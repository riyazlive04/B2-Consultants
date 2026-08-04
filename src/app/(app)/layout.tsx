import { Suspense } from "react";
import { FeedbackHost } from "@/components/ui/feedback";
import { AccessDeniedToast } from "@/components/shell/AccessDeniedToast";
import { NotificationBell } from "@/components/shell/NotificationBell";
import { RunwayBadge } from "@/components/shell/RunwayBadge";
import { AppShell } from "@/components/shell/AppShell";
import { CurrencyProvider } from "@/components/ui/CurrencyToggle";
import { ThemeSync } from "@/components/shell/ThemeSync";
import { SkeletonPill } from "@/components/ui/Skeleton";
import { CallsTodayGreeting } from "@/components/shell/CallsTodayGreeting";
import { istToday } from "@/lib/dates";
import { requireSession, visibleSections, type AppRole } from "@/lib/rbac";
import { getRunwaySnapshot } from "@/server/cash-metrics";
import { getCallsDueToday, getDeskIdentity } from "@/server/telecaller-desk-metrics";
import { computeNotifications } from "@/server/notifications";

/**
 * The two top-bar widgets are the slowest things in the shell: runway walks 3
 * months of expenses, and the notification centre runs the pending-payments,
 * gamification and funnel joins. Awaiting them in the layout blocked EVERY page —
 * the route's own loading.tsx could not even paint until they resolved. Each now
 * streams inside its own Suspense boundary, so the shell and the page skeleton
 * render immediately and the pills fill in when their data lands.
 */
async function RunwaySlot() {
  const runway = await getRunwaySnapshot();
  return <RunwayBadge months={runway.runwayMonths} />;
}

async function BellSlot({ role, userId }: { role: AppRole; userId: string }) {
  const notifications = await computeNotifications(role, userId);
  return <NotificationBell items={notifications} />;
}

/**
 * The telecaller's once-a-day "N calls to make today" greeting. Renders nothing for everyone
 * else — it resolves the signed-in person's TeamProfile and bails unless they're an actual
 * caller, because "telecaller" is a logVariant and no role check can stand in for it.
 * Suspended like the other slots so it never delays the shell.
 */
async function CallsGreetingSlot({ userId }: { userId: string }) {
  // Identity FIRST, and alone. This slot renders on every page in the app, and for everyone who
  // is not a caller — most of the org — it renders nothing at all. It used to reach that
  // conclusion by building the entire telecaller desk: 500 leads with nested call lookups, a
  // month of CallLog rows, all goals. One indexed row now answers "should this render", and the
  // count below runs only for the people it actually renders for.
  const who = await getDeskIdentity(userId);
  if (!who?.isTelecaller) return null;

  const count = await getCallsDueToday(userId);
  return (
    <CallsTodayGreeting
      userId={userId}
      count={count}
      target={who.dailyCallTarget}
      name={who.name.split(" ")[0]}
      todayKey={istToday().toISOString().slice(0, 10)}
    />
  );
}

/** Authenticated shell: grouped, collapsible left sidebar + slim top bar. */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  const accessible = (await visibleSections(session.role, session.overrides))
    // Admin technically has access to everything, but the student portal is a
    // student-only surface — Admin reviews students via /students instead.
    .filter((s) => s.key !== "my-journey" || session.role === "STUDENT");

  /**
   * Two lists, because they answer two different questions.
   *
   * `accessible` is what the viewer may OPEN — it feeds `SectionAccessProvider`, so a cross-link
   * into a section they hold is never stripped. `items` is what the SIDEBAR LISTS, which drops
   * `offRail` sections: Opportunities and Outreach are surfaced on Pipeline, and listing them on
   * the rail as well showed a telecaller five doors into one job.
   *
   * Deriving the rail from the access list (rather than the other way round) is what keeps an
   * off-rail section reachable — the previous shape fed the provider from the rail, so removing
   * an item from the sidebar would also have broken every link to it.
   */
  const items = accessible
    .filter((s) => !s.offRail)
    .map(({ key, label, href, phase, icon, group }) => ({
      key,
      label,
      href,
      phase,
      icon,
      group,
    }));

  return (
    /**
     * ONE ₹/€ provider for the whole authenticated app.
     *
     * It started per-page (Finance, then the dashboard), which broke the moment the notification
     * BELL needed the same currency: the bell lives in this shell, outside any page, so it fell
     * back to INR while the page beside it showed euros. Two providers would have been worse than
     * one — they read the same localStorage key but hold separate state, so flipping the toggle on
     * a page would leave the bell on its old currency until a reload.
     *
     * Emits no DOM node, so wrapping the shell changes no layout.
     */
    <CurrencyProvider>
    <div className="contents">
      {/* The user's own theme wins over whatever this browser happens to have cached. */}
      <ThemeSync preference={session.themePreference} />
      <AppShell
        items={items}
        accessibleHrefs={accessible.map((s) => s.href)}
        user={{
          name: session.user.name,
          email: session.user.email,
          role: session.role,
          image: (session.user as { image?: string | null }).image ?? null,
        }}
        // Runway on every screen (PRD3 §5) - Admin only; others never see cash data.
        runwaySlot={
          session.role === "ADMIN" ? (
            <Suspense fallback={<SkeletonPill className="w-36" />}>
              <RunwaySlot />
            </Suspense>
          ) : undefined
        }
        bellSlot={
          <Suspense fallback={<SkeletonPill className="w-10" />}>
            <BellSlot role={session.role} userId={session.user.id} />
          </Suspense>
        }
      >
        {children}
      </AppShell>
      <FeedbackHost />
      {/* useSearchParams() must sit under a Suspense boundary to keep the layout
          from opting every child page out of static rendering. */}
      <Suspense fallback={null}>
        <AccessDeniedToast />
      </Suspense>
      {/* Telecallers only; resolves to null for everyone else. */}
      <Suspense fallback={null}>
        <CallsGreetingSlot userId={session.user.id} />
      </Suspense>
    </div>
    </CurrencyProvider>
  );
}

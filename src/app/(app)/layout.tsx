import { Suspense } from "react";
import { FeedbackHost } from "@/components/ui/feedback";
import { AccessDeniedToast } from "@/components/shell/AccessDeniedToast";
import { NotificationBell } from "@/components/shell/NotificationBell";
import { RunwayBadge } from "@/components/shell/RunwayBadge";
import { AppShell } from "@/components/shell/AppShell";
import { ThemeSync } from "@/components/shell/ThemeSync";
import { SkeletonPill } from "@/components/ui/Skeleton";
import { CallsTodayGreeting } from "@/components/shell/CallsTodayGreeting";
import { formatMonth } from "@/lib/format";
import { istToday } from "@/lib/dates";
import { requireSession, visibleSections, type AppRole } from "@/lib/rbac";
import { getRunwaySnapshot } from "@/server/cash-metrics";
import { getTelecallerDesk } from "@/server/telecaller-desk-metrics";
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
  const desk = await getTelecallerDesk(userId);
  if (!desk?.isTelecaller) return null;
  return (
    <CallsTodayGreeting
      userId={userId}
      count={desk.today.toCall}
      target={desk.today.target}
      name={desk.name.split(" ")[0]}
      todayKey={istToday().toISOString().slice(0, 10)}
    />
  );
}

/** Authenticated shell: grouped, collapsible left sidebar + slim top bar. */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  const items = (await visibleSections(session.role, session.overrides))
    // Admin technically has access to everything, but the student portal is a
    // student-only surface — Admin reviews students via /students instead.
    .filter((s) => s.key !== "my-journey" || session.role === "STUDENT")
    .map(({ key, label, href, phase, icon, group }) => ({
      key,
      label,
      href,
      phase,
      icon,
      group,
    }));

  return (
    <div className="contents">
      {/* The user's own theme wins over whatever this browser happens to have cached. */}
      <ThemeSync preference={session.themePreference} />
      <AppShell
        items={items}
        user={{
          name: session.user.name,
          email: session.user.email,
          role: session.role,
          image: (session.user as { image?: string | null }).image ?? null,
        }}
        currentMonth={formatMonth(new Date())}
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
  );
}

import { FeedbackHost } from "@/components/ui/feedback";
import { NotificationBell } from "@/components/shell/NotificationBell";
import { RunwayBadge } from "@/components/shell/RunwayBadge";
import { AppShell } from "@/components/shell/AppShell";
import { formatMonth } from "@/lib/format";
import { requireSession, sectionsFor } from "@/lib/rbac";
import { getRunwaySnapshot } from "@/server/cash-metrics";
import { computeNotifications } from "@/server/notifications";

/** Authenticated shell: grouped, collapsible left sidebar + slim top bar. */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  const items = sectionsFor(session.role, session.overrides)
    // Admin technically has access to everything, but the student portal is a
    // student-only surface — Admin reviews students via /students instead.
    .filter((s) => s.key !== "my-journey" || session.role === "STUDENT")
    .map(({ key, label, href, phase }) => ({
      key,
      label,
      href,
      phase,
    }));

  // Runway on every screen (PRD3 §5) - Admin only; others never see cash data.
  const [runway, notifications] = await Promise.all([
    session.role === "ADMIN" ? getRunwaySnapshot() : Promise.resolve(null),
    computeNotifications(session.role, session.user.id),
  ]);

  return (
    // data-role re-keys the accent tokens (globals.css): Admin indigo · Head teal · Member orange.
    <div data-role={session.role} className="contents">
      <AppShell
        items={items}
        user={{
          name: session.user.name,
          email: session.user.email,
          role: session.role,
          image: (session.user as { image?: string | null }).image ?? null,
        }}
        currentMonth={formatMonth(new Date())}
        runwaySlot={runway ? <RunwayBadge months={runway.runwayMonths} /> : undefined}
        bellSlot={<NotificationBell items={notifications} />}
      >
        {children}
      </AppShell>
      <FeedbackHost />
    </div>
  );
}

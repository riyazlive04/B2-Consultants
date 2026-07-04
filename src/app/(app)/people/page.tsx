import { Tabs } from "@/components/ui/Tabs";
import { requireSection } from "@/lib/rbac";
import { getPeopleOverview } from "@/server/people-metrics";
import { listUsers } from "@/server/users-actions";
import { LogsBoard } from "./_components/LogsBoard";
import { OkrBoard } from "./_components/OkrBoard";
import { OrgChart } from "./_components/OrgChart";
import { UsersPanel } from "./_components/UsersPanel";

export const dynamic = "force-dynamic";

export default async function PeoplePage() {
  const session = await requireSection("people"); // Admin-only (PRD2 §2)
  const [{ members, month, weeklyRollup, logs }, users] = await Promise.all([
    getPeopleOverview(),
    listUsers(),
  ]);
  const anyMissing = members.some((m) => m.missingLogBadge);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div>
        <h1 className="font-serif text-3xl font-semibold tracking-tight sm:text-4xl">Users</h1>
        <p className="mt-1 text-sm text-muted">
          Team profiles, OKRs and daily activity - what everyone did today without asking on WhatsApp.
        </p>
      </div>

      <Tabs
        tabs={[
          {
            label: `Daily logs${anyMissing ? " ⚠" : ""}`,
            content: <LogsBoard members={members} weeklyRollup={weeklyRollup} logs={logs} />,
          },
          { label: "OKRs", content: <OkrBoard members={members} month={month} /> },
          { label: "Team & org chart", content: <OrgChart members={members} /> },
          {
            label: "Users & access",
            content: <UsersPanel users={users} currentUserId={session.user.id} />,
          },
        ]}
      />
    </div>
  );
}

import { Tabs } from "@/components/ui/Tabs";
import { requireSection } from "@/lib/rbac";
import { listAccessRequests } from "@/server/access-requests";
import { getPeopleOverview } from "@/server/people-metrics";
import { listUsers } from "@/server/users-actions";
import { getResolvedSections } from "@/server/founder-config";
import { LogsBoard } from "./_components/LogsBoard";
import { OkrBoard } from "./_components/OkrBoard";
import { OrgChart } from "./_components/OrgChart";
import { UsersPanel } from "./_components/UsersPanel";

export const dynamic = "force-dynamic";

export default async function PeoplePage() {
  const session = await requireSection("people"); // Admin-only (PRD2 §2)
  const [{ members, month, weeklyRollup, logs }, users, accessRequests, sections] = await Promise.all([
    getPeopleOverview(),
    listUsers(),
    listAccessRequests(),
    getResolvedSections(),
  ]);
  const anyMissing = members.some((m) => m.missingLogBadge);

  // Who is doing the granting. The dialog greys out anything they can't hand out —
  // and users-actions refuses it again server-side.
  const actor = { id: session.user.id, role: session.role, capabilities: session.capabilities };

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div>
        <h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">Users</h1>
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
            label: `Users & access${accessRequests.length ? ` (${accessRequests.length})` : ""}`,
            content: (
              <UsersPanel
                users={users}
                currentUserId={session.user.id}
                accessRequests={accessRequests}
                sections={sections}
                actor={actor}
              />
            ),
          },
        ]}
      />
    </div>
  );
}

import { Users } from "lucide-react";
import { Tabs } from "@/components/ui/Tabs";
import { getDuplicatesReport } from "@/server/duplicates-metrics";
import { DuplicatesPanel } from "./_components/DuplicatesPanel";
import { PageHeader } from "@/components/ui/kit";
import { requireSection } from "@/lib/rbac";
import { listAccessRequests } from "@/server/access-requests";
import { getPeopleOverview } from "@/server/people-metrics";
import { TELECALLER_VARIANTS } from "@/server/telecaller-desk-metrics";
import { listUsers } from "@/server/users-actions";
import { getResolvedSections } from "@/server/founder-config";
import { LogsBoard } from "./_components/LogsBoard";
import { OkrBoard } from "./_components/OkrBoard";
import { OrgChart } from "./_components/OrgChart";
import { UsersPanel } from "./_components/UsersPanel";

export const dynamic = "force-dynamic";

export default async function PeoplePage() {
  const session = await requireSection("people"); // Admin-only (PRD2 §2)
  const [{ members, month, weeklyRollup, monthlyRollup, entries }, users, accessRequests, sections, duplicates] =
    await Promise.all([
      getPeopleOverview(),
      listUsers(),
      listAccessRequests(),
      getResolvedSections(),
      getDuplicatesReport(),
    ]);
  const duplicateCount = duplicates.leads.length + duplicates.students.length + duplicates.users.length;

  /**
   * The daily-log board is for the people whose day is NOT already measured elsewhere.
   *
   * A telecaller's work is counted from their actual calls - My Desk shows their own numbers and
   * Telecaller Pay shows the team board, both derived from CallLog rather than self-reported.
   * Asking them to also write a daily log meant the same day was recorded twice, by two methods 
   * that could disagree, and the hand-typed one is the one nobody could check. So they come off 
   * this board (and off the My Daily Log rail entry - see lib/sections.ts).
   *
   * Coaches and tutors stay: a delivery session leaves no CallLog behind, so their log IS the
   * record. Filtered here rather than in getPeopleOverview because OKRs and the org chart below
   * still need the whole team.
   */
  const logMembers = members.filter(
    (m) => !TELECALLER_VARIANTS.includes(m.logVariant as (typeof TELECALLER_VARIANTS)[number]),
  );
  // Filtered on the entry's OWN variant rather than by looking its author up: a log written
  // while someone was a telecaller stays a telecaller's log even if their profile changes later.
  const logEntries = entries.filter(
    (e) => !TELECALLER_VARIANTS.includes(e.variant as (typeof TELECALLER_VARIANTS)[number]),
  );
  const anyMissing = logMembers.some((m) => m.missingLogBadge);

  // Who is doing the granting. The dialog greys out anything they can't hand out -
  // and users-actions refuses it again server-side.
  const actor = { id: session.user.id, role: session.role, capabilities: session.capabilities };

  return (
    <div className="w-full space-y-6">
      <PageHeader
        icon={<Users size={20} />}
        title="Users"
        subtitle="Team profiles, OKRs and daily activity - what everyone did today without asking on WhatsApp."
      />

      <Tabs
        tabs={[
          {
            label: `Daily logs${anyMissing ? " ⚠" : ""}`,
            content: <LogsBoard members={logMembers} weeklyRollup={weeklyRollup} monthlyRollup={monthlyRollup} entries={logEntries} />,
          },
          { label: "OKRs", content: <OkrBoard members={members} month={month} /> },
          { label: "Team & org chart", content: <OrgChart members={members} /> },
          {
            label: `Duplicates${duplicateCount ? ` (${duplicateCount})` : ""}`,
            content: <DuplicatesPanel report={duplicates} canMerge={session.role === "ADMIN"} />,
          },
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

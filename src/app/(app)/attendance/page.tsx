import { ClipboardCheck, Eye, Radio, UserCheck } from "lucide-react";
import { requireSection } from "@/lib/rbac";
import { getAttendanceBoard } from "@/server/attendance-board";
import { AttendanceDesk } from "./_components/AttendanceDesk";
import { MetricCard } from "@/components/ui/MetricCard";
import { EngineOffNotice, PageHeader } from "@/components/ui/kit";
import { enginesOff } from "@/server/engine-status";
import { formatDate } from "@/lib/format";

export const metadata = { title: "Attendance" };
export const dynamic = "force-dynamic";

/**
 * THE REGISTER DESK.
 *
 * Gated on the `attendance` section rather than on a role, so the founder can hand it to - or
 * take it from - a person in Console → Sections. The board SCOPES ITSELF (`getAttendanceBoard`
 * returns only the cohorts you lead, or every cohort for a supervisor), so granting the
 * section to someone who teaches nothing shows them an honest empty desk rather than somebody
 * else's week.
 *
 * Marking is still fenced per BATCH inside every action - a section is what puts a door in the
 * sidebar, never what decides whether a register may be written. See `canMark` in
 * server/attendance-actions.ts.
 */
export default async function AttendancePage() {
  const session = await requireSection("attendance");
  // A missed class looks identical to a class nobody scheduled when no reminder goes out.
  const enginesDown = await enginesOff(["classReminders"]);
  const board = await getAttendanceBoard(session);

  const openNow = board.liveNow.length;
  const owed = board.outstanding.length;
  const toShow = board.unpublished.length;
  const checkedInToday = board.today.reduce((a, s) => a + s.checkedInCount, 0);

  return (
    <div className="w-full space-y-6">
      <PageHeader
        icon={<UserCheck size={20} />}
        title="Attendance"
        subtitle={
          board.supervising
            ? "Every active cohort - you lead none of them, so this is the supervisor's view."
            : "Open the register in class and let the room mark itself, then correct what is left."
        }
      />

      {/* Built, and switched off - said on the screen it affects rather than only on the
          Console, because an engine nobody armed is indistinguishable from a broken one. */}
      <EngineOffNotice engines={enginesDown} canOpenConsole={session.role === "ADMIN"} />

      <div className="grid grid-cols-1 gap-4 min-[480px]:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="Open right now"
          value={openNow}
          signal={openNow > 0 ? "ok" : undefined}
          icon={<Radio size={18} />}
          detail={{
            rows: board.liveNow.map((s) => ({
              label: s.title,
              value: `${s.markedCount}/${s.rosterSize}`,
            })),
          }}
        />
        <MetricCard
          label="Checked in today"
          value={checkedInToday}
          icon={<UserCheck size={18} />}
          detail={{
            rows: board.today.map((s) => ({
              label: s.title,
              value: `${s.checkedInCount} of ${s.rosterSize}`,
            })),
          }}
        />
        <MetricCard
          label="Never marked"
          value={owed}
          signal={owed > 0 ? "watch" : "ok"}
          icon={<ClipboardCheck size={18} />}
          detail={{
            rows: board.outstanding.slice(0, 8).map((s) => ({
              label: s.title,
              value: formatDate(s.dateYmd),
            })),
          }}
        />
        <MetricCard
          label="Not shown to students"
          value={toShow}
          signal={toShow > 0 ? "watch" : "ok"}
          icon={<Eye size={18} />}
          detail={{
            rows: board.unpublished.slice(0, 8).map((s) => ({
              label: s.title,
              value: formatDate(s.dateYmd),
            })),
          }}
        />
      </div>

      <AttendanceDesk board={board} />
    </div>
  );
}

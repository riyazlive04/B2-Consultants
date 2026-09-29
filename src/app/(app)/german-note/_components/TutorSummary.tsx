import Link from "next/link";
import { BookOpen, GraduationCap, Users } from "lucide-react";
import { Card, Hint } from "@/components/ui/kit";
import { BOOK_ORDER_STATUS_LABELS } from "@/lib/labels";
import type { TutorDesk } from "@/server/tutor-desk";

/**
 * The tutor's own summary (rebuild spec §9), shown above the German Note batch cards - a tutor is
 * redirected here on sign-in, so this page is effectively their dashboard.
 *
 * Student IDs are printed beside every name because §9 asks for them explicitly: a tutor referring
 * a student to the head coach names the ID, and hunting for it on another screen is the friction
 * the spec is removing.
 *
 * ATTENDANCE IS ABSENT ON PURPOSE. §9 lists it, but the schema has no attendance model and nothing
 * existing stands in for it - a watched recording is not a student who turned up. Faking it from a
 * lookalike would be worse than the gap.
 */

export function TutorSummary({ desk }: { desk: TutorDesk }) {
  const activeBatches = desk.batches.filter((b) => b.status === "ACTIVE");
  const uniqueStudents = new Set(desk.students.map((s) => s.studentId)).size;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card title={<span className="flex items-center gap-2"><Users size={16} /> Your batches</span>}>
          <p className="font-display text-3xl font-bold tnum text-ink">{activeBatches.length}</p>
          <p className="mt-1 text-caption text-muted">
            {uniqueStudents} student{uniqueStudents === 1 ? "" : "s"} across{" "}
            {desk.batches.length} batch{desk.batches.length === 1 ? "" : "es"} in total
          </p>
        </Card>

        <Card title={<span className="flex items-center gap-2"><GraduationCap size={16} /> Sessions delivered</span>}>
          <p className="font-display text-3xl font-bold tnum text-ink">{desk.sessionsToday}</p>
          <p className="mt-1 text-caption text-muted">
            today · {desk.sessionsThisMonth} this month
          </p>
          <Hint>Read back from your daily log - this is the figure the head coach sees.</Hint>
        </Card>

        <Card title={<span className="flex items-center gap-2"><BookOpen size={16} /> Book orders</span>}>
          <p
            className="font-display text-3xl font-bold tnum"
            style={{ color: desk.bookOrdersHeld > 0 ? "var(--warn)" : "var(--ink)" }}
          >
            {desk.bookOrdersHeld}
          </p>
          <p className="mt-1 text-caption text-muted">
            {desk.bookOrdersHeld === 0
              ? "No student is waiting on books"
              : `student${desk.bookOrdersHeld === 1 ? "" : "s"} still waiting on books`}
          </p>
          {desk.bookOrders.length > 0 && (
            <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-caption text-muted">
              {desk.bookOrders.map((o) => (
                <span key={o.status}>
                  {BOOK_ORDER_STATUS_LABELS[o.status] ?? o.status}: <span className="tnum font-semibold">{o.count}</span>
                </span>
              ))}
            </p>
          )}
        </Card>
      </div>

      {desk.students.length > 0 && (
        <Card title="Your students" subtitle="ID beside each name - the reference the head coach asks for.">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-line-strong text-left">
                  <th className="py-2 pr-3 font-semibold text-ink-2">Student</th>
                  <th className="px-3 py-2 font-semibold text-ink-2">ID</th>
                  <th className="py-2 pl-3 font-semibold text-ink-2">Batch</th>
                </tr>
              </thead>
              <tbody>
                {desk.students.map((s) => (
                  <tr key={`${s.studentId}-${s.batchName}`} className="border-b border-line last:border-0">
                    <td className="py-2 pr-3">
                      <Link href={`/students/${s.studentId}`} className="font-medium text-ink hover:underline">
                        {s.name}
                      </Link>
                    </td>
                    <td className="px-3 py-2 tnum text-muted">{s.studentCode ?? "-"}</td>
                    <td className="py-2 pl-3 text-muted">{s.batchName}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

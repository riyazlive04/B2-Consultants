import Link from "next/link";
import { notFound } from "next/navigation";
import { istToday, toDateInputValue } from "@/lib/dates";
import { hasCapability, requireSection } from "@/lib/rbac";
import { getStudentDetail } from "@/server/students-metrics";
import { getWeeklyReports } from "@/server/weekly-report";
import { StudentDetailClient } from "./_components/StudentDetailClient";

export const dynamic = "force-dynamic";

export default async function StudentDetailPage({ params }: { params: { id: string } }) {
  const session = await requireSection("students");
  const student = await getStudentDetail(params.id);
  if (!student) notFound();

  /**
   * The weekly rollup, gathered HERE rather than inside `getStudentDetail`.
   *
   * It is five extra queries per enrolment with a sprint plan, and `getStudentDetail` is also
   * read by screens that have no use for it. Enrolments with no plan are skipped, so a Solo
   * student costs nothing.
   */
  const weeklyReports = await getWeeklyReports(
    student.enrollments.filter((e) => e.sprintWeeks.length > 0).map((e) => e.id),
  );

  return (
    <div className="w-full space-y-6">
      <Link href="/students" className="text-sm text-accent hover:underline">
        ← All students
      </Link>
      <StudentDetailClient
        student={student}
        isAdmin={session.role === "ADMIN"}
        canEditTracker={session.role === "ADMIN" || session.role === "HEAD"}
        canSeat={hasCapability(session.role, session.capabilities, "batches.manage")}
        todayKey={toDateInputValue(istToday())}
        weeklyReports={weeklyReports}
      />
    </div>
  );
}

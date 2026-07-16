import Link from "next/link";
import { notFound } from "next/navigation";
import { istToday, toDateInputValue } from "@/lib/dates";
import { requireSection } from "@/lib/rbac";
import { getStudentDetail } from "@/server/students-metrics";
import { StudentDetailClient } from "./_components/StudentDetailClient";

export const dynamic = "force-dynamic";

export default async function StudentDetailPage({ params }: { params: { id: string } }) {
  const session = await requireSection("students");
  const student = await getStudentDetail(params.id);
  if (!student) notFound();

  return (
    <div className="w-full space-y-6">
      <Link href="/students" className="text-sm text-accent hover:underline">
        ← All students
      </Link>
      <StudentDetailClient
        student={student}
        isAdmin={session.role === "ADMIN"}
        canEditTracker={session.role === "ADMIN" || session.role === "HEAD"}
        todayKey={toDateInputValue(istToday())}
      />
    </div>
  );
}

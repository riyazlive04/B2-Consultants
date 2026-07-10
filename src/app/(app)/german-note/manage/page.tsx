import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Tabs } from "@/components/ui/Tabs";
import { requireAdmin, requireSection } from "@/lib/rbac";
import { getGnManageData } from "@/server/german-note-metrics";
import { BatchesPanel } from "../_components/BatchesPanel";
import { MembersPanel } from "../_components/MembersPanel";
import { TutorsPanel } from "../_components/TutorsPanel";

export const dynamic = "force-dynamic";

export default async function GnManagePage() {
  await requireSection("german-note");
  await requireAdmin(); // belt and braces — management is Admin-only
  const { batches, tutors, students } = await getGnManageData();

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <Link href="/german-note" className="inline-flex items-center gap-1 text-xs font-medium text-muted hover:text-ink">
          <ArrowLeft size={13} /> German Note
        </Link>
        <h1 className="mt-2 font-display text-3xl font-bold tracking-tight sm:text-4xl">Manage German Note</h1>
        <p className="mt-1 text-sm text-muted">
          Batches, who&apos;s in them, and tutor accounts. Tutors post recordings into their own batches.
        </p>
      </div>

      <Tabs
        tabs={[
          { label: "Batches", content: <BatchesPanel batches={batches} tutors={tutors} /> },
          { label: "Members", content: <MembersPanel batches={batches} students={students} /> },
          { label: "Tutors", content: <TutorsPanel tutors={tutors} /> },
        ]}
      />
    </div>
  );
}

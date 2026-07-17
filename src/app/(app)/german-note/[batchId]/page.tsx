import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, Users } from "lucide-react";
import { Tabs } from "@/components/ui/Tabs";
import { PageHeader } from "@/components/ui/kit";
import { requireSection } from "@/lib/rbac";
import { getGnBatchDetail } from "@/server/german-note-metrics";
import { ClassroomPanel } from "../_components/ClassroomPanel";
import { CommunityFeed } from "../_components/CommunityFeed";
import { LevelChip, StatusChip } from "../_components/LevelChip";
import { SchedulePanel } from "../_components/SchedulePanel";

export const dynamic = "force-dynamic";

export default async function GnBatchPage({ params }: { params: { batchId: string } }) {
  const session = await requireSection("german-note");
  const batch = await getGnBatchDetail(params.batchId, session.role, session.user.id);
  if (!batch) redirect("/german-note"); // not found OR not this viewer's batch

  const isArchived = batch.status === "ARCHIVED";

  return (
    <div className="w-full space-y-6">
      <div>
        <Link href="/german-note" className="inline-flex items-center gap-1 text-xs font-medium text-muted hover:text-ink">
          <ArrowLeft size={13} /> German Note
        </Link>
        <PageHeader
          title={batch.name}
          subtitle={`${batch.tutorName ? `Tutor: ${batch.tutorName}` : "No tutor assigned yet"}${batch.notes ? ` · ${batch.notes}` : ""}`}
          actions={
            <>
              <LevelChip level={batch.level} />
              <StatusChip status={batch.status} />
            </>
          }
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_240px]">
        <Tabs
          tabs={[
            {
              label: "Classroom",
              content: (
                <ClassroomPanel
                  batchId={batch.id}
                  classroom={batch.classroom}
                  modules={batch.modules}
                  canManage={batch.canManage}
                  recordingTotal={batch.recordingTotal}
                  watchedCount={batch.watchedCount}
                />
              ),
            },
            {
              label: `Schedule${batch.events.some((e) => !e.isPast) ? ` (${batch.events.filter((e) => !e.isPast).length})` : ""}`,
              content: <SchedulePanel batchId={batch.id} events={batch.events} canManage={batch.canManage} />,
            },
            {
              label: "Discussion",
              content: (
                <div className="space-y-3">
                  {isArchived && (
                    <p className="rounded-field bg-surface-2 px-3 py-2 text-xs text-muted">
                      This batch is archived — the discussion is read-only, but your class recordings stay available for lifetime.
                    </p>
                  )}
                  <CommunityFeed
                    batchId={batch.id}
                    posts={batch.feed}
                    canPost={!isArchived && batch.canPost}
                    candidates={batch.mentionCandidates}
                    placeholder="Ask your batch or tutor something…"
                  />
                </div>
              ),
            },
          ]}
        />

        <aside className="h-fit rounded-card border border-line bg-surface p-4 shadow-card">
          <h3 className="flex items-center gap-2 font-display text-[15px] font-semibold">
            <Users size={15} className="text-[var(--lvl-gn)]" /> Members
          </h3>
          <ul className="mt-3 space-y-1.5">
            {batch.members.length === 0 && <li className="text-xs text-muted">No members yet.</li>}
            {batch.members.map((m) => (
              <li key={m.id} className="truncate text-sm text-ink-2">
                {m.fullName}
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </div>
  );
}

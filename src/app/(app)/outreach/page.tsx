import { AlarmClock, CheckCircle2, ListTodo, MessageCircle, PauseCircle } from "lucide-react";
import { MetricCard } from "@/components/ui/MetricCard";
import { Tabs } from "@/components/ui/Tabs";
import { requireSection } from "@/lib/rbac";
import { OUTREACH_PHASE_LABELS } from "@/lib/outreach-sop";
import { getWatiRuntime } from "@/lib/wati";
import { readOutreachConfig } from "@/server/outreach";
import { getOutreachQueue, getKeyMetrics, getAssignableUsers, getClosedJourneys } from "@/server/outreach-metrics";
import { QueueList } from "./_components/QueueList";
import { KeyMetricsTable } from "./_components/KeyMetricsTable";
import { OutreachSettings } from "./_components/OutreachSettings";

export const dynamic = "force-dynamic";

/**
 * The Outreach Specialist SOP (Script_for_Outreach_Specialist.docx, Steps 1–23), as a screen.
 *
 * Three surfaces:
 *   · Queue       — what to do next, with the message already written (Steps 2–21)
 *   · Key Metrics — "Key Metrics Sales B2_2026.xlsx" (Step 12 onward)
 *   · Closed      — Step 9's IGNORE bucket and the cancellations. Dormant, never deleted.
 */
export default async function OutreachPage() {
  const session = await requireSection("outreach");
  const isAdmin = session.role === "ADMIN";

  const [queue, keyMetrics, users, closed, config, wati] = await Promise.all([
    getOutreachQueue(),
    getKeyMetrics(),
    getAssignableUsers(),
    getClosedJourneys(),
    readOutreachConfig(),
    getWatiRuntime(),
  ]);

  return (
    <div className="w-full space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-line bg-surface px-5 py-4 shadow-card">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 flex-none place-items-center rounded-field bg-accent-soft text-accent">
            <MessageCircle size={20} />
          </span>
          <div>
            <h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">Outreach</h1>
            <p className="text-xs text-muted">
              The Outreach Specialist SOP, steps 1–23 — opt-in to SSS confirmation.
            </p>
          </div>
        </div>
        {!queue.enabled && (
          <span
            className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold"
            style={{ background: "var(--surface-2)", color: "var(--muted)" }}
          >
            <PauseCircle size={13} /> Engine off{isAdmin ? " — turn it on in Settings" : ""}
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="Due now"
          value={queue.counts.due}
          secondary="Steps waiting on you"
          signal={queue.counts.due > 0 ? "watch" : "ok"}
          icon={<ListTodo size={18} />}
        />
        <MetricCard
          label="Reaction SLA at risk"
          value={queue.counts.breaching}
          secondary="Opted in, not yet contacted"
          tooltip="SOP Step 2: contact within 5 minutes of opt-in to stay on the Step 3 path. Past that, the SOP skips the WhatsApp intro and goes straight to the Step 10 booking check."
          signal={queue.counts.breaching > 0 ? "risk" : "ok"}
          icon={<AlarmClock size={18} />}
        />
        <MetricCard
          label="Scheduled"
          value={queue.counts.upcoming}
          secondary="Materialised, not yet due"
          icon={<CheckCircle2 size={18} />}
        />
        <MetricCard
          label="In flight"
          value={queue.counts.waiting}
          secondary="Waiting on the prospect or Discovery"
          icon={<MessageCircle size={18} />}
        />
      </div>

      <Tabs
        tabs={[
          {
            label: `Due now (${queue.counts.due})`,
            content: (
              <QueueList
                rows={queue.due}
                empty={
                  queue.enabled
                    ? "Nothing due. Every prospect is either waiting on a reply or scheduled for later."
                    : "The engine is off, so no steps are being scheduled."
                }
              />
            ),
          },
          {
            label: `Scheduled (${queue.counts.upcoming})`,
            content: <QueueList rows={queue.upcoming} empty="Nothing scheduled ahead." />,
          },
          {
            label: `In flight (${queue.counts.waiting})`,
            content: (
              <QueueList rows={queue.waiting} empty="No prospects are waiting on someone else right now." />
            ),
          },
          {
            label: "Key Metrics",
            content: <KeyMetricsTable rows={keyMetrics} users={users} />,
          },
          {
            label: `Closed (${closed.length})`,
            content: (
              <div className="rounded-card border border-line bg-surface p-5 shadow-card">
                <p className="mb-3 text-xs text-muted">
                  Ignored, cancelled and completed journeys. Step 9&apos;s &ldquo;IGNORE&rdquo; keeps the
                  prospect in the records — nothing here is deleted.
                </p>
                {closed.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted">Nothing closed yet.</p>
                ) : (
                  <ul className="divide-y divide-line">
                    {closed.map((c) => (
                      <li key={c.journeyId} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                        <span className="text-sm font-medium" style={c.red ? { color: "var(--risk)" } : undefined}>
                          {c.name}
                          <span className="ml-2 text-xs font-normal text-muted">{c.phone}</span>
                        </span>
                        <span className="flex items-center gap-2 text-xs text-muted">
                          {c.redReason && <span style={{ color: "var(--risk)" }}>{c.redReason}</span>}
                          <span className="rounded-full bg-surface-2 px-2 py-0.5 font-medium">
                            {OUTREACH_PHASE_LABELS[c.phase] ?? c.phase}
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ),
          },
          ...(isAdmin
            ? [
                {
                  label: "Settings",
                  content: <OutreachSettings config={config} watiLive={wati.enabled} />,
                },
              ]
            : []),
        ]}
      />
    </div>
  );
}

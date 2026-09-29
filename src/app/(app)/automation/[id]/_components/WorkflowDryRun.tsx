"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertTriangle, ChevronDown, ChevronRight, Clock, Eye, Info, Play, Send, Users } from "lucide-react";
import { Btn, SegmentedControl } from "@/components/ui/controls";
import { Card, EmptyState, Pill, Stat, TableShell, Td, Th, Tr, type Tone } from "@/components/ui/kit";
import { toast } from "@/components/ui/feedback";
import { previewWorkflow } from "@/server/automation-actions";
import type { DryRunReport } from "@/server/automation-dryrun";
import { OUTCOME_LABELS, summarise, type ProjectedEnrollment, type StepOutcome } from "@/lib/automation-dryrun";
import { ACTION_LABELS, type TriggerConfig, type TriggerType, type WorkflowAction } from "@/lib/automation-types";

/**
 * Dry run panel - "if this had been live last month, what would it have done?"
 *
 * The question this screen exists to answer is not "does the builder work" but "is it safe to
 * arm this at 23,000 contacts". So the layout leads with the three numbers that decide that -
 * how many events fired, how many the trigger accepted, how many people would actually be
 * enrolled - then what those people would RECEIVE, and only then the per-step detail.
 *
 * It previews the definition on screen, unsaved edits included, which is the only version that
 * matters before you commit. When that differs from what's saved, the panel says so, because
 * publishing arms the SAVED definition - previewing one thing and arming another is the exact
 * mistake this feature is meant to prevent.
 *
 * Every unreachable contact, off channel and deleted template is shown as prominently as the
 * successes: a preview that only reports good news would be worse than no preview at all.
 */

const WINDOWS = [
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
] as const;

const OUTCOME_TONE: Record<StepOutcome, Tone> = {
  DELIVERED: "good",
  LOGGED_ONLY: "warn",
  UNREACHABLE: "bad",
  NOTHING_TO_SEND: "bad",
  CHANGED: "primary",
  NO_CHANGE: "neutral",
  MISCONFIGURED: "bad",
  BRANCH: "info",
  WAITED: "neutral",
};

const n = (v: number) => v.toLocaleString("en-IN");

/** "3 days", "4 hours", "25 minutes" - how long one contact stays in the workflow. */
function duration(mins: number): string {
  if (mins <= 0) return "instant";
  if (mins < 60) return `${mins} min`;
  if (mins < 1440) return `${Math.round((mins / 60) * 10) / 10} hr`;
  return `${Math.round((mins / 1440) * 10) / 10} days`;
}

function time(d: Date): string {
  return new Date(d).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  });
}

export default function WorkflowDryRun({
  triggerType,
  triggerConfig,
  actions,
  dirty,
  disabled,
}: {
  triggerType: TriggerType;
  triggerConfig: TriggerConfig;
  actions: WorkflowAction[];
  /** the editor holds changes that haven't been saved - publishing would arm something else */
  dirty: boolean;
  disabled: boolean;
}) {
  const [windowDays, setWindowDays] = useState<(typeof WINDOWS)[number]["value"]>("30");
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<DryRunReport | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    const res = await previewWorkflow({
      triggerType,
      triggerConfig,
      actions,
      windowDays: Number(windowDays),
    });
    setBusy(false);
    if (!res.ok) {
      setReport(null);
      return toast(res.error, "error");
    }
    setOpen(null);
    setReport(res.report);
  }

  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          <Eye size={16} className="text-primary" /> Dry run
        </span>
      }
      subtitle="Replay this workflow over what really happened. Nothing is enrolled, nothing is sent."
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <SegmentedControl
            ariaLabel="Preview window"
            value={windowDays}
            onChange={setWindowDays}
            options={WINDOWS}
          />
          <Btn variant="primary" icon={<Play size={15} />} onClick={run} busy={busy} disabled={disabled}>
            Preview
          </Btn>
        </div>
      }
    >
      {dirty && (
        <p className="mb-4 flex items-start gap-2 rounded-field border border-warn bg-warn-soft px-3 py-2 text-sm text-warn">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" />
          You have unsaved edits. This previews what's on screen - save before publishing, or you'll arm the older version.
        </p>
      )}

      {!report ? (
        <EmptyState
          icon={<Eye size={22} />}
          title="Nothing previewed yet"
          body={
            actions.length === 0
              ? "Add an action first - there's nothing to project."
              : "Pick a window and hit Preview. You'll see exactly who this would have enrolled, what each of them would have received, and where it would have failed."
          }
        />
      ) : (
        <Results report={report} open={open} setOpen={setOpen} />
      )}
    </Card>
  );
}

function Results({
  report,
  open,
  setOpen,
}: {
  report: DryRunReport;
  open: string | null;
  setOpen: (v: string | null) => void;
}) {
  const r = report.result;
  const sends = r.messages;
  const totalSendSteps =
    sends.delivered.email + sends.delivered.sms + sends.loggedOnly.email + sends.loggedOnly.sms + sends.unreachable.email + sends.unreachable.sms + sends.nothingToSend;
  const totalChanges = r.changes.tagsAdded + r.changes.tagsRemoved + r.changes.stageMoves + r.changes.tasksCreated;

  return (
    <div className="space-y-6">
      <p className="font-display text-h3 text-ink">{summarise(r)}</p>

      {!report.engineEnabled && (
        <p className="flex items-start gap-2 rounded-field border border-risk bg-risk-soft px-3 py-2 text-sm text-risk">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" />
          The automation engine is switched off globally, so nothing is running right now - this is what would happen
          once it's back on. <Link href="/automation/settings" className="underline">Settings</Link>
        </p>
      )}

      {/* The three numbers that decide whether it's safe to arm. */}
      <div className="grid grid-cols-1 gap-4 rounded-field border border-line bg-surface-2 p-4 sm:grid-cols-3">
        <div>
          <Stat label={`Triggers in ${report.windowDays} days`} value={n(r.scanned)} />
          <p className="mt-1 text-caption text-ink-3">from {report.source.label}</p>
        </div>
        <div>
          <Stat label="Match this trigger" value={n(r.matched)} />
          <p className="mt-1 text-caption text-ink-3">
            {r.scanned === r.matched ? "no trigger filter set" : `${n(r.scanned - r.matched)} filtered out`}
          </p>
        </div>
        <div>
          <Stat label="Would enrol" value={n(r.enrolled)} tone="primary" />
          <p className="mt-1 text-caption text-ink-3">
            {n(r.contacts)} contact{r.contacts === 1 ? "" : "s"}
            {r.blockedInFlight > 0 && ` · ${n(r.blockedInFlight)} blocked mid-run`}
            {r.blockedAlreadyRan > 0 && ` · ${n(r.blockedAlreadyRan)} already ran once`}
          </p>
        </div>
      </div>

      {/* What people would actually receive. */}
      {totalSendSteps > 0 && (
        <section>
          <h4 className="mb-2 flex items-center gap-2 text-label font-semibold uppercase text-ink-3">
            <Send size={13} /> Messages
          </h4>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Tile
              label="Delivered"
              value={sends.delivered.email + sends.delivered.sms}
              tone="good"
              detail={`${n(sends.delivered.email)} email · ${n(sends.delivered.sms)} SMS`}
            />
            <Tile
              label="Logged only"
              value={sends.loggedOnly.email + sends.loggedOnly.sms}
              tone={sends.loggedOnly.email + sends.loggedOnly.sms > 0 ? "warn" : "neutral"}
              detail="channel is off - nobody receives these"
            />
            <Tile
              label="Can't reach"
              value={sends.unreachable.email + sends.unreachable.sms}
              tone={sends.unreachable.email + sends.unreachable.sms > 0 ? "bad" : "neutral"}
              detail={`${n(sends.unreachable.email)} no email · ${n(sends.unreachable.sms)} no phone`}
            />
            <Tile
              label="Held by quiet hours"
              value={sends.heldByQuietHours}
              tone={sends.heldByQuietHours > 0 ? "info" : "neutral"}
              detail={
                report.quietHours.enabled
                  ? `sent at ${String(report.quietHours.endHour).padStart(2, "0")}:00 instead`
                  : "quiet hours are off"
              }
            />
          </div>
          <p className="mt-2 text-caption text-ink-3">
            Email: {report.channels.email.reason} · SMS: {report.channels.sms.reason}
          </p>
        </section>
      )}

      {/* What it would do to the records themselves. */}
      {(totalChanges > 0 || r.changes.noChange > 0) && (
        <section>
          <h4 className="mb-2 flex items-center gap-2 text-label font-semibold uppercase text-ink-3">
            <Users size={13} /> Record changes
          </h4>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <Tile label="Tags added" value={r.changes.tagsAdded} tone="primary" />
            <Tile label="Tags removed" value={r.changes.tagsRemoved} tone="primary" />
            <Tile label="Stage moves" value={r.changes.stageMoves} tone="primary" />
            <Tile label="Tasks created" value={r.changes.tasksCreated} tone="primary" />
            <Tile label="No-ops" value={r.changes.noChange} tone="neutral" detail="already in that state" />
          </div>
        </section>
      )}

      {/* Per-step breakdown - where in the list things go wrong. */}
      {r.enrolled > 0 && (
        <section>
          <h4 className="mb-2 text-label font-semibold uppercase text-ink-3">Step by step</h4>
          <div className="rounded-field border border-line">
            <TableShell
              minWidth={640}
              head={
                <>
                  <Th>Step</Th>
                  <Th align="right">Runs</Th>
                  <Th>Outcomes</Th>
                </>
              }
            >
              {r.byAction.map((a) => (
                <Tr key={a.index}>
                  <Td>
                    <span className="flex items-center gap-2">
                      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-primary-soft text-caption text-primary-strong">
                        {a.index + 1}
                      </span>
                      <span className="font-medium text-ink">{ACTION_LABELS[a.type]}</span>
                    </span>
                  </Td>
                  <Td align="right">{n(a.runs)}</Td>
                  <Td>
                    {a.outcomes.length === 0 ? (
                      <span className="text-caption text-ink-3">never reached</span>
                    ) : (
                      <span className="flex flex-wrap gap-1.5">
                        {a.outcomes
                          .slice()
                          .sort((x, y) => y.count - x.count)
                          .map((o) => (
                            <Pill key={o.outcome} tone={OUTCOME_TONE[o.outcome]}>
                              {OUTCOME_LABELS[o.outcome]} · {n(o.count)}
                            </Pill>
                          ))}
                      </span>
                    )}
                  </Td>
                </Tr>
              ))}
            </TableShell>
          </div>
          {r.longestRunMinutes > 0 && (
            <p className="mt-2 flex items-center gap-1.5 text-caption text-ink-3">
              <Clock size={12} /> The longest run keeps a contact in this workflow for {duration(r.longestRunMinutes)}.
            </p>
          )}
        </section>
      )}

      {/* "Show me one" - the individual runs, step by step. */}
      {r.sample.length > 0 && (
        <section>
          <h4 className="mb-2 text-label font-semibold uppercase text-ink-3">
            First {r.sample.length} of {n(r.enrolled)} runs
          </h4>
          <div className="divide-y divide-line rounded-field border border-line">
            {r.sample.map((s, i) => (
              <SampleRow
                key={`${s.leadId}-${i}`}
                run={s}
                open={open === `${s.leadId}-${i}`}
                onToggle={() => setOpen(open === `${s.leadId}-${i}` ? null : `${s.leadId}-${i}`)}
              />
            ))}
          </div>
        </section>
      )}

      {r.warnings.length > 0 && (
        <section className="rounded-field border border-warn bg-warn-soft p-3">
          <h4 className="mb-1.5 flex items-center gap-2 text-label font-semibold uppercase text-warn">
            <AlertTriangle size={13} /> Worth fixing first
          </h4>
          <ul className="space-y-1 text-sm text-warn">
            {r.warnings.map((w) => (
              <li key={w}>· {w}</li>
            ))}
          </ul>
        </section>
      )}

      <section className="rounded-field border border-line bg-surface-2 p-3">
        <h4 className="mb-1.5 flex items-center gap-2 text-label font-semibold uppercase text-ink-3">
          <Info size={13} /> How exact this is
        </h4>
        <ul className="space-y-1 text-caption text-ink-2">
          <li>· {report.source.coverage}</li>
          <li>
            · Re-enrollment is {report.allowReEnrollment ? "allowed once a contact finishes" : "once per contact, ever"},
            matching the current global setting.
          </li>
          {r.approximations.map((a) => (
            <li key={a}>· {a}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function Tile({ label, value, tone, detail }: { label: string; value: number; tone: Tone; detail?: string }) {
  const colour =
    value === 0
      ? "text-ink-3"
      : tone === "good"
        ? "text-good"
        : tone === "warn"
          ? "text-warn"
          : tone === "bad"
            ? "text-bad"
            : tone === "info"
              ? "text-ink-2"
              : tone === "primary"
                ? "text-primary-strong"
                : "text-ink";
  return (
    <div className="rounded-field border border-line bg-surface p-3">
      <p className="text-label font-semibold uppercase text-ink-3">{label}</p>
      <p className={`tnum mt-0.5 font-display text-h2 ${colour}`}>{n(value)}</p>
      {detail && <p className="mt-0.5 text-caption text-ink-3">{detail}</p>}
    </div>
  );
}

function SampleRow({ run, open, onToggle }: { run: ProjectedEnrollment; open: boolean; onToggle: () => void }) {
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-surface-2"
      >
        <span className="flex min-w-0 items-center gap-2">
          {open ? <ChevronDown size={15} className="text-ink-3" /> : <ChevronRight size={15} className="text-ink-3" />}
          <span className="truncate font-medium text-ink" title={run.leadName}>{run.leadName}</span>
          {run.cutShort && <Pill tone="bad">cut short</Pill>}
        </span>
        <span className="shrink-0 text-caption text-ink-3">
          {time(run.enrolledAt)} · {run.steps.length} step{run.steps.length === 1 ? "" : "s"}
        </span>
      </button>
      {open && (
        <ol className="space-y-2 border-t border-line bg-surface-2 px-4 py-3">
          {run.steps.map((s, i) => (
            <li key={i} className="flex flex-wrap items-baseline gap-2 text-sm">
              <span className="tnum w-28 shrink-0 text-caption text-ink-3">{time(s.at)}</span>
              <Pill tone={OUTCOME_TONE[s.outcome]}>{ACTION_LABELS[s.type]}</Pill>
              <span className="min-w-0 text-ink-2">{s.detail}</span>
              {s.heldUntil && <span className="text-caption text-warn">held for quiet hours</span>}
            </li>
          ))}
          <li className="pt-1">
            <Link href={`/contacts/${run.leadId}`} className="text-caption text-primary hover:underline">
              Open {run.leadName} →
            </Link>
          </li>
        </ol>
      )}
    </div>
  );
}

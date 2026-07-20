"use client";

import { useState, useTransition, useEffect } from "react";
import {
  AlarmClock,
  Check,
  ChevronDown,
  Copy,
  MessageCircle,
  PhoneCall,
  SkipForward,
  Settings2,
  Video,
} from "lucide-react";
import { fieldKindProps } from "@/components/ui/field-base";
import type { QueueRow, QueueStep } from "@/server/outreach-metrics";
import {
  markStepSent,
  skipStep,
  logCallOutcome,
  setContactedAt,
  checkBookingNow,
  setZoomLink,
} from "@/server/outreach-actions";
import { OUTREACH_PHASE_LABELS, QUALIFIED_LABELS } from "@/lib/outreach-sop";

/**
 * The outreach specialist's working surface: one card per prospect, showing the single next SOP
 * step with its message already rendered. The point is that nobody has to hold the SOP in their
 * head — the queue says what to send, to whom, and by when.
 */

/** Live countdown to the 5-minute SLA. Ticks client-side so it stays honest between renders. */
function SlaClock({ sla }: { sla: NonNullable<QueueRow["sla"]> }) {
  const [remaining, setRemaining] = useState(sla.remainingMs);

  useEffect(() => {
    setRemaining(sla.remainingMs);
    if (sla.branch !== "PENDING") return;
    const started = Date.now();
    const id = setInterval(() => setRemaining(sla.remainingMs - (Date.now() - started)), 1000);
    return () => clearInterval(id);
  }, [sla.remainingMs, sla.branch]);

  if (sla.branch === "SLOW" || remaining < 0) {
    return (
      <span
        className="flex items-center gap-1 rounded-full px-2 py-0.5 text-caption font-semibold"
        style={{ background: "var(--risk-soft)", color: "var(--risk)" }}
      >
        <AlarmClock size={11} /> SLA missed — Step 10 path
      </span>
    );
  }

  const secs = Math.max(0, Math.floor(remaining / 1000));
  const mm = String(Math.floor(secs / 60)).padStart(2, "0");
  const ss = String(secs % 60).padStart(2, "0");
  const urgent = remaining <= 75_000;

  return (
    <span
      className="flex items-center gap-1 rounded-full px-2 py-0.5 text-caption font-semibold tnum"
      style={
        urgent
          ? { background: "var(--risk-soft)", color: "var(--risk)" }
          : { background: "var(--warn-soft, var(--surface-2))", color: "var(--warn, var(--ink))" }
      }
    >
      <AlarmClock size={11} /> {mm}:{ss} left
    </span>
  );
}

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1600);
        } catch {
          setDone(false);
        }
      }}
      className="flex items-center gap-1.5 rounded-field border border-line px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:bg-surface-2 hover:text-ink"
    >
      {done ? <Check size={13} /> : <Copy size={13} />} {done ? "Copied" : "Copy message"}
    </button>
  );
}

function StepBody({ step }: { step: QueueStep }) {
  if (step.channel === "CALL" && step.script) {
    return (
      <div className="space-y-3 text-xs">
        <p className="text-muted">
          <span className="font-semibold text-ink">Objective:</span> {step.script.objective}
        </p>
        <div className="space-y-1">
          {step.script.opening.map((l, i) => (
            <p key={i} className="text-ink">{l}</p>
          ))}
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {step.script.branches.map((b) => (
            <div key={b.label} className="rounded-field border border-line bg-surface-2 p-2.5">
              <p className="mb-1 text-caption font-semibold uppercase tracking-wide text-muted">{b.label}</p>
              {b.lines.map((l, i) => (
                <p key={i} className="text-ink">{l}</p>
              ))}
            </div>
          ))}
        </div>
        {step.script.closing.length > 0 && (
          <div className="space-y-1 border-t border-line pt-2">
            {step.script.closing.map((l, i) => (
              <p key={i} className="text-ink">{l}</p>
            ))}
          </div>
        )}
      </div>
    );
  }

  if (!step.body) {
    return <p className="text-xs text-muted">Internal check — no message to send.</p>;
  }

  return (
    <pre className="whitespace-pre-wrap break-words rounded-field border border-line bg-surface-2 p-3 font-sans text-xs leading-relaxed text-ink">
      {step.body}
    </pre>
  );
}

function StepActions({ step, journeyId }: { step: QueueStep; journeyId: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const run = (fn: () => Promise<{ ok: boolean; error?: string } | { ok: true }>) =>
    start(async () => {
      const res = (await fn()) as { ok: boolean; error?: string };
      setError(res.ok ? null : (res.error ?? "Something went wrong"));
    });

  const fd = (extra: Record<string, string> = {}) => {
    const f = new FormData();
    f.set("stepLogId", step.stepLogId);
    f.set("journeyId", journeyId);
    for (const [k, v] of Object.entries(extra)) f.set(k, v);
    return f;
  };

  if (step.unresolved.length > 0) {
    return (
      <p className="rounded-field px-3 py-2 text-xs font-medium" style={{ background: "var(--risk-soft)", color: "var(--risk)" }}>
        Can&apos;t send yet — {step.unresolved.join(", ")} {step.unresolved.length === 1 ? "is" : "are"} unresolved.
        {step.unresolved.includes("<<INSERT ZOOM LINK HERE>>") && " Add the Zoom link above."}
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {step.body && <CopyButton text={step.body} />}

        {step.channel === "CALL" ? (
          <>
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => logCallOutcome(fd({ outcome: "YES" })))}
              className="rounded-field bg-accent px-3 py-1.5 text-xs font-semibold text-on-accent transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              Answered — YES
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => logCallOutcome(fd({ outcome: "NO" })))}
              className="rounded-field border border-line px-3 py-1.5 text-xs font-medium transition-colors hover:bg-surface-2 disabled:opacity-50"
            >
              Answered — NO
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => logCallOutcome(fd({ outcome: "NO_ANSWER" })))}
              className="rounded-field border border-line px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:bg-surface-2 disabled:opacity-50"
            >
              No answer
            </button>
          </>
        ) : step.channel === "SYSTEM" ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => checkBookingNow(fd()))}
            className="rounded-field bg-accent px-3 py-1.5 text-xs font-semibold text-on-accent transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            Run the booking check
          </button>
        ) : (
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => markStepSent(fd()))}
            className="flex items-center gap-1.5 rounded-field bg-accent px-3 py-1.5 text-xs font-semibold text-on-accent transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            <Check size={13} /> Mark sent
          </button>
        )}

        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => skipStep(fd()))}
          className="flex items-center gap-1.5 rounded-field px-2.5 py-1.5 text-xs font-medium text-muted transition-colors hover:bg-surface-2 disabled:opacity-50"
        >
          <SkipForward size={13} /> Skip
        </button>
      </div>
      {error && (
        <p className="text-xs font-medium" style={{ color: "var(--risk)" }}>
          {error}
        </p>
      )}
    </div>
  );
}

function ProspectCard({ row }: { row: QueueRow }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const next = row.next ?? row.steps[0] ?? null;

  // The Zoom link is pasted out of a calendar invite, which is exactly where a trailing space or a
  // wrapped newline comes from — and this value is interpolated straight into a WhatsApp template.
  // Uncontrolled (defaultValue), so the scrub is the only onChange it needs.
  const zoomProps = fieldKindProps<HTMLInputElement>("url", undefined);

  const channelIcon =
    next?.channel === "CALL" ? <PhoneCall size={13} /> : next?.channel === "WHATSAPP" ? <MessageCircle size={13} /> : <Settings2 size={13} />;

  return (
    <div
      className="rounded-card border bg-surface shadow-card"
      style={row.redFlag ? { borderColor: "var(--risk)" } : { borderColor: "var(--line)" }}
    >
      <div className="flex flex-wrap items-start justify-between gap-3 p-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-display text-base font-semibold" style={row.redFlag ? { color: "var(--risk)" } : undefined}>
              {row.name}
            </p>
            <span className="rounded-full bg-surface-2 px-2 py-0.5 text-caption font-medium text-muted">
              {OUTREACH_PHASE_LABELS[row.phase] ?? row.phase}
            </span>
            {row.sla && <SlaClock sla={row.sla} />}
            {row.qualified && (
              <span className="rounded-full bg-accent-soft px-2 py-0.5 text-caption font-semibold text-accent">
                {QUALIFIED_LABELS[row.qualified]}
                {row.bantAvg !== null && ` · BANT ${row.bantAvg.toFixed(1)}`}
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-muted">
            {row.phone ?? "No phone"}
            {row.email && ` · ${row.email}`}
            {row.discoAtIst && ` · Disco ${row.discoAtIst} IST`}
            {row.sssAtIst && ` · SSS ${row.sssAtIst} IST`}
          </p>
          {row.redFlag && row.redFlagReason && (
            <p className="mt-1 text-xs font-medium" style={{ color: "var(--risk)" }}>
              {row.redFlagReason}
            </p>
          )}
        </div>

        {next && (
          <span className="flex flex-none items-center gap-1.5 rounded-full bg-accent-soft px-3 py-1 text-xs font-semibold text-accent">
            {channelIcon} {next.sopStep}: {next.label}
          </span>
        )}
      </div>

      {next && (
        <div className="border-t border-line p-4">
          <StepBody step={next} />
          <div className="mt-3">
            <StepActions step={next} journeyId={row.journeyId} />
          </div>
        </div>
      )}

      <div className="border-t border-line">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center justify-between px-4 py-2 text-xs font-medium text-muted transition-colors hover:bg-surface-2"
        >
          <span>Details & overrides</span>
          <ChevronDown size={14} className={open ? "rotate-180 transition-transform" : "transition-transform"} />
        </button>

        {open && (
          <div className="space-y-3 border-t border-line p-4">
            {/* Step 2 — Time Contacted, entered in IST as the SOP prescribes. */}
            <form
              action={(f) => start(async () => void (await setContactedAt(f)))}
              className="flex flex-wrap items-end gap-2"
            >
              <input type="hidden" name="journeyId" value={row.journeyId} />
              <label className="text-xs">
                <span className="mb-1 block font-medium text-muted">Time contacted (IST)</span>
                {/* datetime-local: native popup (theme-corrected via color-scheme) with
                    app field chrome + themed picker indicator (.dateish-native). */}
                <input
                  type="datetime-local"
                  name="at"
                  className="dateish-native h-8 w-full rounded-field border border-line-strong bg-surface px-2.5 text-xs text-ink outline-none focus:border-primary focus:ring-2 focus:ring-primary-soft"
                />
              </label>
              <button
                type="submit"
                disabled={pending}
                className="rounded-field border border-line px-3 py-1.5 text-xs font-medium transition-colors hover:bg-surface-2 disabled:opacity-50"
              >
                {row.contactedAt ? "Update" : "Log now"}
              </button>
              {row.contactedAt && (
                <span className="text-caption text-muted">
                  Logged {new Date(row.contactedAt).toLocaleString("en-GB", { timeZone: "Asia/Kolkata" })} IST
                </span>
              )}
            </form>

            {/* Cross-cutting §R — the Zoom link the confirmation templates need. */}
            <form
              action={(f) => start(async () => void (await setZoomLink(f)))}
              className="flex flex-wrap items-end gap-2"
            >
              <input type="hidden" name="journeyId" value={row.journeyId} />
              <label className="min-w-0 flex-1 text-xs">
                <span className="mb-1 flex items-center gap-1 font-medium text-muted">
                  <Video size={12} /> Zoom link (from the Discovery Specialist&apos;s calendar)
                </span>
                <input
                  {...zoomProps.attrs}
                  name="zoomLink"
                  defaultValue={row.zoomLink ?? ""}
                  onChange={zoomProps.onChange}
                  placeholder="https://zoom.us/j/…"
                  className="w-full rounded-field border border-line bg-surface px-2 py-1.5 text-xs"
                />
              </label>
              <button
                type="submit"
                disabled={pending}
                className="rounded-field border border-line px-3 py-1.5 text-xs font-medium transition-colors hover:bg-surface-2 disabled:opacity-50"
              >
                Save
              </button>
            </form>

            {row.steps.length > 1 && (
              <div>
                <p className="mb-1.5 text-caption font-semibold uppercase tracking-wide text-muted">
                  Also scheduled
                </p>
                <ul className="space-y-1 text-xs text-muted">
                  {row.steps
                    .filter((s) => s.stepLogId !== next?.stepLogId)
                    .map((s) => (
                      <li key={s.stepLogId} className="flex items-center justify-between gap-2">
                        <span>
                          {s.sopStep}: {s.label}
                        </span>
                        <span className="tnum">
                          {new Date(s.dueAt).toLocaleString("en-GB", { timeZone: "Asia/Kolkata" })} IST
                        </span>
                      </li>
                    ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function QueueList({ rows, empty }: { rows: QueueRow[]; empty: string }) {
  if (rows.length === 0) {
    return <p className="rounded-card border border-line bg-surface py-10 text-center text-sm text-muted">{empty}</p>;
  }
  return (
    <div className="space-y-3">
      {rows.map((r) => (
        <ProspectCard key={r.journeyId} row={r} />
      ))}
    </div>
  );
}

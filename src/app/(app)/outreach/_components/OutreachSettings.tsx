"use client";

import { useState, useTransition } from "react";
import { AlertTriangle, Play, Power, RefreshCw } from "lucide-react";
import type { OutreachConfig } from "@/lib/outreach-sop";
import { OUTREACH_STEPS } from "@/lib/outreach-sop";
import { saveOutreachConfig, runOutreachNow, backfillJourneys } from "@/server/outreach-actions";

/**
 * Admin controls for the SOP engine.
 *
 * Two independent switches, deliberately:
 *   1. `enabled` — does the engine run at all (materialise steps, advance phases)?
 *   2. `auto:<STEP>` — may THIS step send without a human?
 *
 * The engine can run with every step manual; that is the default and the SOP's own shape. Turning
 * a step to auto means real WhatsApp messages leave the building unattended, so each one is an
 * explicit, separate act.
 */

const SLA_FIELDS: { key: keyof OutreachConfig["sla"]; label: string; hint: string; unit: string }[] = [
  { key: "reactionMinutes", label: "Reaction time", hint: "Step 2 — contact within this, or the SOP skips to Step 10", unit: "min" },
  { key: "check1Hours", label: "Check 1 wait", hint: "Step 5 — after the intro / first call", unit: "h" },
  { key: "check2Hours", label: "Check 2 wait", hint: "Step 7 — after the follow-up message", unit: "h" },
  { key: "finalCheckHours", label: "Final check wait", hint: "Step 9 — after the follow-up call", unit: "h" },
  { key: "discoConfirm1LeadHours", label: "Disco confirm 1", hint: "Step 14 — hours before the call", unit: "h" },
  { key: "discoConfirm2LeadHours", label: "Disco confirm 2", hint: "Step 15 — hours before the call", unit: "h" },
  { key: "discoCancelLeadHours", label: "Disco cancellation", hint: "Step 16 — hours before the call", unit: "h" },
  { key: "sssConfirm1LeadHours", label: "SSS confirm 1", hint: "Step 19 — hours before the SSS", unit: "h" },
  { key: "sssConfirm2LeadHours", label: "SSS confirm 2", hint: "Step 20 — hours before the SSS", unit: "h" },
  { key: "sssCancelLeadHours", label: "SSS cancellation", hint: "Step 21 — hours before the SSS", unit: "h" },
];

export function OutreachSettings({ config, watiLive }: { config: OutreachConfig; watiLive: boolean }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(config.enabled);

  const messageSteps = OUTREACH_STEPS.filter((s) => s.channel === "WHATSAPP");

  return (
    <div className="space-y-4">
      <form
        action={(f) =>
          start(async () => {
            const res = await saveOutreachConfig(f);
            setMsg(res.ok ? "Saved." : res.error);
          })
        }
        className="space-y-5 rounded-card border border-line bg-surface p-5 shadow-card"
      >
        {/* Master switch */}
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            name="enabled"
            defaultChecked={config.enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="mt-1 h-4 w-4 flex-none"
          />
          <span>
            <span className="flex items-center gap-1.5 font-display text-base font-semibold">
              <Power size={15} className="text-accent" /> Run the outreach engine
            </span>
            <span className="mt-0.5 block text-xs text-muted">
              Materialises SOP steps, runs the Step 10 booking checks, and advances each prospect
              through the ladder. With this off, nothing is scheduled and the queue stays empty.
            </span>
          </span>
        </label>

        {!enabled && (
          <p className="rounded-field bg-surface-2 px-3 py-2 text-xs text-muted">
            The engine is off. Existing journeys are preserved — turning it back on picks up where
            it left off.
          </p>
        )}

        {/* Auto-send */}
        <div className="border-t border-line pt-4">
          <h4 className="font-display text-sm font-semibold">Auto-send</h4>
          <p className="mt-0.5 text-xs text-muted">
            Every step is manual by default: the engine tells the specialist what to send and they
            send it. Tick a step to let the engine send it unattended instead.
          </p>

          {!watiLive && (
            <p
              className="mt-2 flex items-start gap-1.5 rounded-field px-3 py-2 text-xs font-medium"
              style={{ background: "var(--risk-soft)", color: "var(--risk)" }}
            >
              <AlertTriangle size={13} className="mt-px flex-none" />
              <span>
                WhatsApp sending is not live, so auto-send cannot deliver anything yet. Ticked steps
                will stay in the queue for manual sending until WATI is armed and a template is
                mapped for each touchpoint (WhatsApp → Settings).
              </span>
            </p>
          )}

          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {messageSteps.map((s) => (
              <label
                key={s.step}
                className="flex items-start gap-2.5 rounded-field border border-line p-2.5 text-xs"
              >
                <input
                  type="checkbox"
                  name={`auto:${s.step}`}
                  defaultChecked={config.autoSend[s.step] === true}
                  className="mt-0.5 h-3.5 w-3.5 flex-none"
                />
                <span>
                  <span className="font-medium text-ink">{s.label}</span>
                  <span className="ml-1 text-muted">({s.sopStep})</span>
                </span>
              </label>
            ))}
          </div>
        </div>

        {/* SLA windows */}
        <div className="border-t border-line pt-4">
          <h4 className="font-display text-sm font-semibold">Timing</h4>
          <p className="mt-0.5 text-xs text-muted">
            The SOP&apos;s windows. Editable so the SLAs can be tuned without a code change — the
            defaults are exactly what the document specifies.
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {SLA_FIELDS.map((f) => (
              <label key={f.key} className="text-xs">
                <span className="mb-1 block font-medium">{f.label}</span>
                <span className="flex items-center gap-1.5">
                  <input
                    type="number"
                    name={f.key}
                    min={1}
                    step="1"
                    defaultValue={config.sla[f.key]}
                    className="w-20 rounded-field border border-line bg-surface px-2 py-1.5 tnum"
                  />
                  <span className="text-muted">{f.unit}</span>
                </span>
                <span className="mt-1 block text-caption text-muted">{f.hint}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Misc */}
        <div className="grid gap-3 border-t border-line pt-4 sm:grid-cols-2">
          <label className="text-xs">
            <span className="mb-1 block font-medium">Default sender name</span>
            <input
              name="defaultSpecialistName"
              defaultValue={config.defaultSpecialistName}
              className="w-full rounded-field border border-line bg-surface px-2 py-1.5"
            />
            <span className="mt-1 block text-caption text-muted">
              Fills <code>[Your Name]</code> when no touchpoint owner is assigned.
            </span>
          </label>
          <label className="text-xs">
            <span className="mb-1 block font-medium">Max journeys per run</span>
            <input
              type="number"
              name="maxPerRun"
              min={1}
              defaultValue={config.maxPerRun}
              className="w-24 rounded-field border border-line bg-surface px-2 py-1.5 tnum"
            />
            <span className="mt-1 block text-caption text-muted">Safety cap on a single engine tick.</span>
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
          <button
            type="submit"
            disabled={pending}
            className="rounded-field bg-accent px-4 py-2 text-sm font-semibold text-on-accent transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            Save settings
          </button>
          {msg && <span className="text-xs font-medium text-muted">{msg}</span>}
        </div>
      </form>

      {/* Operational */}
      <div className="rounded-card border border-line bg-surface p-5 shadow-card">
        <h4 className="font-display text-sm font-semibold">Run &amp; backfill</h4>
        <p className="mt-0.5 text-xs text-muted">
          The engine has no clock of its own — an external cron must hit{" "}
          <code className="rounded bg-surface-2 px-1">/api/cron/outreach</code> with{" "}
          <code className="rounded bg-surface-2 px-1">CRON_SECRET</code>. Point it at every minute:
          the 5-minute reaction SLA can only be reported as accurately as the cron ticks.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              start(async () => {
                await runOutreachNow();
                setMsg("Engine run complete.");
              })
            }
            className="flex items-center gap-1.5 rounded-field border border-line px-3 py-1.5 text-xs font-medium transition-colors hover:bg-surface-2 disabled:opacity-50"
          >
            <Play size={13} /> Run the engine now
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              start(async () => {
                await backfillJourneys();
                setMsg("Backfill complete — existing leads now have journeys.");
              })
            }
            className="flex items-center gap-1.5 rounded-field border border-line px-3 py-1.5 text-xs font-medium transition-colors hover:bg-surface-2 disabled:opacity-50"
          >
            <RefreshCw size={13} /> Backfill journeys for existing leads
          </button>
        </div>
      </div>
    </div>
  );
}

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
 *   1. `enabled` - does the engine run at all (materialise steps, advance phases)?
 *   2. `auto:<STEP>` - may THIS step send without a human?
 *
 * The engine can run with every step manual; that is the default and the SOP's own shape. Turning
 * a step to auto means real WhatsApp messages leave the building unattended, so each one is an
 * explicit, separate act.
 */

/**
 * `max` mirrors the bound `saveOutreachConfig` enforces (1..720h, and 1..1440min for the reaction
 * window). The server is the real gate - this is here so the two never disagree, which is the point
 * of stating a rule once (see lib/field-rules).
 */
const SLA_HOURS_MAX = 720;
const SLA_MINUTES_MAX = 43_200; // the same 30-day ceiling, expressed in minutes

const SLA_FIELDS: {
  key: keyof OutreachConfig["sla"];
  /** Form input name. Defaults to `key` - set only where the input's unit differs from storage. */
  field?: string;
  label: string;
  hint: string;
  unit: string;
  max: number;
  /** Stored as hours, entered as minutes. */
  inMinutes?: boolean;
}[] = [
  { key: "reactionMinutes", label: "Reaction time", hint: "Step 2 - contact within this, or the SOP skips to Step 10", unit: "min", max: 1440 },
  // The three booking-chase windows are entered in MINUTES, not hours. They are the short ones -
  // "check back in 15 minutes" is a thing the founder wants to say, and a whole-hours box cannot
  // say it. `field` is the form key the action reads; the stored config keeps hours, and
  // `fromHours`/`toField` are the one conversion, applied here and nowhere else.
  { key: "check1Hours", field: "check1Minutes", label: "Check 1 wait", hint: "Step 5 - minutes after the intro message", unit: "min", max: SLA_MINUTES_MAX, inMinutes: true },
  { key: "check2Hours", field: "check2Minutes", label: "Check 2 wait", hint: "Step 7 - minutes after OPT-IN, not after the follow-up", unit: "min", max: SLA_MINUTES_MAX, inMinutes: true },
  { key: "check3Hours", field: "check3Minutes", label: "Check 3 wait", hint: "Step 7c - minutes after OPT-IN; the telecaller is raised after this", unit: "min", max: SLA_MINUTES_MAX, inMinutes: true },
  { key: "finalCheckHours", field: "finalCheckMinutes", label: "Final check wait", hint: "Step 9 - minutes after OPT-IN; not booked moves the card to Lost", unit: "min", max: SLA_MINUTES_MAX, inMinutes: true },
  { key: "postBookingDelayMinutes", field: "postBookingDelayMinutes", label: "After-booking delay", hint: "Steps 13/13c - minutes after a booking before the qualified / not-qualified messages go out", unit: "min", max: SLA_MINUTES_MAX },
  { key: "discoConfirmCallLeadHours", label: "Disco confirm calls", hint: "Step 16 - hours before the call, both telecaller attempts", unit: "h", max: SLA_HOURS_MAX },
  { key: "noShowSweepHours", label: "Write off after call", hint: "Hours AFTER the call - unconfirmed and no outcome logged moves the card to Cancelled/Unqualified", unit: "h", max: SLA_HOURS_MAX },
  { key: "discoConfirm1LeadHours", label: "Disco confirm 1", hint: "Step 14 - hours before the call", unit: "h", max: SLA_HOURS_MAX },
  { key: "discoConfirm2LeadHours", label: "Disco confirm 2", hint: "Step 15 - hours before the call", unit: "h", max: SLA_HOURS_MAX },
  { key: "discoCancelLeadHours", label: "Disco cancellation", hint: "Step 16 - hours before the call", unit: "h", max: SLA_HOURS_MAX },
  { key: "sssConfirm1LeadHours", label: "SSS confirm 1", hint: "Step 19 - hours before the SSS", unit: "h", max: SLA_HOURS_MAX },
  { key: "sssConfirm2LeadHours", label: "SSS confirm 2", hint: "Step 20 - hours before the SSS", unit: "h", max: SLA_HOURS_MAX },
  { key: "sssConfirm3LeadHours", label: "SSS confirm 3", hint: "Step 20b - hours before the SSS", unit: "h", max: SLA_HOURS_MAX },
  { key: "sssConfirmCallLeadHours", label: "SSS confirm call", hint: "Step 20c - hours before the SSS, the specialist rings", unit: "h", max: SLA_HOURS_MAX },
  { key: "sssCancelLeadHours", label: "SSS cancellation", hint: "Step 21 - hours before the SSS, after the confirm call failed", unit: "h", max: SLA_HOURS_MAX },
];

export function OutreachSettings({ config, watiLive }: { config: OutreachConfig; watiLive: boolean }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(config.enabled);
  // Drives the cap field and the "nothing will send yet" warning - both are noise until the
  // founder has actually ticked instant sending.
  const [instantIntro, setInstantIntro] = useState(config.instantIntro.enabled);

  // Every step that can be SENT without a human, which is now both messaging channels. CALL and
  // SYSTEM steps are excluded because there is nothing for a machine to auto-send in them.
  const messageSteps = OUTREACH_STEPS.filter((s) => s.channel === "WHATSAPP" || s.channel === "EMAIL");

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
            The engine is off. Existing journeys are preserved - turning it back on picks up where
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

        {/* ── The top of the funnel, without a human in it ─────────────────────────────
            Two switches that only make sense together, so they are presented together: send the
            invite the instant someone opts in, and hold the caller back until a booking check
            shows they ignored it. Either alone is coherent; the pair is the founder's flow. */}
        <div className="border-t border-line pt-4">
          <h4 className="font-display text-sm font-semibold">Hands-off first contact</h4>
          <p className="mt-0.5 text-xs text-muted">
            How the first message and the first call happen. Both are off by default - the SOP as
            written has a specialist send the invite and ring straight away.
          </p>

          <label className="mt-3 flex items-start gap-3 rounded-field border border-line p-3">
            <input
              type="checkbox"
              name="instantIntro"
              defaultChecked={config.instantIntro.enabled}
              onChange={(e) => setInstantIntro(e.target.checked)}
              className="mt-0.5 h-4 w-4 flex-none"
            />
            <span className="text-xs">
              <span className="block text-sm font-medium text-ink">
                Send the invite the moment a lead arrives
              </span>
              <span className="mt-0.5 block text-muted">
                Fires inline at capture - seconds, not the next engine tick - so the SOP&apos;s
                5-minute window isn&apos;t spent waiting. Only for leads arriving from the live
                capture webhooks; imports and manually-added contacts are never messaged.
              </span>
            </span>
          </label>

          {instantIntro && (
            <label className="mt-2 block text-xs">
              <span className="mb-1 block font-medium">Most invites to send in any one hour</span>
              <input
                type="number"
                name="instantIntroMaxPerHour"
                min={1}
                max={5000}
                defaultValue={config.instantIntro.maxPerHour}
                className="w-32 rounded-field border border-line bg-surface px-2 py-1"
              />
              <span className="mt-1 block text-muted">
                A circuit breaker, not a throttle - normal intake is nowhere near it. If a webhook
                ever loops or an import is routed through a capture endpoint, this stops it and
                leaves the rest for a human instead of messaging thousands of people.
              </span>
            </label>
          )}

          <label className="mt-3 flex items-start gap-3 rounded-field border border-line p-3">
            <input
              type="checkbox"
              name="firstCallAfterCheck"
              defaultChecked={config.firstCallMode === "after_check"}
              className="mt-0.5 h-4 w-4 flex-none"
            />
            <span className="text-xs">
              <span className="block text-sm font-medium text-ink">
                Only call if they haven&apos;t booked
              </span>
              <span className="mt-0.5 block text-muted">
                Holds Step 4 back until a booking check has run and come back empty. Anyone who
                books off the message alone never reaches a caller - which is the point. Off, the
                SOP&apos;s own order applies: message, then ring regardless.
              </span>
            </span>
          </label>

          {instantIntro && !watiLive && (
            <p
              className="mt-2 flex items-start gap-1.5 rounded-field px-3 py-2 text-xs font-medium"
              style={{ background: "var(--risk-soft)", color: "var(--risk)" }}
            >
              <AlertTriangle size={13} className="mt-px flex-none" />
              <span>
                Nothing will actually send yet - WhatsApp is not live, or no template is mapped to
                the SOP intro touchpoint. Each lead&apos;s invite will sit in the queue for manual
                sending until that is done (WhatsApp → Settings).
              </span>
            </p>
          )}
        </div>

        {/* Response-time windows */}
        <div className="border-t border-line pt-4">
          <h4 className="font-display text-sm font-semibold">Timing</h4>
          <p className="mt-0.5 text-xs text-muted">
            The SOP&apos;s windows. Editable so the response times can be tuned without a code change - the
            defaults are exactly what the document specifies.
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {SLA_FIELDS.map((f) => (
              <label key={f.key} className="text-xs">
                <span className="mb-1 block font-medium">{f.label}</span>
                <span className="flex items-center gap-1.5">
                  <input
                    type="number"
                    name={f.field ?? f.key}
                    min={1}
                    max={f.max}
                    step="1"
                    // Rounded, not floored: 0.25 h is 15 min exactly, but a value hand-edited in
                    // the database to something like 0.2333 h must still show as a whole 14 rather
                    // than silently truncating to 13 and saving that back on the next submit.
                    defaultValue={f.inMinutes ? Math.round(config.sla[f.key] * 60) : config.sla[f.key]}
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
            {/* NOT kind="name": this is a sender-name fallback that ships as the company name
                "B2 Consultants" - the person-name rule forbids digits and would eat its own
                default. Bounded free text, capped to match the server. */}
            <input
              name="defaultSpecialistName"
              defaultValue={config.defaultSpecialistName}
              maxLength={80}
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
              max={1000}
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
          The engine has no clock of its own - an external cron must hit{" "}
          <code className="rounded bg-surface-2 px-1">/api/cron/outreach</code> with{" "}
          <code className="rounded bg-surface-2 px-1">CRON_SECRET</code>. Point it at every minute:
          the 5-minute response time can only be reported as accurately as the cron ticks.
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
                setMsg("Backfill complete - existing leads now have journeys.");
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

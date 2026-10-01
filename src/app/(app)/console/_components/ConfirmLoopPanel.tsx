"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Play } from "lucide-react";
import { Field } from "@/components/ui/form";
import { toast } from "@/components/ui/feedback";
import { runBookingAutomationNow, saveConfirmLoopRules } from "@/server/booking-actions";
import { describeDuration, formatDuration, parseDurationMinutes } from "@/lib/duration";
import { SLOT_RELEASE_REASON_LABELS } from "@/lib/labels";
import type { BookingRulesConfig } from "@/lib/config-schema";
import type { SlotReleaseRow } from "@/server/slot-release";
import { Btn, Card, Hint, SaveBar, TextIn, Toggle } from "./kit";

/**
 * Founder Console → Sales ops → Confirm-or-cancel.
 *
 * WHY IT IS HERE TOO. This is the only automation in the app that CANCELS something a prospect is
 * expecting, and until now it could only be reached from inside a modal on the Bookings page or from
 * the WhatsApp settings tab. Everything else that can act on its own is armed from this console,
 * and Console → System → Not armed already lists this loop as off - so the one screen that tells
 * you it is switched off had no way to switch it on.
 *
 * It is the same stored rule as the other two doors, saved through the same parser
 * (server/confirm-loop-config.ts), merged over the stored config so nothing this form omits is
 * reset. The panel adds what a console should add on top of the fields: the rule read back as a
 * sentence before you save it, and the list of calls it has actually released.
 */

/** The three windows, as the form carries them: duration text, parsed on the server. */
type Draft = {
  autoCancelEnabled: boolean;
  promoteNext: boolean;
  confirmRequestLead: string;
  autoCancelWindow: string;
  confirmReplyGrace: string;
};

const draftFrom = (c: BookingRulesConfig): Draft => ({
  autoCancelEnabled: c.autoCancelEnabled,
  promoteNext: c.promoteNext,
  confirmRequestLead: formatDuration(c.confirmRequestLeadMinutes),
  autoCancelWindow: formatDuration(c.autoCancelMinutes),
  confirmReplyGrace: formatDuration(c.confirmReplyGraceMinutes),
});

export function ConfirmLoopPanel({
  rules,
  releases,
}: {
  rules: BookingRulesConfig;
  /** Most recent first; the panel shows a handful and points at the full list. */
  releases: SlotReleaseRow[];
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>(draftFrom(rules));
  const [saved, setSaved] = useState<Draft>(draftFrom(rules));
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));

  /**
   * The same field names the other two doors submit, so the server parser is shared verbatim
   * rather than reimplemented for a console that happens to hold its state in React.
   */
  async function save() {
    setBusy(true);
    setError(null);
    const fd = new FormData();
    if (draft.autoCancelEnabled) fd.set("autoCancelEnabled", "on");
    if (draft.promoteNext) fd.set("promoteNext", "on");
    fd.set("confirmRequestLead", draft.confirmRequestLead);
    fd.set("autoCancelWindow", draft.autoCancelWindow);
    fd.set("confirmReplyGrace", draft.confirmReplyGrace);
    const res = await saveConfirmLoopRules(fd);
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setSaved(draft);
    toast("Confirm-or-cancel saved");
    router.refresh();
  }

  async function runNow() {
    if (running) return;
    setRunning(true);
    const res = await runBookingAutomationNow();
    setRunning(false);
    if (!res.ok) return toast(res.error, "error");
    toast(res.summary ? `Confirmation loop ran - ${res.summary}` : "Confirmation loop ran");
    router.refresh();
  }

  /**
   * The rule read back in words, from the TYPED text rather than the stored config.
   *
   * These three boxes interact - the ask window has to be wider than the cancel window, and the
   * reply grace sits inside both - and three durations in three boxes do not show that. Parsing
   * live also catches the two mistakes the server would otherwise have to refuse: an unreadable
   * duration, and a pair the wrong way round.
   */
  const ask = parseDurationMinutes(draft.confirmRequestLead);
  const cancel = parseDurationMinutes(draft.autoCancelWindow);
  const grace = parseDurationMinutes(draft.confirmReplyGrace);
  const unreadable = [
    ask === null ? "Ask to confirm" : null,
    cancel === null ? "Auto-cancel" : null,
    grace === null ? "Reply grace" : null,
  ].filter(Boolean) as string[];
  const inverted = ask !== null && cancel !== null && ask !== 0 && ask <= cancel;

  const recent = releases.filter((r) => r.reason !== "POSTPONED").slice(0, 6);

  return (
    <div className="space-y-4">
      <Hint>
        As a booked call gets close, the prospect is asked on WhatsApp to reply{" "}
        <strong>YES</strong>. Until they do, the slot is <strong>held</strong> for them - nobody else
        can book it. If they never reply, the slot goes back on the calendar and the call is
        cancelled. A WhatsApp &ldquo;yes&rdquo; confirms it automatically; so does{" "}
        <strong>Mark confirmed</strong> on Bookings → Booking requests.
      </Hint>

      <Card>
        <div className="space-y-5">
          <div className="space-y-1">
            <Toggle
              checked={draft.autoCancelEnabled}
              onChange={(b) => set("autoCancelEnabled", b)}
              label="Ask for confirmation, and release the slot if nobody answers"
            />
            {/* The one switch in this panel that does something to a real prospect. Said plainly,
                in place, rather than left to a tooltip. */}
            <p className={`text-caption ${draft.autoCancelEnabled ? "text-risk" : "text-muted"}`}>
              {draft.autoCancelEnabled
                ? "On: real bookings are cancelled and the prospect is told their slot was released."
                : "Off: nobody is asked to confirm, and a slot nobody confirmed is never released. Manual block, postpone and mark-confirmed still work."}
            </p>
          </div>

          <div className="space-y-1">
            <Toggle
              checked={draft.promoteNext}
              onChange={(b) => set("promoteNext", b)}
              label="Move the next call that day up into a freed slot"
            />
            <p className="text-caption text-muted">
              Same caller, same day, same call length. Applies to a cancellation you make by hand
              too, not only an automatic one.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label="Ask to confirm" hint="How long before the call the request goes out. 0m = never ask, so nothing is ever auto-cancelled.">
              <TextIn
                ariaLabel="Ask to confirm, before the slot"
                value={draft.confirmRequestLead}
                onChange={(s) => set("confirmRequestLead", s)}
                placeholder="24h"
              />
            </Field>
            <Field label="Release the slot" hint="How long before the call an unconfirmed slot is handed back. Must be shorter than the ask window.">
              <TextIn
                ariaLabel="Release the slot, before the slot"
                value={draft.autoCancelWindow}
                onChange={(s) => set("autoCancelWindow", s)}
                placeholder="3h"
              />
            </Field>
            <Field label="Give them at least" hint="Counted from the moment we ask, so a call booked at short notice is never cancelled unanswered. Minimum 5m.">
              <TextIn
                ariaLabel="Minimum time to reply"
                value={draft.confirmReplyGrace}
                onChange={(s) => set("confirmReplyGrace", s)}
                placeholder="30m"
              />
            </Field>
          </div>

          <p className="text-caption text-muted">
            Hours or minutes - <strong>3h</strong>, <strong>45m</strong>, <strong>1h30m</strong>. A
            bare number means hours.
          </p>

          {/* ── the rule, read back ─────────────────────────────────────────────────────── */}
          {unreadable.length > 0 ? (
            <p className="rounded-field bg-risk-soft px-3 py-2 text-sm text-risk">
              {unreadable.join(" and ")} {unreadable.length > 1 ? "are not" : "is not"} a duration I
              can read. Use something like 3h, 45m or 1h30m.
            </p>
          ) : inverted ? (
            <p className="rounded-field bg-risk-soft px-3 py-2 text-sm text-risk">
              Nobody could ever answer in time: the slot would be released{" "}
              {describeDuration(cancel!)} before the call, but the request only goes out{" "}
              {describeDuration(ask!)} before it. Widen the ask window.
            </p>
          ) : (
            <p className="rounded-field bg-surface-2 px-3 py-2 text-sm text-ink-2">
              {!draft.autoCancelEnabled ? (
                <>
                  Nothing happens while the switch above is off. Once on:{" "}
                </>
              ) : null}
              {ask === 0 ? (
                <>Nobody is asked to confirm, so no slot is ever released automatically.</>
              ) : (
                <>
                  We ask <strong>{describeDuration(ask!)}</strong> before the call. If they are still
                  silent <strong>{describeDuration(cancel!)}</strong> before it, the slot goes back on
                  the calendar - but never less than <strong>{describeDuration(grace!)}</strong> after
                  we asked.
                  {draft.promoteNext ? " The next call that day moves up into it." : ""}
                </>
              )}
            </p>
          )}

          <SaveBar dirty={dirty} onSave={save} busy={busy} error={error} />
        </div>
      </Card>

      {/* ── what it has actually done ───────────────────────────────────────────────────── */}
      <Card>
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-display text-base font-semibold text-ink">Slots released</p>
              <p className="mt-0.5 text-caption text-muted">
                The last few calls that gave their slot back. The full list, with what became of each
                slot, is on Bookings → Cancelled slots.
              </p>
            </div>
            <Btn variant="secondary" onClick={runNow} busy={running}>
              <Play size={14} /> Run the loop now
            </Btn>
          </div>

          {recent.length === 0 ? (
            <p className="rounded-field border border-dashed border-line px-3 py-4 text-center text-sm text-muted">
              No slot has been released yet.
              {rules.autoCancelEnabled
                ? " Nothing has gone unconfirmed since the loop was switched on."
                : " The loop is off, so nothing has been released automatically."}
            </p>
          ) : (
            <ul className="divide-y divide-line">
              {recent.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
                  <span className="font-medium text-ink">{r.prospectName}</span>
                  <span className="tnum text-muted">
                    {r.slotDay} · {r.slotTime} IST
                  </span>
                  <span className="rounded-full bg-surface-2 px-2 py-0.5 text-caption font-medium text-muted">
                    {SLOT_RELEASE_REASON_LABELS[r.reason] ?? r.reason}
                  </span>
                  <span className="text-caption text-muted">
                    {r.releasedByName ?? "Confirmation loop"} · {r.releasedDay}
                  </span>
                  {r.promotedName && (
                    <span className="ml-auto text-caption font-medium text-ok">
                      {r.promotedName} moved in
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>
    </div>
  );
}

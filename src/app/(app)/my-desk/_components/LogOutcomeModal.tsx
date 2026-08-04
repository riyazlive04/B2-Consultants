"use client";

import { useState } from "react";
import { logCall } from "@/server/call-log-actions";
import { SETTER_NEXT_STAGES } from "@/lib/call-outcome";
import { LEAD_STAGE_LABELS } from "@/lib/labels";
import { Field, FormError, Select, SubmitButton, TextInput } from "@/components/ui/form";
import { Modal } from "@/components/ui/Modal";
import { toast } from "@/components/ui/feedback";

/**
 * "Log outcome" — the one modal BOTH specialist desks use to record a call.
 *
 * ── Why this is shared, and why that was the bug ─────────────────────────────────
 * This lived inside `L1Desk.tsx`. `L2Desk` had no equivalent: its only outcome control was
 * `RouteModal`, attached to today's BOOKED calls. So a Level 2 specialist could record the
 * outcome of a scheduled discovery call and had NO WAY AT ALL to record an ordinary call to one
 * of her own leads — the "Your leads" rows offered a dial button and nothing else.
 *
 * That is not a cosmetic gap. On 4 Aug 2026 production held 23,545 leads, zero appointment slots
 * and zero bookings, which meant `desk.today` was empty for every discovery specialist on every
 * day: Asma's desk contained no outcome control under any circumstance, and the whole app had
 * logged one call. The affordance existed the entire time — on the other desk.
 *
 * ── Two vocabularies, one modal ──────────────────────────────────────────────────
 * A call to a lead with no booking is a CHASE — "did I reach them, and where did that leave
 * them" — which is L1's outcome set and L1's next-stage list. A booked discovery call that has
 * happened is a ROUTING decision, which is `RouteModal`'s job and stays there. So this component
 * is the chase form, used by both desks, and `RouteModal` remains the post-call form used by one.
 * Forking a third variant is what let them drift apart in the first place.
 *
 * ── Offline ──────────────────────────────────────────────────────────────────────
 * `queueCall` is optional. When supplied (L1, and now L2) a failed send is stored in IndexedDB
 * and replayed with its ORIGINAL time; when omitted the modal is online-only. Passing it is
 * strongly preferred — these are phone calls, made on phones, often with one bar of signal.
 */

const OUTCOME_OPTIONS = [
  { value: "SPOKE", label: "Spoke to them" },
  { value: "NO_ANSWER", label: "No answer" },
  { value: "BUSY", label: "Busy" },
  { value: "CALLBACK", label: "Asked to call back" },
  { value: "WRONG_NUMBER", label: "Wrong number" },
  { value: "NOT_INTERESTED", label: "Not interested" },
];

/** The outcomes that close the lead by themselves — see `stageAfterCall`. */
const AUTO_CLOSING = new Set(["NOT_INTERESTED", "WRONG_NUMBER"]);

export type LogOutcomeTarget = { id: string; name: string; phone: string | null };

export function LogOutcomeModal({
  lead,
  onClose,
  queueCall,
  online = true,
}: {
  lead: LogOutcomeTarget;
  onClose: () => void;
  /** Offline fallback. Omit for an online-only desk; supplying it is strongly preferred. */
  queueCall?: (leadId: string, outcome: string, notes: string, nextStage?: string) => Promise<boolean>;
  online?: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  // Mirrors the form's own default so the stage control's visibility tracks the select.
  const [outcome, setOutcome] = useState("SPOKE");
  const autoCloses = AUTO_CLOSING.has(outcome);

  return (
    <Modal open onClose={onClose} title={`Log outcome — ${lead.name}`} subtitle={lead.phone ?? undefined}>
      <form
        action={async (form) => {
          setError(null);
          const outcome = String(form.get("outcome") ?? "");
          const notes = String(form.get("notes") ?? "");
          // Read here rather than from component state: the offline branch below needs the
          // same value the online branch posts, and the form is the single source of truth.
          const nextStage = String(form.get("nextStage") ?? "");

          /**
           * The online action stays the primary path — it is the one that has been exercised,
           * and it keeps working in browsers where IndexedDB is unavailable (private mode,
           * some embedded webviews). The queue is the FALLBACK, entered either because the
           * device already knows it is offline or because the call actually failed to travel.
           *
           * The catch matters more than the `navigator.onLine` check: a phone with one bar
           * reports itself online and the request dies anyway, which is precisely the case
           * this feature exists for.
           */
          const queueIt = async (reason: string) => {
            const stored = queueCall ? await queueCall(lead.id, outcome, notes, nextStage) : false;
            if (!stored) {
              return setError(
                "No connection, and this device cannot store the call offline. Please note it down and log it when you are back online.",
              );
            }
            toast(`Saved on this device — ${reason}. It will sync when you are back online.`);
            onClose();
          };

          if (!online) return queueIt("you are offline");

          try {
            const res = await logCall(lead.id, form);
            // A rejection from the server is a real answer (bad input, missing lead) — the
            // request travelled, so queueing it would just fail again later.
            if (!res.ok) return setError(res.error);
            toast("Outcome logged");
            onClose();
          } catch {
            await queueIt("the connection dropped");
          }
        }}
        className="space-y-4"
      >
        <Field label="What happened?">
          <Select
            name="outcome"
            options={OUTCOME_OPTIONS}
            defaultValue="SPOKE"
            onChange={(e) => setOutcome(e.currentTarget.value)}
          />
        </Field>

        {/* ── Where the conversation left them ──────────────────────────────────────────
            The JD scores this person on "pipeline updated before end of day: 100%", and until
            now the only control that could move a card lived on the Pipeline screen — so the
            desk measured something it did not let them do. This is that control, on the form
            they are already filling in.

            Hidden for the two outcomes that close the lead by themselves: offering a "next
            stage" beside "Not interested" invites a contradiction the server would then have to
            resolve silently. Its default is "leave as is", so the old behaviour is still one
            submit away for anyone who does not want to decide yet. */}
        {!autoCloses && (
          <Field label="Where did that leave them? (optional)">
            <Select
              name="nextStage"
              defaultValue=""
              options={[
                { value: "", label: "Leave the stage as it is" },
                ...SETTER_NEXT_STAGES.map((s) => ({
                  value: s,
                  label: LEAD_STAGE_LABELS[s] ?? s,
                })),
              ]}
            />
          </Field>
        )}

        <Field label="Notes (optional)">
          <TextInput kind="text" name="notes" maxLength={500} placeholder="What did they say?" />
        </Field>
        <p className="text-caption text-muted">
          {autoCloses
            ? "This closes the lead automatically — no stage to set."
            : "Setting a stage here moves the card on the pipeline too, so you don't have to do it twice."}
        </p>
        <div className="flex items-center justify-between gap-3">
          <FormError message={error} />
          <span className="ml-auto"><SubmitButton>Log outcome</SubmitButton></span>
        </div>
      </form>
    </Modal>
  );
}

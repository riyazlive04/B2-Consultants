/**
 * The agreement lifecycle as ONE derived state — isomorphic, no prisma, no server-only, so the
 * founder's cards (client), the picker (client) and the server reads all import the same truth.
 *
 * WHY DERIVE INSTEAD OF STORE: the request asks for eight states, but they span two phases of one
 * timeline. Three of them (NOT_REQUIRED / AWAITING_PAYMENT / READY_TO_SEND) describe a client for
 * whom NO agreement row exists yet — there is nothing to store them on. The other five map to (or
 * are refinements of) the `AgreementStatus` enum. So the unified state is a pure function over
 * (the client's pipeline position, the latest agreement, the workflow config) — computed on read,
 * exactly the way EXPIRED is already computed from `expiresAt` on the public token path. No column,
 * no migration, no cron: the state is always current because it is recomputed every render.
 *
 * The workflow config only decides WHEN the "Ready to send" prompt appears. It never gates
 * generation — the founder can draft an agreement for anyone, any time, from the picker.
 */

export type AgreementState =
  | "NOT_REQUIRED"
  | "AWAITING_PAYMENT"
  | "READY_TO_SEND"
  | "SENT"
  | "VIEWED"
  | "SIGNED"
  | "EXPIRED"
  | "COMPLETED";

/** When the system should start prompting "Ready to send". Founder-editable; never a hard gate. */
export type AgreementReadiness = "DEPOSIT" | "WON" | "EITHER";
export type AgreementWorkflowConfig = { readiness: AgreementReadiness };

/** The one agreement that represents the client right now (see pickCurrentAgreement server-side). */
export type LatestAgreement = {
  id: string;
  documentNo: string;
  status: string; // AgreementStatus — string to keep this file prisma-free
  expiresAt: string | Date | null;
  signedAt: string | Date | null;
} | null;

export type DeriveAgreementInput = {
  /** The current agreement for this client, or null when none has been drafted. */
  agreement: LatestAgreement;
  /** A signed agreement whose countersigned copy has been delivered on WhatsApp → COMPLETED. */
  copyDelivered: boolean;
  /** The client's lead pipeline stage. null = a Student with no lead (already a paying customer). */
  leadStage: string | null;
};

// The stages where a deal is live enough that an agreement is on the horizon. Everything earlier
// (NEW_LEAD, DISCO_*, SSS_*) or terminal-lost (LOST, NO_SHOW) is NOT_REQUIRED until it advances.
const ACTIVE_DEAL_STAGES = new Set([
  "PROPOSAL_SENT",
  "SENT_TO_WORKSHOP",
  "WORKSHOP_FOLLOWUP",
  "OFFER_FOLLOWUP",
  "DEPOSIT_FOLLOWUP",
  "DEPOSIT_PAID",
  "WON",
]);

/**
 * Which stages the founder's chosen readiness treats as "prompt me — this one is ready".
 * Exported so the dashboard count can push the same rule down into SQL instead of re-deriving it.
 */
export function eligibleStages(readiness: AgreementReadiness): Set<string> {
  switch (readiness) {
    case "WON":
      return new Set(["WON"]);
    case "DEPOSIT":
      return new Set(["DEPOSIT_PAID", "WON"]);
    case "EITHER":
      // deposit paid, won, OR "agreed but no deposit yet" — the confirmed-intention signal
      return new Set(["DEPOSIT_FOLLOWUP", "DEPOSIT_PAID", "WON"]);
  }
}

function asMs(d: string | Date | null): number | null {
  if (!d) return null;
  const t = typeof d === "string" ? Date.parse(d) : d.getTime();
  return Number.isFinite(t) ? t : null;
}

/**
 * The single source of truth for "where is this client in the agreement workflow?".
 *
 * Order matters: a live agreement always wins over the pipeline signal, because once a contract is
 * out the founder's next action is about THAT document, not the deal. VOIDED / DECLINED fall
 * through — they leave the client back in "ready to re-issue" territory.
 */
export function deriveAgreementState(
  input: DeriveAgreementInput,
  config: AgreementWorkflowConfig,
  now: number = Date.now(),
): AgreementState {
  const ag = input.agreement;
  if (ag) {
    switch (ag.status) {
      case "SIGNED":
        return input.copyDelivered ? "COMPLETED" : "SIGNED";
      case "SENT":
      case "VIEWED": {
        const exp = asMs(ag.expiresAt);
        if (exp !== null && exp <= now) return "EXPIRED";
        return ag.status === "VIEWED" ? "VIEWED" : "SENT";
      }
      case "DRAFT":
        return "READY_TO_SEND"; // drafted but not countersigned — one tap from sending
      // VOIDED / DECLINED / (stored) EXPIRED → fall through to the pipeline signal below
    }
  }

  // No live agreement — read the client's pipeline position.
  const stage = input.leadStage;
  if (stage === null || stage === undefined) return "READY_TO_SEND"; // a Student is already a customer
  if (eligibleStages(config.readiness).has(stage)) return "READY_TO_SEND";
  if (ACTIVE_DEAL_STAGES.has(stage)) return "AWAITING_PAYMENT";
  return "NOT_REQUIRED";
}

// ───────────────────────────── Display vocabulary ─────────────────────────────

export type AgreementStateTone = "primary" | "good" | "warn" | "bad" | "muted";

const BASE_LABELS: Record<AgreementState, string> = {
  NOT_REQUIRED: "Not required",
  AWAITING_PAYMENT: "Awaiting payment",
  READY_TO_SEND: "Ready to send",
  SENT: "Sent",
  VIEWED: "Viewed",
  SIGNED: "Signed",
  EXPIRED: "Expired",
  COMPLETED: "Completed",
};

/** Label with the one config-dependent nuance: what "awaiting" is actually waiting for. */
export function agreementStateLabel(state: AgreementState, config?: AgreementWorkflowConfig): string {
  if (state === "AWAITING_PAYMENT" && config) {
    return config.readiness === "WON" ? "Awaiting close" : "Awaiting deposit";
  }
  return BASE_LABELS[state];
}

export function agreementStateTone(state: AgreementState): AgreementStateTone {
  switch (state) {
    case "COMPLETED":
    case "SIGNED":
      return "good";
    case "READY_TO_SEND":
      return "primary"; // the CTA state — make it pop
    case "SENT":
    case "VIEWED":
    case "AWAITING_PAYMENT":
      return "warn";
    case "EXPIRED":
      return "bad";
    default:
      return "muted"; // NOT_REQUIRED
  }
}

/** Whether this state wants the founder to do something now — drives card prominence + notifications. */
export function isAgreementActionable(state: AgreementState): boolean {
  return state === "READY_TO_SEND" || state === "EXPIRED" || state === "SIGNED";
}

/** One-line, founder-facing "what this means / what's next", used on the task card. */
export function agreementStateHint(state: AgreementState, config?: AgreementWorkflowConfig): string {
  switch (state) {
    case "NOT_REQUIRED":
      return "No agreement needed yet — this deal isn't far enough along.";
    case "AWAITING_PAYMENT":
      return config?.readiness === "WON"
        ? "Close the deal to unlock the agreement."
        : "Waiting on the deposit before the agreement is prompted.";
    case "READY_TO_SEND":
      return "Everything's in place — generate and send the agreement.";
    case "SENT":
      return "Sent on WhatsApp — waiting for the student to open it.";
    case "VIEWED":
      return "The student has opened it but not signed yet — a nudge may help.";
    case "SIGNED":
      return "Signed and sealed — deliver the countersigned copy to finish.";
    case "EXPIRED":
      return "The signing link lapsed unsigned — re-issue a fresh one.";
    case "COMPLETED":
      return "Signed, sealed and the copy delivered — this one is done.";
  }
}

/**
 * Everything a task card needs, and nothing that can't cross a server→client boundary. Produced by
 * `getAgreementSummaryFor` (server/agreement-state.ts) and rendered by AgreementTaskCard.
 */
export type AgreementSummary = {
  state: AgreementState;
  config: AgreementWorkflowConfig;
  /** The current agreement, when one exists — the id every "track / preview / send" action needs. */
  agreementId: string | null;
  documentNo: string | null;
  /** Which record a new agreement would be drafted against. */
  leadId: string | null;
  studentId: string | null;
  /** Fields the CRM cannot answer — a non-empty list means one-click must route to the form. */
  missing: string[];
};

// ───────────────────────────── Grouping (the picker) ─────────────────────────────

/** The buckets the client picker groups candidates into — actionable ones first. */
export type AgreementGroup =
  | "READY"
  | "EXPIRED"
  | "AWAITING_SIGNATURE"
  | "AWAITING_PAYMENT"
  | "SIGNED"
  | "OTHER";

export const AGREEMENT_GROUP_ORDER: AgreementGroup[] = [
  "READY",
  "EXPIRED",
  "AWAITING_SIGNATURE",
  "AWAITING_PAYMENT",
  "SIGNED",
  "OTHER",
];

export const AGREEMENT_GROUP_LABELS: Record<AgreementGroup, string> = {
  READY: "Ready to send",
  EXPIRED: "Expired — re-issue",
  AWAITING_SIGNATURE: "Awaiting signature",
  AWAITING_PAYMENT: "Awaiting payment",
  SIGNED: "Signed & completed",
  OTHER: "Other clients",
};

export function agreementGroup(state: AgreementState): AgreementGroup {
  switch (state) {
    case "READY_TO_SEND":
      return "READY";
    case "EXPIRED":
      return "EXPIRED";
    case "SENT":
    case "VIEWED":
      return "AWAITING_SIGNATURE";
    case "AWAITING_PAYMENT":
      return "AWAITING_PAYMENT";
    case "SIGNED":
    case "COMPLETED":
      return "SIGNED";
    default:
      return "OTHER"; // NOT_REQUIRED
  }
}

/** Short headline for the action card, e.g. the requested "Agreement Pending – Ready to Send". */
export function agreementStateHeadline(state: AgreementState): string {
  switch (state) {
    case "READY_TO_SEND":
      return "Agreement pending — ready to send";
    case "AWAITING_PAYMENT":
      return "Agreement — awaiting payment";
    case "SENT":
    case "VIEWED":
      return "Agreement — awaiting signature";
    case "SIGNED":
      return "Agreement signed — deliver copy";
    case "EXPIRED":
      return "Agreement expired — re-issue";
    case "COMPLETED":
      return "Agreement completed";
    default:
      return "Agreement";
  }
}

import type { LeadStage, PaymentPlan } from "@prisma/client";

/**
 * The default Opportunity board's columns — a 1:1 mirror of the live Synamate pipeline
 * (app.synamate.com → Opportunities), in Synamate's order and with Synamate's exact wording.
 *
 * ── Why the names are copied character-for-character ────────────────────────────
 * The team reads both boards during the changeover. "Offer Follow-up" next to "Offer and didn't
 * buy" is a question every time; the same string is not. So the labels here are Synamate's,
 * including its capitalisation ("Full pay", not "Full Pay") and its curly apostrophe. Change them
 * only when Synamate changes.
 *
 * ── Twelve columns, fifteen lifecycle stages ────────────────────────────────────
 * `LeadStage` carries three states Synamate has no column for (NEW_LEAD, DISCO_NOT_BOOKED,
 * DISCO_COMPLETED, PROPOSAL_SENT) because the funnel %, commission split and gamification XP are
 * all measured off them — they stay in the enum and keep working, they just don't get their own
 * column. `BOARD_COLUMN_FOR_STAGE` below is what decides where such a lead's card is filed.
 *
 * The other mismatch runs the other way: Synamate ends in two won columns, "Split Pay" and
 * "Full pay", where this schema has one WON stage plus `Lead.paymentPlan`. Both columns therefore
 * carry `legacyStage: "WON"` and are told apart by `paymentPlan` (schema.prisma
 * PipelineStage.paymentPlan) — never by name, so renaming a column can't break the routing.
 *
 * Pure and isomorphic: imported by the seed, the reshape script, the server actions and the board.
 */
export type SynamateStage = {
  name: string;
  legacyStage: LeadStage;
  /** Set on the two terminal WON columns; null on the other ten. */
  paymentPlan: PaymentPlan | null;
};

export const SYNAMATE_STAGES: readonly SynamateStage[] = [
  // The early funnel, added 06/08/2026 on the founder's instruction. Until then a fresh opt-in was
  // filed straight into "Pre-Qualified & Confirmed", which said a lead had been qualified and a
  // call confirmed when nobody had so much as messaged them — and it hid the single busiest
  // column on the board inside one that is meant to hold a handful of confirmed calls.
  { name: "Fresh Optins", legacyStage: "NEW_LEAD", paymentPlan: null },
  { name: "WhatsApp Sent", legacyStage: "WHATSAPP_SENT", paymentPlan: null },
  { name: "Strategy Call Booked", legacyStage: "STRATEGY_CALL_BOOKED", paymentPlan: null },
  { name: "Cancelled/Unqualified", legacyStage: "LOST", paymentPlan: null },
  { name: "Pre-Qualified & Confirmed", legacyStage: "DISCO_BOOKED", paymentPlan: null },
  { name: "No Shows/Rescheduled", legacyStage: "NO_SHOW", paymentPlan: null },
  { name: "SSS Call Booked", legacyStage: "SSS_BOOKED", paymentPlan: null },
  { name: "SSS Call Confirmed", legacyStage: "SSS_COMPLETED", paymentPlan: null },
  { name: "Sent to Workshop", legacyStage: "SENT_TO_WORKSHOP", paymentPlan: null },
  { name: "Summit Follow Up", legacyStage: "WORKSHOP_FOLLOWUP", paymentPlan: null },
  { name: "Offer and didn’t buy", legacyStage: "OFFER_FOLLOWUP", paymentPlan: null },
  { name: "No Deposit and follow up", legacyStage: "DEPOSIT_FOLLOWUP", paymentPlan: null },
  { name: "Confirmed Sign Up (With Deposit)", legacyStage: "DEPOSIT_PAID", paymentPlan: null },
  { name: "Split Pay", legacyStage: "WON", paymentPlan: "SPLIT_PAY" },
  { name: "Full pay", legacyStage: "WON", paymentPlan: "FULL_PAY" },
] as const;

/**
 * Every lifecycle stage → the stage whose COLUMN holds its cards.
 *
 * Twelve of these are identities. The four that aren't are the stages Synamate doesn't show:
 *
 *   NEW_LEAD, DISCO_COMPLETED → Pre-Qualified & Confirmed   (before the SSS call, still in play)
 *   DISCO_NOT_BOOKED         → Cancelled/Unqualified        (the lead never made it to a call)
 *   PROPOSAL_SENT            → Offer and didn’t buy         (an offer is out, no decision yet)
 *
 * `PROPOSAL_SENT` folding into "Offer and didn't buy" is the one that reads oddly: the column is
 * named for the outcome, not the moment. It is still the right column — it is where Synamate's
 * offer-made deals sit while their three-touch follow-up runs (SALES-LOGIC.md §1.11-12) — but it
 * means the column's count includes offers that are merely outstanding. Read a true "offer made,
 * refused" figure off `LeadStage`, not off this column.
 */
const BOARD_COLUMN_FOR_STAGE: Record<LeadStage, LeadStage> = {
  // Identity now that "Fresh Optins" exists. This line used to read `NEW_LEAD: "DISCO_BOOKED"`,
  // which is what put every inbound lead into "Pre-Qualified & Confirmed" the moment it landed.
  NEW_LEAD: "NEW_LEAD",
  WHATSAPP_SENT: "WHATSAPP_SENT",
  STRATEGY_CALL_BOOKED: "STRATEGY_CALL_BOOKED",
  DISCO_BOOKED: "DISCO_BOOKED",
  DISCO_NOT_BOOKED: "LOST",
  DISCO_COMPLETED: "DISCO_BOOKED",
  SSS_BOOKED: "SSS_BOOKED",
  SSS_COMPLETED: "SSS_COMPLETED",
  PROPOSAL_SENT: "OFFER_FOLLOWUP",
  SENT_TO_WORKSHOP: "SENT_TO_WORKSHOP",
  WORKSHOP_FOLLOWUP: "WORKSHOP_FOLLOWUP",
  OFFER_FOLLOWUP: "OFFER_FOLLOWUP",
  DEPOSIT_FOLLOWUP: "DEPOSIT_FOLLOWUP",
  DEPOSIT_PAID: "DEPOSIT_PAID",
  WON: "WON",
  LOST: "LOST",
  NO_SHOW: "NO_SHOW",
};

/**
 * Which of the twelve columns a lead belongs in.
 *
 * Returns the column's `legacyStage` + `paymentPlan`, i.e. what to match a `PipelineStage` row on
 * — deliberately not a name and not an id, so the caller's query survives a rename and works on
 * any pipeline that has been bridged to the same stages.
 *
 * A WON lead with no payment plan recorded (every win from before the plan field existed) is
 * filed into "Split Pay": both columns are WON so no metric moves either way, and split is the
 * plan the overwhelming majority of wins actually use. Setting the plan — on the lead form, or by
 * dropping the card in the other column — moves it.
 */
export function boardColumnFor(
  stage: LeadStage,
  paymentPlan: PaymentPlan | null | undefined,
): { legacyStage: LeadStage; paymentPlan: PaymentPlan | null } {
  const legacyStage = BOARD_COLUMN_FOR_STAGE[stage] ?? stage;
  if (legacyStage !== "WON") return { legacyStage, paymentPlan: null };
  return { legacyStage, paymentPlan: paymentPlan ?? "SPLIT_PAY" };
}

/**
 * The stage a card's COLUMN means, which is not always the stage its lead is in.
 *
 * Used for `Opportunity.status`: a DISCO_NOT_BOOKED lead sits in Cancelled/Unqualified, and a card
 * in a cancelled column that still reports status OPEN would show up under the board's "Open"
 * filter inside a closed column. The column wins.
 */
export function columnStageFor(stage: LeadStage): LeadStage {
  return BOARD_COLUMN_FOR_STAGE[stage] ?? stage;
}

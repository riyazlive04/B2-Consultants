/**
 * The stage-movement rules the app already applies, stated in ONE readable place.
 *
 * ── Why this file exists ────────────────────────────────────────────────────────
 * "Automatic move mode" was reported as missing. It is not missing - the app has moved leads
 * automatically all along:
 *
 *   · a call outcome of "not interested" closes the lead        (lib/call-outcome.stageAfterCall)
 *   · a booking created moves the lead to Discovery booked      (booking-actions)
 *   · a discovery outcome routes to SSS / follow-up / no-show   (discovery-routing)
 *   · a lead's stage change moves its Opportunity card          (opportunity-sync)
 *   · a card moved on the board writes back to the lead's stage (opportunities-actions)
 *
 * What was missing was any way to SEE that. The rules lived in five files as `switch` statements
 * and inline conditionals, and there was a founder toggle
 * (`pipelineConfig.mode: "rules" | "drag_drop"`) that claimed to choose between them - read by
 * exactly one screen and ignored by the Opportunities board, which was always drag-and-drop.
 *
 * So this is DOCUMENTATION THAT THE APP RENDERS, not a second engine. Each entry names a rule
 * that real code already enforces, and points at the file that enforces it. It cannot drift into
 * being wrong without someone editing a rule and not this list - which is exactly the review
 * this file is meant to force.
 *
 * Isomorphic and dependency-free: the Console panel and the board both read it.
 */

export type StageRule = {
  /** What happens in the world. */
  trigger: string;
  /** Where the lead ends up. */
  result: string;
  /** The module that actually does it - so a reader can check this list against the code. */
  enforcedIn: string;
  /**
   * True when the move happens with no human involved at all. False = the app OFFERS the move
   * and a person confirms it, which is a materially different promise and should not be
   * presented as automation.
   */
  automatic: boolean;
};

export const STAGE_RULES: readonly StageRule[] = [
  {
    trigger: 'A call is logged as "Not interested" or "Wrong number"',
    result: "Lead → Lost",
    enforcedIn: "lib/call-outcome.ts · stageAfterCall",
    automatic: true,
  },
  {
    trigger: "A call is logged with any other outcome",
    result: "Stage unchanged unless the caller picks one on the same form",
    enforcedIn: "lib/call-outcome.ts · resolveStageAfterCall",
    automatic: false,
  },
  {
    trigger: "A prospect books a discovery call",
    result: "Lead → Discovery booked",
    enforcedIn: "server/booking-actions.ts · submitBooking",
    automatic: true,
  },
  {
    trigger: "A discovery call is recorded as qualified for the strategy session",
    result: "Lead → SSS booked, and the outreach journey advances",
    enforcedIn: "server/discovery-routing.ts · routeDiscoveryCall",
    automatic: true,
  },
  {
    trigger: "A discovery call is recorded as a no-show",
    result: "Lead → No show; the slot is released",
    enforcedIn: "server/discovery-routing.ts · routeDiscoveryCall",
    automatic: true,
  },
  {
    trigger: "A lead's stage changes anywhere in the app",
    result: "Its card moves to the matching column on the default board",
    enforcedIn: "server/opportunity-sync.ts · syncDefaultOpportunity",
    automatic: true,
  },
  {
    trigger: "A card is dragged to a different column on the default board",
    result: "The lead's stage is written back to match",
    enforcedIn: "server/opportunities-actions.ts · moveOpportunity",
    automatic: true,
  },
  {
    trigger: "A lead is captured, or a dormant lead opts in again",
    result: "A card is created on the default board in the column matching its stage",
    enforcedIn: "server/opportunity-sync.ts · ensureDefaultOpportunity",
    automatic: true,
  },
  {
    trigger: "A card is moved into a column with no lead stage mapped",
    result: "NOTHING is written back - the card and the lead stop agreeing",
    enforcedIn: "server/opportunities-actions.ts · moveOpportunity (legacyStage null)",
    automatic: false,
  },
] as const;

/** What `pipelineConfig.mode` actually changes, in the words a founder would use. */
export const PIPELINE_MODE_EFFECT: Record<"rules" | "drag_drop", string> = {
  rules:
    "Cards are positioned by the rules above and cannot be dragged. The board can never disagree with the underlying record.",
  drag_drop:
    "Cards can also be dragged by hand. A card moved manually stays where it was put, and still writes its new stage back to the lead - but the rules stop correcting it afterwards.",
};

/**
 * Generates `WhatsApp_Templates_UTILITY_Submission_Pack.docx` - the full inventory of every
 * WhatsApp template the application needs WATI/Meta to approve, written to qualify as UTILITY
 * wherever that is honestly possible, each with the sample values Meta requires at submission.
 *
 * The count is never written down anywhere in here. It was stale ("25" in one comment, "26" in the
 * footer of the generated document) within a day of the list changing, and a submission pack that
 * misstates how many templates it contains is the one kind of error its reader cannot check. Every
 * count is read off `TEMPLATES`.
 *
 * Unlike scripts/whatsapp-templates-docx.ts (the 9 SOP messages, derived from the SOP constants and
 * declared MARKETING), this is a self-contained submission pack: the bodies here are the UTILITY
 * rewrites, so this file carries its own content rather than deriving it. Re-run after any edit.
 *
 * Run:  npx tsx scripts/wati-templates-utility-docx.ts
 */

import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import { writeFileSync } from "node:fs";
// The SOP pack, for the --all document. Isomorphic (no server-only), so a script may read it.
import {
  SUBMISSION_TEMPLATES,
  submissionBody,
  supersededSubmissionBody,
  type SubmissionTemplate,
} from "../src/lib/whatsapp-submission";
import { STEP_BY_KEY } from "../src/lib/outreach-sop";
import path from "node:path";

// ── palette ──
const INK = "1A1A1A";
const MUTED = "666666";
const ACCENT = "1F5C4A";
const RISK = "B3261E";
const RULE = "DDDDDD";
const SHADE = "F4F6F5";
const UTILITY = "1C6A48";
const AUTH = "33497E";
const MARKETING = "8F560F";

const FONT = "Calibri";
const MONO = "Consolas";

type Category = "UTILITY" | "AUTHENTICATION" | "MARKETING";

type Tpl = {
  area: string;
  name: string;
  kind: string;
  sub: string;
  category: Category;
  fires: string;
  vars: { name: string; sample: string }[];
  body: string;
  note?: { warn?: boolean; tag: string; text: string };
  /**
   * Set ONLY by `actionTemplates()`, for the action document.
   *
   * Not a property of a template - a template does not know whether anybody has submitted
   * it - so it is attached when that one list is built, and absent everywhere else. That is
   * why every reader of it is optional-chained rather than asserted.
   */
  action?: {
    group: Action;
    label: string;
    why: string;
    categoryChanged?: boolean;
    /** What Meta approved last time, for a re-submission. Null where nothing was superseded. */
    previousBody?: string | null;
  };
};

/**
 * WHICH DOCUMENT IS BEING GENERATED. One value, not a bag of booleans.
 *
 * This was `isBatch` and then `isBatch` plus `isAll`, which is two flags with three legal states
 * and one illegal one that had to be caught at runtime (`--batch and --all are different
 * documents`). A fourth document would have made that four flags, twelve illegal combinations and
 * a `cover(list, isBatch, isAll, isAction)` whose argument order is the only thing standing
 * between the reader and the wrong title. One `mode` cannot be in two states at once, and the
 * three records below are exhaustive by type - adding a mode without giving it a title, a file
 * and an npm script does not compile.
 */
type Mode = "inventory" | "batch" | "all" | "action";

/**
 * Exported for `scripts/wati-templates-action-csv.ts`, which renders the same work list as a
 * spreadsheet tab. It imports `actionTemplates()` rather than rebuilding the list from
 * `NEEDS_ACTION`: two readers of the same list is fine, two derivations of it is how the Word
 * document and the sheet end up disagreeing about which templates need submitting.
 */
export type { Tpl };
export { ACTION_GROUP, ACTION_ORDER };

const DOC_TITLE: Record<Mode, string> = {
  inventory: "WhatsApp Templates - Full Inventory",
  batch: "WhatsApp Templates - Awaiting Submission",
  all: "WhatsApp Templates - Complete Set",
  action: "WhatsApp Templates - Action Required",
};
const DOC_FILE: Record<Mode, string> = {
  inventory: "WhatsApp_Templates_UTILITY_Submission_Pack.docx",
  batch: "WhatsApp_Templates_Awaiting_Submission.docx",
  all: "WhatsApp_Templates_Complete_Set.docx",
  action: "WhatsApp_Templates_Action_Required.docx",
};
const NPM_SCRIPT: Record<Mode, string> = {
  inventory: "docs:whatsapp:utility",
  batch: "docs:whatsapp:batch",
  all: "docs:whatsapp:all",
  action: "docs:whatsapp:action",
};

const catColor = (c: Category) => (c === "UTILITY" ? UTILITY : c === "AUTHENTICATION" ? AUTH : MARKETING);

/**
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *  THE BATCH STILL AWAITING SUBMISSION  (26 October 2026)
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `TEMPLATES` below is the full INVENTORY - everything the app can send, approved or not. This is
 * the subset nobody has submitted yet, so that the person doing the submitting has one list to
 * work from rather than a 50-template document to diff against WATI by eye.
 *
 * Run `npm run docs:whatsapp:batch` to get these on their own, in the same layout.
 *
 * ── WHY A NAMED LIST RATHER THAN A DERIVED ONE ──────────────────────────────────────────────
 * The rule "anything ending `_u`, anything starting `b2_stage_`, plus the reset code" would be
 * shorter and would rot the first time a template is approved: it describes how these happen to
 * be named, not what is true about them. Being pending is a fact about a MOMENT, not a property
 * of a template - so it is written down, dated, and each entry says why it is here. Delete a line
 * as it is approved.
 *
 * `wati-template-catalogue.test.ts` asserts every name below resolves to a real entry in
 * `TEMPLATES`, so a typo or a rename fails the suite instead of quietly shrinking the batch.
 */
export const PENDING_SUBMISSION: { name: string; why: string }[] = [
  // ════════════════════════════════════════════════════════════════════════════════════════
  //  EMPTY SINCE 29/10/2026 - EVERY TEMPLATE ON THIS LIST CLEARED META REVIEW
  // ════════════════════════════════════════════════════════════════════════════════════════
  //
  // All 17 entries were approved in one round: the 15 `b2_stage_*` messages, `b2_password_reset_otp`,
  // and (outside this list, in NEEDS_ACTION) `b2_sop_not_qualified` and `b2_sop_sss_confirm_3`.
  // Verified against the tenant, not against anybody's memory: `fetchWatiTemplates()` reports 214
  // templates, 142 APPROVED, and each of those names among them.
  //
  // ── `b2_stage_no_show_1` NEVER EXISTED, AND THAT IS THE ONE TO READ TWICE ───────────────────
  // This list used to carry `b2_stage_no_show_1`, on the recorded belief that `b2_stage_no_show`
  // "was already taken in WATI". **The live account says otherwise**: `b2_stage_no_show` is
  // APPROVED with params `[name, apply_url]` - exactly the vars this pack declares for the
  // STAGE_NO_SHOW template - and `b2_stage_no_show_1` does not exist at all. Whatever was holding
  // the unsuffixed name is gone (the tenant carries 72 DELETED templates).
  //
  // So the `_1` suffix convention described in the git history was never actually used, and the
  // binding must name **`b2_stage_no_show`**. Binding `b2_stage_no_show_1` points at nothing and
  // the touchpoint skips every send, silently, forever - which is the failure this whole file
  // exists to prevent. Confirm the body in WATI before binding: the list API returns an empty
  // body string, so the params match is the strongest check available from here.
  //
  // ⚠ APPROVAL IS NOT DELIVERY. Every name above is approved and **none of them is bound to its
  // touchpoint** - see the binding note on NEEDS_ACTION below. Nothing changed for a single
  // customer when these cleared review.
];

/**
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *  WHAT STILL NEEDS SOMETHING DOING TO IT  (26 October 2026)
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `PENDING_SUBMISSION` above answers "what has never been submitted". That is NOT the same
 * question as "what do I have to do something about", and the gap between them is where a
 * template gets lost: a body that changed after it was approved is not pending by any list, and
 * yet it is the most urgent item there is - Meta approves ONE body per (name, language), so an
 * edited template is a REPLACEMENT in review, and its touchpoint sends nothing at all until the
 * new body clears. Nobody notices, because the app logs a skip rather than failing.
 *
 * ── APPROVAL IS NOT THE LAST STEP, AND 29/10/2026 PROVED IT ────────────────────────────────
 * Eighteen templates cleared Meta review that day and NOTHING changed for a single customer,
 * because a template only sends once it is BOUND to its touchpoint in WhatsApp → Settings. At
 * the time of writing every `b2_stage_*` touchpoint is either unbound or bound to an unrelated
 * older template (STAGE_NEW_LEAD → `b2_sop_intro`, STAGE_DISCO_COMPLETED → `170526_attended`),
 * so the purpose-written messages sit approved and unused while substitutes go out in their
 * place. This list tracks approvals; it cannot see bindings. Check both.
 *
 * So this is the work list: everything awaiting a first approval, everything whose approved body
 * has since changed, and everything carrying a wording decision that is cheaper to take now than
 * after the next approval. Run `npm run docs:whatsapp:action` for it on its own.
 *
 * The first group is DERIVED from `PENDING_SUBMISSION` rather than retyped - the two documents
 * must never disagree about which templates have no approval, and the only way to guarantee that
 * is for one of them not to have its own copy of the names.
 *
 * WHAT THIS LIST CANNOT KNOW: which template names already exist in B2's WATI account. That is
 * recorded here by hand, in this file, and nowhere else - so the first instruction in the
 * generated document is to open WATI's template list and tick off anything already APPROVED with
 * the same body. Delete a line here as it clears.
 */
type Action = "APPROVE" | "BIND" | "RESUBMIT" | "DECIDE";

/** The heading each group gets in the action document, and the order the groups appear in. */
const ACTION_GROUP: Record<Action, string> = {
  APPROVE: "1 · Never submitted — needs a first approval",
  BIND: "2 · Approved but NOT BOUND — the touchpoint still sends nothing",
  RESUBMIT: "3 · Approved once, the body has changed — re-submit",
  DECIDE: "4 · Blocked on a decision — do not submit yet",
};
const ACTION_LABEL: Record<Action, string> = {
  APPROVE: "Submit for approval",
  BIND: "Bind it in WhatsApp → Settings — approval alone sends nothing",
  RESUBMIT: "Re-submit — replaces the approved body",
  DECIDE: "Take the decision before submitting anything",
};
const ACTION_ORDER: Action[] = ["APPROVE", "BIND", "RESUBMIT", "DECIDE"];

export const NEEDS_ACTION: {
  name: string;
  action: Action;
  why: string;
  /**
   * True where the re-submission also changes Meta's CATEGORY, which is a second thing to set
   * in the same edit and the one most easily forgotten - a stripped body left declared
   * MARKETING is billed as MARKETING and stays subject to the per-user marketing cap.
   *
   * Written down rather than inferred: nothing in either pack records what a template's
   * category USED to be, so there is nothing to diff against.
   */
  categoryChanged?: boolean;
  /**
   * The body Meta approved last time, where nothing in the codebase records it.
   *
   * The SOP pack's rewrites carry theirs as `acceptedFix.was`, so `actionTemplates()` DERIVES
   * those and this field stays empty for them. This pack has no such field - it holds one body per
   * template and simply overwrites it - so where a body here has been edited after approval, the
   * old one has to be written down or it is gone. Written down for exactly that reason and no
   * other: if it ever becomes derivable, delete it.
   */
  previousBody?: string;
}[] = [
  // ── Never submitted ──
  // Derived, deliberately. See the note above.
  ...PENDING_SUBMISSION.map((e) => ({ name: e.name, action: "APPROVE" as Action, why: e.why })),

  // Two SOP templates sit outside `PENDING_SUBMISSION` because that list only covers THIS pack's
  // inventory. They are just as unapproved, and the SOP pack says so on each one's own page.
    
  // ── Approved on 29/10/2026, and BOUND TO NOTHING ──────────────────────────────────────────
  // Read against the live tenant, not from memory: all of these are APPROVED in WATI, and not one
  // of them is bound to its touchpoint. Eight touchpoints have no template at all and skip every
  // send; the rest point at an older, unrelated template that happens to be approved, so a
  // substitute message goes out in place of the one written for the moment.
  //
  // Binding is in the app: WhatsApp → Settings. Nothing here can do it, and nothing here can see
  // whether it has been done - which is exactly why this group exists rather than the names being
  // deleted as "done" when review cleared them.
  ...([
    ["b2_stage_new_lead", "STAGE_NEW_LEAD currently sends `b2_sop_intro` instead"],
    ["b2_stage_whatsapp_sent", "STAGE_WHATSAPP_SENT is unbound - every send skips"],
    ["b2_stage_strategy_call_booked", "STAGE_STRATEGY_CALL_BOOKED currently sends `b2_sop_disco_welcome`"],
    ["b2_stage_disco_booked", "STAGE_DISCO_BOOKED currently sends `b2_booking_confirmation`"],
    ["b2_stage_disco_not_booked", "STAGE_DISCO_NOT_BOOKED currently sends `b2_booking_auto_cancelled`"],
    ["b2_stage_sss_booked", "STAGE_SSS_BOOKED currently sends `b2_sop_sss_confirm_1`"],
    ["b2_stage_sss_completed", "STAGE_SSS_COMPLETED currently sends `b2_booking_confirmation`"],
    ["b2_stage_proposal_sent", "STAGE_PROPOSAL_SENT is unbound - every send skips"],
    ["b2_stage_sent_to_workshop", "STAGE_SENT_TO_WORKSHOP is unbound - every send skips"],
    ["b2_stage_workshop_followup", "STAGE_WORKSHOP_FOLLOWUP is unbound - every send skips"],
    ["b2_stage_offer_followup", "STAGE_OFFER_FOLLOWUP is unbound - every send skips"],
    ["b2_stage_deposit_followup", "STAGE_DEPOSIT_FOLLOWUP is unbound - every send skips"],
    ["b2_stage_deposit_paid", "STAGE_DEPOSIT_PAID is unbound - every send skips"],
    ["b2_stage_won", "STAGE_WON is unbound - every send skips"],
    ["b2_stage_lost", "STAGE_LOST currently sends `b2_booking_auto_cancelled`"],
    // ⚠ The approved name has NO `_1` suffix - see the note on PENDING_SUBMISSION above.
    // STAGE_NO_SHOW is currently bound to `b2_sss_rescheduled`, which WATI has DELETED, so the
    // touchpoint is broken twice over: wrong template, and that template no longer exists.
    ["b2_stage_no_show_1", "bind the touchpoint to `b2_stage_no_show` (no suffix); it currently points at the DELETED `b2_sss_rescheduled`"],
    ["b2_password_reset_otp", "PASSWORD_RESET_OTP is unbound - the WhatsApp password-reset route sends nothing"],
    ["b2_sop_not_qualified", "SOP_NOT_QUALIFIED currently sends `b2_booking_auto_cancelled`"],
    ["b2_sop_sss_confirm_3", "SOP_SSS_CONFIRM_3 currently sends `b2_sop_sss_confirm_2` - the third confirmation has its own approved body now"],
  ] as const).map(([name, why]) => ({ name, action: "BIND" as Action, why })),

  // ── Approved once, body has changed since ──
  // The group that no other list catches, and the only group where doing nothing BREAKS something
  // that used to work.
  {
    // ⚠ 29/10/2026: WATI reports this template **DELETED**, not merely superseded - and the app's
    // cached catalogue still had it as APPROVED, so `sendWhatsApp` let every attempt through to
    // WATI to fail there rather than skipping with a reason. TWO touchpoints point at it:
    // SSS_RESCHEDULED and (wrongly) STAGE_NO_SHOW. Both send nothing today.
    name: "b2_sss_rescheduled",
    action: "RESUBMIT",
    categoryChanged: true,
    previousBody:
      "Hi {{name}}, your Success Strategy Session has been rescheduled to *{{slot_time}}* IST.\n\n" +
      "If this time doesn't work for you, you can choose another here at your convenience: {{sss_url}}",
    why:
      "the reviewer corrected the call's NAME on 26/10/2026 - it is the \"Solution\" Strategy Session, not \"Success\" - and the " +
      "correction is applied in the body below. One word, and still a full re-submission: Meta holds one body per " +
      "(name, language), so the approved template now says something B2 does not. " +
      "This one was MISSED by the first pass of this list, and the reason is worth knowing: the three SOP rewrites are " +
      "recorded in code as an `acceptedFix` and this pack has no such field, so a body edited here leaves no trace at all. " +
      "The live catalogue had this name as MARKETING at the 3 Oct cross-reference while the pack declares UTILITY, so set " +
      "the category in the same edit - but check WATI first, since that cross-reference is three weeks old.",
  },
  {
    name: "b2_book_order",
    // Was RESUBMIT. The reviewer answered "this needs to be discussed as well" on 26/10/2026, and
    // a re-submission is exactly what must NOT happen while the content is unsettled: Meta holds
    // one body per (name, language), so submitting the edit takes the APPROVED body out of
    // service and BOOK_ORDER sends nothing until the replacement clears - for a wording nobody
    // has agreed. Doing nothing is safe here, and that is the point of the group: the approved
    // body is still live and still sends.
    action: "DECIDE",
    previousBody:
      "Hello {{publisher_name}}, this is a book order from B2 Consultants (ref *{{order_ref}}*).\n\n" +
      "Please arrange the German *{{level}}* course books for our student {{student_name}}.\n\n" +
      "Ship to: {{ship_to}}\n" +
      "Contact on delivery: {{ship_phone}}\n\n" +
      "Kindly confirm the quotation and expected dispatch date. Thank you.",
    why:
      "approved 03/08/2026, and HOLD IT THERE for now. The body below changed on 26/10/2026 to add the Visual " +
      "Dictionary at the reviewer's own instruction, and on 26/10/2026 the same reviewer answered “this needs to be " +
      "discussed as well” - so the edit is drafted but the content is not agreed. Submitting it anyway is the one " +
      "move that costs something: Meta holds ONE body per (name, language), so the edit would take the APPROVED body " +
      "out of service and BOOK_ORDER would send nothing until the replacement cleared, for a wording nobody has signed " +
      "off. Doing nothing is free and safe - the approved body is live and still sends. Settle TWO things first, both " +
      "on its page below: whether the Visual Dictionary belongs on every level's order, and whether the order should " +
      "name a quantity at all (today it asks for “the set”, which a publisher has to interpret).",
  },
  {
    name: "b2_sop_sss_confirm_1",
    action: "RESUBMIT",
    categoryChanged: true,
    why:
      "the reviewer rewrote the body on 26/10/2026 - the call is the \"Solution\" Strategy Session, not \"Success\", and " +
      "the promotional copy is gone. That moves it MARKETING → UTILITY. A changed body and a changed category are each " +
      "a fresh submission on their own. The sample video is also gone, which is what unblocks Step 19 from being manual-only.",
  },
  {
    name: "b2_sop_sss_confirm_2",
    action: "RESUBMIT",
    categoryChanged: true,
    why:
      "the reviewer rewrote the body on 26/10/2026, same two changes as b2_sop_sss_confirm_1, so MARKETING -> UTILITY. " +
      "SUBMIT THE CLOSING LINE. The reviewer's text ends on {{zoom_link}} and Meta commonly rejects a body that ends with a " +
      "variable, so the body here adds \"Please reply *YES* to confirm.\" after the link. That line is part of what goes to " +
      "Meta - it is NOT added at send time - so paste the body exactly as shown, this list's version, not the sheet's.",
  },
  {
    name: "b2_sop_sss_cancel",
    action: "RESUBMIT",
    categoryChanged: true,
    why:
      "the reviewer rewrote the body on 26/10/2026, same two changes again, so MARKETING → UTILITY. Each page below " +
      "carries the exact text it replaced, so a reviewer can see what changed rather than taking it on trust.",
  },

  // ── A decision with no edit attached, yet ──
  {
    name: "b2_stage_disco_completed",
    action: "DECIDE",
    why:
      "PULLED FROM THE SUBMISSION LIST on 26/10/2026. The reviewer stopped it: “next steps are manual so triggering " +
      "the message doesnot make any sense, we need a tree with 2 branches here.” They are right, and the body is the " +
      "evidence - it promises “we will be in touch shortly with your next steps”, and what happens after a discovery " +
      "call is decided by a human on the call, differently for each prospect. One template cannot carry two outcomes, so " +
      "an approval taken now would be an approval for the wrong message. WHAT THE TWO BRANCHES ALREADY ARE, in the app: a " +
      "qualified prospect goes on to the Solution Strategy Session (SSS_BOOKED, which already has b2_stage_sss_booked) " +
      "and an unqualified one is told so (SOP_NOT_QUALIFIED, which already has b2_sop_not_qualified, submitted this " +
      "round). So the decision is probably NOT to write a third template: it is whether DISCO_COMPLETED needs a message " +
      "of its own at all, given both branches are covered one step later by templates that can name a real next step. " +
      "Nothing is lost by leaving this touchpoint unbound in the meantime - it has never sent anything.",
  },
  {
    name: "b2_payment_reminder",
    action: "DECIDE",
    why:
      "nothing to re-submit today - the body is unchanged and the reviewer confirmed it. But the question they asked " +
      "has to be answered before it is ever submitted again. There is ONE payment-reminder touchpoint and one template " +
      "on it, and the body names B2 Consultants, so a German Note student in arrears either gets a message signed by " +
      "the wrong business or gets nothing at all. Fixing it needs either a second touchpoint or a {{business}} variable " +
      "on this one - and a variable added later costs a re-approval, while a variable added to the next submission costs nothing.",
  },
];

// ────────────────── The templates awaiting Meta approval ──────────────────
//
// The count is deliberately NOT written here - it was wrong ("25") for as long as it was, because
// the comment and the array drift the moment anything is added. Read it off the array.

const AREA_A = "A · Discovery-call & booking lifecycle";
const AREA_I = "I · Class reminders";
const AREA_J = "J · Missing a class & catching up";
const AREA_K = "K · Pipeline stage messages";
const AREA_SOP = "F · Outreach Specialist SOP (Steps 3–21)";
const AREA_H = "H · Portal accounts";

/**
 * The warning every Zoom-link variant carries. One constant because it is one fact, and three
 * copies of it would be three chances to update only two.
 */
const ZOOM_BIND_NOTE =
  "Bind this INSTEAD of the plain template only once Zoom is armed and proven: a booking with no " +
  "link yet SKIPS the send rather than delivering a blank join line, which is the right trade for " +
  "a joining link but is also why the plain template must stay approved as the fallback. The cron " +
  "sweep fills a missing link within one tick.";

/**
 * Exported so `src/lib/__tests__/wati-template-catalogue.test.ts` can hold this list to the
 * contract the app enforces at send time: a template may only declare variables its touchpoint
 * actually offers, or every send of it is silently SKIPPED. That check belongs in CI, not in
 * whoever-reads-the-Word-document's head.
 */
export const TEMPLATES: Tpl[] = [
  // ── A · Discovery-call & booking lifecycle ──
  {
    area: "A · Discovery-call & booking lifecycle",
    name: "b2_booking_confirmation",
    kind: "BOOKING_CONFIRMATION",
    sub: "Booking confirmation",
    category: "UTILITY",
    fires: "Once, immediately after a prospect books a discovery-call slot.",
    vars: [
      { name: "name", sample: "Priya" },
      { name: "slot_time", sample: "Sat 18 Jul, 07:00 PM" },
      { name: "booking_url", sample: "https://app.b2consultants.de/book" },
    ],
    body:
      "Hi {{name}}, your discovery call with B2 Consultants is confirmed for *{{slot_time}}* IST.\n\n" +
      "We'll share the joining details before the call. If you need to reschedule, use this link and we'll update your slot: {{booking_url}}",
  },
  {
    area: "A · Discovery-call & booking lifecycle",
    name: "b2_booking_reminder",
    kind: "BOOKING_REMINDER",
    sub: "Pre-call reminder",
    category: "UTILITY",
    fires: "Before an upcoming booked slot (default 24h and 2h before).",
    vars: [
      { name: "name", sample: "Priya" },
      { name: "slot_time", sample: "Sat 18 Jul, 07:00 PM" },
      { name: "booking_url", sample: "https://app.b2consultants.de/book" },
    ],
    body:
      "Hi {{name}}, a reminder that your discovery call with B2 Consultants is scheduled for *{{slot_time}}* IST.\n\n" +
      "Please reply *YES* to confirm you'll attend, or pick another time here if needed: {{booking_url}}",
  },
  {
    area: "A · Discovery-call & booking lifecycle",
    name: "b2_booking_confirm_request",
    kind: "BOOKING_CONFIRM_REQUEST",
    sub: "Confirm-or-hold request (Bookings loop)",
    category: "UTILITY",
    fires: "As the call approaches - asks the prospect to reply YES to hold their slot before the auto-cancel cut-off.",
    vars: [
      { name: "name", sample: "Priya" },
      { name: "slot_time", sample: "Sat 18 Jul, 07:00 PM" },
      { name: "booking_url", sample: "https://app.b2consultants.de/book" },
    ],
    body:
      "Hi {{name}}, please confirm your discovery call scheduled for *{{slot_time}}* IST by replying *YES*.\n\n" +
      "If you need a different time, you can rebook here and we'll update it: {{booking_url}}",
  },
  {
    area: "A · Discovery-call & booking lifecycle",
    name: "b2_booking_rescheduled",
    kind: "BOOKING_RESCHEDULED",
    sub: "Rescheduled notice",
    category: "UTILITY",
    fires: "When a call is moved to a new time - manual postpone, or promoted into a freed earlier slot.",
    vars: [
      { name: "name", sample: "Priya" },
      { name: "slot_time", sample: "Sun 19 Jul, 05:30 PM" },
      { name: "booking_url", sample: "https://app.b2consultants.de/book" },
    ],
    body:
      "Hi {{name}}, your discovery call has been rescheduled to *{{slot_time}}* IST.\n\n" +
      "If this new time doesn't suit you, you can choose another here at your convenience: {{booking_url}}",
  },
  // -- The three Zoom-link variants. Added 8 Oct 2026, when the app began creating a real Zoom
  // meeting for every booked discovery call (src/server/zoom-meetings.ts).
  //
  // WHY THEY ARE SEPARATE TEMPLATES rather than a 4th variable bolted onto the three above: a
  // declared variable with no value BLOCKS the send. Editing the approved templates in place would
  // mean that the first time Zoom timed out, the prospect got no confirmation at all instead of
  // one without a link. As separate names, the plain templates stay approved as the fallback and
  // the founder binds these per touchpoint once Zoom has proven itself.
  //
  // Submit all three together - it is one review cycle for what is really one change.
  {
    area: AREA_A,
    name: "b2_booking_confirmation_zoom",
    kind: "BOOKING_CONFIRMATION",
    sub: "Booking confirmation (with Zoom link)",
    category: "UTILITY",
    fires: "Once, immediately after a prospect books a discovery-call slot - the variant that carries the meeting link.",
    vars: [
      { name: "name", sample: "Priya" },
      { name: "slot_time", sample: "Sat 18 Jul, 07:00 PM" },
      { name: "zoom_link", sample: "https://us06web.zoom.us/j/85512345678?pwd=abcdEFGH1234" },
      { name: "booking_url", sample: "https://app.b2consultants.de/book" },
    ],
    body:
      "Hi {{name}}, your discovery call with B2 Consultants is confirmed for *{{slot_time}}* IST.\n\n" +
      "Join using this link at your scheduled time: {{zoom_link}}\n\n" +
      "If you need to reschedule, use this link and we'll update your slot: {{booking_url}}",
    note: {
      tag: "Replaces a promise with the thing itself",
      text:
        "The plain b2_booking_confirmation promises that joining details will follow - a promise somebody " +
        "then had to keep by hand. " + ZOOM_BIND_NOTE,
    },
  },
  {
    area: AREA_A,
    name: "b2_booking_reminder_zoom",
    kind: "BOOKING_REMINDER",
    sub: "Pre-call reminder (with Zoom link)",
    category: "UTILITY",
    fires: "Before an upcoming booked slot (default 24h and 2h before) - the variant that carries the meeting link.",
    vars: [
      { name: "name", sample: "Priya" },
      { name: "slot_time", sample: "Sat 18 Jul, 07:00 PM" },
      { name: "zoom_link", sample: "https://us06web.zoom.us/j/85512345678?pwd=abcdEFGH1234" },
      { name: "booking_url", sample: "https://app.b2consultants.de/book" },
    ],
    body:
      "Hi {{name}}, a reminder that your discovery call with B2 Consultants is scheduled for *{{slot_time}}* IST.\n\n" +
      "Join here at your scheduled time: {{zoom_link}}\n\n" +
      "Please reply *YES* to confirm you'll attend, or pick another time here if needed: {{booking_url}}",
    note: {
      tag: "The one that matters most",
      text:
        "This is the message a prospect actually has open minutes before the call, so it is the " +
        "highest-value place for the link. " + ZOOM_BIND_NOTE,
    },
  },
  {
    area: AREA_A,
    name: "b2_booking_rescheduled_zoom",
    kind: "BOOKING_RESCHEDULED",
    sub: "Rescheduled notice (with Zoom link)",
    category: "UTILITY",
    fires: "When a call is moved to a new time - the variant that repeats the meeting link alongside the new time.",
    vars: [
      { name: "name", sample: "Priya" },
      { name: "slot_time", sample: "Sun 19 Jul, 05:30 PM" },
      { name: "zoom_link", sample: "https://us06web.zoom.us/j/85512345678?pwd=abcdEFGH1234" },
      { name: "booking_url", sample: "https://app.b2consultants.de/book" },
    ],
    body:
      "Hi {{name}}, your discovery call has been rescheduled to *{{slot_time}}* IST.\n\n" +
      "The same joining link still works: {{zoom_link}}\n\n" +
      "If this new time doesn't suit you, you can choose another here at your convenience: {{booking_url}}",
    note: {
      tag: "Why the link is safe to repeat",
      text:
        "A reschedule MOVES the existing Zoom meeting rather than creating a second one, so the link " +
        "the prospect already holds stays valid - which is what lets this template say so. " + ZOOM_BIND_NOTE,
    },
  },
  {
    area: "A · Discovery-call & booking lifecycle",
    name: "b2_no_show_followup",
    kind: "NO_SHOW_FOLLOWUP",
    sub: "No-show follow-up",
    category: "UTILITY",
    fires: "For a lead marked No-show - one nudge to rebook.",
    vars: [
      { name: "name", sample: "Priya" },
      { name: "booking_url", sample: "https://app.b2consultants.de/book" },
    ],
    body:
      "Hi {{name}}, we're sorry we missed you at your scheduled discovery call.\n\n" +
      "If you'd like to arrange another time, you can book one here whenever you're ready: {{booking_url}}",
    note: {
      tag: "Borderline",
      text: "There was a booked appointment, so a plain “we missed you, rebook here” can pass as UTILITY. If Meta re-categorises it, that is acceptable - it still sends; it just counts against the marketing cap.",
    },
  },
  {
    area: "A · Discovery-call & booking lifecycle",
    name: "b2_disco_reminder",
    kind: "DISCO_REMINDER",
    sub: "Discovery-call reminder - not yet booked",
    category: "MARKETING",
    fires: "For un-booked leads (New / Disco-not-booked) who haven't scheduled a call.",
    vars: [
      { name: "name", sample: "Priya" },
      { name: "booking_url", sample: "https://app.b2consultants.de/book" },
    ],
    body:
      "Hi {{name}}, you registered interest in finding a job in Germany but haven't booked your discovery call yet.\n\n" +
      "You can book a time with our team here whenever you're ready: {{booking_url}}",
    note: {
      warn: true,
      tag: "Cannot be UTILITY",
      text: "The recipient has booked nothing - there is no transaction to notify about, so this is re-engagement, which Meta treats as MARKETING however plainly it is worded. Submit as MARKETING (opt-in is held via the website form), or drop the template and let the SOP intro/follow-up cover this contact.",
    },
  },

  // ── B · SSS calendar ──
  {
    area: "B · Solution Strategy Session calendar",
    name: "b2_sss_rescheduled",
    kind: "SSS_RESCHEDULED",
    sub: "SSS rescheduled notice",
    category: "UTILITY",
    fires: "When a Solution Strategy Session is moved - founder blocked the slot/day, or a manual/drag reschedule.",
    vars: [
      { name: "name", sample: "Priya" },
      { name: "slot_time", sample: "Mon 20 Jul, 06:30 PM" },
      { name: "sss_url", sample: "https://optin.b2consultants.de/sss" },
    ],
    body:
      "Hi {{name}}, your Solution Strategy Session has been rescheduled to *{{slot_time}}* IST.\n\n" +
      "If this time doesn't work for you, you can choose another here at your convenience: " +
      "{{sss_url}} - your new time is held until then.",
    note: {
      tag: "The three SSS links are now one",
      text:
        "REVIEWER ASKED (26/10/2026): “Perfect (we have to check with the Link as we have 3 links currently)” ANSWER: they were right, and it was a real defect rather than a worry - this app held THREE different answers to “where does someone rebook an SSS?”: a `SSS_URL` constant in server/lead-template-vars.ts, a second literal hardcoded inside `sendSssRescheduled`, and `${base}/sss` off this app's own origin in the test-variable pool. Which one a prospect received depended on which code path sent the message, and the test send showed a URL no real send would ever use. All three now read `getPublicLinksConfig().sssUrl`, so there is one value, it is editable at WhatsApp → Settings, and changing it needs no re-submission. A closing clause was also added after {{sss_url}}: the body used to END on a variable, which Meta commonly rejects.",
    },
  },

  // ── C · Coaching agreements ──
  {
    area: "C · Coaching agreements",
    name: "b2_agreement_send",
    kind: "AGREEMENT_SEND",
    sub: "Signing link",
    category: "UTILITY",
    fires: "When the founder countersigns an agreement - carries the tokenised signing link.",
    vars: [
      { name: "name", sample: "Priya" },
      { name: "document_no", sample: "B2-2026-0142" },
      { name: "sign_url", sample: "https://app.b2consultants.de/sign/k7Qz2Xp9Rt4Bn" },
    ],
    body:
      "Hi {{name}}, your B2 Consultants coaching agreement (ref *{{document_no}}*) is ready for your signature.\n\n" +
      "Please review and sign it securely here - the link is unique to you: {{sign_url}}",
    note: {
      tag: "Variable choice",
      text: "The app can supply either {{sign_url}} (full link in the body) or {{sign_token}} (the 43-char token, if you approve a dynamic URL-button suffix instead). Declare ONE, not both, matching how you build the template. When submitting, paste a full real signing URL so Meta's reviewer sees the true format.",
    },
  },
  {
    area: "C · Coaching agreements",
    name: "b2_agreement_otp",
    kind: "AGREEMENT_OTP",
    sub: "Signing verification code",
    category: "AUTHENTICATION",
    fires: "To send the one-time code that binds the signature to control of the number.",
    // `name` is deliberately NOT declared: the body does not use it, and an AUTHENTICATION
    // template accepts only the code parameter anyway (see the note below, which has said so since
    // this pack was written). Declaring an unused variable is what shifts WATI's positional params
    // by one and earns the "it cannot have typos or blank text" rejection - so the declaration has
    // to match the body, not the list of values the app happens to be able to offer.
    vars: [{ name: "code", sample: "482913" }],
    body: "{{code}} is your B2 Consultants agreement signing code. It is valid for a short time. Do not share it with anyone.",
    note: {
      warn: true,
      tag: "Use AUTHENTICATION, not UTILITY",
      text: "A one-time passcode is Meta's AUTHENTICATION category, which has a fixed format (code + copy button, no marketing) and its own pricing. Meta rejects OTP-style copy submitted as UTILITY. Build it with WATI's authentication template flow. Only the code parameter is declared here - AUTHENTICATION templates allow nothing else, and the app's AGREEMENT_OTP touchpoint offers `name` as well, which is harmless because a template never has to use everything on offer.",
    },
  },
  {
    /**
     * ════════════════════════════════════════════════════════════════════════════════════════
     *  PASSWORD RESET BY WHATSAPP  (issue C4)
     * ════════════════════════════════════════════════════════════════════════════════════════
     *
     * NEEDS APPROVAL BEFORE THE FLOW CAN SHIP, which is why the template is in this pack ahead
     * of the screens: Meta approval is the long-lead item - days - and the code to send through
     * an unapproved template is the code that silently sends nothing.
     *
     * Credentials go out on BOTH channels today (`server/login-credentials.ts` emails them AND
     * WhatsApps them, because for this user base WhatsApp is the one that is read). Resetting
     * them goes out on ONE: `sendResetPassword` in `lib/auth.ts` is a direct Resend call. For a
     * student onboarded over WhatsApp whose email was mistyped at intake, `/forgot-password`
     * then says "a reset link is on its way" - it has to answer generically, or it becomes an
     * address-enumeration oracle - and nothing ever arrives, with no second route to try.
     *
     * A DIFFERENT TEMPLATE FROM b2_agreement_otp, deliberately. One WATI template is bound per
     * WhatsAppKind, and that one's approved text says "agreement signing code" - a person
     * resetting a password would be sent a sentence about a contract. Same reasoning as
     * AGREEMENT_COPY not reusing AGREEMENT_SEND's template.
     */
    // "H · Portal accounts", the area that already holds b2_login_credentials - not an area of
    // its own. A reset code and a set of login details are the same job at two moments, and a
    // new letter would have collided with "B · Solution Strategy Session calendar" in the merged
    // document, giving it two different B sections.
    area: AREA_H,
    name: "b2_password_reset_otp",
    kind: "PASSWORD_RESET_OTP",
    sub: "Portal password-reset code",
    category: "AUTHENTICATION",
    fires: "When a student or team member asks to reset their password and chooses WhatsApp.",
    // Only the code, for the same reason b2_agreement_otp declares only the code: an
    // AUTHENTICATION template accepts nothing else, and declaring an unused variable shifts
    // WATI's positional parameters by one and earns a rejection.
    vars: [{ name: "code", sample: "719204" }],
    body:
      "{{code}} is your B2 Consultants password reset code. It is valid for a short time. " +
      "Do not share it with anyone.",
    note: {
      warn: true,
      tag: "Use AUTHENTICATION, not UTILITY",
      text:
        "A one-time passcode is Meta's AUTHENTICATION category, which has a fixed format (code + copy button, no marketing) and its own pricing - OTP copy submitted as UTILITY is rejected. Build it with WATI's authentication template flow, exactly as b2_agreement_otp was. Until this is APPROVED AND BOUND the WhatsApp reset route does not exist and /forgot-password stays email-only, so this is the blocking item rather than the screens.",
    },
  },
  {
    area: "C · Coaching agreements",
    name: "b2_agreement_reminder",
    kind: "AGREEMENT_REMINDER",
    sub: "Unsigned-agreement reminder",
    category: "UTILITY",
    fires: "When an issued agreement is still unsigned and the link has not expired.",
    vars: [
      { name: "name", sample: "Priya" },
      { name: "document_no", sample: "B2-2026-0142" },
      { name: "sign_url", sample: "https://app.b2consultants.de/sign/k7Qz2Xp9Rt4Bn" },
    ],
    body:
      "Hi {{name}}, a reminder that your coaching agreement (ref *{{document_no}}*) is still awaiting your signature.\n\n" +
      "You can complete it here before the link expires - it only takes a minute: {{sign_url}}",
  },
  {
    area: "C · Coaching agreements",
    name: "b2_agreement_copy",
    kind: "AGREEMENT_COPY",
    sub: "Countersigned copy",
    category: "UTILITY",
    fires: "The moment the student signs - carries the link to the sealed, countersigned PDF. Delivering it is what marks the agreement Completed.",
    vars: [
      { name: "name", sample: "Priya" },
      { name: "document_no", sample: "B2-2026-0142" },
      { name: "copy_url", sample: "https://app.b2consultants.de/copy/k7Qz2Xp9Rt4Bn" },
    ],
    body:
      "Hi {{name}}, thank you for signing. Your countersigned copy of agreement *{{document_no}}* is available to download here - please keep it for your records: {{copy_url}}",
  },

  // ── D · Finance & payments ──
  {
    area: "D · Finance & payments",
    name: "b2_payment_reminder",
    kind: "PAYMENT_REMINDER",
    sub: "Overdue payment reminder",
    category: "UTILITY",
    fires: "For a pending payment that is overdue (balance still owing).",
    vars: [
      { name: "name", sample: "Priya" },
      { name: "amount", sample: "₹25,000" },
    ],
    body:
      "Hi {{name}}, this is a reminder that a payment of *{{amount}}* is currently due on your B2 Consultants account.\n\n" +
      "If you've already paid, please ignore this message. Otherwise, reply here and we'll assist.",
    note: {
      warn: true,
      tag: "B2 only - German Note students get nothing",
      text:
        "REVIEWER ASKED (26/10/2026): “how does it work for German Note?, because it says B2 Consultants only”. ANSWER, confirmed by B2: “currently the template is only for b2 consultants”. " +
        "WHAT THAT COSTS, stated plainly: there is ONE PAYMENT_REMINDER touchpoint and one template bound to it, so a German Note student in arrears either receives a message signed by the wrong business or - if the touchpoint is left unbound for them - receives nothing. The app cannot tell them apart here: the reminder is raised off `PendingPayment`, which carries a `programLevel` and therefore a business line, but the touchpoint has no {{business}} variable to switch on. " +
        "FIXING IT LATER means either a second touchpoint (PAYMENT_REMINDER_GN, its own template) or a {{business}} variable on this one - and the second costs a re-approval, so it is cheaper to decide before submitting than after.",
    },
  },
  {
    area: "D · Finance & payments",
    name: "b2_emi_pre_due",
    kind: "EMI_PRE_DUE",
    sub: "Instalment due-soon reminder",
    category: "UTILITY",
    fires: "Before an instalment's due date (default 3 days out, then on the day). Runs in dry-run by default.",
    vars: [
      { name: "name", sample: "Priya" },
      { name: "seq", sample: "2" },
      { name: "total", sample: "3" },
      { name: "amount", sample: "₹25,000" },
      { name: "due_date", sample: "20 Jul 2026" },
    ],
    body:
      "Hi {{name}}, a reminder that instalment {{seq}} of {{total}} - *{{amount}}* - is due on *{{due_date}}*.\n\n" +
      "Please ensure funds are available by then. Reply here if you have any questions.",
  },

  // ── E · Student coaching ──
  {
    area: "E · Student coaching",
    name: "b2_student_welcome",
    kind: "STUDENT_WELCOME",
    sub: "Enrolment welcome",
    category: "UTILITY",
    fires:
      "Once, when a student is seated in a batch - i.e. after they have signed, paid and been enrolled. Never repeats, even if they later move batch.",
    vars: [
      { name: "name", sample: "Priya" },
      { name: "program", sample: "Guided" },
      { name: "tutor_name", sample: "Lena Fischer" },
      { name: "first_class", sample: "Mon 20 Oct, 07:00 PM IST" },
    ],
    body:
      "Hi {{name}}, welcome to the *{{program}}* programme at B2 Consultants - you're all set.\n\n" +
      "{{tutor_name}} will be looking after you, and your first session is {{first_class}}.\n\n" +
      "Reply here any time if you have a question.",
    note: {
      tag: "Bind this one first",
      text:
        "This is the only enrolment message the app sends. Every variable it declares is guaranteed " +
        "non-empty by the sender: tutor_name falls back from the batch tutor to the assigned coach, " +
        "and first_class to “we'll confirm the time shortly” when no class is scheduled yet. " +
        "It therefore cannot be skipped for want of a value, unlike the _portal variant below.",
    },
  },
  {
    area: "E · Student coaching",
    name: "b2_student_welcome_portal",
    kind: "STUDENT_WELCOME",
    sub: "Enrolment welcome (with portal link)",
    category: "UTILITY",
    fires: "Same trigger as b2_student_welcome - bind ONE of the two, not both.",
    vars: [
      { name: "name", sample: "Priya" },
      { name: "program", sample: "Guided" },
      { name: "tutor_name", sample: "Lena Fischer" },
      { name: "first_class", sample: "Mon 20 Oct, 07:00 PM IST" },
      { name: "portal_url", sample: "https://app.b2consultants.de/portal" },
    ],
    body:
      "Hi {{name}}, welcome to the *{{program}}* programme at B2 Consultants - you're all set.\n\n" +
      "{{tutor_name}} will be looking after you, and your first session is {{first_class}}.\n\n" +
      "You can follow your milestones, agreement and payments any time at {{portal_url}}.\n\n" +
      "Reply here any time if you have a question.",
    note: {
      warn: true,
      tag: "Skips for students with no login",
      text:
        "portal_url is EMPTY for a student who has not been given a portal account yet, and an " +
        "unresolved variable skips the whole send rather than delivering a blank line. Same trade as " +
        "the _zoom booking variants: bind this one only once creating a portal login is a routine " +
        "part of enrolling someone, and keep b2_student_welcome approved as the fallback.",
    },
  },
  {
    area: "E · Student coaching",
    name: "b2_checkin_nudge",
    kind: "CHECKIN_NUDGE",
    sub: "Check-in nudge",
    category: "UTILITY",
    fires: "For a student whose coaching check-in date has arrived or passed.",
    vars: [{ name: "name", sample: "Priya" }],
    body:
      "Hi {{name}}, it's time for your scheduled coaching check-in with B2 Consultants. Please reply to this message to arrange your session.",
    note: {
      tag: "What the check-in is, and who receives this",
      text:
        "REVIEWER ASKED (26/10/2026): “what is check-in here, I am not aware of this”. ANSWER: “this is the template to connect with Mr. Karthik” - correct, with one detail worth being exact about, because it decides whose phone rings. " +
        "THE MESSAGE GOES TO THE STUDENT, not to the head coach. `server/whatsapp.ts` sends it `to: e.student.phone` for every ACTIVE enrolment whose `nextCheckInDate` has arrived or passed, so it is the nudge that gets the STUDENT to come and book their coaching session - which is the session Karthick runs. He is the subject of the message, never its recipient. " +
        "The body deliberately does not name him: it says “your scheduled coaching check-in with B2 Consultants”, so a change of head coach does not need a re-approval. Throttled by `studentRepeatHours` so a student past their date is not nudged daily.",
    },
  },
  {
    area: "E · Student coaching",
    name: "b2_sprint_miss_nudge",
    kind: "SPRINT_MISS_NUDGE",
    sub: "Sprint-miss nudge",
    category: "UTILITY",
    fires: "For a student who missed a sprint-week target.",
    vars: [{ name: "name", sample: "Priya" }],
    body:
      "Hi {{name}}, our records show this week's sprint target wasn't marked complete. Reply to this message and your coach will help you get back on track.",
  },

  // ── F · Outreach Specialist SOP ──
  {
    area: "F · Outreach Specialist SOP (Steps 3–21)",
    name: "b2_sop_intro",
    kind: "SOP_INTRO",
    sub: "SOP Step 3 · WhatsApp introduction",
    category: "MARKETING",
    fires: "Immediately after opt-in (target <5 min), inviting a discovery call.",
    vars: [
      { name: "name", sample: "Priya" },
      { name: "sender", sample: "Nilofer" },
    ],
    body:
      "Hi {{name}}, this is {{sender}} from B2 Consultants. Thanks for registering your interest in finding your next job in Germany.\n\n" +
      "You can book a 20-minute discovery call with our team here: https://optin.b2consultants.de/apply\n\n" +
      // Was "I'll also give you a quick call shortly to help you get booked." Changed 3 Aug 2026,
      // same decision as the acceptedFix in src/lib/whatsapp-submission.ts: this message is now
      // auto-sent at opt-in and a telecaller only rings if the prospect does NOT book, so promising
      // a call outright would be a promise the system deliberately does not keep.
      "Prefer a hand with booking? Just reply here and one of our team will call you.",
    note: {
      warn: true,
      tag: "Cannot be UTILITY",
      text: "This is the first contact and its whole purpose is to invite someone to book - there is no existing appointment to notify about, so it is promotional by nature. Even stripped of “*FREE*”, Meta reads an invitation-to-book to a fresh lead as MARKETING. Submit as MARKETING (opt-in is held via the website form).",
    },
  },
  {
    area: "F · Outreach Specialist SOP (Steps 3–21)",
    name: "b2_sop_followup_not_booked",
    kind: "SOP_FOLLOWUP",
    sub: "SOP Step 6 · Follow-up, not booked",
    category: "MARKETING",
    fires: "When the lead is still not booked at the 2-hour check.",
    vars: [
      { name: "name", sample: "Priya" },
      { name: "sender", sample: "Nilofer" },
    ],
    body:
      "Hi {{name}}, {{sender}} here from B2 Consultants. I noticed you haven't booked your discovery call with our team yet.\n\n" +
      "You can book a time directly here: https://optin.b2consultants.de/apply\n\n" +
      "Let me know if you'd like any help.",
    note: {
      warn: true,
      tag: "Cannot be UTILITY",
      text: "Same reason as Step 3 - chasing an un-booked lead is re-engagement. Submit as MARKETING.",
    },
  },
  /*
   * REMOVED 26/10/2026: `b2_sop_disco_cancel_u` - a UTILITY rewrite for SOP Step 16.
   *
   * It was redundant, and keeping it would have left SOP_DISCO_CANCEL with two candidate
   * templates for a founder to pick between on a screen that offers no way to tell them apart.
   *
   * `b2_booking_auto_cancelled`, two hundred lines above, is ALREADY APPROVED, is already the
   * UTILITY body for this exact event, and says the identical thing: no confirmation arrived, so
   * the slot was released, here is a link to book again. `src/lib/whatsapp-submission.ts` binds
   * Step 16 to it deliberately for that reason. One approved template serving both the Bookings
   * confirm-loop and the SOP's Step 16 is correct - the words are true at both - and a second
   * submission saying the same thing is one more thing to keep in step for no gain.
   *
   * The entry this replaces carried the body kept below for the record, which is what
   * `b2_booking_auto_cancelled` already says:
   *   "Hi {{name}}, as we didn't receive your confirmation, your discovery call slot has been
   *    released. If you'd still like to speak with us, you can book another time here..."
   */

  // ── G · Book publisher orders ──
  {
    area: "G · Book publisher orders",
    name: "b2_book_order",
    kind: "BOOK_ORDER",
    sub: "Order for a student's level books, sent to the publisher/vendor",
    category: "UTILITY",
    fires: "When a book order is placed with the publisher for a student's level (BookOrder → ORDERED / QUOTE_REQUESTED). Sent to the Vendor's WhatsApp number.",
    vars: [
      { name: "publisher_name", sample: "Sharma Book House" },
      { name: "order_ref", sample: "BO-2026-0087" },
      { name: "level", sample: "German A1" },
      { name: "student_name", sample: "Priya Sharma" },
      { name: "ship_to", sample: "12 MG Road, Indiranagar, Bengaluru 560038" },
      { name: "ship_phone", sample: "+91 98450 12345" },
    ],
    body:
      "Hello {{publisher_name}}, this is a book order from B2 Consultants (ref *{{order_ref}}*).\n\n" +
      "Please arrange the German *{{level}}* course books set and Visual dictionary for our student {{student_name}}.\n\n" +
      "Ship to: {{ship_to}}\n" +
      "Contact on delivery: {{ship_phone}}\n\n" +
      "Kindly confirm the quotation and expected dispatch date. Thank you.",
    note: {
      warn: true,
      tag: "Re-approval needed, and one wording decision open",
      text:
        "RE-SUBMIT. The body changed on 26 Oct 2026 to add the Visual Dictionary, at the reviewer’s instruction (“a visual dictionary has to be ordered”), so it goes with every order and is fixed text rather than a variable. It was approved on 3 Aug 2026 as “…the German *{{level}}* course books for our student…”. Meta approves one body per (name, language), so this edit sends the template back through review - and until it clears, BOOK_ORDER has no approved template and sends nothing. " +
        "OPEN QUESTION - A BUNDLE READS BADLY, which is what the reviewer’s own question exposes. {{level}} is the level’s display label, and the catalogue has a GERMAN_BUNDLE kind labelled “German bundle” (lib/levels.ts) - so a bundle order renders as “the German *German bundle* course books set”. Dropping the literal word “German” from the body fixes both cases at once: “the *German A1* course books set” and “the *German bundle* course books set” both read correctly. NOT applied - it changes what the publisher reads, which is B2’s call, and taking it later would cost a second re-approval. Decide it before submitting, not after. " +
        "Otherwise unchanged and live in the app: Students → Book orders → Update → “Send to publisher”. {{publisher_name}} comes from the Vendor, {{order_ref}} is allocated as BO-YYYY-NNNN on first send, {{level}} is the level's display label, and {{student_name}}/{{ship_to}}/{{ship_phone}} come from the order's snapshot - not live off the Student, so a later address edit cannot rewrite where a past parcel went. Sending is MANUAL by design; a status change never places an order. The publisher's number must be opted-in for a business-initiated template to deliver.",
    },
  },

  // ── H · Portal accounts ──
  {
    area: AREA_H,
    name: "b2_login_credentials",
    kind: "LOGIN_CREDENTIALS",
    sub: "Portal login details",
    category: "UTILITY",
    fires:
      "When an admin creates a student's portal login, reinstates one, or resets a password - with “Send the login details” ticked (the default). The same details go by email at the same moment.",
    vars: [
      { name: "name", sample: "Priya" },
      { name: "login_url", sample: "https://b2app.sirahagents.com/login" },
      { name: "login_email", sample: "priya.nair@example.com" },
      { name: "temp_password", sample: "Journey-2026" },
    ],
    body:
      "Hi {{name}}, your B2 Consultants portal login is ready.\n\n" +
      "Sign in: {{login_url}}\n" +
      "Login email: {{login_email}}\n" +
      "Temporary password: {{temp_password}}\n\n" +
      "You will be asked to set your own password the first time you sign in. From now on, all your " +
      "updates - classes, progress, payments, receipts and documents - are in the portal.",
    note: {
      tag: "Password is never stored",
      text:
        "The app logs this message with {{temp_password}} redacted, so the password exists only in the delivered " +
        "message and the email. If Meta rejects the template for carrying a password, resubmit it WITHOUT " +
        "{{temp_password}} (“Your temporary password has been emailed to {{login_email}}”): the app still offers the " +
        "variable, an unused one is simply not sent, and the email carries the password on its own.",
    },
  },

  // ── I · Class reminders ──
  // The only touchpoints in this pack that message a ROOM rather than a person: one class fans
  // out to its whole roster. Both ship switched off and rehearsing (WhatsApp → Settings →
  // Cadence), so approving these templates does not by itself start any sending.
  {
    area: AREA_I,
    name: "b2_class_reminder",
    kind: "CLASS_REMINDER",
    sub: "Class starting soon (student)",
    category: "UTILITY",
    fires:
      "To every student on a batch's roster, at each lead time set in Cadence (default 24h and 1h before). Each lead time fires once per student per class. Pre-recorded video modules are never reminded about - they have no start time.",
    vars: [
      { name: "name", sample: "Priya" },
      { name: "class_title", sample: "Open Job Market" },
      { name: "class_time", sample: "Sun 27 Sep, 10:30 AM IST" },
    ],
    body:
      "Hi {{name}}, a quick reminder about your next B2 Consultants session.\n\n" +
      "*{{class_title}}*\n" +
      "{{class_time}}\n\n" +
      "The join link is in your classroom on the student portal. See you there.",
    note: {
      tag: "Bind this one first",
      text:
        "Every variable here is guaranteed non-empty by the sender: name and class_title come from " +
        "the timetable, and class_time is always rendered in IST regardless of where the server or " +
        "the reader is. It therefore cannot be skipped for want of a value, unlike the _link variant below.",
    },
  },
  {
    area: AREA_I,
    name: "b2_class_reminder_link",
    kind: "CLASS_REMINDER",
    sub: "Class starting soon, with the join link (student)",
    category: "UTILITY",
    fires: "Same trigger as b2_class_reminder - bind ONE of the two, not both.",
    vars: [
      { name: "name", sample: "Priya" },
      { name: "class_title", sample: "Open Job Market" },
      { name: "class_time", sample: "Sun 27 Sep, 10:30 AM IST" },
      { name: "join_url", sample: "https://zoom.us/j/98412345678" },
    ],
    body:
      "Hi {{name}}, a quick reminder about your next B2 Consultants session.\n\n" +
      "*{{class_title}}*\n" +
      "{{class_time}}\n\n" +
      "Join here: {{join_url}}\n\n" +
      "See you there.",
    note: {
      warn: true,
      tag: "Skips any class with no link pasted yet",
      text:
        "join_url is EMPTY until someone puts the Zoom link on the class, and an unresolved variable " +
        "skips the whole send rather than delivering a blank line. Same trade as the _zoom booking " +
        "variants and the _portal welcome: bind this one only once pasting the link is a routine part " +
        "of building a timetable. Until then bind b2_class_reminder, which points students at their " +
        "classroom instead.",
    },
  },
  {
    area: AREA_I,
    name: "b2_class_reminder_coach",
    kind: "CLASS_REMINDER_COACH",
    sub: "Class starting soon (coach / tutor)",
    category: "UTILITY",
    fires:
      "The same classes and the same lead times as the student reminder, to whoever runs the batch. Switched on separately, so the coach side can be armed before or after the student side.",
    vars: [
      { name: "name", sample: "Karthick" },
      { name: "class_title", sample: "Open Job Market" },
      { name: "class_time", sample: "Sun 27 Sep, 10:30 AM IST" },
      { name: "batch_name", sample: "Guided - September 2026" },
      { name: "student_count", sample: "8" },
    ],
    body:
      "Hi {{name}}, your next class is coming up.\n\n" +
      "*{{class_title}}* - {{batch_name}}\n" +
      "{{class_time}}\n" +
      "{{student_count}} students expected.\n\n" +
      "The join link and the register are on your teaching desk.",
    note: {
      tag: "Goes to the team profile number",
      text:
        "The recipient is read from the coach's TEAM PROFILE phone, not their login - a coach with no " +
        "profile number is skipped with that reason rather than guessed at. student_count is the live " +
        "roster size (batch members plus active enrolments, de-duplicated), so it is never blank for a " +
        "batch that has anybody in it.",
    },
  },
  // ── J · Missing a class & catching up ──
  // Both of these carry a JUDGEMENT about the recipient rather than an invitation, which is why
  // they ship behind their own rehearse switch (WhatsApp → Settings → Cadence) and why neither
  // can fire until a coach has PUBLISHED the register it reads from.
  {
    area: AREA_J,
    name: "b2_class_absence",
    kind: "CLASS_ABSENCE",
    sub: "Marked absent from a class",
    category: "UTILITY",
    fires:
      "To a student marked ABSENT, once the coach presses “Show to students” on that register - never when it is marked. Late and excused students are never messaged: one was in the room, and the other told somebody. Only absences from the last 14 days are ever sent.",
    vars: [
      { name: "name", sample: "Priya" },
      { name: "class_title", sample: "Open Job Market" },
      { name: "class_date", sample: "Sun 27 Sep, 10:30 AM IST" },
      { name: "watch_deadline", sample: "7 days left to watch" },
    ],
    body:
      "Hi {{name}}, we had you down as absent from this session.\n\n" +
      "*{{class_title}}*\n" +
      "{{class_date}}\n\n" +
      "The recording is in your classroom on the student portal - {{watch_deadline}}.\n\n" +
      "If you think this is wrong, reply here and your coach will check the register.",
    note: {
      tag: "Bind this one first",
      text:
        "Every variable is guaranteed non-empty by the sender. watch_deadline is a SENTENCE rather " +
        "than a date (“7 days left to watch”, “No time limit”, “Your coach has not posted it yet”) " +
        "because the viewing window is set per recording, and a bare date would leave the reader to " +
        "work out whether it has already passed. The closing line is not politeness: a register is " +
        "taken by a human in a hurry, and a message that asserts an absence with no way to dispute " +
        "it is how a wrong tick becomes an argument.",
    },
  },
  {
    area: AREA_J,
    name: "b2_class_absence_link",
    kind: "CLASS_ABSENCE",
    sub: "Marked absent, with the recording link",
    category: "UTILITY",
    fires: "Same trigger as b2_class_absence - bind ONE of the two, not both.",
    vars: [
      { name: "name", sample: "Priya" },
      { name: "class_title", sample: "Open Job Market" },
      { name: "class_date", sample: "Sun 27 Sep, 10:30 AM IST" },
      { name: "recording_url", sample: "https://fathom.video/share/abc123" },
      { name: "watch_deadline", sample: "7 days left to watch" },
    ],
    body:
      "Hi {{name}}, we had you down as absent from this session.\n\n" +
      "*{{class_title}}*\n" +
      "{{class_date}}\n\n" +
      "Catch up here: {{recording_url}}\n" +
      "{{watch_deadline}}.\n\n" +
      "If you think this is wrong, reply here and your coach will check the register.",
    note: {
      warn: true,
      tag: "Skips any class whose recording is not up - or has expired",
      text:
        "recording_url is EMPTY until somebody posts the video, and an unresolved variable skips the " +
        "whole send. It is ALSO emptied once that recording's viewing window has closed, because a " +
        "link the student will be refused at is worse than no link. Both cases mean a student who " +
        "was absent hears nothing at all - which is the situation where being told matters most. " +
        "Bind the plain template unless posting the recording the same day is already routine.",
    },
  },
  {
    area: AREA_J,
    name: "b2_class_catch_up",
    kind: "CLASS_CATCH_UP",
    sub: "Recording still not watched",
    category: "UTILITY",
    fires:
      "To a student who missed a class and still has not watched its recording once the catch-up grace has run out (Console → Attendance, default 24 hours after the recording goes up). Once per class per student.",
    vars: [
      { name: "name", sample: "Priya" },
      { name: "class_title", sample: "Open Job Market" },
      { name: "class_date", sample: "Sun 27 Sep, 10:30 AM IST" },
      { name: "watch_deadline", sample: "5 days left to watch" },
    ],
    body:
      "Hi {{name}}, you have not caught up on this one yet.\n\n" +
      "*{{class_title}}*\n" +
      "{{class_date}}\n\n" +
      "The recording is in your classroom - {{watch_deadline}}. It takes one sitting, and the next " +
      "session builds on it.",
    note: {
      tag: "Never sent about a recording they cannot open",
      text:
        "Two cases are deliberately excluded and reach nobody's phone: a class whose recording was " +
        "never posted, and one whose viewing window has already closed. Both are the COACH's failing " +
        "rather than the student's, and both appear on the Attendance desk instead. “Watched” is " +
        "judged on the TRACKED percentage, not the student's own tick - so somebody who ticked " +
        "watched at 40% still receives this.",
    },
  },

  // ════════════════════════════════════════════════════════════════════════════════════════════
  //  K · PIPELINE STAGE MESSAGES  (issue W2)
  // ════════════════════════════════════════════════════════════════════════════════════════════
  //
  // Seventeen touchpoints, one per LeadStage, and until now NOT ONE of them had a template in
  // either submission pack. `lib/stage-messages.ts` says what that cost: "WhatsApp is
  // template-only (Meta rule for business-initiated messages) ... Until one is bound, that stage
  // sends its email only and the WhatsApp attempt is logged once as skipped." So the feature has
  // been shipping half-armed since it was built - every stage change sent its email and silently
  // dropped its WhatsApp.
  //
  // ── EVERY BODY DECLARES {{name}} AND NOTHING ELSE, AND THAT IS THE WHOLE DESIGN ─────────────
  // A STAGE_* touchpoint offers eight variables (`LEAD_TEMPLATE_VARS`), and declaring any of the
  // other seven would break these templates for most of the leads they are meant to reach,
  // because `sendWhatsApp` SKIPS a send whose declared variable resolves to nothing:
  //
  //   `slot_time` / `date` / `time`   filled only from a LIVE booking. A lead dragged to
  //                                   "Disco booked" on the board by hand has no BookingRequest
  //                                   row, so a template declaring the time would reach the
  //                                   automatic leads and silently skip the manual ones - the
  //                                   worst kind of failure, because it half-works.
  //   `zoom_link`                     filled only once the Zoom reconciler has run.
  //   `sss_url` / `booking_url`       always filled, but they resolve to a DIFFERENT host from
  //                                   the one the stage EMAILS use (`/book` vs the opt-in page).
  //                                   Two halves of one feature must not send people to two
  //                                   places, so the link is written into the body as a constant
  //                                   matching `lib/stage-messages.ts`'s own BOOK.
  //   `sender`                        always filled, and deliberately unused: a stage change is
  //                                   the SYSTEM noticing something, not a person writing. A
  //                                   name on it invites a reply to somebody who never typed it.
  //
  // ── THE CATEGORY RULE, STATED ONCE ──────────────────────────────────────────────────────────
  // UTILITY where the message is about an appointment or a payment THAT ALREADY EXISTS - the
  // prospect's own transaction, reported back to them. MARKETING where its purpose is to get them
  // to take a step they have not taken, which is every "book it", "come back" and "any questions
  // about the offer" message however politely it is worded. Eight UTILITY, nine MARKETING.
  //
  // Meta judges by the body, not by our label: see the rationale at the top of
  // `src/lib/whatsapp-submission.ts` for what a declaration that flatters the copy actually buys.
  //
  // Bodies are derived from `DEFAULT_COPY` in `lib/stage-messages.ts` - the same message the email
  // half sends - rewritten for WhatsApp: no subject line, no sign-off block, short paragraphs, and
  // the persuasive asides dropped wherever they were the only thing standing between a message and
  // UTILITY.
  //
  // ── FIVE OF THEM OVERLAP A TEMPLATE THAT IS ALREADY APPROVED ────────────────────────────────
  // New Lead, Disco Booked, Won, Lost and No-show each say roughly what some other engine already
  // says at roughly the same moment. They are submitted for completeness - a touchpoint with no
  // approved template can never be turned on later - but each carries a note saying which engine
  // it collides with, because binding both is how a prospect hears from us twice in a day.

  {
    area: AREA_K,
    name: "b2_stage_new_lead",
    kind: "STAGE_NEW_LEAD",
    sub: "Stage · New lead",
    category: "MARKETING",
    fires: "Every time a lead enters New Lead - the first thing a brand-new opt-in hears from us.",
    vars: [{ name: "name", sample: "Priya" }, { name: "apply_url", sample: "https://optin.b2consultants.de/apply" }],
    /**
     * The reviewer rewrote this on 26/10/2026. Two edits were made to their text before it went
     * in, both from the creation rules in docs/WHATSAPP_TEMPLATE_CREATION_RULES.md:
     *   - "your next step towards Germany... the next step is to book" said "next step" twice in
     *     two sentences. The second is now "To move forward, book", which also closes the
     *     missing comma.
     *   - the link is a variable, and the body no longer ENDS on it.
     */
    body:
      "Hi {{name}}, thanks for your interest in taking your next step towards Germany 🇩🇪.\n\n" +
      "To move forward, book a free 20-minute Personalized Discovery Call with our team so we can " +
      "understand your situation and propose possible solutions.\n\n" +
      "You can book a time that suits you here: {{apply_url}} - it takes under two minutes.",
    note: {
      tag: "Overlaps SOP Step 3 - bind only one",
      text:
        "b2_sop_intro says almost the same thing at almost the same moment: the SOP's Step 3 fires on opt-in, and a lead's first stage IS New Lead. Binding both sends two first messages. Decide which engine owns the opening - the SOP ladder or stage messages - and leave the other one unbound.",
    },
  },
  {
    area: AREA_K,
    name: "b2_stage_whatsapp_sent",
    kind: "STAGE_WHATSAPP_SENT",
    sub: "Stage · WhatsApp sent",
    category: "MARKETING",
    fires: "Every time a lead enters WhatsApp Sent.",
    vars: [{ name: "name", sample: "Priya" }, { name: "apply_url", sample: "https://optin.b2consultants.de/apply" }],
    // Reviewer 26/10/2026: "perfect". The wording is theirs, untouched; only the link moved into
    // a variable, with a closing clause so the body does not end on one.
    body:
      "Hi {{name}}, just checking you received our message about your move to Germany.\n\n" +
      "Whenever you are ready, you can book your free Discovery Call here: {{apply_url}} - it " +
      "takes under two minutes.",
    note: {
      warn: true,
      tag: "Consider leaving this one unbound",
      text:
        "The stage means we have sent them a WhatsApp, and the email half says exactly that - which reads sensibly in an inbox and absurdly on WhatsApp, where it is a message announcing itself. The body above is rewritten as a plain nudge instead, but the honest answer may be to get it approved and bind nothing: the SOP's Step 6 already chases an un-booked lead, with better timing.",
    },
  },
  {
    area: AREA_K,
    name: "b2_stage_strategy_call_booked",
    kind: "STAGE_STRATEGY_CALL_BOOKED",
    // "Discovery Call Booked", not "Strategy call booked" - see the note below. The TEMPLATE name
    // keeps `strategy_call` because it mirrors the WhatsAppKind, which is the convention for all
    // seventeen of these; only the words a human reads are corrected.
    sub: "Stage · Discovery Call Booked",
    category: "UTILITY",
    fires: "Every time a lead enters Discovery Call Booked (the STRATEGY_CALL_BOOKED stage).",
    vars: [{ name: "name", sample: "Priya" }],
    body:
      "Hi {{name}}, your Personalized Discovery Call with B2 Consultants is booked.\n\n" +
      "Our team is preparing for it and will be in touch if we need anything more from you.",
    note: {
      tag: "Discovery Call - the STAGE is misnamed, the body is right",
      text:
        "REVIEWER ASKED (26/10/2026): “Strategy call or Discovery call?” ANSWER: Discovery call, and the body already says so - nothing in it changes. `STRATEGY_CALL_BOOKED` is a LEGACY enum name: the app itself calls this stage “Discovery Call Booked” on every screen (LEAD_STAGE_LABELS in lib/labels.ts and SYNAMATE_STAGES in lib/pipeline-stages.ts, which labels.test.ts holds to each other), and B2 sells exactly one such call - the Personalized Discovery Call. There is no separate “strategy call” anywhere in the product; the Solution Strategy Session is the LATER call and has its own stages, touchpoints and templates (b2_stage_sss_booked onwards). The stale word was in this pack's own heading and is now corrected. Separately, on category: the email half closes with a link to the case-studies page, which is social proof and would make this MARKETING on its own. It is dropped here - this message's job is to confirm an appointment the prospect has just made - and no time is quoted, for the reason given at the top of this section.",
    },
  },
  {
    area: AREA_K,
    name: "b2_stage_disco_booked",
    kind: "STAGE_DISCO_BOOKED",
    sub: "Stage · Discovery call booked",
    category: "UTILITY",
    fires: "Every time a lead enters Disco Booked.",
    vars: [{ name: "name", sample: "Priya" }],
    body:
      "Hi {{name}}, your Discovery Call is confirmed.\n\n" +
      "Please keep the time free and join a few minutes early. If anything changes, reply to this " +
      "message and we will move it for you.",
    note: {
      tag: "Overlaps b2_booking_confirmation",
      text:
        "A prospect who books through /book already receives b2_booking_confirmation from the booking engine, WITH the time in it. This stage fires as well, so binding both sends two confirmations for one appointment. Bind this only for leads whose stage is moved by hand - or, more simply, leave it unbound and let the booking engine own the confirmation.",
    },
  },
  {
    area: AREA_K,
    name: "b2_stage_disco_not_booked",
    kind: "STAGE_DISCO_NOT_BOOKED",
    sub: "Stage · Discovery call not booked",
    category: "MARKETING",
    fires: "Every time a lead enters Disco Not Booked - including from the no-slots capture on /book.",
    vars: [{ name: "name", sample: "Priya" }, { name: "apply_url", sample: "https://optin.b2consultants.de/apply" }],
    /**
     * The reviewer rewrote this on 26/10/2026 as "It takes less than 2 minutes to get your German
     * roadmap, there is no obligation." Their three facts are kept and two faults are fixed:
     *   - "It" read back to the CALL in the previous sentence, making the message say the call
     *     takes under 2 minutes when it takes 20 - a misleading claim, and a rejection reason in
     *     its own right. The subject is now "Booking".
     *   - a comma splice joined the two clauses.
     */
    body:
      "Hi {{name}}, you have not booked your free Personalized Discovery Call yet.\n\n" +
      "Booking takes less than 2 minutes, and there is no obligation - you come away with your " +
      "German roadmap.\n\n" +
      "You can pick a time here: {{apply_url}}, whenever suits you.",
    note: {
      tag: "Now also reaches the no-slots capture",
      text:
        "Since the 26 Oct change to /book, a prospect who arrives when the calendar is empty is captured at this stage rather than lost (issue A6). They are the one audience for whom you have not booked yet is unfair - they tried - so consider a separate wording for them if that capture becomes common. The email half's spots are limited each week, and we do not want you to miss out is dropped: it is scarcity copy, and it was the main thing making this message read as an advert.",
    },
  },
  {
    area: AREA_K,
    name: "b2_stage_disco_completed",
    kind: "STAGE_DISCO_COMPLETED",
    sub: "Stage · Discovery call completed",
    category: "UTILITY",
    fires: "Every time a lead enters Disco Completed.",
    vars: [{ name: "name", sample: "Priya" }],
    body:
      "Hi {{name}}, thank you for taking the time to speak with our team today.\n\n" +
      "We are going through what you shared and will be in touch shortly with your next steps.",
  },
  {
    area: AREA_K,
    name: "b2_stage_sss_booked",
    kind: "STAGE_SSS_BOOKED",
    sub: "Stage · Solution Strategy Session booked",
    category: "UTILITY",
    fires: "Every time a lead enters SSS Booked.",
    vars: [{ name: "name", sample: "Priya" }],
    body:
      "Hi {{name}}, your Solution Strategy Session with B2 Consultants is booked.\n\n" +
      "In this session we map out your personal plan for landing a job in Germany. We will send you " +
      "a reminder before the call.",
    note: {
      tag: "Why no time is quoted here in particular",
      text:
        "The SSS time lives on OutreachJourney.sssAt, and leadTemplateVars fills slot_time from it ONLY when the caller asks for the SSS flavour. The stage sweep is generic and does not, so a slot_time here would resolve to the DISCOVERY call's time - the wrong appointment, confidently stated. The SOP's Step 19 confirmation carries the real one.",
    },
  },
  {
    area: AREA_K,
    name: "b2_stage_sss_completed",
    kind: "STAGE_SSS_COMPLETED",
    sub: "Stage · Solution Strategy Session completed",
    category: "UTILITY",
    fires: "Every time a lead enters SSS Completed.",
    vars: [{ name: "name", sample: "Priya" }],
    body:
      "Hi {{name}}, thank you for your time in the Solution Strategy Session.\n\n" +
      "If anything came up afterwards that you would like to go over, reply to this message.",
  },
  {
    area: AREA_K,
    name: "b2_stage_proposal_sent",
    kind: "STAGE_PROPOSAL_SENT",
    sub: "Stage · Proposal sent",
    category: "MARKETING",
    fires: "Every time a lead enters Proposal Sent.",
    vars: [{ name: "name", sample: "Priya" }],
    body:
      "Hi {{name}}, you now have our offer for the B2 Consultants coaching programme.\n\n" +
      "Take your time with it. If anything is unclear, reply to this message and we will walk you " +
      "through it.",
    note: {
      tag: "MARKETING, and not arguable - plus an open question on WHEN it fires",
      text:
        "A message whose subject is a commercial offer is MARKETING whatever its tone. Declaring it UTILITY would be the gaming that earns an account flag rather than a cheaper message - see the rationale at the top of src/lib/whatsapp-submission.ts. REVIEWER ASKED (26/10/2026): “Perfect, but currently we dont send any proposal actually, whatever happens, happens inside the call, how do we handle this” ANSWER, and it is a BINDING decision rather than a wording one: the body is approved as it stands, so GET IT APPROVED either way - an unapproved template can never be switched on later, and an approval costs nothing to hold. What must not happen is BINDING it while the offer is only ever made verbally on the call, because the body says “you now have our offer” and the prospect would have nothing in hand. Two honest options: (a) leave this touchpoint UNBOUND and let the stage exist for pipeline reporting only - PROPOSAL_SENT folds into the “Offer and didn’t buy” column, so moving a lead there after a verbal offer still reports correctly; or (b) start sending something real at that moment (the offer summary, or the agreement itself) and then bind it. Note b2_stage_offer_followup has the same dependency one step later and the reviewer passed it as “Perfect”, so whichever way this goes, the two should go the same way.",
    },
  },
  {
    area: AREA_K,
    name: "b2_stage_sent_to_workshop",
    kind: "STAGE_SENT_TO_WORKSHOP",
    sub: "Stage · Sent to workshop",
    category: "MARKETING",
    fires: "Every time a lead enters Sent to Workshop.",
    vars: [{ name: "name", sample: "Priya" }, { name: "workshop_url", sample: "https://workshop.b2consultants.de/self-reg-1" }],
    /**
     * REVIEWER, 26/10/2026: "instead of team sending, lets redirect them to the workshop page
     * always". So the closing line is now the registration page rather than a promise that
     * somebody will follow up - which also removes the one sentence in here that nobody could
     * keep automatically. The link is `{{workshop_url}}`, filled from WhatsApp -> Settings.
     *
     * The stage EMAIL in lib/stage-messages.ts was changed in the same breath, for the reason
     * stated at the top of this section: two halves of one touchpoint must not send a prospect
     * to two different places, and one half promising a follow-up while the other hands over a
     * self-registration link is exactly that.
     */
    body:
      "Hi {{name}}, we think our workshop is the right next step for you. It covers what it really " +
      "takes to get a job in Germany.\n\n" +
      "You can register for the next session here: {{workshop_url}} - pick the date that suits you.",
  },
  {
    area: AREA_K,
    name: "b2_stage_workshop_followup",
    kind: "STAGE_WORKSHOP_FOLLOWUP",
    sub: "Stage · Workshop follow-up",
    category: "MARKETING",
    fires: "Every time a lead enters Workshop Follow-up.",
    vars: [{ name: "name", sample: "Priya" }],
    // Reviewer's rewrite of 26/10/2026, which added "so that we can help you with your open
    // questions". Kept, with the comma before "so that" removed - it made the clause read as an
    // afterthought rather than the reason for replying.
    body:
      "Hi {{name}}, thank you for joining our workshop.\n\n" +
      "We would like to hear what you took away from it, and to help with your next step. Just " +
      "reply to this message and we will help with any open questions you have.",
  },
  {
    area: AREA_K,
    name: "b2_stage_offer_followup",
    kind: "STAGE_OFFER_FOLLOWUP",
    sub: "Stage · Offer follow-up",
    category: "MARKETING",
    fires: "Every time a lead enters Offer Follow-up.",
    vars: [{ name: "name", sample: "Priya" }],
    body:
      "Hi {{name}}, checking in about the offer we shared with you.\n\n" +
      "If anything is holding you back, reply and tell us what it is - we would rather know than " +
      "leave you deciding on your own.",
  },
  {
    area: AREA_K,
    name: "b2_stage_deposit_followup",
    kind: "STAGE_DEPOSIT_FOLLOWUP",
    sub: "Stage · Deposit follow-up",
    category: "UTILITY",
    fires: "Every time a lead enters Deposit Follow-up.",
    vars: [{ name: "name", sample: "Priya" }],
    body:
      "Hi {{name}}, the only step left to secure your place in the programme is the deposit.\n\n" +
      "Reply to this message if you need the payment details again, or if you have any questions.",
    note: {
      tag: "UTILITY, same footing as b2_payment_reminder - and how it is triggered",
      text:
        "This is a payment step on a purchase the prospect has already agreed to, which is Meta's own UTILITY example and exactly the footing b2_payment_reminder is submitted on. The email half's we are glad you have decided to join us is dropped - warm, and the one persuasive line in it. REVIEWER ASKED (26/10/2026): “Perfect, but need to know the triggering process” ANSWER: it is not a dunning schedule and it does not repeat. It fires ONCE each time a lead ENTERS the Deposit Follow-up stage (board column “No Deposit and follow up”) - and only on entering, so a lead parked there is never messaged again. The mechanism is a sweep, not a hook: every stage writer appends a LeadStageHistory row, and server/stage-messages.ts reads that table as an event stream on each outreach cron tick, which is why all eighteen places that can set a stage - a Pipeline drag, the Opportunities board, a lead edit, a call log, the SOP engine - trigger it identically, whether a human or an engine moved the card. Three gates sit in front of it: the per-stage WhatsApp toggle (WhatsApp → Stage messages), a bound approved template for STAGE_DEPOSIT_FOLLOWUP, and the channel not being paused. The cursor also means switching the stage on never replays a backlog - only moves made after that point are announced. CONSEQUENCE WORTH KNOWING: nothing in the app watches for a deposit going UNPAID, so if nobody moves the card, nobody is reminded; the reminder is only as reliable as the stage discipline behind it.",
    },
  },
  {
    area: AREA_K,
    name: "b2_stage_deposit_paid",
    kind: "STAGE_DEPOSIT_PAID",
    sub: "Stage · Deposit paid",
    category: "UTILITY",
    fires: "Every time a lead enters Deposit Paid.",
    vars: [{ name: "name", sample: "Priya" }],
    body:
      "Hi {{name}}, we have received your deposit and your place in the programme is confirmed.\n\n" +
      "Our team will be in touch with your onboarding details shortly.",
  },
  {
    area: AREA_K,
    name: "b2_stage_won",
    kind: "STAGE_WON",
    sub: "Stage · Won",
    category: "UTILITY",
    fires: "Every time a lead enters Won.",
    vars: [{ name: "name", sample: "Priya" }],
    body:
      "Hi {{name}}, welcome to the B2 Consultants programme.\n\n" +
      "Your coach will contact you with your first steps. Everything after this - your classes, " +
      "your payments and your documents - lives in your student portal.",
    note: {
      tag: "Overlaps b2_student_welcome",
      text:
        "b2_student_welcome fires ONCE when the student is seated in a batch, and names their tutor and their first class. This one fires when the DEAL is won, which is earlier and knows neither. Both are legitimate and they are not the same message - but bind both and a new student hears from us twice in a day. Pick the one that matches when you actually start teaching them.",
    },
  },
  {
    area: AREA_K,
    name: "b2_stage_lost",
    kind: "STAGE_LOST",
    sub: "Stage · Lost",
    category: "MARKETING",
    fires: "Every time a lead enters Lost.",
    vars: [{ name: "name", sample: "Priya" }, { name: "apply_url", sample: "https://optin.b2consultants.de/apply" }],
    body:
      "Hi {{name}}, thank you for your interest in B2 Consultants.\n\n" +
      "If now is not the right time, that is completely fine. Whenever you are ready, you are " +
      "welcome to come back to us: {{apply_url}}\n\n" +
      "All the best with your plans for Germany.",
    note: {
      warn: true,
      tag: "Check this one against the lost reason before binding",
      text:
        "A MARKETING message to somebody who has just been marked Lost is the likeliest in this pack to earn a block report, and a block costs the whole number's quality rating rather than this one send. lib/outbound-allowlist.ts already stops a send to anyone who opted out; what it cannot know is WHY the lead was lost. Consider binding this only once a lost-reason gate exists - or not at all.",
    },
  },
  {
    area: AREA_K,
    name: "b2_stage_no_show_1",
    kind: "STAGE_NO_SHOW",
    sub: "Stage · No-show",
    category: "MARKETING",
    fires: "Every time a lead enters No-show.",
    vars: [{ name: "name", sample: "Priya" }, { name: "apply_url", sample: "https://optin.b2consultants.de/apply" }],
    body:
      "Hi {{name}}, we were looking forward to speaking with you but it looks like you could not " +
      "make your call.\n\n" +
      "No problem - you can pick a new time here: {{apply_url}}, whenever suits you.",
    note: {
      tag: "Overlaps two other templates, one already approved",
      text:
        "b2_no_show_followup (the Bookings engine) and b2_sop_disco_cancel (the SOP's L2 no-show step) both already say this, and b2_sop_disco_cancel is approved. Three templates for one event is two too many: get this approved for completeness, then bind whichever engine you actually run no-shows from.",
    },
  },
  /*
   * ════════════════════════════════════════════════════════════════════════════════════════════
   *  REMOVED 26/10/2026: THE SEVEN `_u` UTILITY REWRITES
   * ════════════════════════════════════════════════════════════════════════════════════════════
   *
   *   b2_sop_disco_welcome_u · b2_sop_disco_confirm_1_u · b2_sop_disco_confirm_2_u
   *   b2_sop_sss_confirm_1_u · b2_sop_sss_confirm_2_u   · b2_sop_sss_cancel_u
   *   b2_booking_auto_cancelled_u
   *
   * They existed for one week, for one reason: this pack and `src/lib/whatsapp-submission.ts`
   * described the same seven template NAMES two different ways - one MARKETING carrying the SOP's
   * own promotional body, one UTILITY with that copy stripped. Meta approves one body per
   * (name, language), so they were competing submissions, and the `_u` suffix let both exist
   * while B2 decided which it wanted.
   *
   * B2 HAS NOW DECIDED, template by template, in the approval sheet - so there is nothing left to
   * defer, and a variant kept "just in case" is only a second thing for somebody to bind by
   * mistake:
   *
   *   disco_welcome · disco_confirm_1 · disco_confirm_2 · booking_auto_cancelled
   *       "Template ok" / "Template is fine" - the SUBMITTED body stays, promotional copy and
   *       all. They remain MARKETING in the SOP pack. No rewrite was ever wanted.
   *
   *   sss_confirm_1 · sss_confirm_2 · sss_cancel
   *       The reviewer wrote the stripped body out in full under the ORIGINAL name - identical,
   *       word for word, to what these variants carried. Those templates now hold that body and
   *       are submitted as UTILITY, so a separate `_u` name would duplicate a template that
   *       already says the same thing.
   *
   * Net effect on the batch: 25 templates down to 18. Nothing is lost - every body these carried
   * is now in the SOP pack under its original name, or was never asked for.
   */

];

// ─────────────────────────────── small builders ───────────────────────────────

const p = (
  text: string,
  opts: { size?: number; bold?: boolean; color?: string; italics?: boolean; spacing?: number; font?: string } = {},
) =>
  new Paragraph({
    spacing: { after: opts.spacing ?? 80 },
    children: [
      new TextRun({
        text,
        size: opts.size ?? 20,
        bold: opts.bold,
        italics: opts.italics,
        color: opts.color ?? INK,
        font: opts.font ?? FONT,
      }),
    ],
  });

const h1 = (text: string) =>
  new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 240, after: 120 },
    children: [new TextRun({ text, size: 32, bold: true, color: INK, font: FONT })],
  });

const h2 = (text: string) =>
  new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 220, after: 100 },
    children: [new TextRun({ text, size: 26, bold: true, color: ACCENT, font: FONT })],
  });

const bullet = (text: string, color = INK) =>
  new Paragraph({
    bullet: { level: 0 },
    spacing: { after: 60 },
    children: [new TextRun({ text, size: 20, color, font: FONT })],
  });

const checkbox = (text: string, bold = false) =>
  new Paragraph({
    spacing: { after: 70 },
    children: [
      new TextRun({ text: "☐   ", size: 22, color: INK, font: FONT }),
      new TextRun({ text, size: 20, bold, color: INK, font: FONT }),
    ],
  });

const spacer = (h = 120) => new Paragraph({ spacing: { after: h }, children: [] });

const rule = () =>
  new Paragraph({
    spacing: { before: 120, after: 120 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: RULE } },
    children: [],
  });

function cell(text: string, opts: { bold?: boolean; mono?: boolean; shade?: boolean; width?: number; color?: string } = {}) {
  return new TableCell({
    width: opts.width ? { size: opts.width, type: WidthType.PERCENTAGE } : undefined,
    shading: opts.shade ? { type: ShadingType.CLEAR, fill: SHADE } : undefined,
    margins: { top: 60, bottom: 60, left: 120, right: 120 },
    children: [
      new Paragraph({
        children: [
          new TextRun({
            text,
            size: 18,
            bold: opts.bold,
            color: opts.color ?? INK,
            font: opts.mono ? MONO : FONT,
          }),
        ],
      }),
    ],
  });
}

function table(headers: string[], rows: (string | { text: string; color?: string; mono?: boolean })[][], widths: number[], monoCols: number[] = []) {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 2, color: RULE },
      bottom: { style: BorderStyle.SINGLE, size: 2, color: RULE },
      left: { style: BorderStyle.SINGLE, size: 2, color: RULE },
      right: { style: BorderStyle.SINGLE, size: 2, color: RULE },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: RULE },
      insideVertical: { style: BorderStyle.SINGLE, size: 2, color: RULE },
    },
    rows: [
      new TableRow({
        tableHeader: true,
        children: headers.map((h, i) => cell(h, { bold: true, shade: true, width: widths[i] })),
      }),
      ...rows.map(
        (r) =>
          new TableRow({
            children: r.map((c, i) => {
              if (typeof c === "string") return cell(c, { width: widths[i], mono: monoCols.includes(i) });
              return cell(c.text, { width: widths[i], mono: c.mono ?? monoCols.includes(i), color: c.color });
            }),
          }),
      ),
    ],
  });
}

/** The message body, monospaced and boxed, one paragraph per line so Word keeps the blank lines. */
function bodyBox(text: string): Paragraph[] {
  const lines = text.split("\n");
  return lines.map(
    (line, i) =>
      new Paragraph({
        spacing: { after: i === lines.length - 1 ? 0 : 40, before: i === 0 ? 40 : 0 },
        shading: { type: ShadingType.CLEAR, fill: SHADE },
        border: {
          left: { style: BorderStyle.SINGLE, size: 12, color: ACCENT },
          ...(i === 0 ? { top: { style: BorderStyle.SINGLE, size: 2, color: RULE } } : {}),
          ...(i === lines.length - 1 ? { bottom: { style: BorderStyle.SINGLE, size: 2, color: RULE } } : {}),
        },
        indent: { left: 160, right: 160 },
        children: [new TextRun({ text: line || " ", size: 19, font: MONO, color: INK })],
      }),
  );
}

// ─────────────────────────────── document sections ───────────────────────────────

function cover(list: Tpl[], mode: Mode): Paragraph[] {
  /**
   * EVERY COUNT IS READ OFF `list`. The header of this file has said since it was written that
   * the count is never to be typed out, because the comment and the array drift the moment
   * anything is added - and by 26 Oct 2026 it had drifted in four places at once ("26 templates",
   * "Three of the 26", "All 25 templates", and the document's own description). A submission pack
   * that misstates how many templates it contains is the one error its reader cannot check.
   */
  const areas = new Set(list.map((t) => t.area)).size;
  const marketing = list.filter((t) => t.category === "MARKETING");
  const auth = list.filter((t) => t.category === "AUTHENTICATION");
  const byAction = (a: Action) => list.filter((t) => t.action?.group === a).length;
  return [
    new Paragraph({
      spacing: { after: 60 },
      children: [new TextRun({ text: "B2 Consultants  ·  WATI / Meta submission", size: 22, bold: true, color: ACCENT, font: FONT })],
    }),
    new Paragraph({
      spacing: { after: 100 },
      children: [new TextRun({ text: DOC_TITLE[mode], size: 40, bold: true, color: INK, font: FONT })],
    }),
    p(
      mode === "action"
        ? `Every business-initiated WhatsApp message the application sends must be a template Meta has approved. These ${list.length} are the only ones with work outstanding: ${byAction("APPROVE")} have never been submitted, ${byAction("RESUBMIT")} were approved once and have had their body changed since, and ${byAction("DECIDE")} carries a wording decision that is cheaper to take now than after its next approval. Everything the app can send, approved or not, is in the complete set.`
        : mode === "batch"
          ? `Every business-initiated WhatsApp message the application sends must be a template Meta has approved. These ${list.length} are the ones NOT YET SUBMITTED, grouped by the part of the app they belong to, each with the sample values Meta requires. Everything else the app can send is in the full inventory pack.`
          : `Every business-initiated WhatsApp message the application sends must be a template Meta has approved. This is the complete inventory - ${list.length} templates across ${areas} areas - written to qualify as UTILITY wherever that is honestly possible, each with the sample values Meta requires at submission.`,
      { size: 22, color: MUTED },
    ),
    spacer(140),
    p("Read this before you submit", { bold: true, size: 22 }),
    /**
     * THE ONE THING THIS DOCUMENT CANNOT CHECK, said first, on the action document only.
     *
     * Which names already exist in WATI is recorded by hand in the generator and nowhere else.
     * Every other fact in here is derived and therefore self-correcting; this one rots the moment
     * somebody submits a template and does not say so. Putting it at the top is the difference
     * between a stale line and a wasted afternoon re-submitting approved templates.
     */
    ...(mode === "action"
      ? [
          bullet(
            "FIRST, open WATI's template list and compare. Which names already exist is tracked by hand in scripts/wati-templates-utility-docx.ts, not read from WATI - so tick off anything already APPROVED with the same body, and tell whoever maintains that file. A re-submission of an unchanged body is wasted review time; a missed one is a touchpoint that silently sends nothing.",
            RISK,
          ),
          bullet(
            "A changed body is a REPLACEMENT, not an addition. Meta approves one body per (name, language), so editing an approved template puts it back into review and its touchpoint sends nothing in the meantime - the app logs a skip rather than failing, so nobody notices. That is why group 2 is urgent and group 1 is merely incomplete.",
          ),
        ]
      : []),
    bullet(
      "Every body here is written as a plain, transactional notification wherever it honestly can be - no sales pitch, no case-study links, no offer language. That wording is what actually earns the UTILITY category.",
    ),
    bullet(
      "Why the wording, not just the label, matters: since April 2025 Meta categorises a template by reading its content - it re-classifies anything promotional as MARKETING regardless of what you declared, and flags accounts that repeatedly mis-declare. A UTILITY label on selling copy costs you the flag, not a cheaper message.",
    ),
    bullet(
      marketing.length === 0
        ? "Nothing in this batch is MARKETING."
        : `${marketing.length} of these ${list.length} cannot honestly be UTILITY - each is either sent to somebody who has booked nothing, or is about a commercial offer, so there is no transaction to notify about. They are marked MARKETING, with the reasoning on each page: ${marketing.map((t) => t.name).join(", ")}.`,
      RISK,
    ),
    ...(auth.length
      ? [
          bullet(
            `${auth.length === 1 ? "One template" : `${auth.length} templates`} belong${auth.length === 1 ? "s" : ""} in Meta's AUTHENTICATION category and must be built with WATI's authentication flow rather than as UTILITY - OTP copy submitted as UTILITY is rejected: ${auth.map((t) => t.name).join(", ")}.`,
            AUTH,
          ),
        ]
      : []),
    bullet(
      "Business-initiated messages stay queued for a human until each template is APPROVED and mapped in the app - nothing breaks in the meantime, it just stays manual.",
    ),
    rule(),
  ];
}

function summary(list: Tpl[], mode: Mode): (Paragraph | Table)[] {
  const counts = list.reduce(
    (a, t) => ((a[t.category] = (a[t.category] ?? 0) + 1), a),
    {} as Record<Category, number>,
  );
  /**
   * The "why it is here" column exists only on the batch and action documents, and it is the
   * column the person submitting actually reads: on the batch, seventeen of these have never had
   * a template at all while the rest are new touchpoints; on the action list, "never approved"
   * and "approved, then edited" need completely different care at submission time.
   */
  const why = new Map(PENDING_SUBMISSION.map((e) => [e.name, e.why]));
  const heading =
    mode === "action"
      ? `${list.length} templates with work outstanding`
      : mode === "batch"
        ? `${list.length} templates awaiting submission`
        : `All ${list.length} templates at a glance`;
  const subtitle =
    `${counts.UTILITY ?? 0} UTILITY  ·  ${counts.AUTHENTICATION ?? 0} AUTHENTICATION  ·  ${counts.MARKETING ?? 0} MARKETING.` +
    (mode === "action"
      ? "  Work top to bottom: group 1 is incomplete, group 2 is actively broken until it clears."
      : mode === "batch"
        ? "  None of these exists in WATI yet."
        : "  All are new to this WATI account.");

  return [
    h2(heading),
    p(subtitle, { size: 19, color: MUTED, spacing: 140 }),
    mode === "action"
      ? table(
          ["#", "Template name", "Do this", "Category", "Why it is here"],
          list.map((t, i) => [
            String(i + 1),
            { text: t.name, mono: true },
            { text: t.action?.label ?? "", color: t.action?.group === "RESUBMIT" ? RISK : ACCENT },
            { text: t.category, color: catColor(t.category) },
            t.action?.why ?? "",
          ]),
          [4, 24, 18, 11, 43],
        )
      : mode === "batch"
        ? table(
            ["#", "Template name", "Category", "App touchpoint", "Why it is here"],
            list.map((t, i) => [
              String(i + 1),
              { text: t.name, mono: true },
              { text: t.category, color: catColor(t.category) },
              { text: t.kind, mono: true },
              why.get(t.name) ?? "",
            ]),
            [5, 27, 14, 24, 30],
          )
        : table(
            ["#", "Template name", "Category", "App touchpoint"],
            list.map((t, i) => [
              String(i + 1),
              { text: t.name, mono: true },
              { text: t.category, color: catColor(t.category) },
              { text: t.kind, mono: true },
            ]),
            [6, 40, 22, 32],
          ),
    rule(),
  ];
}

function templateSection(t: Tpl, index: number, firstInArea: boolean): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = [];

  if (firstInArea) {
    out.push(
      new Paragraph({
        pageBreakBefore: true,
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 40, after: 140 },
        children: [new TextRun({ text: t.area, size: 30, bold: true, color: INK, font: FONT })],
      }),
    );
  }

  out.push(
    new Paragraph({
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 220, after: 60 },
      keepNext: true,
      children: [
        new TextRun({ text: `${index + 1}.  `, size: 24, bold: true, color: INK, font: FONT }),
        new TextRun({ text: t.name, size: 24, bold: true, color: ACCENT, font: MONO }),
        new TextRun({ text: `    ${t.category}`, size: 18, bold: true, color: catColor(t.category), font: FONT }),
      ],
    }),
    p(t.sub, { size: 19, color: MUTED, spacing: 100 }),
    table(
      ["Field", "Value"],
      [
        // First row when there is one, because it is the only row that says what to DO.
        ...(t.action
          ? [["Do this", { text: t.action.label, color: t.action.group === "RESUBMIT" ? RISK : ACCENT }]]
          : []),
        ["Template name", { text: t.name, mono: true }],
        ["Category", { text: t.category, color: catColor(t.category) }],
        ["Language", "en"],
        ["App touchpoint (bind to this)", { text: t.kind, mono: true }],
        ["When it fires", t.fires],
      ],
      [30, 70],
    ),
    spacer(100),
    p("Body - paste exactly as shown (keep the blank lines and *asterisks*)", { bold: true, size: 20 }),
    ...bodyBox(t.body),
    spacer(140),
    p("Variables & sample values", { bold: true, size: 20 }),
    table(
      ["Order", "Variable", "Sample value (submit this to Meta)"],
      t.vars.map((v, i) => [String(i + 1), { text: `{{${v.name}}}`, mono: true }, v.sample]),
      [12, 30, 58],
    ),
    spacer(120),
  );

  /**
   * Repeated from the summary table ON PURPOSE.
   *
   * These pages are what somebody actually works from - one template per page, typed into WATI and
   * ticked off - and a reason that lives only in a table forty pages earlier is a reason they
   * will not read at the moment it matters.
   */
  if (t.action) {
    out.push(
      new Paragraph({
        spacing: { before: 40, after: 60 },
        children: [new TextRun({ text: "Why it is on the action list", size: 20, bold: true, color: ACCENT, font: FONT })],
      }),
      p(t.action.why, { size: 19, color: MUTED, spacing: 120 }),
    );
  }

  if (t.note) {
    out.push(
      new Paragraph({
        spacing: { before: 40, after: 60 },
        children: [
          new TextRun({ text: `${t.note.warn ? "⚠  " : ""}${t.note.tag}`, size: 20, bold: true, color: t.note.warn ? RISK : ACCENT, font: FONT }),
        ],
      }),
      p(t.note.text, { size: 19, color: t.note.warn ? RISK : MUTED, spacing: 120 }),
    );
  }

  return out;
}

function checklist(list: Tpl[], mode: Mode): (Paragraph | Table)[] {
  /**
   * PARAMETERISED FOR THE SAME REASON `cover` AND `summary` ARE.
   *
   * This read "UTILITY for the 22 ... AUTHENTICATION for the signing code ... MARKETING for the
   * three re-engagement messages", and named `b2_agreement_otp` as the one to build through
   * WATI's authentication flow. Every one of those was a count or a name typed out by hand, and
   * on the BATCH document all of them were wrong: the batch has no `b2_agreement_otp` in it at
   * all, so its own closing checklist told the reader to go and build a template that is not in
   * the document they are holding. A submission pack's final instruction naming the wrong
   * template is the worst place in the file for this particular rot.
   *
   * So the counts and the names come off `list`, and the two sentences that only make sense for
   * the full inventory are dropped from the batch.
   */
  const counts = list.reduce((a, t) => ((a[t.category] = (a[t.category] ?? 0) + 1), a), {} as Record<Category, number>);
  const auth = list.filter((t) => t.category === "AUTHENTICATION");
  const marketing = list.filter((t) => t.category === "MARKETING");
  const resubmit = list.filter((t) => t.action?.group === "RESUBMIT");
  const decide = list.filter((t) => t.action?.group === "DECIDE");
  // Named, never counted by hand: the sentence that used to say "Three of these" was wrong
  // the first time the list changed.
  const flips = list.filter((t) => t.action?.categoryChanged);
  const linkVars = new Set<string>();
  for (const t of list) for (const v of t.vars) if (/_url$/.test(v.name)) linkVars.add(`{{${v.name}}}`);

  const categoryLine =
    `Set the category as marked: ${counts.UTILITY ?? 0} UTILITY` +
    (auth.length ? `, ${auth.length} AUTHENTICATION` : "") +
    (marketing.length ? `, ${marketing.length} MARKETING` : "") +
    ". Do NOT re-declare a promotional body UTILITY to save cost - Meta re-categorises it and flags the account.";

  return [
    new Paragraph({ pageBreakBefore: true, children: [] }),
    h1("Submitting & going live"),
    p("Nothing sends until each template is APPROVED in WATI and bound to its touchpoint in the app.", {
      size: 19,
      color: MUTED,
      spacing: 160,
    }),
    h2("Part A - Submit in WATI (per template)"),
    checkbox("Create each template with the EXACT snake_case name shown - the app is mapped to these names.", true),
    checkbox(categoryLine),
    checkbox("Paste the body exactly, blank lines included. Keep the *asterisks* - they render as bold in WhatsApp."),
    checkbox("Declare each variable in the order shown and give it the sample value from its card. Meta rejects missing or unrealistic samples."),
    ...(linkVars.size
      ? [checkbox(`For ${[...linkVars].sort().join(" / ")}, paste a full real link at submission so the reviewer sees the true format.`)]
      : []),
    checkbox("Language en (use en_GB if WATI forces a locale). Submit and record the date; review is usually minutes but can take 24-48h."),
    ...auth.map((t) =>
      checkbox(`Build ${t.name} through WATI's AUTHENTICATION template flow, not as a UTILITY text template - OTP copy submitted as UTILITY is rejected.`),
    ),
    /**
     * The action document's extra instructions, and they are the point of it existing.
     *
     * A re-submission is NOT the same job as a first submission: you edit a template that is
     * already live rather than creating one, the touchpoint goes dark while review runs, and any
     * wording decision has to be taken in the same edit or it costs a second round. Named
     * template by template off `list`, because a checklist that said "three of these" was wrong
     * the first time the list changed.
     */
    ...(mode === "action"
      ? [
          ...(resubmit.length
            ? [
                checkbox(
                  `EDIT, do not create: ${resubmit.map((t) => t.name).join(", ")}. Each already exists in WATI under this exact name with an older body. Creating a second one is not possible - Meta holds one body per (name, language) - and the edit sends it back to review, so its touchpoint sends nothing until it clears. Do these on a quiet day, not mid-campaign.`,
                  true,
                ),
                ...(flips.length
                  ? [
                      checkbox(
                        `${flips.length === 1 ? "One of the re-submissions changes" : `${flips.length} of the re-submissions change`} CATEGORY as well as body (${flips.map((t) => t.name).join(", ")} — MARKETING → UTILITY, because the promotional copy came out). Set the new category in the same edit: a body that no longer sells will not be re-categorised for you, and the declaration is what you are billed on.`,
                      ),
                    ]
                  : []),
              ]
            : []),
          ...decide.map((t) =>
            checkbox(
              `${t.name} has NO body change pending - do not re-submit it today. Answer the question on its page first, then fold the answer into its next submission. Taking it after an approval costs another round.`,
            ),
          ),
          checkbox(
            "Record the date and the body you submitted for each one, back in scripts/wati-templates-utility-docx.ts. This document knows what changed and when only because the last person did that.",
          ),
        ]
      : []),
    ...(mode === "batch"
      ? [
          checkbox(
            "Five stage templates overlap an engine that already messages the prospect at the same moment (new lead, disco booked, won, lost, no-show). Get them approved anyway - a touchpoint with no approved template can never be switched on later - but read the note on each card before BINDING it, or somebody hears from us twice in a day.",
          ),
        ]
      : []),
    h2("Part B - Wire it into the app (Admin)"),
    checkbox("Set WATI_ENABLED=true, WATI_API_ENDPOINT and WATI_ACCESS_TOKEN in the environment.", true),
    checkbox("WhatsApp -> Settings -> Refresh templates. All approved names should appear in the catalogue."),
    checkbox("Bind each touchpoint to its template using the App touchpoint value on each card. One template per touchpoint."),
    checkbox("Enter each template's variable list in Settings exactly as approved. A mismatch blocks the send and names the missing variable - it never delivers a half-empty message."),
    checkbox("Send a test to your own number. Confirm variables resolve and the bold renders."),
    checkbox("Turn on sending one low-risk touchpoint at a time; watch the WhatsApp history before enabling the rest."),
    rule(),
    p(
      `Generated from scripts/wati-templates-utility-docx.ts - re-run \`npm run ${NPM_SCRIPT[mode]}\` after any edit. ` +
        `${list.length} templates. ` +
        (mode === "action"
          ? "This is the work list only - everything with a first approval, a changed body or an open wording decision outstanding, from both packs. Everything the app can send, approved or not, is in WhatsApp_Templates_Complete_Set.docx."
          : mode === "batch"
            ? "This is the batch awaiting submission; the full inventory of everything the app can send is in WhatsApp_Templates_UTILITY_Submission_Pack.docx."
            : mode === "all"
              ? "This is every template from both packs. The free-form MANUAL touchpoint needs no template and is excluded. The subset still needing approval, a re-submission or a decision is in WhatsApp_Templates_Action_Required.docx."
              : "The free-form MANUAL touchpoint needs no template and is excluded. The 13 Outreach SOP bodies are maintained in src/lib/whatsapp-submission.ts and are not in this pack; WhatsApp_Templates_Complete_Set.docx has both."),
      { size: 16, color: MUTED, italics: true },
    ),
  ];
}

/**
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *  THE SOP PACK, FLATTENED INTO THIS ONE'S SHAPE  (for the --all document)
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * B2's templates live in two files for a real reason: the thirteen Outreach SOP messages are
 * DERIVED from `Script_for_Outreach_Specialist.docx` (so their bodies are generated by
 * `submissionBody`, and changing one is a decision recorded as a proposedFix/acceptedFix),
 * while everything else is written directly here. That split is right for authoring and wrong
 * for submitting: the person typing templates into WATI wants one list, not two documents to
 * diff against each other.
 *
 * So `--all` renders both through the renderer below, which needs one shape. This adapter is
 * that, and it is deliberately LOSSLESS in the direction that matters - every field the SOP pack
 * carries that a submitter needs (category rationale, the notes, the open proposedFix, the
 * settled acceptedFix and its superseded wording) ends up in the note text rather than being
 * dropped on the floor.
 *
 * It does NOT replace either document. The SOP pack keeps its own richer rendering, with each
 * body shown beside the SOP step it was transcribed from; this is the flat view.
 */
function fromSopPack(t: SubmissionTemplate): Tpl {
  const def = STEP_BY_KEY[t.step];

  /**
   * "When it fires", built from the engine rather than retyped.
   *
   * The SOP pack has no `fires` field - its reader is looking at the SOP document and already
   * knows the step. A flat list has no such context, so it is assembled from the step definition
   * (`label`, and the SLA key that sets its offset) plus the Zoom dependency, which is the one
   * piece of timing that decides whether a template can be bound at all.
   */
  const fires = [
    `${t.sopStep} - ${def?.label ?? t.step}.`,
    def?.slaKey ? `Offset driven by the “${def.slaKey}” SLA.` : null,
    def?.needsZoom ? "BLOCKED until a Zoom link is resolved on the prospect's card." : null,
  ]
    .filter(Boolean)
    .join(" ");

  /**
   * Everything the SOP pack would have shown on its own page, folded into one note.
   *
   * Order is deliberate: the decision a submitter must ACT on comes first (an open proposedFix,
   * or a settled acceptedFix and what it replaced), then the per-template notes, then the
   * category rationale - which is reference material, and is also the longest.
   */
  const parts: string[] = [];
  if (t.proposedFix) {
    parts.push(
      `DECISION OPEN - B2 MUST CHOOSE BEFORE SUBMITTING. ${t.proposedFix.reason} The body above is the SOP text as it stands; the proposed replacement is: “${t.proposedFix.body.replace(/\s+/g, " ").trim()}”`,
    );
  }
  if (t.acceptedFix) {
    parts.push(
      `WORDING CHANGE ALREADY APPROVED (${t.acceptedFix.decidedOn}) - the body above is the one to submit. ${t.acceptedFix.reason} It replaced: “${t.acceptedFix.was.replace(/\s+/g, " ").trim()}”`,
    );
  }
  if (t.header) parts.push(`HEADER: ${t.header}`);
  parts.push(...(t.notes ?? []));
  parts.push(`Why this category: ${t.categoryNote}`);

  return {
    area: AREA_SOP,
    name: t.name,
    kind: t.kind,
    sub: `${t.sopStep} · ${def?.label ?? t.step}`,
    category: t.category as Category,
    fires,
    vars: t.vars.map((v) => ({ name: v.name, sample: v.sample })),
    body: submissionBody(t),
    note: {
      // Amber whenever there is still a decision in it - that is what a submitter needs to see
      // before they start typing, not after.
      warn: Boolean(t.proposedFix),
      tag: t.proposedFix ? "Read this before submitting" : "From the Outreach SOP",
      text: parts.join(" · "),
    },
  };
}

/**
 * Every template B2 can submit, from both packs, in one list.
 *
 * De-duplicated by NAME, and the SOP pack wins a tie. Two names appear in both files -
 * `b2_sop_intro` and `b2_sop_followup_not_booked` - because this pack carries them unchanged for
 * completeness; the SOP pack's version of each is the authored one, with the category rationale
 * and the superseded wording attached, so that is the copy worth printing.
 */
function allTemplates(): Tpl[] {
  const byName = new Map<string, Tpl>();
  for (const t of TEMPLATES) byName.set(t.name, t);
  for (const t of SUBMISSION_TEMPLATES) byName.set(t.name, fromSopPack(t));
  // Grouped by area, and within an area in the order each pack declares - which is funnel order
  // for the lifecycle areas and SOP step order for the SOP one.
  const areas = [...new Set([...byName.values()].map((t) => t.area))];
  return areas.flatMap((a) => [...byName.values()].filter((t) => t.area === a));
}

/**
 * The work list, resolved against BOTH packs.
 *
 * Resolved off `allTemplates()` rather than `TEMPLATES`, because three of the entries live in the
 * SOP pack - and that is the whole reason this document is worth generating. "What needs
 * approval" is a question about B2's WATI account, not about a source file, so an answer that
 * covers only one of the two files is not an answer.
 *
 * Grouped by what has to be DONE, not by part of the app: the area headings are replaced with the
 * action group, because a person working through this is deciding "do I create this or edit it",
 * and three UTILITY rewrites of SSS messages have more in common with each other here than any of
 * them has with the rest of the SSS calendar.
 */
/** The SOP pack's superseded body for a name, in WATI dialect - null if it has none. */
function supersededBody(name: string): string | null {
  const t = SUBMISSION_TEMPLATES.find((x) => x.name === name);
  return t ? supersededSubmissionBody(t) : null;
}

export function actionTemplates(): Tpl[] {
  const byName = new Map(allTemplates().map((t) => [t.name, t]));
  const missing = NEEDS_ACTION.filter((e) => !byName.has(e.name)).map((e) => e.name);
  if (missing.length) {
    // Loud and fatal, for the same reason the batch check is: a work list that silently drops a
    // template gives its reader no way to know it is short, and the dropped one never gets done.
    throw new Error(`NEEDS_ACTION names templates that are in neither pack: ${missing.join(", ")}`);
  }
  // Sorted into group order rather than trusting the declaration order to stay that way, so that
  // adding an entry in the wrong place cannot interleave the groups and break the page breaks.
  return ACTION_ORDER.flatMap((group) =>
    NEEDS_ACTION.filter((e) => e.action === group).map((e) => ({
      ...byName.get(e.name)!,
      area: ACTION_GROUP[group],
      action: {
        group,
        label: ACTION_LABEL[group],
        why: e.why,
        categoryChanged: e.categoryChanged,
        // Derived where the SOP pack records it, written down where nothing does.
        previousBody: e.previousBody ?? supersededBody(e.name),
      },
    })),
  );
}

// ─────────────────────────────── assemble ───────────────────────────────

/**
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *  TWO DOCUMENTS, ONE RENDERER
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 *   no flag   this pack's own templates - everything except the thirteen Outreach SOP bodies,
 *             which are authored in src/lib/whatsapp-submission.ts and have their own document.
 *   --batch   only `PENDING_SUBMISSION` - the ones nobody has submitted yet. The working
 *             document, for whoever sits down in WATI and types them in.
 *   --all     EVERY template B2 can submit, both packs merged into one file. The document to
 *             hand somebody who wants the whole set without cross-referencing three files.
 *
 * A flag on the existing script rather than a second script, because the alternative is two
 * copies of a two-hundred-line docx layout drifting apart - which is precisely the failure the
 * two submission PACKS just had with each other (issue W1), and it would be odd to fix that by
 * creating a third place for it to happen.
 */
async function main() {
  const flags = new Set(process.argv.slice(2));
  const picked: Mode[] = ([["--batch", "batch"], ["--all", "all"], ["--action", "action"]] as const)
    .filter(([flag]) => flags.has(flag))
    .map(([, mode]) => mode);
  if (picked.length > 1) throw new Error(`These are different documents; pass one, not ${picked.length}.`);
  const mode: Mode = picked[0] ?? "inventory";

  let list: Tpl[];
  if (mode === "all") {
    list = allTemplates();
  } else if (mode === "action") {
    list = actionTemplates();
  } else if (mode === "batch") {
    const byName = new Map(TEMPLATES.map((t) => [t.name, t]));
    const missing = PENDING_SUBMISSION.filter((e) => !byName.has(e.name)).map((e) => e.name);
    if (missing.length) {
      // Loud, and fatal. A batch document that silently omits a template is worse than no batch
      // document: the reader has no way to know it is short. `wati-template-catalogue.test.ts`
      // asserts the same thing in CI so this should be unreachable.
      throw new Error(`PENDING_SUBMISSION names templates that are not in TEMPLATES: ${missing.join(", ")}`);
    }
    // Ordered by PENDING_SUBMISSION, not by the inventory: that list is grouped by WHY each one
    // is pending (the seventeen stage messages, then the one new touchpoint), which is the order
    // somebody submitting them wants to work in.
    list = PENDING_SUBMISSION.map((e) => byName.get(e.name)!);
  } else {
    list = TEMPLATES;
  }

  const seenAreas = new Set<string>();
  const templatePages = list.flatMap((t, i) => {
    const first = !seenAreas.has(t.area);
    seenAreas.add(t.area);
    return templateSection(t, i, first);
  });

  const doc = new Document({
    creator: "B2 Consultants",
    title: DOC_TITLE[mode],
    // Read off the list, like every other count in this file. It used to say "All 25" and was
    // wrong by a dozen.
    description:
      mode === "action"
        ? `${list.length} WhatsApp templates needing a first approval, a re-submission or a wording decision, with the sample values Meta requires.`
        : `${list.length} WhatsApp templates${mode === "batch" ? " awaiting WATI/Meta approval" : " the app can send"}, with the sample values Meta requires.`,
    styles: { default: { document: { run: { font: FONT, size: 20, color: INK } } } },
    sections: [
      {
        properties: { page: { margin: { top: 1000, right: 1000, bottom: 1000, left: 1000 } } },
        children: [
          ...cover(list, mode),
          ...summary(list, mode),
          ...templatePages,
          ...checklist(list, mode),
          spacer(160),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({
                text: "B2 Consultants - WhatsApp template submission pack",
                size: 16,
                color: MUTED,
                italics: true,
                font: FONT,
              }),
            ],
          }),
        ],
      },
    ],
  });

  const out = path.resolve(process.cwd(), "..", DOC_FILE[mode]);
  writeFileSync(out, await Packer.toBuffer(doc));

  const counts = list.reduce((a, t) => ((a[t.category] = (a[t.category] ?? 0) + 1), a), {} as Record<Category, number>);
  console.log(`Wrote ${out}`);
  console.log(
    `${list.length} templates - ${counts.UTILITY ?? 0} UTILITY, ${counts.AUTHENTICATION ?? 0} AUTHENTICATION, ${counts.MARKETING ?? 0} MARKETING.`,
  );
  if (mode === "action") {
    for (const group of ACTION_ORDER) {
      const n = list.filter((t) => t.action?.group === group).length;
      if (n) console.log(`  ${n} - ${ACTION_GROUP[group]}`);
    }
  } else if (mode !== "batch") {
    console.log(`${NEEDS_ACTION.length} of them still need something doing - run with --action for just those.`);
    if (mode !== "all") console.log(`Run with --all for every template in both packs in one document.`);
  }
}

/**
 * Only write the document when this file is the thing being RUN.
 *
 * Importing it (the catalogue test does) must not have the side effect of overwriting a submission
 * pack sitting next to the repo - least of all during a test run.
 */
// split/join rather than a regex: a lone backslash in a literal is the kind of escaping that
// breaks differently in every tool that touches this file.
const runDirectly = (process.argv[1] ?? "").split("\\").join("/").endsWith("scripts/wati-templates-utility-docx.ts");
if (runDirectly) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

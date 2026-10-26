/**
 * WhatsApp template submission pack - the nine SOP messages, in the shape WATI/Meta want.
 *
 * WHY THIS EXISTS: the SOP writes its variables as `[Prospect’s First Name]`; WATI declares them
 * as `{{name}}`. Those are the same message in two dialects. This module is the translation, and
 * it is the SINGLE SOURCE for both the Word submission pack (scripts/whatsapp-templates-docx.ts)
 * and the in-app mapping guidance - so what B2 sends to Meta for approval and what the app expects
 * back can never drift apart.
 *
 * The SUBMITTED body is derived from the SOP body by substituting the bracket variables for WATI's
 * `{{…}}` names. It is not retyped: `submissionBody()` runs the real substitution over the real
 * template constant, so a change to the SOP text flows into the submission pack automatically.
 *
 * Isomorphic - no prisma, no server-only.
 */

import type { WhatsAppKind } from "@prisma/client";
import {
  STEP_BY_KEY,
  TPL_INTRO_SUPERSEDED,
  TPL_SSS_CANCEL_SUPERSEDED,
  TPL_SSS_CONFIRM_1_SUPERSEDED,
  TPL_SSS_CONFIRM_2_SUPERSEDED,
  renderOutreachTemplate,
  type OutreachVars,
} from "./outreach-sop";
import type { OutreachStep } from "@prisma/client";

/** Meta's two relevant template categories. AUTHENTICATION doesn't apply to any SOP message. */
export type TemplateCategory = "MARKETING" | "UTILITY";

export type TemplateVarSpec = {
  /** The `{{name}}` WATI declares. Must exist in WHATSAPP_AVAILABLE_VARS for the bound kind. */
  name: string;
  /** What the SOP calls it. */
  sopName: string;
  /** Where the app gets the value. */
  source: string;
  /** Meta requires a realistic sample for every variable at submission time. */
  sample: string;
};

export type SubmissionTemplate = {
  /** The SOP step this implements, e.g. "Step 14". */
  sopStep: string;
  /** The app touchpoint this template must be bound to in WhatsApp → Settings. */
  kind: WhatsAppKind;
  /** The engine step that fires it. */
  step: OutreachStep;
  /** Proposed WATI template name. snake_case, ≤512 chars, lowercase - Meta's rule. */
  name: string;
  category: TemplateCategory;
  language: string;
  /** Why this category - reviewers reject on category mismatch more than anything else. */
  categoryNote: string;
  vars: TemplateVarSpec[];
  /** Header media, where the SOP calls for it. */
  header?: string;
  /** Anything the submitter must know or decide. */
  notes?: string[];
  /**
   * A wording change B2 must APPROVE before submitting, where the SOP text as written would likely
   * be rejected by Meta. Deliberately not applied automatically: the SOP text is the contract with
   * the team, and changing what a prospect reads is a business decision, not a lint fix.
   */
  proposedFix?: { reason: string; body: string };
  /**
   * A wording change that HAS been approved and is already live in the SOP constant.
   *
   * The counterpart to `proposedFix`, and the distinction matters at submission time: a
   * `proposedFix` is a question still open - the pack prints the SOP body and asks B2 to decide.
   * An `acceptedFix` is a decision already taken, so the pack prints the NEW body as the thing to
   * submit and carries the old one as an explanatory note.
   *
   * `was` is the superseded text, kept so the Word pack can show a reviewer (and the next person
   * to read this file) exactly what changed and why, rather than a body that silently disagrees
   * with the SOP document B2 also has on file.
   */
  acceptedFix?: { reason: string; decidedOn: string; was: string };
};

const V = {
  name: (sample: string): TemplateVarSpec => ({
    name: "name",
    sopName: "[Prospect’s First Name]",
    source: "Lead.name, first word",
    sample,
  }),
  sender: (sample: string): TemplateVarSpec => ({
    name: "sender",
    sopName: "[Your Name]",
    source: "Key Metrics “Resp. for TOUCHPOINT”, else the default sender name in Outreach → Settings",
    sample,
  }),
  date: (sample: string): TemplateVarSpec => ({
    name: "date",
    sopName: "[DATE]",
    source: "Appointment slot (disco) or SSS date/time, rendered in IST",
    sample,
  }),
  time: (sample: string): TemplateVarSpec => ({
    name: "time",
    sopName: "[TIME]",
    source: "Appointment slot (disco) or SSS date/time, rendered in IST",
    sample,
  }),
  zoom: (): TemplateVarSpec => ({
    name: "zoom_link",
    sopName: "<<INSERT ZOOM LINK HERE>>",
    source: "Zoom link on the prospect’s Outreach card (copied from the Discovery Specialist’s calendar)",
    sample: "https://us02web.zoom.us/j/85512345678",
  }),
};

/**
 * The nine templates.
 *
 * ALL NINE ARE MARKETING. This was reviewed against Meta's categorisation rules on 17 Jul 2026 and
 * is a deliberate call, not an oversight - the earlier revision of this file had Steps 13-21 as
 * UTILITY, and that was wrong.
 *
 * WHY. Meta's bar for UTILITY is that a template be "non-promotional, not containing any
 * promotional or persuasive intent"; anything with MIXED content defaults to MARKETING. Every one
 * of these bodies carries promotional or persuasive copy, so none of them clears that bar:
 *  · Step 3 / Step 6 - promote a free call to someone who filled in a form. Never were UTILITY.
 *  · Step 13 - links the case studies page (social proof).
 *  · Step 14 - "possibilities of your next job in Germany", "your next best steps".
 *  · Step 15 - "*FREE* Personalized Discovery Call" is offer language.
 *  · Step 16 / Step 21 - carry a re-booking CTA and link. Note these have NO confirmation request
 *    in them at all, and are still MARKETING: it is the promotional copy that decides this, not
 *    the ask.
 *  · Step 19 - "personalized game plan", "excited to help you take the next step in your career".
 *  · Step 20 - "prepared something very specific for your profile".
 * Stacked on top: the appointment being confirmed is a free SALES call, which is a weaker claim to
 * "transaction" than a paid booking would be.
 *
 * A "reply YES to confirm" does NOT make a template MARKETING - a confirmation request for an
 * appointment the prospect booked is the textbook UTILITY case, and the reply is part of the
 * transactional flow. Recorded here because it is the intuitive wrong answer, and because if the
 * promotional copy below is ever stripped, the YES is not what stands in the way of UTILITY.
 *
 * CONSEQUENCES, both real:
 *  · Since April 2025 Meta approves as MARKETING anything it judges to be MARKETING regardless of
 *    what you declared, and flags accounts that game the categorisation. Declaring UTILITY here
 *    would not buy cheaper messages - it would buy a flag.
 *  · MARKETING templates are subject to per-user marketing limits and require opt-in (B2 has it,
 *    via the website form - keep that consent wording, it is the evidence). The cost is that a
 *    time-critical confirm-your-call reminder CAN be throttled for a prospect near their cap.
 *    Accepted for now; revisit against real delivery rates.
 *
 * To move any of Steps 13-21 back to UTILITY, the promotional lines must come out of the body
 * first - and that is a `proposedFix`, because it changes what a prospect reads.
 */
export const SUBMISSION_TEMPLATES: SubmissionTemplate[] = [
  {
    sopStep: "Step 3",
    kind: "SOP_INTRO",
    step: "INTRO_WHATSAPP",
    name: "b2_sop_intro",
    category: "MARKETING",
    language: "en",
    categoryNote:
      "Promotes a free discovery call to someone who just opted in. Not tied to an existing transaction → MARKETING.",
    vars: [V.name("Priya"), V.sender("Nilofer")],
    notes: [
      "Both links are literal text, not variables - Meta reviews them once at approval.",
      "Sent automatically within seconds of opt-in (SOP Step 2), so the opt-in is fresh and provable.",
      "The closing line no longer promises an immediate call. Under the instant-intro flow a caller only rings if the prospect does NOT book, so the message offers a call on request instead of asserting one.",
    ],
    acceptedFix: {
      decidedOn: "2026-08-03",
      reason:
        "Two changes, both approved by B2. (1) The SOP's first two lines put {{name}} and {{sender}} back to back with only a line break between them; Meta rejects adjacent parameters with no static text between, and a newline does not count - as transcribed, this template could never have been approved. The replacement is exactly how the SOP itself opens Step 13, so the intro adopts B2's own house phrasing rather than new wording. (2) The closing line promised “I’ll give you a quick call now”, which became untrue once the message is auto-sent at opt-in and the call is conditional on NOT booking. Everything between those two lines is untouched.",
      was: TPL_INTRO_SUPERSEDED,
    },
  },
  {
    sopStep: "Step 6",
    kind: "SOP_FOLLOWUP",
    step: "FOLLOWUP_WHATSAPP",
    name: "b2_sop_followup_not_booked",
    category: "MARKETING",
    language: "en",
    categoryNote: "Chases an un-booked prospect. Still promotional → MARKETING.",
    vars: [V.name("Priya"), V.sender("Nilofer")],
  },
  {
    sopStep: "Step 7b",
    kind: "SOP_FOLLOWUP_2",
    step: "FOLLOWUP_WHATSAPP_2",
    name: "b2_sop_followup_not_booked_2",
    category: "MARKETING",
    language: "en",
    categoryNote: "The second chase at an un-booked prospect. Same promotional ask as Step 6 → MARKETING.",
    vars: [V.name("Priya"), V.sender("Nilofer")],
    notes: [
      "Body is IDENTICAL to b2_sop_followup_not_booked - it is the same ask, made once more.",
      "Submitted as its own template rather than re-sending Step 6's so the two can be worded apart later, and so per-template delivery stats separate the first chase from the second.",
    ],
  },
  {
    sopStep: "Step 13c",
    kind: "SOP_NOT_QUALIFIED",
    step: "DISCO_REJECT_MSG",
    name: "b2_sop_not_qualified",
    category: "UTILITY",
    language: "en",
    categoryNote:
      "The ONE template here with a real claim to UTILITY: it carries no offer, no link and no persuasion - it tells someone that an appointment they booked has been cancelled. That is a transaction update. If Meta re-categorises it as MARKETING, accept it rather than adding promotional copy to argue the point.",
    vars: [V.name("Priya"), V.sender("Nilofer")],
    notes: [
      "NOT in the SOP document - written for the founder's flow of 25/08/2026, so the wording has not been through the same sign-off as the transcribed templates.",
      "Deliberately does not say 'you are not qualified'. The prospect did what was asked of them; the message says the programme is not the right fit at this stage and leaves the door open.",
      "UNTIL THIS IS APPROVED, the step has no bound template and waits in the queue for a human. It is never auto-sent with the wrong text - see STEP_TO_KIND in server/outreach.ts.",
    ],
  },
  {
    sopStep: "Step 13",
    kind: "SOP_DISCO_WELCOME",
    step: "DISCO_WELCOME",
    name: "b2_sop_disco_welcome",
    category: "MARKETING",
    language: "en",
    categoryNote:
      "Confirms an appointment the prospect booked - but links the case studies page, which is social proof, i.e. promotional. Mixed content defaults to MARKETING.",
    vars: [V.name("Priya"), V.sender("Nilofer"), V.date("Sat 18 Jul"), V.time("07:00 PM")],
    notes: ["The SOP renders this time in IST and says so in the body (“at *[TIME]* IST”)."],
  },
  {
    sopStep: "Step 14",
    kind: "SOP_DISCO_CONFIRM_1",
    step: "DISCO_CONFIRM_1",
    name: "b2_sop_disco_confirm_1",
    category: "MARKETING",
    language: "en",
    categoryNote:
      "Reminder for a booked appointment, but sells the call while reminding - “possibilities of your next job in Germany”, “figure out your next best steps”. Persuasive intent → MARKETING. The YES is not why.",
    vars: [V.name("Priya"), V.date("Sat 18 Jul"), V.time("07:00 PM"), V.zoom()],
    notes: [
      "The app will NOT send this until a Zoom link is on the prospect’s card - an unresolved variable blocks the send rather than delivering a broken message.",
      "REVIEWER ASKED (26/10/2026): “since the zoom is not connected, from where will you get the link?” ANSWER: from `OutreachJourney.zoomLink`, written by the Zoom reconciler in server/zoom-meetings.ts - which ships OFF. Until it is armed and proven, {{zoom_link}} resolves to nothing and `sendWhatsApp` SKIPS the send rather than delivering a blank join line. So this template is safe to GET APPROVED now and must NOT be BOUND until Zoom is on: bound early it sends nothing, silently, per prospect. The reviewer marked the wording itself as ok.",
    ],
  },
  {
    sopStep: "Step 15",
    kind: "SOP_DISCO_CONFIRM_2",
    step: "DISCO_CONFIRM_2",
    name: "b2_sop_disco_confirm_2",
    category: "MARKETING",
    language: "en",
    categoryNote:
      "Second reminder for the same booked appointment, but re-pitches it as a “*FREE* Personalized Discovery Call”. “Free” is offer language → MARKETING.",
    vars: [V.name("Priya"), V.date("Sat 18 Jul"), V.time("07:00 PM"), V.zoom()],
    notes: [
      "REVIEWER ASKED (26/10/2026): “since the zoom is not connected, from where will you get the link?” ANSWER: from `OutreachJourney.zoomLink`, written by the Zoom reconciler in server/zoom-meetings.ts - which ships OFF. Until it is armed and proven, {{zoom_link}} resolves to nothing and `sendWhatsApp` SKIPS the send rather than delivering a blank join line. So this template is safe to GET APPROVED now and must NOT be BOUND until Zoom is on: bound early it sends nothing, silently, per prospect. The reviewer marked the wording itself as ok.",
    ],
  },
  {
    sopStep: "Step 16",
    kind: "SOP_DISCO_CANCEL",
    step: "DISCO_CANCEL_MSG",
    // NOT b2_sop_disco_cancel, despite the name. That template's approved text says the call was
    // MISSED, and this step fires 12h BEFORE it - it now lives on DISCO_NOSHOW_MSG, where a miss
    // has actually happened. b2_booking_auto_cancelled is approved and says the true thing here:
    // the slot is being released for lack of confirmation.
    name: "b2_booking_auto_cancelled",
    /**
     * MARKETING, and it stays MARKETING - see `whatsapp-submission.test.ts`, which asserts it.
     *
     * Recorded here because the 26 Oct WATI audit briefly flipped this to UTILITY to resolve a
     * cross-pack conflict, and that was the wrong end of the problem. The category follows the
     * BODY, and this body carries a re-booking CTA; flipping the declaration without stripping
     * the copy earns a silent re-categorisation from Meta and an abuse flag, which is exactly
     * what that test exists to prevent.
     *
     * The conflict was real and is fixed on the other side: `scripts/wati-templates-utility-docx.ts`
     * had a DIFFERENT, non-promotional body under this same name, and Meta approves one body per
     * (name, language) - so the two documents were competing submissions and whichever was sent
     * second replaced the first. That rewrite was briefly renamed `b2_booking_auto_cancelled_u` so
     * both could be approved; it was then DELETED on 26 Oct 2026, when the reviewer's approval
     * sheet marked this template's wording ok. The name now has exactly one body again, this one.
     */
    category: "MARKETING",
    language: "en",
    categoryNote:
      "Notifies the prospect their slot was released, then asks them to re-book with a link. That CTA is re-engagement → MARKETING. Note this template contains no confirmation request at all and is still MARKETING - the copy decides it, not the ask.",
    vars: [V.name("Priya")],
    notes: ["Fires only after BOTH required confirmation calls are logged (SOP Step 16)."],
  },
  {
    sopStep: "Step 19",
    kind: "SOP_SSS_CONFIRM_1",
    step: "SSS_CONFIRM_1",
    name: "b2_sop_sss_confirm_1",
    /**
     * ── THE REVIEWER REWROTE THIS BODY, AND THAT IS WHY IT IS UTILITY  (26 Oct 2026) ────
     *
     * Two decisions in one rewrite, and the second is the one that moves the category.
     *
     * The call is the "Solution Strategy Session". The SOP document transcribed it as "Success"
     * throughout; the reviewer corrected it on four separate templates, and `lib/outreach-sla.ts`
     * had been saying "Solution Strategy Call" for months - so this is a correction, not taste.
     *
     * And the PROMOTIONAL COPY IS OUT. The rationale at the top of this file says these steps
     * could not clear Meta's UTILITY bar because every body sold while it informed, and that
     * moving them "back to UTILITY" would first require the promotional lines to come out - a
     * `proposedFix`, because it changes what a prospect reads. The reviewer has now taken that
     * trade and written the stripped bodies themselves. So this is an `acceptedFix`, the open
     * question is closed, and the category follows the body it actually has.
     *
     * The superseded transcription lives in `TPL_*_SUPERSEDED` in lib/outreach-sop.ts, beside
     * the new constant, for the same reason `TPL_INTRO_SUPERSEDED` does.
     */
    acceptedFix: {
      reason:
        'Reviewer rewrote the body in the approval sheet: the call is the "Solution Strategy Session", and the promotional copy that forced MARKETING is removed. Submitted as UTILITY on the new body.',
      decidedOn: "2026-10-26",
      was: TPL_SSS_CONFIRM_1_SUPERSEDED,
    },
    category: "UTILITY",
    language: "en",
    categoryNote:
      "Confirmation request for a booked SSS, but built around a “personalized game plan” and “excited to help you take the next step in your career” - and carries a promo video header. Persuasive throughout → MARKETING.",
    vars: [V.name("Priya"), V.sender("Nilofer"), V.date("Mon 20 Jul"), V.time("06:30 PM")],
    header: "VIDEO - the personalized video Ameen records per prospect",
    notes: [
      "THE VIDEO IS GONE, AND THAT UNBLOCKS THIS STEP. Both notes that used to sit here are obsolete as of the reviewer’s 26/10/2026 rewrite: the body no longer ends in “<< ATTACH VIDEO TO THIS MESSAGE>>”, so there is no media header to submit and no per-send video to upload.",
      "What that was blocking: a per-prospect video header means uploading each one to WATI and passing its media id, which this app does not do - so Step 19 was pinned to MANUAL sending. With the video out of the template, it is an ordinary text send like every other rung on the ladder and the engine can run it.",
      "If B2 still wants the personalised video, it goes as a SEPARATE message rather than a header on this one. Putting it back into the body re-imposes the manual-only constraint and costs a re-approval; `outreach-engine.test.ts` asserts the placeholder stays out so that decision cannot be made by accident.",
    ],
  },
  {
    sopStep: "Step 20",
    kind: "SOP_SSS_CONFIRM_2",
    step: "SSS_CONFIRM_2",
    name: "b2_sop_sss_confirm_2",
    /**
     * ── THE REVIEWER REWROTE THIS BODY, AND THAT IS WHY IT IS UTILITY  (26 Oct 2026) ────
     *
     * Two decisions in one rewrite, and the second is the one that moves the category.
     *
     * The call is the "Solution Strategy Session". The SOP document transcribed it as "Success"
     * throughout; the reviewer corrected it on four separate templates, and `lib/outreach-sla.ts`
     * had been saying "Solution Strategy Call" for months - so this is a correction, not taste.
     *
     * And the PROMOTIONAL COPY IS OUT. The rationale at the top of this file says these steps
     * could not clear Meta's UTILITY bar because every body sold while it informed, and that
     * moving them "back to UTILITY" would first require the promotional lines to come out - a
     * `proposedFix`, because it changes what a prospect reads. The reviewer has now taken that
     * trade and written the stripped bodies themselves. So this is an `acceptedFix`, the open
     * question is closed, and the category follows the body it actually has.
     *
     * The superseded transcription lives in `TPL_*_SUPERSEDED` in lib/outreach-sop.ts, beside
     * the new constant, for the same reason `TPL_INTRO_SUPERSEDED` does.
     */
    acceptedFix: {
      reason:
        'Reviewer rewrote the body in the approval sheet: the call is the "Solution Strategy Session", and the promotional copy that forced MARKETING is removed. Submitted as UTILITY on the new body.',
      decidedOn: "2026-10-26",
      was: TPL_SSS_CONFIRM_2_SUPERSEDED,
    },
    category: "UTILITY",
    language: "en",
    categoryNote:
      "Second reminder for the same booked SSS, but sells attendance - “prepared something very specific for your profile and would love to see you there” → MARKETING.",
    vars: [V.name("Priya"), V.date("Mon 20 Jul"), V.time("06:30 PM"), V.zoom()],
    notes: [
      "REJECTION RISK: the SOP’s wording ends on the Zoom link, so the body would end with {{zoom_link}}. Meta commonly rejects a body that ends with a variable. The submitted body below therefore adds a short closing line after the link. Confirm this wording is acceptable to B2 before submitting.",
    ],
  },
  {
    sopStep: "Step 20b",
    kind: "SOP_SSS_CONFIRM_3",
    step: "SSS_CONFIRM_3",
    name: "b2_sop_sss_confirm_3",
    category: "MARKETING",
    language: "en",
    categoryNote:
      "The third SSS confirmation. Same body and same promotional framing as Step 20 → MARKETING.",
    vars: [V.name("Priya"), V.date("Sat 18 Jul"), V.time("07:00 PM"), V.zoom()],
    notes: [
      "Body is IDENTICAL to b2_sop_sss_confirm_2 - the same ask, made once more at the 6-hour mark.",
      "Its own template so the 6h rung can be worded apart later, and so delivery stats separate it from the 12h one.",
      "Until it is approved, bind SOP_SSS_CONFIRM_3 to b2_sop_sss_confirm_2 in WhatsApp → Settings; the text is the same.",
    ],
  },
  {
    sopStep: "L2 · no-show",
    kind: "SOP_DISCO_NOSHOW",
    step: "DISCO_NOSHOW_MSG",
    name: "b2_sop_disco_cancel",
    category: "MARKETING",
    language: "en",
    categoryNote:
      "Carries a re-booking CTA and link, which is promotional → MARKETING. Same reasoning as the other post-miss messages.",
    vars: [V.name("Priya")],
    notes: [
      "ALREADY APPROVED in WATI, and this is where its text belongs: \"We noticed you missed your scheduled Personalized Discovery Call... you can book a new appointment\".",
      "It was previously bound to Step 16, which fires 12h BEFORE the call - so it told people they had missed an appointment that had not happened yet. Step 16 now uses b2_booking_auto_cancelled.",
    ],
  },
  {
    sopStep: "Step 21",
    kind: "SOP_SSS_CANCEL",
    step: "SSS_CANCEL_MSG",
    name: "b2_sop_sss_cancel",
    /**
     * ── THE REVIEWER REWROTE THIS BODY, AND THAT IS WHY IT IS UTILITY  (26 Oct 2026) ────
     *
     * Two decisions in one rewrite, and the second is the one that moves the category.
     *
     * The call is the "Solution Strategy Session". The SOP document transcribed it as "Success"
     * throughout; the reviewer corrected it on four separate templates, and `lib/outreach-sla.ts`
     * had been saying "Solution Strategy Call" for months - so this is a correction, not taste.
     *
     * And the PROMOTIONAL COPY IS OUT. The rationale at the top of this file says these steps
     * could not clear Meta's UTILITY bar because every body sold while it informed, and that
     * moving them "back to UTILITY" would first require the promotional lines to come out - a
     * `proposedFix`, because it changes what a prospect reads. The reviewer has now taken that
     * trade and written the stripped bodies themselves. So this is an `acceptedFix`, the open
     * question is closed, and the category follows the body it actually has.
     *
     * The superseded transcription lives in `TPL_*_SUPERSEDED` in lib/outreach-sop.ts, beside
     * the new constant, for the same reason `TPL_INTRO_SUPERSEDED` does.
     */
    acceptedFix: {
      reason:
        'Reviewer rewrote the body in the approval sheet: the call is the "Solution Strategy Session", and the promotional copy that forced MARKETING is removed. Submitted as UTILITY on the new body.',
      decidedOn: "2026-10-26",
      was: TPL_SSS_CANCEL_SUPERSEDED,
    },
    category: "UTILITY",
    language: "en",
    categoryNote:
      "Notifies the prospect their SSS slot was released, then asks them to re-book with a link. Re-engagement CTA → MARKETING. Like Step 16, no confirmation request in it - still MARKETING.",
    vars: [V.name("Priya")],
  },
];

/** SOP bracket variable → the WATI `{{name}}` that replaces it. */
const TO_WATI: OutreachVars = {
  "[Prospect’s First Name]": "{{name}}",
  "[Your Name]": "{{sender}}",
  "[DATE]": "{{date}}",
  "[TIME]": "{{time}}",
  "<<INSERT ZOOM LINK HERE>>": "{{zoom_link}}",
};

/**
 * Meta rejects a body that ends with a variable. Step 20's SOP wording does exactly that, so it
 * gets one closing line. This is the ONLY place the submitted text departs from the SOP, it is
 * additive, and it is called out in that template's notes so the reviewer sees it.
 */
const BODY_SUFFIX: Partial<Record<OutreachStep, string>> = {
  SSS_CONFIRM_2: "\n\nPlease reply *YES* to confirm.",
  // Same body as Step 20, so the same trailing-variable problem and the same fix.
  SSS_CONFIRM_3: "\n\nPlease reply *YES* to confirm.",
};

/**
 * The exact body to paste into WATI, derived from the real SOP constant. The video placeholder is
 * stripped because it becomes a media header, not body text.
 */
export function submissionBody(t: SubmissionTemplate): string {
  const sop = STEP_BY_KEY[t.step]?.body ?? "";
  const wati = renderOutreachTemplate(sop, TO_WATI);
  return (wati.replace(/\s*<< ATTACH VIDEO TO THIS MESSAGE>>\s*$/, "").trimEnd() + (BODY_SUFFIX[t.step] ?? "")).trim();
}

/** Meta's hard body cap. Worth failing loudly at build time rather than at submission. */
export const BODY_CHAR_LIMIT = 1024;

export type TemplateLint = { name: string; issues: string[] };

/**
 * Static checks against Meta's documented body rules, so a rejection is caught here rather than
 * three days into a review queue.
 */
export function lintTemplate(t: SubmissionTemplate): TemplateLint {
  const body = submissionBody(t);
  const issues: string[] = [];

  if (body.length > BODY_CHAR_LIMIT) issues.push(`Body is ${body.length} chars - over Meta's ${BODY_CHAR_LIMIT} limit.`);
  if (/^\s*\{\{/.test(body)) issues.push("Body starts with a variable - Meta rejects this.");
  if (/\}\}\s*$/.test(body)) issues.push("Body ends with a variable - Meta rejects this.");
  // "Adjacent" means no STATIC TEXT between two parameters. Whitespace - including a line break -
  // is not text, so `{{a}}\n{{b}}` is as adjacent as `{{a}}{{b}}` as far as Meta is concerned.
  // Naming which pair is at fault matters: the reader has to find them in a 600-character body.
  const adjacent = body.match(/\{\{\s*([\w.]+)\s*\}\}(\s*)\{\{\s*([\w.]+)\s*\}\}/);
  if (adjacent) {
    const sep = adjacent[2].includes("\n") ? "only a line break" : adjacent[2] ? "only whitespace" : "nothing";
    issues.push(
      `{{${adjacent[1]}}} and {{${adjacent[3]}}} have ${sep} between them - Meta rejects adjacent parameters.`,
    );
  }
  if (!/^[a-z0-9_]+$/.test(t.name)) issues.push(`Template name "${t.name}" must be lowercase letters, digits and underscores only.`);

  // Every {{var}} in the body must be declared, and every declared var must appear.
  const used = new Set(Array.from(body.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)).map((m) => m[1]));
  const declared = new Set(t.vars.map((v) => v.name));
  for (const u of used) if (!declared.has(u)) issues.push(`Body uses {{${u}}} but it is not declared.`);
  for (const d of declared) if (!used.has(d)) issues.push(`{{${d}}} is declared but never used in the body.`);

  return { name: t.name, issues };
}

export function lintAll(): TemplateLint[] {
  return SUBMISSION_TEMPLATES.map(lintTemplate).filter((l) => l.issues.length > 0);
}

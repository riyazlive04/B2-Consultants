/**
 * WhatsApp template submission pack — the nine SOP messages, in the shape WATI/Meta want.
 *
 * WHY THIS EXISTS: the SOP writes its variables as `[Prospect’s First Name]`; WATI declares them
 * as `{{name}}`. Those are the same message in two dialects. This module is the translation, and
 * it is the SINGLE SOURCE for both the Word submission pack (scripts/whatsapp-templates-docx.ts)
 * and the in-app mapping guidance — so what B2 sends to Meta for approval and what the app expects
 * back can never drift apart.
 *
 * The SUBMITTED body is derived from the SOP body by substituting the bracket variables for WATI's
 * `{{…}}` names. It is not retyped: `submissionBody()` runs the real substitution over the real
 * template constant, so a change to the SOP text flows into the submission pack automatically.
 *
 * Isomorphic — no prisma, no server-only.
 */

import type { WhatsAppKind } from "@prisma/client";
import { STEP_BY_KEY, renderOutreachTemplate, type OutreachVars } from "./outreach-sop";
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
  /** Proposed WATI template name. snake_case, ≤512 chars, lowercase — Meta's rule. */
  name: string;
  category: TemplateCategory;
  language: string;
  /** Why this category — reviewers reject on category mismatch more than anything else. */
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
 * is a deliberate call, not an oversight — the earlier revision of this file had Steps 13–21 as
 * UTILITY, and that was wrong.
 *
 * WHY. Meta's bar for UTILITY is that a template be "non-promotional, not containing any
 * promotional or persuasive intent"; anything with MIXED content defaults to MARKETING. Every one
 * of these bodies carries promotional or persuasive copy, so none of them clears that bar:
 *  · Step 3 / Step 6 — promote a free call to someone who filled in a form. Never were UTILITY.
 *  · Step 13 — links the case studies page (social proof).
 *  · Step 14 — "possibilities of your next job in Germany", "your next best steps".
 *  · Step 15 — "*FREE* Personalized Discovery Call" is offer language.
 *  · Step 16 / Step 21 — carry a re-booking CTA and link. Note these have NO confirmation request
 *    in them at all, and are still MARKETING: it is the promotional copy that decides this, not
 *    the ask.
 *  · Step 19 — "personalized game plan", "excited to help you take the next step in your career".
 *  · Step 20 — "prepared something very specific for your profile".
 * Stacked on top: the appointment being confirmed is a free SALES call, which is a weaker claim to
 * "transaction" than a paid booking would be.
 *
 * A "reply YES to confirm" does NOT make a template MARKETING — a confirmation request for an
 * appointment the prospect booked is the textbook UTILITY case, and the reply is part of the
 * transactional flow. Recorded here because it is the intuitive wrong answer, and because if the
 * promotional copy below is ever stripped, the YES is not what stands in the way of UTILITY.
 *
 * CONSEQUENCES, both real:
 *  · Since April 2025 Meta approves as MARKETING anything it judges to be MARKETING regardless of
 *    what you declared, and flags accounts that game the categorisation. Declaring UTILITY here
 *    would not buy cheaper messages — it would buy a flag.
 *  · MARKETING templates are subject to per-user marketing limits and require opt-in (B2 has it,
 *    via the website form — keep that consent wording, it is the evidence). The cost is that a
 *    time-critical confirm-your-call reminder CAN be throttled for a prospect near their cap.
 *    Accepted for now; revisit against real delivery rates.
 *
 * To move any of Steps 13–21 back to UTILITY, the promotional lines must come out of the body
 * first — and that is a `proposedFix`, because it changes what a prospect reads.
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
      "REJECTION RISK: the SOP's first two lines put {{name}} and {{sender}} back to back with only a line break between them. Meta rejects templates whose parameters are adjacent with no static text in between, and a newline does not count as text. See the proposed fix — B2 must approve it before submitting.",
      "Both links are literal text, not variables — Meta reviews them once at approval.",
      "Sent within 5 minutes of opt-in (SOP Step 2), so the opt-in is fresh and provable.",
    ],
    proposedFix: {
      reason:
        "Puts static text between the two variables so Meta will accept it. The wording is not invented — it is exactly how the SOP itself opens Step 13 (“Hi [Prospect’s First Name], this is [Your Name] from B2 Consultants”), so the intro simply adopts B2’s own house phrasing. Everything after the first two lines is untouched.",
      body: "Hi {{name}}, this is {{sender}} from B2 Consultants.",
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
    sopStep: "Step 13",
    kind: "SOP_DISCO_WELCOME",
    step: "DISCO_WELCOME",
    name: "b2_sop_disco_welcome",
    category: "MARKETING",
    language: "en",
    categoryNote:
      "Confirms an appointment the prospect booked — but links the case studies page, which is social proof, i.e. promotional. Mixed content defaults to MARKETING.",
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
      "Reminder for a booked appointment, but sells the call while reminding — “possibilities of your next job in Germany”, “figure out your next best steps”. Persuasive intent → MARKETING. The YES is not why.",
    vars: [V.name("Priya"), V.date("Sat 18 Jul"), V.time("07:00 PM"), V.zoom()],
    notes: [
      "The app will NOT send this until a Zoom link is on the prospect’s card — an unresolved variable blocks the send rather than delivering a broken message.",
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
  },
  {
    sopStep: "Step 16",
    kind: "SOP_DISCO_CANCEL",
    step: "DISCO_CANCEL_MSG",
    name: "b2_sop_disco_cancel",
    category: "MARKETING",
    language: "en",
    categoryNote:
      "Notifies the prospect their slot was released, then asks them to re-book with a link. That CTA is re-engagement → MARKETING. Note this template contains no confirmation request at all and is still MARKETING — the copy decides it, not the ask.",
    vars: [V.name("Priya")],
    notes: ["Fires only after BOTH required confirmation calls are logged (SOP Step 16)."],
  },
  {
    sopStep: "Step 19",
    kind: "SOP_SSS_CONFIRM_1",
    step: "SSS_CONFIRM_1",
    name: "b2_sop_sss_confirm_1",
    category: "MARKETING",
    language: "en",
    categoryNote:
      "Confirmation request for a booked SSS, but built around a “personalized game plan” and “excited to help you take the next step in your career” — and carries a promo video header. Persuasive throughout → MARKETING.",
    vars: [V.name("Priya"), V.sender("Nilofer"), V.date("Mon 20 Jul"), V.time("06:30 PM")],
    header: "VIDEO — the personalized video Ameen records per prospect",
    notes: [
      "The SOP’s “<< ATTACH VIDEO TO THIS MESSAGE>>” is a per-prospect video, so it must be a VIDEO HEADER, not body text. Submit with a sample video; the real one is supplied per send.",
      "DECISION NEEDED: a per-send video header requires uploading each prospect’s video to WATI and passing its media id. The app does not do that today — see the wiring doc. Until it does, keep this step MANUAL.",
    ],
  },
  {
    sopStep: "Step 20",
    kind: "SOP_SSS_CONFIRM_2",
    step: "SSS_CONFIRM_2",
    name: "b2_sop_sss_confirm_2",
    category: "MARKETING",
    language: "en",
    categoryNote:
      "Second reminder for the same booked SSS, but sells attendance — “prepared something very specific for your profile and would love to see you there” → MARKETING.",
    vars: [V.name("Priya"), V.date("Mon 20 Jul"), V.time("06:30 PM"), V.zoom()],
    notes: [
      "REJECTION RISK: the SOP’s wording ends on the Zoom link, so the body would end with {{zoom_link}}. Meta commonly rejects a body that ends with a variable. The submitted body below therefore adds a short closing line after the link. Confirm this wording is acceptable to B2 before submitting.",
    ],
  },
  {
    sopStep: "Step 21",
    kind: "SOP_SSS_CANCEL",
    step: "SSS_CANCEL_MSG",
    name: "b2_sop_sss_cancel",
    category: "MARKETING",
    language: "en",
    categoryNote:
      "Notifies the prospect their SSS slot was released, then asks them to re-book with a link. Re-engagement CTA → MARKETING. Like Step 16, no confirmation request in it — still MARKETING.",
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

  if (body.length > BODY_CHAR_LIMIT) issues.push(`Body is ${body.length} chars — over Meta's ${BODY_CHAR_LIMIT} limit.`);
  if (/^\s*\{\{/.test(body)) issues.push("Body starts with a variable — Meta rejects this.");
  if (/\}\}\s*$/.test(body)) issues.push("Body ends with a variable — Meta rejects this.");
  // "Adjacent" means no STATIC TEXT between two parameters. Whitespace — including a line break —
  // is not text, so `{{a}}\n{{b}}` is as adjacent as `{{a}}{{b}}` as far as Meta is concerned.
  // Naming which pair is at fault matters: the reader has to find them in a 600-character body.
  const adjacent = body.match(/\{\{\s*([\w.]+)\s*\}\}(\s*)\{\{\s*([\w.]+)\s*\}\}/);
  if (adjacent) {
    const sep = adjacent[2].includes("\n") ? "only a line break" : adjacent[2] ? "only whitespace" : "nothing";
    issues.push(
      `{{${adjacent[1]}}} and {{${adjacent[3]}}} have ${sep} between them — Meta rejects adjacent parameters.`,
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

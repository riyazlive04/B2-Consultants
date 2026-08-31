/**
 * Outreach Specialist SOP - the written process, as data.
 *
 * Source of truth: `Script for Outreach Specialist.docx`, Steps 1–23. The message bodies below are
 * transcribed VERBATIM from that document - including its curly apostrophes (’), its emoji, its
 * `*bold*` WhatsApp markers, its `<<INSERT ZOOM LINK HERE>>` placeholders, and its trailing
 * spaces. The QA checklist (§S) requires a character-diff against the SOP to pass, so DO NOT
 * "tidy" this text: straightening a quote or trimming a line is a real regression.
 *
 * ONE DOCUMENTED EXCEPTION, and it is deliberate: `TPL_INTRO` (Step 3) carries two founder-approved
 * wording changes made on 2026-08-03 - one because the transcribed opening could never have passed
 * Meta's adjacent-parameter rule, one because auto-sending the message made its closing promise
 * untrue. Both are explained on the constant, and the original transcription is kept beside it as
 * `TPL_INTRO_SUPERSEDED`. That is the bar for changing any body here: a stated reason, founder
 * sign-off, and the superseded text preserved. Anything less is the "tidying" this rule forbids.
 *
 * Isomorphic - no prisma, no server-only, no secrets. The settings UI, the queue UI and the
 * server engine all import from here. The DB-facing engine lives in `src/server/outreach.ts`;
 * the pure ladder maths lives in `src/lib/outreach-engine.ts`.
 */

import type { OutreachStep, OutreachChannel, QualifiedVerdict } from "@prisma/client";

// ─────────────────────────────── Variables ───────────────────────────────

/**
 * The SOP writes its variables as bracketed English, e.g. `[Prospect’s First Name]`. We keep that
 * exact syntax rather than normalising to `{{name}}`: the specialist reads these messages next to
 * the printed SOP, and a mismatch there is what causes send-time mistakes.
 *
 * Note `[Prospect’s First Name]` uses U+2019, not an ASCII apostrophe - matching the document.
 */
export const OUTREACH_VARS = [
  "[Prospect’s First Name]",
  "[Your Name]",
  "[DATE]",
  "[TIME]",
  "<<INSERT ZOOM LINK HERE>>",
  "<< ATTACH VIDEO TO THIS MESSAGE>>",
] as const;

export type OutreachVar = (typeof OUTREACH_VARS)[number];
export type OutreachVars = Partial<Record<OutreachVar, string>>;

/**
 * Substitute the SOP's bracketed variables.
 *
 * Deliberately NOT a regex over `\[.*?\]` - the templates contain literal brackets we must not
 * touch, and a greedy match across `*[DATE]* at *[TIME]*` would eat the whole span. We replace
 * only the known variable names, literally.
 */
export function renderOutreachTemplate(body: string, vars: OutreachVars): string {
  let out = body;
  for (const key of OUTREACH_VARS) {
    const value = vars[key];
    if (value === undefined) continue;
    out = out.split(key).join(value);
  }
  return out;
}

/**
 * Which SOP variables are still unresolved in a rendered body.
 *
 * The checklist (§5 of the test prompt) requires that no unresolved placeholder ever reaches the
 * send step. `src/server/outreach.ts` calls this as a fail-closed gate: a step with leftovers is
 * blocked, not sent with a blank. Mirrors the WATI layer's existing stance (server/whatsapp.ts:175)
 * - an empty variable renders a broken message ("Hi ,") and burns the prospect's trust.
 */
export function unresolvedVars(rendered: string): OutreachVar[] {
  return OUTREACH_VARS.filter((v) => rendered.includes(v));
}

// ─────────────────────────────── Templates (VERBATIM) ───────────────────────────────

/**
 * Step 3 - Outreach WhatsApp Message: Introduction.
 *
 * ── THE ONE TEMPLATE THAT IS NOT VERBATIM ────────────────────────────────────────
 * Two lines differ from the SOP document. Both changes were put to the founder and accepted on
 * 2026-08-03; `TPL_INTRO_SUPERSEDED` below holds the original transcription so the provenance
 * this file exists to protect is not lost. Nothing else in the body moved.
 *
 * 1. THE OPENING. The SOP put `[Prospect’s First Name]` and `[Your Name]` on consecutive lines,
 *    which becomes two ADJACENT `{{…}}` parameters at submission. Meta rejects templates whose
 *    parameters are adjacent with no static text between them, and a newline does not count as
 *    text - so the message as transcribed could never have been approved. The replacement is not
 *    invented wording: it is exactly how the SOP itself opens Step 13, so the intro adopts B2's
 *    own house phrasing rather than something new.
 *
 * 2. THE CLOSING. It read "I’ll give you a quick call now to help you get booked!". Once this
 *    message is sent automatically at opt-in, that promise is false - under
 *    `firstCallMode: "after_check"` a caller only rings if the prospect does NOT book. A message
 *    that promises a call the system will not make is worse than a colder one, so the offer is
 *    kept but made the prospect's to take up.
 *
 * Why the constant changed rather than only the submission pack: this text is ALSO what the app
 * shows a specialist in the manual copy-and-send flow. Fixing only the submitted body would mean
 * the queue shows one message while an auto-send delivers another.
 */
const TPL_INTRO = `Hi [Prospect’s First Name], this is [Your Name] from B2 Consultants.

Thanks for showing interest in finding your next job in Germany 🇩🇪

To help you further, we would like to invite you to book a 20 min *FREE* Personalized Discovery Call to understand your requirements and current situation.

Please use this link to book a *FREE* Personalized Discovery Call with our team here: https://optin.b2consultants.de/apply

If you have questions about our coaching program, I request you to watch this short video where Ameen explains 3 mistakes that people usually make, as well as 3 secrets to overcome them: https://optin.b2consultants.de/lang

Prefer a hand with booking? Just reply here and one of our team will call you.`;

/**
 * The Step 3 body EXACTLY as transcribed from Script_for_Outreach_Specialist.docx, before the
 * two changes documented on `TPL_INTRO`.
 *
 * Kept, not deleted. The whole point of the verbatim rule is that the transcription is evidence
 * of what the team agreed to say; a change to it is only defensible if the thing it replaced is
 * still readable. Referenced by the submission pack so the Word document tells Meta's reviewer -
 * and B2 - what changed and why.
 */
export const TPL_INTRO_SUPERSEDED = `Hi [Prospect’s First Name]
[Your Name] here from B2 Consultants.

Thanks for showing interest in finding your next job in Germany 🇩🇪

To help you further, we would like to invite you to book a 20 min *FREE* Personalized Discovery Call to understand your requirements and current situation.

Please use this link to book a *FREE* Personalized Discovery Call with our team here: https://optin.b2consultants.de/apply

If you have questions about our coaching program, I request you to watch this short video where Ameen explains 3 mistakes that people usually make, as well as 3 secrets to overcome them: https://optin.b2consultants.de/lang

I’ll give you a quick call now to help you get booked!`;

/** Step 6 - Outreach WhatsApp Message: Call Not Booked. */
const TPL_FOLLOWUP = `Hey [Prospect’s First Name], [Your Name] here from B2 Consultants.
Just wanted to follow up - I saw you haven’t booked the *FREE* Personalized Discovery Call with our team yet.
We only have a few spots available coming week, and we don’t want you to miss this window.

Please use the link to book a call directly with our team: https://optin.b2consultants.de/apply

Do let me know if you need assistance. `;

/**
 * Step 6b - the booking chase by email.
 *
 * NOT a transcription of the SOP: the document's Step 6 is WhatsApp only, and this channel did
 * not exist when it was written. Per the provenance rule at the top of this file, that makes the
 * wording new rather than founder-approved - so it deliberately says nothing the approved
 * WhatsApp follow-up does not already say, and carries the same booking link. Treat it as
 * provisional until it has been signed off like the rest.
 *
 * Plain text, rendered to HTML at send time. The subject is separate because email needs one and
 * the SOP's bracketed-variable syntax is kept identical to every other body here.
 */
const TPL_FOLLOWUP_EMAIL_SUBJECT = `[Prospect’s First Name], your free Discovery Call spot is still open`;

const TPL_FOLLOWUP_EMAIL = `Hi [Prospect’s First Name],

[Your Name] here from B2 Consultants. I saw you haven’t booked your *FREE* Personalized Discovery Call with our team yet.

We only have a few spots available in the coming week, and we don’t want you to miss this window.

You can book a call directly with our team here:
https://optin.b2consultants.de/apply

Do let me know if you need any assistance.

[Your Name]
B2 Consultants`;

/**
 * Step 13c - the booked call is being cancelled because BANT came back below the bar.
 *
 * NEW WORDING, not from the SOP - the document has no not-qualified notice, so this is
 * provisional under the provenance rule at the top of this file. It deliberately does NOT say
 * "you are not qualified": the prospect is a person who did what we asked, and the honest and
 * kinder framing is that this particular call is not the right fit right now.
 *
 * WHATSAPP CANNOT SEND THIS YET. Business-initiated WhatsApp must use a template Meta has
 * approved, and there is no approved b2 template for it - see SOP_NOT_QUALIFIED in
 * `STEP_TO_KIND`, which is deliberately left unmapped so the step waits in the queue for a human
 * rather than sending the WRONG approved template. The EMAIL counterpart has no such limit and
 * sends immediately.
 */
const TPL_NOT_QUALIFIED = `Hi [Prospect’s First Name], this is [Your Name] from B2 Consultants.

Thank you for booking a Personalized Discovery Call with us. Having looked at your answers, our programme isn’t the right fit for your situation at this stage, so we’ve released your call slot.

This isn’t a no forever - circumstances change, and you’re welcome to come back to us when yours do.

Wishing you all the best with your plans for Germany.`;

const TPL_NOT_QUALIFIED_EMAIL_SUBJECT = `[Prospect’s First Name], about your Discovery Call booking`;

/** Step 13d - the email counterpart of Step 13c. Same message, same reservations. */
const TPL_NOT_QUALIFIED_EMAIL = TPL_NOT_QUALIFIED;

/**
 * Step 13b - the disco welcome by email. Mirrors the APPROVED `b2_sop_disco_welcome` WhatsApp
 * template rather than inventing a second voice, so a prospect reading both sees one message.
 */
const TPL_DISCO_WELCOME_EMAIL_SUBJECT = `[Prospect’s First Name], your Discovery Call is confirmed for [DATE]`;

const TPL_DISCO_WELCOME_EMAIL = `Hi [Prospect’s First Name], this is [Your Name] from B2 Consultants.

I saw you booked a Personalized Discovery Call with our team on [DATE] at [TIME] IST.

The team is preparing for your call and will get back to you if we need more information on further steps.

Meanwhile, you can visit our case studies page to understand more about what our students have to say about us:
https://casestudies.b2consultants.de/casestudies

See you soon!`;

/** Step 16b - the email counterpart of the cancellation notice. Mirrors `TPL_DISCO_CANCEL`. */
const TPL_DISCO_CANCEL_EMAIL_SUBJECT = `[Prospect’s First Name], your Discovery Call slot has been released`;

const TPL_DISCO_CANCEL_EMAIL = `Hi [Prospect’s First Name],

Since we didn’t receive your confirmation, we’ve had to cancel your Personalized Discovery Call slot and release it for another candidate.

If you would still like to speak with our team, you can book a new slot here:
https://optin.b2consultants.de/apply

[Your Name]
B2 Consultants`;

/**
 * Step 3b - the opt-in welcome by email.
 *
 * Mirrors the APPROVED `b2_sop_intro` WhatsApp wording rather than inventing a second voice: a
 * prospect receives both within a minute of each other, and two different accounts of what B2
 * does would read as two different companies. The emoji and the WhatsApp bold markers are gone
 * because they are WhatsApp conventions, not email ones; nothing else is changed.
 *
 * This replaces the "New lead nurture" workflow's SEND_EMAIL, which said only "thanks for
 * reaching out" and carried no booking link - so the email half of Step 1 asked for nothing.
 */
const TPL_INTRO_EMAIL_SUBJECT = `[Prospect’s First Name], your free Discovery Call with B2 Consultants`;

const TPL_INTRO_EMAIL = `Hi [Prospect’s First Name], this is [Your Name] from B2 Consultants.

Thanks for showing interest in finding your next job in Germany.

To help you further, we would like to invite you to book a 20 minute FREE Personalized Discovery Call to understand your requirements and current situation.

You can book your call here:
https://optin.b2consultants.de/apply

If you have questions about our coaching programme, this short video has Ameen explaining the 3 mistakes people usually make, and the 3 secrets to overcome them:
https://optin.b2consultants.de/lang

Prefer a hand with booking? Just reply to this email and one of our team will call you.

[Your Name]
B2 Consultants`;

/** Step 13 - Disco Welcome WhatsApp 1. */
const TPL_DISCO_WELCOME = `Hi [Prospect’s First Name], this is [Your Name] from B2 Consultants

I saw you booked a Personalized Discovery Call with our team on *[DATE]* at *[TIME]* IST.

The team is preparing for your call and will get back to you if we need more information on further steps.

Meanwhile, you can visit our case studies page to understand more about what our students have to say about us: https://casestudies.b2consultants.de/casestudies

See you soon!`;

/** Step 14 - Disco Confirmation WhatsApp 2 (≥36h before). */
const TPL_DISCO_CONFIRM_1 = `Hi [Prospect’s First Name], just a quick reminder about your upcoming *Personalized Discovery Call* with us to discuss about the possibilities of your next job in Germany.

During this 20-minute session our team will understand your current situation and help you figure out your next best steps.

You can use this link to join the call directly: <<INSERT ZOOM LINK HERE>>

Just to double-check - are you still good for *[DATE]* at *[TIME]*?

Please reply *YES* to confirm your participation.

Looking forward to seeing you there!`;

/** Step 15 - Disco Confirmation WhatsApp 3 (≥24h before, only if Step 14 got no reply). */
const TPL_DISCO_CONFIRM_2 = `Just checking in again, [Prospect’s First Name] - are you joining the *FREE* Personalized Discovery Call with our team on *[DATE]* at *[TIME]*?

<<INSERT ZOOM LINK HERE>>

Please reply *YES* to confirm your participation. `;

/** Step 16 - Disco Confirmation WhatsApp 4 / cancellation (≥12h before, after two calls). */
const TPL_DISCO_CANCEL = `Hey [Prospect’s First Name], since we didn’t receive your confirmation, we had to *CANCEL* your Personalized Discovery Call slot and release it for another candidate.
No worries - if you're still interested, please use the link below to book a call at your convenience.
Use this link to book a call: https://optin.b2consultants.de/apply

Wishing you the best. `;

/** Step 19 - SSS Call Confirmation WhatsApp 1 (≥24h before; carries the personalized video). */
const TPL_SSS_CONFIRM_1 = `Hey [Prospect’s First Name], this is [Your Name] from B2 Consultants

Ameen asked me to send you this quick video he made just for you

After your Personalized Discovery Call, he has created a personalized game plan based on your profile and goals.

Before presenting it to you in the next call, Ameen would love to clarify a couple more things so he can make this as tailored as possible for you.

Your Success Strategy Session is scheduled for *[DATE]* at *[TIME]*

And just to be sure, are you available at this time?

Please reply *YES* to confirm.

We’re excited to help you take the next step in your career.

 << ATTACH VIDEO TO THIS MESSAGE>>`;

/** Step 20 - SSS Call Confirmation WhatsApp 2 (≥12h before). */
const TPL_SSS_CONFIRM_2 = `Just checking in again, [Prospect’s First Name] - are you joining the Success Strategy Session with Ameen on *[DATE]* at *[TIME]*?

He’s prepared something very specific for your profile and would love to see you there.

<<INSERT ZOOM LINK HERE>>`;

/**
 * L2 - the prospect did not join their discovery call.
 *
 * TRANSCRIBED FROM THE APPROVED WATI TEMPLATE `b2_sop_disco_cancel`, read from the WATI API on
 * 27/08/2026 - not written here. That template's text is a POST-miss message, which is why it was
 * wrong bound to Step 16 (12h BEFORE the call, telling people they had missed something that had
 * not happened) and is exactly right for this step.
 */
const TPL_DISCO_NOSHOW = `Hi [Prospect’s First Name],

We noticed you missed your scheduled Personalized Discovery Call.

If you’re still interested in exploring career opportunities in Germany, you can book a new appointment at a time that works for you:
https://optin.b2consultants.de/apply

If you have any questions, we’re happy to help.`;

/** Step 21 - SSS Call Cancellation WhatsApp 3 (≥10h before). */
const TPL_SSS_CANCEL = `Hey [Prospect’s First Name], since we didn’t receive your confirmation, we had to release your Success Strategy Session slot for another candidate.

No worries - if you're still interested, just let us know and we’ll try to find another time or please use the link below to book a call at your convenience.
Book a call with Ameen to finalise your plan: https://optin.b2consultants.de/sss`;

// ─────────────────────────────── Call scripts (Steps 4, 8, 16) ───────────────────────────────

/**
 * The SOP's call scripts, as branching data rather than prose - checklist §D requires the Yes/No
 * paths be "accessible to the specialist during the call", which means rendering them, not filing
 * them. The (▼)(►)(▲) marks are the SOP's own intonation cues; they are part of the training and
 * are preserved verbatim.
 */
export type CallScript = {
  objective: string;
  opening: string[];
  branches: { label: string; lines: string[] }[];
  closing: string[];
};

export const CALL_SCRIPTS: Partial<Record<OutreachStep, CallScript>> = {
  FIRST_CALL: {
    objective: "Politely push them to book the Personalized Discovery Call.",
    opening: [
      "YOU: [Prospect’s First Name]......??? (▼)",
      "PROSPECT: YES",
      "YOU: Hi, [Prospect’s First Name]. this is [Your Name] from B2 Consultants - I just sent you a WhatsApp message (►), did you get a chance to see it? (▼)",
    ],
    branches: [
      {
        label: "They saw the message (YES)",
        lines: [
          "YOU: Awesome (▲)! So, you submitted your details to know how to find a job in Germany (►), right? (▼)",
          "PROSPECT: (→ Wait for YES)",
        ],
      },
      {
        label: "They did not see it (NO)",
        lines: [
          "YOU: Not a problem (►), in that case, let me guide you through the next steps quickly (►). You have submitted your details to know how to find a job in Germany (►), right? (▼)",
          "PROSPECT: (→ Wait for YES)",
        ],
      },
    ],
    closing: [
      "YOU: Perfect (▲).",
      "Let me guide you through the next step, it’s very simple (►)",
      "our team (▲)……….is currently doing a few 20-minute Personalized Discovery Calls coming week……..to help people who are looking for a job in Germany, just like you. (►)",
      "The objective is….to understand why (▲) you want to move to Germany, where you are now, and how we can help you further….to move ahead in your job search journey. (►)",
      "Once after you have booked the call (▼), we will evaluate your application and will let you know about our next steps through WhatsApp. (►) Is that OK? (▼)",
      "PROSPECT: (→ Wait for YES)",
      "YOU: Great (▲), [Prospect’s First Name], then I am looking forward to your call and have a nice day! (►)",
    ],
  },
  FOLLOWUP_CALL: {
    objective: "Check why the call is still not booked, and close the booking on the phone.",
    opening: [
      "YOU: Hey [Prospect’s First Name], [Your Name] here from B2 Consultants. (►)",
      "I was checking our calendar, and it looks like (▼)……you have not booked your FREE personalized discovery session with us yet.",
      "As already mentioned, we have only few (▲) spots available, where you can learn (▲) the process of getting a job in Germany (►), are you still interested (►)?",
    ],
    branches: [
      {
        label: "Still interested (YES)",
        lines: [
          "YOU: Great. (▲) In that case, please use the link that I have already sent you to your WhatsApp to book a FREE session. (►)",
          "YOU: I am looking forward for your call until then take care.",
        ],
      },
      {
        // Step 8's NO branch is terminal - the SOP ends this lead's active follow-up cycle here
        // (checklist §H). The engine honours that by moving the journey to IGNORED.
        label: "Not interested (NO) - ends the follow-up cycle",
        lines: [
          "YOU: No worries. (►)",
          "YOU: I wish you all the best for your career. Bye. (►)",
        ],
      },
    ],
    closing: [],
  },
  DISCO_CONFIRM_CALL_1: {
    objective: "Get the discovery-call participation confirmed verbally (attempt 1 of 2).",
    opening: [
      "YOU: Hi [Prospect’s First Name], [Your Name] here from B2 Consultants. (►)",
      "I’m calling about your upcoming Personalized Discovery Call - we haven’t received your confirmation yet.",
      "Are you still good for *[DATE]* at *[TIME]*? (▼)",
    ],
    branches: [
      { label: "Confirms (YES)", lines: ["Mark WhatsApp Confirmed = YES. The cancellation ladder stops immediately."] },
      { label: "No answer / no confirmation", lines: ["Log the attempt. The SOP requires a second attempt before any cancellation message goes out."] },
    ],
    closing: [],
  },
  DISCO_CONFIRM_CALL_2: {
    objective: "Get the discovery-call participation confirmed verbally (attempt 2 of 2).",
    opening: [
      "YOU: Hi [Prospect’s First Name], [Your Name] here from B2 Consultants. (►)",
      "Just one last check about your Personalized Discovery Call on *[DATE]* at *[TIME]*. (▼)",
    ],
    branches: [
      { label: "Confirms (YES)", lines: ["Mark WhatsApp Confirmed = YES. The cancellation ladder stops immediately."] },
      {
        label: "No answer / no confirmation",
        lines: ["Both required attempts are now logged. The Step 16 cancellation message unlocks at the 12-hour mark."],
      },
    ],
    closing: [],
  },
};

// ─────────────────────────────── Step definitions ───────────────────────────────

/**
 * How a step's due time is anchored. This is the distinction the existing WATI cadence layer
 * could not express (server/whatsapp.ts:462 sends "within the window, spaced by the minimum gap"
 * rather than at discrete offsets), and it is why the SOP's 36/24/12/10h ladder needed its own
 * engine:
 *
 *  - `IMMEDIATE`      - due the moment its precondition is met (Steps 3, 13).
 *  - `AFTER_PREV`     - due N hours after the previous step was acted on (Steps 5, 7, 9).
 *  - `BEFORE_DISCO`   - due N hours BEFORE the discovery appointment (Steps 14, 15, 16).
 *  - `BEFORE_SSS`     - due N hours BEFORE the SSS appointment (Steps 19, 20, 21).
 */
export type StepAnchor = "IMMEDIATE" | "AFTER_PREV" | "BEFORE_DISCO" | "BEFORE_SSS";

export type OutreachStepDef = {
  step: OutreachStep;
  /** The SOP step number(s) this implements - shown in the UI so the specialist can cross-refer. */
  sopStep: string;
  label: string;
  channel: OutreachChannel;
  anchor: StepAnchor;
  /** Which SLA key drives this step's offset. Null for IMMEDIATE steps. */
  slaKey: keyof OutreachSla | null;
  /** The step this one waits on, for AFTER_PREV anchoring. */
  after?: OutreachStep;
  body?: string;
  /** EMAIL steps only - the subject line. WhatsApp and CALL steps have no use for one. */
  subject?: string;
  /** Steps that need a Zoom link resolved before they can be sent (checklist §R). */
  needsZoom?: boolean;
};

export const OUTREACH_STEPS: OutreachStepDef[] = [
  {
    step: "INTRO_WHATSAPP",
    sopStep: "Step 3",
    label: "WhatsApp intro",
    channel: "WHATSAPP",
    anchor: "IMMEDIATE",
    slaKey: null,
    body: TPL_INTRO,
  },
  {
    step: "INTRO_EMAIL",
    sopStep: "Step 3b",
    label: "Welcome email",
    channel: "EMAIL",
    anchor: "IMMEDIATE",
    slaKey: null,
    body: TPL_INTRO_EMAIL,
    subject: TPL_INTRO_EMAIL_SUBJECT,
  },
  {
    step: "FIRST_CALL",
    sopStep: "Step 4",
    label: "First call",
    channel: "CALL",
    anchor: "IMMEDIATE",
    slaKey: null,
  },
  {
    step: "CHECK_1",
    sopStep: "Step 5 → 10",
    label: "Check 1 - booked?",
    channel: "SYSTEM",
    anchor: "AFTER_PREV",
    slaKey: "check1Hours",
    after: "INTRO_WHATSAPP",
  },
  {
    step: "FOLLOWUP_WHATSAPP",
    sopStep: "Step 6",
    label: "WhatsApp follow-up - not booked",
    channel: "WHATSAPP",
    anchor: "IMMEDIATE",
    slaKey: null,
    body: TPL_FOLLOWUP,
  },
  {
    step: "FOLLOWUP_EMAIL",
    sopStep: "Step 6b",
    label: "Email follow-up - not booked",
    channel: "EMAIL",
    anchor: "IMMEDIATE",
    slaKey: null,
    body: TPL_FOLLOWUP_EMAIL,
    subject: TPL_FOLLOWUP_EMAIL_SUBJECT,
  },
  {
    step: "CHECK_2",
    sopStep: "Step 7 → 10",
    label: "Check 2 - booked?",
    channel: "SYSTEM",
    anchor: "AFTER_PREV",
    slaKey: "check2Hours",
    after: "FOLLOWUP_WHATSAPP",
  },
  {
    step: "FOLLOWUP_WHATSAPP_2",
    sopStep: "Step 7b",
    label: "WhatsApp follow-up 2 - still not booked",
    channel: "WHATSAPP",
    anchor: "IMMEDIATE",
    slaKey: null,
    // Same words as Step 6 - it is the same ask, and the approved template says it well. Its own
    // KIND though, so a differently-worded template can be bound later without touching Step 6.
    body: TPL_FOLLOWUP,
  },
  {
    step: "CHECK_3",
    sopStep: "Step 7c → 10",
    label: "Check 3 - booked?",
    channel: "SYSTEM",
    anchor: "AFTER_PREV",
    slaKey: "check3Hours",
    after: "FOLLOWUP_WHATSAPP_2",
  },
  {
    step: "FOLLOWUP_CALL",
    sopStep: "Step 8",
    label: "Call follow-up - not booked",
    channel: "CALL",
    anchor: "IMMEDIATE",
    slaKey: null,
  },
  {
    step: "FINAL_CHECK",
    sopStep: "Step 9 → 10",
    label: "Final check - booked?",
    channel: "SYSTEM",
    anchor: "AFTER_PREV",
    slaKey: "finalCheckHours",
    after: "FOLLOWUP_CALL",
  },
  {
    step: "BANT_QUALIFICATION",
    sopStep: "Step 11",
    label: "BANT qualification",
    channel: "SYSTEM",
    anchor: "IMMEDIATE",
    slaKey: null,
  },
  {
    step: "KEY_METRICS_TRANSFER",
    sopStep: "Step 12",
    label: "Key Metrics transfer + assign owners",
    channel: "SYSTEM",
    anchor: "IMMEDIATE",
    slaKey: null,
  },
  {
    step: "DISCO_WELCOME",
    sopStep: "Step 13",
    label: "Disco welcome",
    channel: "WHATSAPP",
    anchor: "IMMEDIATE",
    slaKey: null,
    body: TPL_DISCO_WELCOME,
  },
  {
    step: "DISCO_WELCOME_EMAIL",
    sopStep: "Step 13b",
    label: "Disco welcome - email",
    channel: "EMAIL",
    anchor: "IMMEDIATE",
    slaKey: null,
    body: TPL_DISCO_WELCOME_EMAIL,
    subject: TPL_DISCO_WELCOME_EMAIL_SUBJECT,
  },
  {
    step: "DISCO_REJECT_MSG",
    sopStep: "Step 13c",
    label: "Not qualified - WhatsApp",
    channel: "WHATSAPP",
    anchor: "IMMEDIATE",
    slaKey: null,
    body: TPL_NOT_QUALIFIED,
  },
  {
    step: "DISCO_REJECT_EMAIL",
    sopStep: "Step 13d",
    label: "Not qualified - email",
    channel: "EMAIL",
    anchor: "IMMEDIATE",
    slaKey: null,
    body: TPL_NOT_QUALIFIED_EMAIL,
    subject: TPL_NOT_QUALIFIED_EMAIL_SUBJECT,
  },
  {
    step: "DISCO_CONFIRM_1",
    sopStep: "Step 14",
    label: "Disco confirmation 1",
    channel: "WHATSAPP",
    anchor: "BEFORE_DISCO",
    slaKey: "discoConfirm1LeadHours",
    body: TPL_DISCO_CONFIRM_1,
    needsZoom: true,
  },
  {
    step: "DISCO_CONFIRM_2",
    sopStep: "Step 15",
    label: "Disco confirmation 2",
    channel: "WHATSAPP",
    anchor: "BEFORE_DISCO",
    slaKey: "discoConfirm2LeadHours",
    body: TPL_DISCO_CONFIRM_2,
    needsZoom: true,
  },
  {
    step: "DISCO_CONFIRM_CALL_1",
    sopStep: "Step 16",
    label: "Disco confirmation call 1 of 2",
    channel: "CALL",
    anchor: "BEFORE_DISCO",
    slaKey: "discoConfirmCallLeadHours",
  },
  {
    step: "DISCO_CONFIRM_CALL_2",
    sopStep: "Step 16",
    label: "Disco confirmation call 2 of 2",
    channel: "CALL",
    anchor: "BEFORE_DISCO",
    slaKey: "discoConfirmCallLeadHours",
  },
  {
    step: "DISCO_CANCEL_MSG",
    sopStep: "Step 16",
    label: "Disco cancellation message",
    channel: "WHATSAPP",
    anchor: "BEFORE_DISCO",
    slaKey: "discoCancelLeadHours",
    body: TPL_DISCO_CANCEL,
  },
  {
    step: "DISCO_CANCEL_EMAIL",
    sopStep: "Step 16b",
    label: "Disco cancellation - email",
    channel: "EMAIL",
    anchor: "BEFORE_DISCO",
    slaKey: "discoCancelLeadHours",
    body: TPL_DISCO_CANCEL_EMAIL,
    subject: TPL_DISCO_CANCEL_EMAIL_SUBJECT,
  },
  {
    step: "DISCO_CANCEL",
    sopStep: "Step 17/18",
    label: "Cancel disco + mark RED",
    channel: "SYSTEM",
    anchor: "IMMEDIATE",
    slaKey: null,
  },
  {
    step: "DISCO_NOSHOW_CALL_1",
    sopStep: "L2 · no-show",
    label: "No-show - call attempt 1",
    channel: "CALL",
    anchor: "IMMEDIATE",
    slaKey: null,
  },
  {
    step: "DISCO_NOSHOW_CALL_2",
    sopStep: "L2 · no-show",
    label: "No-show - call attempt 2",
    channel: "CALL",
    anchor: "IMMEDIATE",
    slaKey: null,
  },
  {
    step: "DISCO_NOSHOW_MSG",
    sopStep: "L2 · no-show",
    label: "No-show - WhatsApp",
    channel: "WHATSAPP",
    anchor: "IMMEDIATE",
    slaKey: null,
    body: TPL_DISCO_NOSHOW,
  },
  {
    step: "SSS_CONFIRM_1",
    sopStep: "Step 19",
    label: "SSS confirmation 1 (+ video)",
    channel: "WHATSAPP",
    anchor: "BEFORE_SSS",
    slaKey: "sssConfirm1LeadHours",
    body: TPL_SSS_CONFIRM_1,
  },
  {
    step: "SSS_CONFIRM_2",
    sopStep: "Step 20",
    label: "SSS confirmation 2",
    channel: "WHATSAPP",
    anchor: "BEFORE_SSS",
    slaKey: "sssConfirm2LeadHours",
    body: TPL_SSS_CONFIRM_2,
    needsZoom: true,
  },
  {
    step: "SSS_CONFIRM_3",
    sopStep: "Step 20b",
    label: "SSS confirmation 3",
    channel: "WHATSAPP",
    anchor: "BEFORE_SSS",
    slaKey: "sssConfirm3LeadHours",
    body: TPL_SSS_CONFIRM_2,
  },
  {
    step: "SSS_CONFIRM_CALL",
    sopStep: "Step 20c",
    label: "SSS confirmation call",
    channel: "CALL",
    anchor: "BEFORE_SSS",
    slaKey: "sssConfirmCallLeadHours",
  },
  {
    step: "SSS_CANCEL_MSG",
    sopStep: "Step 21",
    label: "SSS cancellation message",
    channel: "WHATSAPP",
    anchor: "BEFORE_SSS",
    slaKey: "sssCancelLeadHours",
    body: TPL_SSS_CANCEL,
  },
  {
    step: "SSS_CANCEL",
    sopStep: "Step 22/23",
    label: "Cancel SSS + mark RED",
    channel: "SYSTEM",
    anchor: "IMMEDIATE",
    slaKey: null,
  },
];

export const STEP_BY_KEY: Record<OutreachStep, OutreachStepDef> = Object.fromEntries(
  OUTREACH_STEPS.map((s) => [s.step, s]),
) as Record<OutreachStep, OutreachStepDef>;

export function stepBody(step: OutreachStep): string | null {
  return STEP_BY_KEY[step]?.body ?? null;
}

// ─────────────────────────────── Config ───────────────────────────────

/**
 * Every SLA window the SOP names, in hours (minutes for the reaction time). Checklist §S requires
 * these be configurable rather than hardcoded "so SLAs can be tuned" - they are persisted in
 * AppSetting("outreachConfig") and these are only the defaults.
 */
export type OutreachSla = {
  /** Step 2 - contact within this many minutes of opt-in, or the SOP skips to Step 10. */
  reactionMinutes: number;
  /** Step 5 - wait this long after the intro, then check the booking. */
  check1Hours: number;
  /** Step 7 - wait this long after the Step 6 follow-up. */
  check2Hours: number;
  /** Step 9 - wait this long after the Step 8 call. */
  /** Step 7c - the third booking check, measured from opt-in. */
  check3Hours: number;
  finalCheckHours: number;
  /** Step 14 - send at least this many hours before the disco call. */
  discoConfirm1LeadHours: number;
  /** Step 15 - send at least this many hours before the disco call. */
  discoConfirm2LeadHours: number;
  /** Step 16 - cancellation message at least this many hours before. */
  discoCancelLeadHours: number;
  /** Step 19 - send at least this many hours before the SSS call. */
  sssConfirm1LeadHours: number;
  /** Step 20 - send at least this many hours before the SSS call. */
  sssConfirm2LeadHours: number;
  /** Step 20b - the third SSS confirmation, this many hours before the call. */
  sssConfirm3LeadHours: number;
  /** Step 20c - the specialist rings to confirm, this many hours before the call. */
  sssConfirmCallLeadHours: number;
  /** Step 21 - cancellation message at least this many hours before. */
  sssCancelLeadHours: number;
  /**
   * Step 16 - how many hours before the disco call the telecaller's two confirmation attempts
   * are raised. Previously these rode on `discoConfirm2LeadHours`, which meant the calls were
   * scheduled at the same moment as the 24h reminder rather than in their own window.
   */
  discoConfirmCallLeadHours: number;
  /**
   * Steps 13/13c - how long after a booking is matched the qualification outcome is acted on.
   * A short delay, not zero: BANT is scored the instant the booking lands, and messaging someone
   * in the same second they finished the form reads as a machine. Expressed in MINUTES because
   * that is the scale it operates at.
   */
  postBookingDelayMinutes: number;
  /**
   * How many hours AFTER a discovery call's start time the engine writes it off when nobody
   * confirmed and nobody recorded an outcome.
   *
   * Every other window in the disco ladder is measured BEFORE the call. Nothing was measured
   * after it, so a prospect who never confirmed simply sat in "Discovery Call Booked" once their
   * slot had come and gone - the board kept counting a call that never happened. This is the
   * sweep that closes them.
   *
   * A grace period, not a deadline: the call may be running late, or the specialist may not have
   * logged the outcome yet, and writing someone off mid-conversation would be worse than waiting.
   */
  noShowSweepHours: number;
};

export const DEFAULT_SLA: OutreachSla = {
  reactionMinutes: 5,
  check1Hours: 2,
  /**
   * Check 2 and the final check are measured from OPT-IN (see `planJourney`), so these two
   * defaults are RE-EXPRESSED in that anchor rather than changed in effect. The SOP's ladder is
   * intro → 2h → check 1 → follow-up → 1h → check 2 → call → 2h → final check, which from opt-in
   * is the 3h and 5h below. Leaving them at 1 and 2 after the anchor moved would have quietly
   * turned the documented process into a much tighter one.
   */
  check2Hours: 3,
  // The SOP has no third check - it goes straight from Step 7 to the call. This default keeps
  // that shape by sitting between check 2 and the final check; the founder's own cadence
  // (3 hours) is set in settings.
  check3Hours: 4,
  finalCheckHours: 5,
  discoConfirm1LeadHours: 36,
  discoConfirm2LeadHours: 24,
  discoCancelLeadHours: 12,
  sssConfirm1LeadHours: 24,
  sssConfirm2LeadHours: 12,
  sssConfirm3LeadHours: 6,
  sssConfirmCallLeadHours: 3,
  /**
   * Was 10, which predates the 6h and 3h rungs and would have put the cancellation BEFORE the
   * call that is supposed to save it. It has to sit after the 3-hour attempt.
   */
  sssCancelLeadHours: 2,
  discoConfirmCallLeadHours: 12,
  postBookingDelayMinutes: 5,
  noShowSweepHours: 2,
};

export type OutreachConfig = {
  /** Master switch. Off → the engine materialises nothing and the cron is a no-op. */
  enabled: boolean;
  /**
   * Per-step auto-send. EVERY step defaults to false: the SOP is human-executed, and an
   * unattended send to a real prospect is not something to opt people into by accident. A step
   * that is not auto-send still becomes DUE - it just waits for the specialist to act.
   *
   * Auto-send additionally requires the WATI layer to be live AND a template mapped for the step;
   * otherwise the engine leaves the row DUE and says why (see server/outreach.ts).
   */
  autoSend: Partial<Record<OutreachStep, boolean>>;
  sla: OutreachSla;
  /** Fallback for `[Your Name]` when a step has no assigned specialist. */
  defaultSpecialistName: string;
  /** Safety cap: the most steps one engine run will materialise or auto-send. */
  maxPerRun: number;
  /**
   * Never advance a journey whose opt-in is older than this many days.
   *
   * The active-journey query filtered only on phase, so every non-terminal journey ever created
   * qualified and `orderBy: updatedAt asc` walked from the oldest. Arming the engine therefore
   * reached back through the whole historical import - the same shape of bug as the discovery
   * reminder's missing floor (see `discoMaxAgeDays`), and it fired on the same day.
   *
   * A journey past the cut-off is simply not picked up; nothing is cancelled or rewritten, so
   * widening the window again brings them back exactly as they were.
   */
  maxAgeDays: number;
  /**
   * WHEN the first telecaller call is raised.
   *
   * `"immediate"` - the SOP as written. Step 4 follows Step 3 unconditionally: the intro goes out
   * and a caller rings straight away, whether or not the prospect has had a chance to book.
   *
   * `"after_check"` - the caller is only pulled in once a booking check has come back NOT_BOOKED.
   * The intro gets its `check1Hours` window to work on its own, and a human is spent only on the
   * prospects who did not act on it.
   *
   * The default stays `"immediate"` because that is the process B2 actually wrote down, and the
   * ladder here is a transcription of it. Switching to `"after_check"` is a real change to how the
   * team works, so it is an explicit, reversible choice rather than something a code change
   * decided for them - and it only becomes sensible once the intro is auto-sending, since
   * otherwise nothing happens until a human sends the message anyway.
   */
  firstCallMode: "immediate" | "after_check";
  /**
   * Send Step 3 the INSTANT a lead is captured, rather than on the next engine tick.
   *
   * Separate from `autoSend.INTRO_WHATSAPP`, and the two compose deliberately. This one fires
   * inline at capture - seconds, not up to a cron interval - which is what the SOP's 5-minute
   * reaction window actually asks for. `autoSend` remains the cron path, so a lead whose instant
   * send was skipped (WATI briefly down, hourly cap reached) is retried by the engine instead of
   * being stranded.
   */
  instantIntro: {
    enabled: boolean;
    /**
     * Hard ceiling on instant intros in any rolling hour.
     *
     * A circuit breaker, not a throttle for normal traffic - B2's real intake is a few dozen a
     * day. It exists for the failure that would otherwise be unrecoverable: a webhook stuck in a
     * retry loop, or a bulk import routed through a capture endpoint, messaging thousands of real
     * people before anyone noticed. On reaching the cap the engine stops sending and leaves the
     * steps DUE, so nothing is lost - a human just picks them up.
     */
    maxPerHour: number;
  };
};

export const DEFAULT_OUTREACH_CONFIG: OutreachConfig = {
  enabled: false,
  autoSend: {},
  sla: DEFAULT_SLA,
  defaultSpecialistName: "B2 Consultants",
  maxPerRun: 200,
  // Matches the WhatsApp cadence's 30-day floor. The two engines chase the same people; a
  // prospect who is too cold for one is too cold for the other.
  maxAgeDays: 30,
  firstCallMode: "immediate",
  instantIntro: { enabled: false, maxPerHour: 200 },
};

/** Coerce stored JSON into a config, filling every gap with a default. Never throws. */
export function coerceOutreachConfig(raw: unknown): OutreachConfig {
  const v = (raw ?? {}) as Partial<OutreachConfig>;
  const sla = { ...DEFAULT_SLA, ...(v.sla ?? {}) };
  /**
   * A zero or negative WINDOW would make a step permanently due - clamp to something sane.
   *
   * `postBookingDelayMinutes` is the one exception, and it is a real one: it is a deliberate
   * pause, not a window, and 0 is a meaningful value meaning "send immediately", which is what
   * the SOP itself specifies. Clamping it like the rest would take a founder who typed 0 and
   * silently give them 5 minutes - the settings screen showing one number while the engine used
   * another, which is the exact failure the rest of this validation exists to prevent.
   */
  const ALLOWS_ZERO: ReadonlySet<keyof OutreachSla> = new Set(["postBookingDelayMinutes"]);
  for (const k of Object.keys(sla) as (keyof OutreachSla)[]) {
    const n = Number(sla[k]);
    const floorOk = ALLOWS_ZERO.has(k) ? n >= 0 : n > 0;
    sla[k] = Number.isFinite(n) && floorOk ? n : DEFAULT_SLA[k];
  }
  return {
    enabled: v.enabled === true,
    autoSend: typeof v.autoSend === "object" && v.autoSend ? v.autoSend : {},
    sla,
    defaultSpecialistName: v.defaultSpecialistName?.trim() || DEFAULT_OUTREACH_CONFIG.defaultSpecialistName,
    maxPerRun: Number.isFinite(Number(v.maxPerRun)) && Number(v.maxPerRun) > 0 ? Number(v.maxPerRun) : 200,
    maxAgeDays:
      Number.isFinite(Number(v.maxAgeDays)) && Number(v.maxAgeDays) > 0
        ? Number(v.maxAgeDays)
        : DEFAULT_OUTREACH_CONFIG.maxAgeDays,
    // Fail-closed to the SOP as written: only the exact string opts out of Step 4, so a typo or a
    // half-written config row leaves the documented process running rather than silently
    // suppressing the team's first call.
    firstCallMode: v.firstCallMode === "after_check" ? "after_check" : "immediate",
    instantIntro: {
      // Fail-closed, like `enabled`: only an explicit `true` arms unattended messaging.
      enabled: v.instantIntro?.enabled === true,
      // A missing, zero or negative cap must NOT mean "unlimited" - that is the one misreading
      // that turns a safety valve into the thing it was meant to prevent.
      maxPerHour:
        Number.isFinite(Number(v.instantIntro?.maxPerHour)) && Number(v.instantIntro?.maxPerHour) > 0
          ? Math.floor(Number(v.instantIntro!.maxPerHour))
          : DEFAULT_OUTREACH_CONFIG.instantIntro.maxPerHour,
    },
  };
}

/**
 * The only lead provenances that may trigger an UNATTENDED WhatsApp at capture.
 *
 * A whitelist, not a blacklist, and that direction is the whole safety property: an import path,
 * a backfill script or a seeding tool added later is silently EXCLUDED until someone deliberately
 * adds it here. A blacklist has the opposite default and would eventually be wrong exactly once -
 * expensively, and to thousands of real people at the same moment.
 *
 * Concretely, this is what stands between the instant intro and the 23,500 leads already in the
 * table: they arrived as `SYNAMATE`/`SHEET` imports, and no amount of switching the feature on can
 * reach them.
 *
 * `BOOKING_FORM` is absent on purpose - that person has already booked, so inviting them to book
 * is nonsense.
 *
 * Kept HERE, in the pure module, rather than beside the sender: it is the rule most worth having a
 * test on, and `server/outreach-instant.ts` imports `server-only`, which cannot be loaded from a
 * test runner.
 */
/**
 * `NATIVE_FORM` stays OUT even though the public opt-in is a genuine live capture: the same
 * source is also stamped by workshop registration (server/workshop-registrations.ts) and the
 * intake API, so admitting it here would auto-message every workshop registrant as a side effect.
 * A per-form WhatsApp step on the FORM_SUBMITTED workflow is the scoped way to message one
 * specific form's opt-ins - see the SEND_WHATSAPP action in lib/automation-types.ts.
 */
export const INSTANT_INTRO_SOURCES = ["PABBLY", "FLEXIFUNNELS", "META_LEAD_AD"] as const;

export function isInstantIntroSource(source: string): boolean {
  return (INSTANT_INTRO_SOURCES as readonly string[]).includes(source);
}

// ─────────────────────────────── BANT → Qualified ───────────────────────────────

/**
 * The SOP's "Qualified" column, derived from the BANT score. Single source of truth for the
 * mapping the document states on its final page:
 *
 *   Qualified      → "YES"
 *   Cannot Judge   → "MAYBE"
 *   Not Qualified  → "NO"
 *
 * The thresholds are Ameen's, already implemented for `BantVerdict` in `src/lib/booking-intake.ts`
 * (>3 confirm · 2–3 doubt · <2 cancel). We reuse those exact boundaries rather than inventing a
 * second scale, so "Qualified" and "BANT verdict" can never disagree - they are the same decision
 * under the SOP's names and the CRM's names.
 */
export function qualifiedFromBant(bantAvg: number | null | undefined): QualifiedVerdict | null {
  if (bantAvg == null || !Number.isFinite(bantAvg)) return null;
  if (bantAvg > 3) return "YES";
  if (bantAvg >= 2) return "MAYBE";
  return "NO";
}

/** YES and MAYBE both continue to Step 13; only NO diverts to Step 17. */
export function qualifiedContinues(q: QualifiedVerdict | null): boolean {
  return q === "YES" || q === "MAYBE";
}

export const QUALIFIED_LABELS: Record<QualifiedVerdict, string> = {
  YES: "Qualified",
  MAYBE: "Cannot judge",
  NO: "Not qualified",
};

export const OUTREACH_PHASE_LABELS: Record<string, string> = {
  OPT_IN: "Opted in",
  BOOKING_CHASE: "Chasing booking",
  QUALIFICATION: "Awaiting qualification",
  DISCO_CONFIRMATION: "Confirming disco",
  AWAITING_DISCO: "Disco confirmed",
  HANDOFF: "Awaiting HQ verdict",
  SSS_CONFIRMATION: "Confirming SSS",
  COMPLETED: "Completed",
  IGNORED: "Ignored (dormant)",
  CANCELLED: "Cancelled",
  CLOSED_NOT_HQ: "Closed - not highly qualified",
};

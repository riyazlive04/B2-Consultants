/**
 * Outreach Specialist SOP — the written process, as data.
 *
 * Source of truth: `Script for Outreach Specialist.docx`, Steps 1–23. The message bodies below are
 * transcribed VERBATIM from that document — including its curly apostrophes (’), its emoji, its
 * `*bold*` WhatsApp markers, its `<<INSERT ZOOM LINK HERE>>` placeholders, and its trailing
 * spaces. The QA checklist (§S) requires a character-diff against the SOP to pass, so DO NOT
 * "tidy" this text: straightening a quote or trimming a line is a real regression.
 *
 * Isomorphic — no prisma, no server-only, no secrets. The settings UI, the queue UI and the
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
 * Note `[Prospect’s First Name]` uses U+2019, not an ASCII apostrophe — matching the document.
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
 * Deliberately NOT a regex over `\[.*?\]` — the templates contain literal brackets we must not
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
 * — an empty variable renders a broken message ("Hi ,") and burns the prospect's trust.
 */
export function unresolvedVars(rendered: string): OutreachVar[] {
  return OUTREACH_VARS.filter((v) => rendered.includes(v));
}

// ─────────────────────────────── Templates (VERBATIM) ───────────────────────────────

/** Step 3 — Outreach WhatsApp Message: Introduction. */
const TPL_INTRO = `Hi [Prospect’s First Name]
[Your Name] here from B2 Consultants.

Thanks for showing interest in finding your next job in Germany 🇩🇪

To help you further, we would like to invite you to book a 20 min *FREE* Personalized Discovery Call to understand your requirements and current situation.

Please use this link to book a *FREE* Personalized Discovery Call with our team here: https://optin.b2consultants.de/apply

If you have questions about our coaching program, I request you to watch this short video where Ameen explains 3 mistakes that people usually make, as well as 3 secrets to overcome them: https://optin.b2consultants.de/lang

I’ll give you a quick call now to help you get booked!`;

/** Step 6 — Outreach WhatsApp Message: Call Not Booked. */
const TPL_FOLLOWUP = `Hey [Prospect’s First Name], [Your Name] here from B2 Consultants.
Just wanted to follow up - I saw you haven’t booked the *FREE* Personalized Discovery Call with our team yet.
We only have a few spots available coming week, and we don’t want you to miss this window.

Please use the link to book a call directly with our team: https://optin.b2consultants.de/apply

Do let me know if you need assistance. `;

/** Step 13 — Disco Welcome WhatsApp 1. */
const TPL_DISCO_WELCOME = `Hi [Prospect’s First Name], this is [Your Name] from B2 Consultants

I saw you booked a Personalized Discovery Call with our team on *[DATE]* at *[TIME]* IST.

The team is preparing for your call and will get back to you if we need more information on further steps.

Meanwhile, you can visit our case studies page to understand more about what our students have to say about us: https://casestudies.b2consultants.de/casestudies

See you soon!`;

/** Step 14 — Disco Confirmation WhatsApp 2 (≥36h before). */
const TPL_DISCO_CONFIRM_1 = `Hi [Prospect’s First Name], just a quick reminder about your upcoming *Personalized Discovery Call* with us to discuss about the possibilities of your next job in Germany.

During this 20-minute session our team will understand your current situation and help you figure out your next best steps.

You can use this link to join the call directly: <<INSERT ZOOM LINK HERE>>

Just to double-check - are you still good for *[DATE]* at *[TIME]*?

Please reply *YES* to confirm your participation.

Looking forward to seeing you there!`;

/** Step 15 — Disco Confirmation WhatsApp 3 (≥24h before, only if Step 14 got no reply). */
const TPL_DISCO_CONFIRM_2 = `Just checking in again, [Prospect’s First Name] - are you joining the *FREE* Personalized Discovery Call with our team on *[DATE]* at *[TIME]*?

<<INSERT ZOOM LINK HERE>>

Please reply *YES* to confirm your participation. `;

/** Step 16 — Disco Confirmation WhatsApp 4 / cancellation (≥12h before, after two calls). */
const TPL_DISCO_CANCEL = `Hey [Prospect’s First Name], since we didn’t receive your confirmation, we had to *CANCEL* your Personalized Discovery Call slot and release it for another candidate.
No worries - if you're still interested, please use the link below to book a call at your convenience.
Use this link to book a call: https://optin.b2consultants.de/apply

Wishing you the best. `;

/** Step 19 — SSS Call Confirmation WhatsApp 1 (≥24h before; carries the personalized video). */
const TPL_SSS_CONFIRM_1 = `Hey [Prospect’s First Name], this is [Your Name] from B2 Consultants

Ameen asked me to send you this quick video he made just for you

After your Personalized Discovery Call, he has created a personalized game plan based on your profile and goals.

Before presenting it to you in the next call, Ameen would love to clarify a couple more things so he can make this as tailored as possible for you.

Your Success Strategy Session is scheduled for *[DATE]* at *[TIME]*

And just to be sure, are you available at this time?

Please reply *YES* to confirm.

We’re excited to help you take the next step in your career.

 << ATTACH VIDEO TO THIS MESSAGE>>`;

/** Step 20 — SSS Call Confirmation WhatsApp 2 (≥12h before). */
const TPL_SSS_CONFIRM_2 = `Just checking in again, [Prospect’s First Name] — are you joining the Success Strategy Session with Ameen on *[DATE]* at *[TIME]*?

He’s prepared something very specific for your profile and would love to see you there.

<<INSERT ZOOM LINK HERE>>`;

/** Step 21 — SSS Call Cancellation WhatsApp 3 (≥10h before). */
const TPL_SSS_CANCEL = `Hey [Prospect’s First Name], since we didn’t receive your confirmation, we had to release your Success Strategy Session slot for another candidate.

No worries - if you're still interested, just let us know and we’ll try to find another time or please use the link below to book a call at your convenience.
Book a call with Ameen to finalise your plan: https://optin.b2consultants.de/sss`;

// ─────────────────────────────── Call scripts (Steps 4, 8, 16) ───────────────────────────────

/**
 * The SOP's call scripts, as branching data rather than prose — checklist §D requires the Yes/No
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
      "YOU: Hi, [Prospect’s First Name]. this is [Your Name] from B2 Consultants — I just sent you a WhatsApp message (►), did you get a chance to see it? (▼)",
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
        // Step 8's NO branch is terminal — the SOP ends this lead's active follow-up cycle here
        // (checklist §H). The engine honours that by moving the journey to IGNORED.
        label: "Not interested (NO) — ends the follow-up cycle",
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
      "I’m calling about your upcoming Personalized Discovery Call — we haven’t received your confirmation yet.",
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
 *  - `IMMEDIATE`      — due the moment its precondition is met (Steps 3, 13).
 *  - `AFTER_PREV`     — due N hours after the previous step was acted on (Steps 5, 7, 9).
 *  - `BEFORE_DISCO`   — due N hours BEFORE the discovery appointment (Steps 14, 15, 16).
 *  - `BEFORE_SSS`     — due N hours BEFORE the SSS appointment (Steps 19, 20, 21).
 */
export type StepAnchor = "IMMEDIATE" | "AFTER_PREV" | "BEFORE_DISCO" | "BEFORE_SSS";

export type OutreachStepDef = {
  step: OutreachStep;
  /** The SOP step number(s) this implements — shown in the UI so the specialist can cross-refer. */
  sopStep: string;
  label: string;
  channel: OutreachChannel;
  anchor: StepAnchor;
  /** Which SLA key drives this step's offset. Null for IMMEDIATE steps. */
  slaKey: keyof OutreachSla | null;
  /** The step this one waits on, for AFTER_PREV anchoring. */
  after?: OutreachStep;
  body?: string;
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
    label: "Check 1 — booked?",
    channel: "SYSTEM",
    anchor: "AFTER_PREV",
    slaKey: "check1Hours",
    after: "INTRO_WHATSAPP",
  },
  {
    step: "FOLLOWUP_WHATSAPP",
    sopStep: "Step 6",
    label: "WhatsApp follow-up — not booked",
    channel: "WHATSAPP",
    anchor: "IMMEDIATE",
    slaKey: null,
    body: TPL_FOLLOWUP,
  },
  {
    step: "CHECK_2",
    sopStep: "Step 7 → 10",
    label: "Check 2 — booked?",
    channel: "SYSTEM",
    anchor: "AFTER_PREV",
    slaKey: "check2Hours",
    after: "FOLLOWUP_WHATSAPP",
  },
  {
    step: "FOLLOWUP_CALL",
    sopStep: "Step 8",
    label: "Call follow-up — not booked",
    channel: "CALL",
    anchor: "IMMEDIATE",
    slaKey: null,
  },
  {
    step: "FINAL_CHECK",
    sopStep: "Step 9 → 10",
    label: "Final check — booked?",
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
    slaKey: "discoConfirm2LeadHours",
  },
  {
    step: "DISCO_CONFIRM_CALL_2",
    sopStep: "Step 16",
    label: "Disco confirmation call 2 of 2",
    channel: "CALL",
    anchor: "BEFORE_DISCO",
    slaKey: "discoConfirm2LeadHours",
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
    step: "DISCO_CANCEL",
    sopStep: "Step 17/18",
    label: "Cancel disco + mark RED",
    channel: "SYSTEM",
    anchor: "IMMEDIATE",
    slaKey: null,
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
 * these be configurable rather than hardcoded "so SLAs can be tuned" — they are persisted in
 * AppSetting("outreachConfig") and these are only the defaults.
 */
export type OutreachSla = {
  /** Step 2 — contact within this many minutes of opt-in, or the SOP skips to Step 10. */
  reactionMinutes: number;
  /** Step 5 — wait this long after the intro, then check the booking. */
  check1Hours: number;
  /** Step 7 — wait this long after the Step 6 follow-up. */
  check2Hours: number;
  /** Step 9 — wait this long after the Step 8 call. */
  finalCheckHours: number;
  /** Step 14 — send at least this many hours before the disco call. */
  discoConfirm1LeadHours: number;
  /** Step 15 — send at least this many hours before the disco call. */
  discoConfirm2LeadHours: number;
  /** Step 16 — cancellation message at least this many hours before. */
  discoCancelLeadHours: number;
  /** Step 19 — send at least this many hours before the SSS call. */
  sssConfirm1LeadHours: number;
  /** Step 20 — send at least this many hours before the SSS call. */
  sssConfirm2LeadHours: number;
  /** Step 21 — cancellation message at least this many hours before. */
  sssCancelLeadHours: number;
};

export const DEFAULT_SLA: OutreachSla = {
  reactionMinutes: 5,
  check1Hours: 2,
  check2Hours: 1,
  finalCheckHours: 2,
  discoConfirm1LeadHours: 36,
  discoConfirm2LeadHours: 24,
  discoCancelLeadHours: 12,
  sssConfirm1LeadHours: 24,
  sssConfirm2LeadHours: 12,
  sssCancelLeadHours: 10,
};

export type OutreachConfig = {
  /** Master switch. Off → the engine materialises nothing and the cron is a no-op. */
  enabled: boolean;
  /**
   * Per-step auto-send. EVERY step defaults to false: the SOP is human-executed, and an
   * unattended send to a real prospect is not something to opt people into by accident. A step
   * that is not auto-send still becomes DUE — it just waits for the specialist to act.
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
};

export const DEFAULT_OUTREACH_CONFIG: OutreachConfig = {
  enabled: false,
  autoSend: {},
  sla: DEFAULT_SLA,
  defaultSpecialistName: "B2 Consultants",
  maxPerRun: 200,
};

/** Coerce stored JSON into a config, filling every gap with a default. Never throws. */
export function coerceOutreachConfig(raw: unknown): OutreachConfig {
  const v = (raw ?? {}) as Partial<OutreachConfig>;
  const sla = { ...DEFAULT_SLA, ...(v.sla ?? {}) };
  // A zero or negative window would make a step permanently due — clamp to something sane.
  for (const k of Object.keys(sla) as (keyof OutreachSla)[]) {
    const n = Number(sla[k]);
    sla[k] = Number.isFinite(n) && n > 0 ? n : DEFAULT_SLA[k];
  }
  return {
    enabled: v.enabled === true,
    autoSend: typeof v.autoSend === "object" && v.autoSend ? v.autoSend : {},
    sla,
    defaultSpecialistName: v.defaultSpecialistName?.trim() || DEFAULT_OUTREACH_CONFIG.defaultSpecialistName,
    maxPerRun: Number.isFinite(Number(v.maxPerRun)) && Number(v.maxPerRun) > 0 ? Number(v.maxPerRun) : 200,
  };
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
 * second scale, so "Qualified" and "BANT verdict" can never disagree — they are the same decision
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
  CLOSED_NOT_HQ: "Closed — not highly qualified",
};

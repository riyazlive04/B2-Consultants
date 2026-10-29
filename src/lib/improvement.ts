/**
 * IMPROVEMENT REPORTING - the whole contract, in one isomorphic file.
 *
 * Pure, no prisma, no `server-only`: the modal (client) renders the questions from here and the
 * submit action (server) validates against the very same definitions. That is the point. A form
 * that asks three questions and a server that accepts five is how a report arrives with the one
 * field nobody filled in, and this app has already paid for two-definitions-of-one-thing twice
 * (`lib/income-form.ts`, where a blank business had two spellings, and `lib/engines.ts`, where the
 * Console and the on-screen notice had to be made to read one registry).
 *
 * ── WHY SEVEN KINDS AND NOT ONE BOX ────────────────────────────────────────────────────────
 * A single "describe your problem" field produces "doesn't work". What makes a report actionable
 * differs completely by kind: a broken screen needs the steps, a wrong number needs the OTHER
 * number, a rule change needs the reason, a feature needs who it is for. So the kind is picked
 * first and it chooses the questions (`QUESTIONS` below).
 *
 * The seven are not invented. Each one is a class of problem this repo demonstrably produces -
 * see docs/IMPROVEMENTS_MODULE_PLAN.md §1.1, which derives them from the 14-26 Oct audit
 * rounds:
 *
 *   NOT_WORKING    a flow that ends nowhere, a screen that throws        (A1-A8, W2)
 *   WRONG_RESULT   two places answering one question differently         (W1, seat-count bug)
 *   LOGIC_CHANGE   the rule is wrong for the business, not broken
 *   MISSING_STATE  the thing that happened has nowhere to be recorded    (C1-C6)
 *   NEW_FEATURE    a capability that does not exist
 *   CONFUSING      the screen cannot be acted on                         (the 20 dead ends)
 *   ACCESS         permission, a blocked page, a missing section          (A7, B3, B7)
 *
 * KIND IS THE REPORTER'S OPINION, NOT A CLASSIFICATION. Triage may re-kind a report, and that
 * re-kinding is recorded as an `ImprovementEvent` - which is what makes the accuracy of this picker
 * measurable instead of a matter of taste.
 */

import { z } from "zod";

// ─────────────────────────────── kinds ───────────────────────────────

export const IMPROVEMENT_KINDS = [
  "NOT_WORKING",
  "WRONG_RESULT",
  "LOGIC_CHANGE",
  "MISSING_STATE",
  "NEW_FEATURE",
  "CONFUSING",
  "ACCESS",
] as const;
export type ImprovementKind = (typeof IMPROVEMENT_KINDS)[number];

export const IMPROVEMENT_SEVERITIES = ["BLOCKING", "ANNOYING", "MINOR"] as const;
export type ImprovementSeverity = (typeof IMPROVEMENT_SEVERITIES)[number];

export const IMPROVEMENT_STATUSES = [
  "NEW",
  "TRIAGED",
  "ACCEPTED",
  "IN_PROGRESS",
  "FIXED",
  "CLOSED",
  "DECLINED",
  "DUPLICATE",
] as const;
export type ImprovementStatus = (typeof IMPROVEMENT_STATUSES)[number];

export type ImprovementKindDef = {
  key: ImprovementKind;
  /** What the reporter picks. Their words, not ours - "Something is broken", not "Defect". */
  label: string;
  /** The one line under it that makes the choice obvious without a manual. */
  hint: string;
};

export const IMPROVEMENT_KIND_DEFS: readonly ImprovementKindDef[] = [
  {
    key: "NOT_WORKING",
    label: "Something is broken",
    hint: "It errored, or nothing happened when I did it",
  },
  {
    key: "WRONG_RESULT",
    label: "A number or result looks wrong",
    hint: "The figure, list or status here does not match what I expect",
  },
  {
    key: "LOGIC_CHANGE",
    label: "The rule should work differently",
    hint: "It does what it was built to do; the rule itself is wrong for us",
  },
  {
    key: "MISSING_STATE",
    label: "There is no way to record this",
    hint: "The thing that happened has no option on this screen",
  },
  {
    key: "NEW_FEATURE",
    label: "This section needs something new",
    hint: "A capability that does not exist yet",
  },
  {
    key: "CONFUSING",
    label: "I cannot tell what to do here",
    hint: "The screen is unclear, or tells me to do something I cannot find",
  },
  {
    key: "ACCESS",
    label: "I cannot see or open something",
    hint: "Permission, a blocked page, or a missing section",
  },
] as const;

export function improvementKindLabel(kind: ImprovementKind): string {
  return IMPROVEMENT_KIND_DEFS.find((k) => k.key === kind)?.label ?? kind;
}

/** Short label for a table cell or a chip, where the sentence-length one will not fit. */
export const IMPROVEMENT_KIND_SHORT: Record<ImprovementKind, string> = {
  NOT_WORKING: "Broken",
  WRONG_RESULT: "Wrong result",
  LOGIC_CHANGE: "Rule change",
  MISSING_STATE: "Missing state",
  NEW_FEATURE: "New feature",
  CONFUSING: "Unclear",
  ACCESS: "Access",
};

// ─────────────────────────────── the questions ───────────────────────────────

export type ImprovementQuestion = {
  /** Stable key in `answers`. Renaming one orphans old reports, so these do not get renamed. */
  id: string;
  label: string;
  placeholder?: string;
  required?: boolean;
  /** A textarea rather than a single line. */
  multiline?: boolean;
  /** A fixed set of answers instead of free text. */
  options?: readonly { value: string; label: string }[];
};

const REPRO_OPTIONS = [
  { value: "always", label: "Every time" },
  { value: "sometimes", label: "Sometimes" },
  { value: "once", label: "Just once so far" },
] as const;

const FREQUENCY_OPTIONS = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "rarely", label: "Rarely" },
] as const;

/**
 * What each kind asks. 2-4 questions, and never more - a seven-field form gets abandoned, and an
 * abandoned report is worth less than a one-line one.
 *
 * The REQUIRED ones are chosen as the minimum from which a developer can start work without a
 * follow-up conversation. Everything else is optional, because a reporter who cannot answer an
 * optional question still files the report.
 */
export const QUESTIONS: Record<ImprovementKind, readonly ImprovementQuestion[]> = {
  NOT_WORKING: [
    {
      id: "doing",
      label: "What were you doing?",
      placeholder: "I pressed Save on the second payment for this student",
      required: true,
      multiline: true,
    },
    {
      id: "happened",
      label: "What happened?",
      placeholder: "The level list went empty and it printed the word null",
      required: true,
      multiline: true,
    },
    { id: "expected", label: "What did you expect instead?", multiline: true },
    // The single field that most often decides whether a bug can be chased at all.
    { id: "repro", label: "Does it happen every time?", options: REPRO_OPTIONS },
  ],
  WRONG_RESULT: [
    {
      id: "shows",
      label: "What does it show?",
      placeholder: "Paid so far: 0",
      required: true,
    },
    {
      id: "should",
      label: "What should it show?",
      placeholder: "99,500 - that payment is on the student's record",
      required: true,
    },
    // Names the second site. Two screens disagreeing over one figure is the commonest real bug
    // in this codebase, and this question halves the hunt for it.
    {
      id: "rightPlace",
      label: "Where are you seeing the right number?",
      placeholder: "The panel at the top of the same page",
    },
  ],
  LOGIC_CHANGE: [
    {
      id: "ruleNow",
      label: "What is the rule now?",
      placeholder: "Any student can be seated in any cohort of their level",
      required: true,
      multiline: true,
    },
    {
      id: "ruleWanted",
      label: "What should the rule be?",
      required: true,
      multiline: true,
    },
    // No "why", no judgement. The deliberately-not-fixed list in the refactor changelog is
    // entirely made of rules nobody could judge without this answer.
    {
      id: "why",
      label: "Why - what goes wrong with the rule as it is?",
      required: true,
      multiline: true,
    },
    { id: "affects", label: "Who else does this affect?" },
  ],
  MISSING_STATE: [
    {
      id: "happened",
      label: "What happened in real life?",
      placeholder: "The student's payment bounced a week after we recorded it",
      required: true,
      multiline: true,
    },
    {
      id: "where",
      label: "Where would you expect to record it?",
      required: true,
      multiline: true,
    },
    // This is how you find out the workaround is corrupting data.
    { id: "insteadToday", label: "What do you do instead today?", multiline: true },
  ],
  NEW_FEATURE: [
    { id: "what", label: "What should it do?", required: true, multiline: true },
    { id: "who", label: "Who is it for?", placeholder: "Telecallers, every morning", required: true },
    {
      id: "insteadToday",
      label: "What do you do today instead?",
      required: true,
      multiline: true,
    },
    { id: "frequency", label: "How often would you use it?", options: FREQUENCY_OPTIONS },
  ],
  CONFUSING: [
    // The reporter's expectation IS the finding here - that is what a dead end is.
    {
      id: "expected",
      label: "What did you expect this screen to do?",
      required: true,
      multiline: true,
    },
    { id: "clearer", label: "What would make it clear?", multiline: true },
  ],
  ACCESS: [
    { id: "tryingToOpen", label: "What were you trying to open?", required: true },
    {
      id: "said",
      label: "What did it say?",
      placeholder: "You don't have access to this section",
      required: true,
    },
    { id: "whoSaid", label: "Who told you you should have it?" },
  ],
};

export function questionsFor(kind: ImprovementKind): readonly ImprovementQuestion[] {
  return QUESTIONS[kind];
}

/** The question label, for rendering a stored answer back on the triage screen. */
export function questionLabel(kind: ImprovementKind, id: string): string {
  return QUESTIONS[kind].find((q) => q.id === id)?.label ?? id;
}

/** A stored choice value, in words. `always` on its own means nothing to a reader. */
export function answerDisplay(kind: ImprovementKind, id: string, value: string): string {
  const q = QUESTIONS[kind].find((x) => x.id === id);
  return q?.options?.find((o) => o.value === value)?.label ?? value;
}

// ─────────────────────────────── validation ───────────────────────────────

/** Per-answer cap. Generous for a textarea, far short of someone pasting a log file. */
export const ANSWER_MAX = 2000;
export const TITLE_MAX = 160;

/**
 * The validator for one kind's answers, built from the SAME table the form renders.
 *
 * Returns a schema over `Record<string, string>`: every required question must carry at least two
 * characters, every optional one may be absent or blank, a choice must be one of its options, and
 * anything not in the table is dropped rather than stored. Dropping is deliberate - a crafted
 * POST should not be able to write arbitrary keys into a JSON column that a triage screen renders.
 */
export function answersSchema(kind: ImprovementKind) {
  return z.record(z.string(), z.unknown()).transform((raw, ctx) => {
    const out: Record<string, string> = {};
    for (const q of QUESTIONS[kind]) {
      const value = typeof raw[q.id] === "string" ? (raw[q.id] as string).trim() : "";
      if (!value) {
        if (q.required) {
          ctx.addIssue({ code: "custom", message: `${q.label} - please fill this in` });
        }
        continue;
      }
      if (q.options && !q.options.some((o) => o.value === value)) {
        ctx.addIssue({ code: "custom", message: `${q.label} - pick one of the options` });
        continue;
      }
      out[q.id] = value.slice(0, ANSWER_MAX);
    }
    return out;
  });
}

/** True when every required question of `kind` has an answer - what the modal's Send button reads. */
export function answersComplete(kind: ImprovementKind, answers: Record<string, string>): boolean {
  return QUESTIONS[kind].every((q) => !q.required || (answers[q.id]?.trim().length ?? 0) >= 2);
}

/**
 * A title, from the first answer, so nobody has to compose one.
 *
 * Prefixed with the kind's short label because a queue of twenty rows all titled with a fragment
 * of a sentence is unreadable. Editable in the form - this is a suggestion, not a rule.
 */
export function suggestTitle(kind: ImprovementKind, answers: Record<string, string>): string {
  const first = QUESTIONS[kind].find((q) => q.required && answers[q.id]?.trim());
  const body = first ? answers[first.id].trim().replace(/\s+/g, " ") : "";
  const prefix = IMPROVEMENT_KIND_SHORT[kind];
  if (!body) return prefix;
  const room = TITLE_MAX - prefix.length - 2;
  return `${prefix}: ${body.length > room ? `${body.slice(0, room - 1).trimEnd()}…` : body}`;
}

// ─────────────────────────────── severity ───────────────────────────────

export const IMPROVEMENT_SEVERITY_DEFS: readonly { key: ImprovementSeverity; label: string; hint: string }[] = [
  { key: "BLOCKING", label: "I can't do my job", hint: "There is no way around it" },
  { key: "ANNOYING", label: "Annoying, I have a workaround", hint: "I can still get the work done" },
  { key: "MINOR", label: "Minor or cosmetic", hint: "Worth fixing one day" },
] as const;

export function severityLabel(severity: ImprovementSeverity): string {
  return IMPROVEMENT_SEVERITY_DEFS.find((s) => s.key === severity)?.label ?? severity;
}

/** Short form for a table cell. */
export const IMPROVEMENT_SEVERITY_SHORT: Record<ImprovementSeverity, string> = {
  BLOCKING: "Blocking",
  ANNOYING: "Annoying",
  MINOR: "Minor",
};

/**
 * Severity decides how LOUD the notification is, and nothing else.
 *
 * It deliberately does not drive triage order: that is the developer's judgement, and a reporter
 * who learns that `BLOCKING` jumps the queue will file everything as blocking. What it buys is
 * honesty - "I can't do my job" reaches someone today; the rest ride the daily digest.
 */
export function notifiesImmediately(severity: ImprovementSeverity): boolean {
  return severity === "BLOCKING";
}

// ─────────────────────────────── status ───────────────────────────────

/**
 * The legal moves. One table, read by the triage UI (to decide which buttons exist) and by the
 * server action (to refuse anything else) - so a button that cannot work is never rendered, and a
 * crafted POST cannot make a move the screen does not offer.
 *
 * ── Why FIXED and CLOSED are different states ──────────────────────────────────────────────
 * `FIXED` means the developer shipped something. `CLOSED` means it is actually fixed as far as
 * the person who reported it is concerned. Collapsing the two is how a tracker fills up with
 * things everyone believes are done, and it would also throw away the one signal worth having:
 * a `FIXED` report that gets re-opened says the fix missed.
 *
 * `DUPLICATE` is terminal and reachable from the two triage states only - marking a report a
 * duplicate after work has started on it is a sign the duplicate link is wrong, not the work.
 */
export const IMPROVEMENT_TRANSITIONS: Record<ImprovementStatus, readonly ImprovementStatus[]> = {
  NEW: ["TRIAGED", "ACCEPTED", "DECLINED", "DUPLICATE"],
  TRIAGED: ["ACCEPTED", "IN_PROGRESS", "DECLINED", "DUPLICATE"],
  ACCEPTED: ["IN_PROGRESS", "DECLINED", "TRIAGED"],
  IN_PROGRESS: ["FIXED", "ACCEPTED", "DECLINED"],
  FIXED: ["CLOSED", "IN_PROGRESS"],
  // Terminal, but re-openable: "we decided not to" and "we thought this was done" both get
  // revisited, and a reporter saying "it is still happening" must have somewhere to land.
  CLOSED: ["IN_PROGRESS"],
  DECLINED: ["TRIAGED"],
  DUPLICATE: ["TRIAGED"],
};

export function canTransition(from: ImprovementStatus, to: ImprovementStatus): boolean {
  return IMPROVEMENT_TRANSITIONS[from].includes(to);
}

export const IMPROVEMENT_STATUS_LABELS: Record<ImprovementStatus, string> = {
  NEW: "New",
  TRIAGED: "Triaged",
  ACCEPTED: "Accepted",
  IN_PROGRESS: "In progress",
  FIXED: "Fixed",
  CLOSED: "Closed",
  DECLINED: "Declined",
  DUPLICATE: "Duplicate",
};

/** What the reporter is told their report is doing. Internal triage vocabulary means nothing to them. */
export const IMPROVEMENT_STATUS_FOR_REPORTER: Record<ImprovementStatus, string> = {
  NEW: "Waiting to be looked at",
  TRIAGED: "Read, being sized up",
  ACCEPTED: "Accepted, queued to fix",
  IN_PROGRESS: "Being worked on",
  FIXED: "Fixed - please check",
  CLOSED: "Done",
  DECLINED: "Not being changed",
  DUPLICATE: "Already reported by someone else",
};

/** Still in play - what the queue counts and the notification badge reads. */
export function isOpenStatus(status: ImprovementStatus): boolean {
  return status !== "CLOSED" && status !== "DECLINED" && status !== "DUPLICATE";
}

/** Nobody has looked at it yet. The only count worth putting in front of a developer. */
export function isUntriagedStatus(status: ImprovementStatus): boolean {
  return status === "NEW";
}

// ─────────────────────────────── event kinds ───────────────────────────────

export const IMPROVEMENT_EVENT_KINDS = ["STATUS", "COMMENT", "REKIND", "ASSIGN", "ATTACH"] as const;
export type ImprovementEventKind = (typeof IMPROVEMENT_EVENT_KINDS)[number];

// ─────────────────────────────── the screen tag ───────────────────────────────

/**
 * What "point at the problem" records. Every field optional: the tag is a convenience, and a
 * report with a half-captured tag is still a report.
 *
 * `text` is capped hard at 120 characters. It is the single most useful field on this object -
 * it is the figure the person was actually looking at - and also the one most likely to carry a
 * student's name, so it is kept to roughly one cell's worth and never used in a title or an email.
 */
export const elementTagSchema = z
  .object({
    selector: z.string().max(400).optional(),
    testId: z.string().max(120).optional(),
    text: z.string().max(120).optional(),
    role: z.string().max(40).optional(),
    heading: z.string().max(160).optional(),
    box: z
      .object({
        x: z.number().finite(),
        y: z.number().finite(),
        w: z.number().finite(),
        h: z.number().finite(),
      })
      .optional(),
  })
  .strict();
export type ElementTag = z.infer<typeof elementTagSchema>;

/**
 * One client breadcrumb. Paths and messages only - never form values, never a response body.
 *
 * The ring this comes from (lib/report-breadcrumbs.ts) exists because the deep bugs in this app
 * are found by DOING something twice, not by looking at a screen: the income form that died on
 * the second save is invisible in a screenshot and obvious in three breadcrumbs.
 */
export const breadcrumbSchema = z
  .object({
    at: z.string().max(40),
    kind: z.enum(["route", "action", "error", "fetch"]),
    label: z.string().max(300),
  })
  .strict();
export type Breadcrumb = z.infer<typeof breadcrumbSchema>;

export const MAX_BREADCRUMBS = 20;

// ─────────────────────────────── submit payload ───────────────────────────────

/**
 * What the modal posts.
 *
 * Note what is NOT here: the reporter's identity, their role, the running build, whether the
 * engine behind the screen is armed. All of that is captured server-side in
 * `server/improvement-context.ts`, because the client cannot be trusted about its own permissions and
 * does not know what is switched on. A client that could name its own reporter could file a
 * report as somebody else.
 */
export const submitImprovementSchema = z.object({
  kind: z.enum(IMPROVEMENT_KINDS),
  severity: z.enum(IMPROVEMENT_SEVERITIES),
  title: z.string().trim().max(TITLE_MAX).optional(),
  answers: z.record(z.string(), z.unknown()),
  note: z.string().trim().max(ANSWER_MAX).optional(),
  /** The route PATTERN, not the raw path - see `routePattern` below. */
  route: z.string().max(300),
  routeParams: z.record(z.string(), z.string().max(120)).optional(),
  sectionKey: z.string().max(60).nullable().optional(),
  elementTag: elementTagSchema.nullable().optional(),
  breadcrumbs: z.array(breadcrumbSchema).max(MAX_BREADCRUMBS).optional(),
  screenWidth: z.number().int().min(0).max(100000).optional(),
  screenHeight: z.number().int().min(0).max(100000).optional(),
  /** Next's own error digest, when the report comes from the crash screen. */
  clientDigest: z.string().max(120).nullable().optional(),
});
export type SubmitImprovementInput = z.infer<typeof submitImprovementSchema>;

/**
 * `/students/abc123` → `/students/[id]`, with the id carried separately.
 *
 * A raw path is a terrible thing to store on a row that gets rendered into a queue, a title and a
 * notification email: it puts a record id - and on some routes a token - into all three. The
 * pattern is also what makes "which screen generates the most reports" answerable at all, since
 * grouping by raw path would count every student's page as its own screen.
 *
 * A segment is treated as an id when it looks like one: a cuid, a uuid, or any long opaque run.
 * Short readable segments (`/finance`, `/console`, `/batches/plans`) are route structure and stay.
 */
export function routePattern(pathname: string): { route: string; params: Record<string, string> } {
  const params: Record<string, string> = {};
  let n = 0;
  const route = pathname
    .split("/")
    .map((segment) => {
      if (!segment || !looksLikeId(segment)) return segment;
      const name = n === 0 ? "id" : `id${n + 1}`;
      n += 1;
      params[name] = segment.slice(0, 120);
      return `[${name}]`;
    })
    .join("/");
  return { route: route.slice(0, 300) || "/", params };
}

function looksLikeId(segment: string): boolean {
  // cuid / cuid2 (Prisma's default here), uuid, or a long hex/base-ish run.
  if (/^c[a-z0-9]{20,}$/i.test(segment)) return true;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(segment)) return true;
  if (/^[A-Za-z0-9_-]{21,}$/.test(segment)) return true;
  // A bare number is an id on every route in this app that takes one.
  if (/^\d+$/.test(segment)) return true;
  return false;
}

/**
 * THE WEEKLY REPORT FORM - the question set, the answers, and the week it belongs to.
 *
 * ── What this is ──────────────────────────────────────────────────────────────────────
 * Pure rules for the founder-configurable weekly questionnaire: what a question may ask,
 * what counts as a valid answer to it, which integer (if any) that answer contributes to
 * a cohort total, and which calendar week a cycle is for. No Prisma, no React, no dates
 * read from the clock except through an argument - everything here is a function of its
 * inputs, so it can be unit-tested and run identically on the server and in the public
 * form's browser.
 *
 * ── Why validation lives here and not in the action ───────────────────────────────────
 * The public page validates as the student types and the server validates again on
 * submit, because a hidden input is not a fence. Two implementations of "is 'seven' a
 * valid answer to a NUMBER question" would eventually disagree, and the one that
 * disagreed quietly would be the server's. So there is one `validateWeeklyAnswer` and
 * both sides call it.
 *
 * ── THE RULE THAT MATTERS MOST: not-asked is not zero ─────────────────────────────────
 * A template need not ask about LinkedIn posts. When it does not, that student has no
 * posts figure - which is a different fact from "posted nothing", and the flag engine
 * must not read it as a miss. So `numericFor` returns null rather than 0 for anything it
 * cannot count, and every caller treats null as absence. Same reasoning lib/attendance.ts
 * applies to an unmarked register.
 *
 * ── Not to be confused with lib/weekly-report.ts ──────────────────────────────────────
 * That file derives what the RECORDS say a student did in a sprint week and stores
 * nothing. This one is about what the STUDENT says, on a form. See the header there.
 */

import { istDayOf, istIsoWeekKey, istWeekRange, toDateInputValue } from "./dates";

/** Mirrors `WeeklyQuestionKind` in the schema. Kept as a union so this file stays pure. */
export type WeeklyQuestionKind =
  | "NUMBER"
  | "SCALE"
  | "SINGLE_SELECT"
  | "MULTI_SELECT"
  | "YES_NO"
  | "TEXT"
  | "LONG_TEXT";

/** Mirrors `WeeklyMetric`. What the question means, as opposed to how it is worded. */
export type WeeklyMetricKey =
  | "APPLICATIONS"
  | "INTERVIEWS"
  | "NETWORKING"
  | "LINKEDIN_POSTS"
  | "LEARNING_HOURS"
  | "BLOCKERS"
  | "OTHER";

/**
 * One choice on a SELECT question.
 *
 * `numeric` exists because the founders ask for learning hours as buckets ("3-5 hours"),
 * and a dashboard still has to be able to say roughly how much studying a cohort did.
 * It is the bucket's floor, and it is opt-in: an option without one contributes nothing
 * to any total rather than being guessed at.
 */
export type WeeklyOption = { value: string; label: string; numeric?: number | null };

export type WeeklyQuestion = {
  id: string;
  key: string;
  version: number;
  kind: WeeklyQuestionKind;
  metric: WeeklyMetricKey;
  label: string;
  helpText?: string | null;
  required: boolean;
  orderIndex: number;
  options?: WeeklyOption[] | null;
  allowOther: boolean;
  min?: number | null;
  max?: number | null;
  targetNumeric?: number | null;
};

/** An answer as it travels: what the student picked or typed. */
export type WeeklyAnswerValue = string | number | boolean | string[] | null;

/** The sentinel option value that means "let me type my own". */
export const WEEKLY_OTHER_VALUE = "__other__";

/** How a free-text companion to an "Other" choice is named in the submitted form. */
export function weeklyOtherField(key: string): string {
  return `${key}__other`;
}

export type WeeklyAnswerOk = { ok: true; value: WeeklyAnswerValue; numeric: number | null };
export type WeeklyAnswerErr = { ok: false; error: string };
export type WeeklyAnswerResult = WeeklyAnswerOk | WeeklyAnswerErr;

const MAX_TEXT = 500;
const MAX_LONG_TEXT = 4000;
/**
 * A sanity ceiling on the countable answers. Nobody sends 100,000 applications in a week,
 * and without a cap one fat-fingered entry drags a cohort average somewhere meaningless
 * and the figure gets distrusted thereafter.
 */
const MAX_COUNT = 10_000;

function trimmed(raw: unknown): string {
  return typeof raw === "string" ? raw.trim() : raw == null ? "" : String(raw).trim();
}

function optionFor(q: WeeklyQuestion, value: string): WeeklyOption | undefined {
  return (q.options ?? []).find((o) => o.value === value);
}

/**
 * Validate one answer and work out what it contributes to a total.
 *
 * `otherText` is the free-text companion for a question whose chosen option was
 * WEEKLY_OTHER_VALUE. It is passed separately rather than folded into `raw` so that a
 * student who picks "Other" and types nothing fails on the required check instead of
 * silently submitting the literal sentinel.
 */
export function validateWeeklyAnswer(
  q: WeeklyQuestion,
  raw: unknown,
  otherText?: unknown,
): WeeklyAnswerResult {
  const blank = (v: unknown) =>
    v == null || (typeof v === "string" && v.trim() === "") || (Array.isArray(v) && v.length === 0);

  if (blank(raw)) {
    if (q.required) return { ok: false, error: `${q.label} is required` };
    return { ok: true, value: null, numeric: null };
  }

  switch (q.kind) {
    case "NUMBER":
    case "SCALE": {
      const text = trimmed(raw);
      // Deliberately strict: "10+" was a real value in the founders' sheet and it is the
      // reason a column of numbers could not be totalled. The form offers a number input
      // and refuses anything that is not one, rather than accepting it and losing the row.
      if (!/^-?\d+$/.test(text)) return { ok: false, error: `${q.label} must be a whole number` };
      const n = Number(text);
      const min = q.min ?? 0;
      const max = q.max ?? MAX_COUNT;
      if (n < min) return { ok: false, error: `${q.label} cannot be below ${min}` };
      if (n > max) return { ok: false, error: `${q.label} cannot be above ${max}` };
      return { ok: true, value: n, numeric: n };
    }

    case "YES_NO": {
      const text = trimmed(raw).toLowerCase();
      if (text === "yes" || text === "true") return { ok: true, value: true, numeric: 1 };
      if (text === "no" || text === "false") return { ok: true, value: false, numeric: 0 };
      return { ok: false, error: `${q.label} must be yes or no` };
    }

    case "SINGLE_SELECT": {
      const text = trimmed(raw);
      if (text === WEEKLY_OTHER_VALUE) {
        if (!q.allowOther) return { ok: false, error: `${q.label} has no other option` };
        const other = trimmed(otherText);
        if (!other) return { ok: false, error: `Tell us what you chose for ${q.label}` };
        if (other.length > MAX_TEXT) return { ok: false, error: `${q.label} is too long` };
        return { ok: true, value: other, numeric: null };
      }
      const opt = optionFor(q, text);
      if (!opt) return { ok: false, error: `${q.label} is not one of the choices` };
      return { ok: true, value: opt.value, numeric: opt.numeric ?? null };
    }

    case "MULTI_SELECT": {
      const list = (Array.isArray(raw) ? raw : [raw]).map((v) => trimmed(v)).filter(Boolean);
      const picked: string[] = [];
      for (const v of list) {
        if (v === WEEKLY_OTHER_VALUE) {
          if (!q.allowOther) return { ok: false, error: `${q.label} has no other option` };
          const other = trimmed(otherText);
          if (!other) return { ok: false, error: `Tell us what you chose for ${q.label}` };
          if (other.length > MAX_TEXT) return { ok: false, error: `${q.label} is too long` };
          picked.push(other);
          continue;
        }
        if (!optionFor(q, v)) return { ok: false, error: `${q.label} is not one of the choices` };
        picked.push(v);
      }
      if (picked.length === 0 && q.required) return { ok: false, error: `${q.label} is required` };
      // A count of selections is a real number and the only one a multi-select can offer.
      return { ok: true, value: picked, numeric: picked.length };
    }

    case "TEXT":
    case "LONG_TEXT": {
      const text = trimmed(raw);
      const cap = q.kind === "TEXT" ? MAX_TEXT : MAX_LONG_TEXT;
      if (text.length > cap) return { ok: false, error: `${q.label} is too long` };
      return { ok: true, value: text, numeric: null };
    }
  }
}

/** Validate a whole submission. Returns every error, not just the first. */
export function validateWeeklySubmission(
  questions: WeeklyQuestion[],
  input: Record<string, unknown>,
): {
  ok: boolean;
  errors: Record<string, string>;
  answers: Array<{ questionId: string; value: WeeklyAnswerValue; numeric: number | null }>;
} {
  const errors: Record<string, string> = {};
  const answers: Array<{ questionId: string; value: WeeklyAnswerValue; numeric: number | null }> = [];

  for (const q of questions) {
    const res = validateWeeklyAnswer(q, input[q.key], input[weeklyOtherField(q.key)]);
    if (!res.ok) {
      errors[q.key] = res.error;
      continue;
    }
    // An unanswered optional question stores no row at all, for the reason
    // SessionAttendance stores no row for an unopened register: "nothing was asked" and
    // "nothing was given" must stay distinguishable from each other on read.
    if (res.value === null) continue;
    answers.push({ questionId: q.id, value: res.value, numeric: res.numeric });
  }

  return { ok: Object.keys(errors).length === 0, errors, answers };
}

/** Questions a respondent actually sees: active ones, in the founder's order. */
export function orderedQuestions(questions: WeeklyQuestion[]): WeeklyQuestion[] {
  return [...questions].sort((a, b) => a.orderIndex - b.orderIndex || a.key.localeCompare(b.key));
}

// ── The week a cycle is for ───────────────────────────────────────────────────────────

export type WeeklyWeekRef = {
  /** "2026-W44" - the key. */
  isoWeek: string;
  /** Monday, as YYYY-MM-DD. */
  weekStart: string;
  /** Sunday, as YYYY-MM-DD. */
  weekEnd: string;
};

/**
 * The ISO week an instant sits in, as the three values a cycle row stores.
 *
 * `ref` is normalised to its IST calendar day FIRST. Callers pass `new Date()` as often as
 * they pass a date-only value, and the week helpers preserve the time of whatever they are
 * given - see `istDayOf`, which exists because skipping this step silently shifted a whole
 * week's deadline.
 */
export function weekRefFor(ref: Date): WeeklyWeekRef {
  const day = istDayOf(ref);
  const { start, end } = istWeekRange(day);
  const sunday = new Date(end);
  sunday.setUTCDate(end.getUTCDate() - 1);
  return {
    isoWeek: istIsoWeekKey(day),
    weekStart: toDateInputValue(start),
    weekEnd: toDateInputValue(sunday),
  };
}

/**
 * Which week of the programme this is, counting from the cohort's start date.
 *
 * A LABEL, never a key. Two cohorts that began three months apart are both in "week 4"
 * of their own curriculum while sitting in different calendar weeks, so comparing them
 * by this number would compare different weeks; that is what `isoWeek` is for. Returns
 * null when the batch has no start date, because a guess here would appear on a tutor's
 * screen as a fact about their curriculum.
 */
export function batchWeekNumber(batchStart: Date | null | undefined, weekStart: Date): number | null {
  if (!batchStart) return null;
  // Both ends normalised, so a start date that arrived as a timestamp cannot shift the count.
  const anchor = istWeekRange(istDayOf(batchStart)).start;
  const days = Math.round((istDayOf(weekStart).getTime() - anchor.getTime()) / 86400000);
  if (days < 0) return null;
  return Math.floor(days / 7) + 1;
}

// ── The window ────────────────────────────────────────────────────────────────────────

/**
 * Four states, and the two in the middle are the point: a form can still be submitted
 * after its deadline, and that submission is marked late rather than refused. The
 * founders' own sheet had three values for "Form Submitted?" - Yes, No and Late - which
 * is them saying that a late answer is worth more than no answer.
 */
export type WeeklyWindowState = "NOT_OPEN" | "OPEN" | "LATE" | "CLOSED";

export function weeklyWindowState(
  cycle: {
    status: "OPEN" | "CLOSED";
    opensAt: Date;
    closesAt: Date;
  },
  now: Date,
): WeeklyWindowState {
  if (cycle.status === "CLOSED") return "CLOSED";
  if (now.getTime() < cycle.opensAt.getTime()) return "NOT_OPEN";
  if (now.getTime() <= cycle.closesAt.getTime()) return "OPEN";
  return "LATE";
}

/** Whether a submission may be accepted, and whether it counts as late. */
export function weeklyAcceptance(state: WeeklyWindowState): { accept: boolean; late: boolean } {
  if (state === "OPEN") return { accept: true, late: false };
  if (state === "LATE") return { accept: true, late: true };
  return { accept: false, late: false };
}

export const WEEKLY_WINDOW_COPY: Record<WeeklyWindowState, string> = {
  NOT_OPEN: "This week's report has not opened yet.",
  OPEN: "Open for submissions.",
  LATE: "Past the deadline - submissions still count, and are marked late.",
  CLOSED: "This week is closed. Ask your coach if you need it reopened.",
};

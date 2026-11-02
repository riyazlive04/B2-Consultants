import "server-only";
import {
  orderedQuestions,
  type WeeklyOption,
  type WeeklyQuestion,
} from "@/lib/weekly-form";

/**
 * A TEMPLATE'S QUESTIONS, AS THE FORM NEEDS THEM.
 *
 * One reader for the stored question rows, shared by the student's own form and by every
 * screen that has to show what a cohort was asked. Kept apart from the pages so that two
 * callers cannot drift into reading the same stored shape two different ways - which is
 * how one screen comes to offer an option another refuses to accept.
 */

/**
 * `options` is Json in the schema, so it arrives as `unknown` and has to be proven.
 *
 * A malformed row yields no options rather than a crash: the question then renders as
 * unanswerable and the student can still submit the rest, which is a better Monday than a
 * white screen for the whole cohort.
 */
function readOptions(raw: unknown): WeeklyOption[] | null {
  if (!Array.isArray(raw)) return null;
  const out: WeeklyOption[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    if (typeof rec.value !== "string" || typeof rec.label !== "string") continue;
    out.push({
      value: rec.value,
      label: rec.label,
      numeric: typeof rec.numeric === "number" ? rec.numeric : null,
    });
  }
  return out.length > 0 ? out : null;
}

export type WeeklyQuestionRow = {
  id: string;
  key: string;
  version: number;
  kind: string;
  metric: string;
  label: string;
  helpText: string | null;
  required: boolean;
  orderIndex: number;
  options: unknown;
  allowOther: boolean;
  min: number | null;
  max: number | null;
  targetNumeric: number | null;
};

export function toWeeklyQuestions(rows: WeeklyQuestionRow[]): WeeklyQuestion[] {
  return orderedQuestions(
    rows.map((r) => ({
      id: r.id,
      key: r.key,
      version: r.version,
      kind: r.kind as WeeklyQuestion["kind"],
      metric: r.metric as WeeklyQuestion["metric"],
      label: r.label,
      helpText: r.helpText,
      required: r.required,
      orderIndex: r.orderIndex,
      options: readOptions(r.options),
      allowOther: r.allowOther,
      min: r.min,
      max: r.max,
      targetNumeric: r.targetNumeric,
    })),
  );
}

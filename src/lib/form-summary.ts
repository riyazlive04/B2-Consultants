import {
  isStaticItem,
  answerToText,
  type FormAnswers,
  type FormItem,
} from "./sites-types";

/**
 * The per-question roll-up behind Responses → Summary (Google Forms' "Summary" tab).
 *
 * Pure and dependency-free so it can be unit-tested and so the page can compute it without a
 * second round of queries. The interesting decision is what each question type turns into:
 *
 *   choice / scale / rating / consent → a COUNT PER OPTION. Every declared option is emitted even
 *       when nobody picked it, because "nobody chose C" is an answer and a chart that silently
 *       omits the empty bar reads as though C was never offered.
 *   free text                          → recent verbatims, not a chart. Bar-charting free text
 *       produces a hundred bars of one, which looks like analysis and isn't.
 *
 * Multi-select answers count once per ticked box, so the counts legitimately sum to more than the
 * number of respondents — `answered` is carried separately so the page can say so rather than
 * letting someone read the percentages as a share of people.
 */

export type QuestionSummary = {
  item: FormItem;
  /** Respondents who gave this question any answer at all. */
  answered: number;
  /** Choice-like questions: one row per option, in the order the form declares them. */
  counts?: { label: string; value: number }[];
  /** True when one respondent can contribute to several rows (checkboxes). */
  multi?: boolean;
  /** Numeric questions: the mean of what was given. */
  average?: number;
  /** Free-text questions: the most recent verbatims. */
  samples?: string[];
};

const SAMPLE_LIMIT = 8;

export function summariseAnswers(
  items: readonly FormItem[],
  rows: readonly FormAnswers[],
): QuestionSummary[] {
  return items.filter((i) => !isStaticItem(i.type)).map((item) => {
    const values = rows.map((r) => r[item.key]).filter((v) => {
      if (v == null) return false;
      return Array.isArray(v) ? v.length > 0 : v.trim() !== "";
    });
    const answered = values.length;
    const base: QuestionSummary = { item, answered };

    switch (item.type) {
      case "radio":
      case "select":
      case "checkboxes": {
        const tally = new Map<string, number>();
        for (const o of item.options ?? []) tally.set(o.label, 0);
        let other = 0;
        for (const v of values) {
          for (const one of Array.isArray(v) ? v : [v]) {
            if (tally.has(one)) tally.set(one, tally.get(one)! + 1);
            else other++; // an "Other:" write-in — grouped rather than given its own bar each
          }
        }
        const counts = [...tally].map(([label, value]) => ({ label, value }));
        if (other > 0) counts.push({ label: "Other", value: other });
        return { ...base, counts, multi: item.type === "checkboxes" };
      }

      case "checkbox": {
        const yes = values.length;
        return { ...base, counts: [{ label: "Ticked", value: yes }, { label: "Not ticked", value: rows.length - yes }] };
      }

      case "scale":
      case "rating": {
        const min = item.type === "rating" ? 1 : item.scaleMin ?? 1;
        const max = item.scaleMax ?? 5;
        const tally = new Map<string, number>();
        for (let n = min; n <= max; n++) tally.set(String(n), 0);
        let sum = 0;
        let n = 0;
        for (const v of values) {
          const t = answerToText(v);
          if (tally.has(t)) tally.set(t, tally.get(t)! + 1);
          const parsed = Number(t);
          if (Number.isFinite(parsed)) {
            sum += parsed;
            n++;
          }
        }
        return {
          ...base,
          counts: [...tally].map(([label, value]) => ({ label, value })),
          average: n ? sum / n : undefined,
        };
      }

      case "number": {
        let sum = 0;
        let n = 0;
        for (const v of values) {
          const parsed = Number(answerToText(v));
          if (Number.isFinite(parsed)) {
            sum += parsed;
            n++;
          }
        }
        return { ...base, average: n ? sum / n : undefined, samples: values.slice(0, SAMPLE_LIMIT).map(answerToText) };
      }

      default:
        return { ...base, samples: values.slice(0, SAMPLE_LIMIT).map(answerToText) };
    }
  });
}

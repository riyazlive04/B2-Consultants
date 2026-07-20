/**
 * The two businesses the founder actually runs (§1).
 *
 * Revenue was only ever reported as one combined figure, so B2 and German Note
 * performance could not be told apart — the Excel sheet splits them and the dashboard
 * did not. A business line is DERIVED, never stored: an income or receivable belongs to
 * German Note when its programme level is a German level or bundle, and to B2 otherwise.
 * Deriving it means historic rows segment correctly with no migration and no backfill,
 * and a newly added German level (say C1) lands on the right side automatically.
 */

export type BusinessLine = "B2" | "GERMAN_NOTE";

/** Including "ALL" — the combined view, which stays the default. */
export type BusinessLineView = BusinessLine | "ALL";

export const BUSINESS_LINE_LABELS: Record<BusinessLineView, string> = {
  ALL: "Combined",
  B2: "B2",
  GERMAN_NOTE: "German Note",
};

/** Level KIND → line. Kinds come from the configurable `Level` table, not a name prefix. */
export function lineForKind(kind: string | undefined): BusinessLine {
  return kind === "GERMAN_LEVEL" || kind === "GERMAN_BUNDLE" ? "GERMAN_NOTE" : "B2";
}

/**
 * Human-readable student numbers (§6.1) - "B2-0001" for B2 Consultants, "GN-0001" for German Note.
 *
 * Duplicate names are the problem this solves: the roster already holds two "Anna Smith"
 * and two "Karthik", and a payment has been credited to the wrong one. A cuid cannot be
 * read down a phone line, so every screen that shows a student name shows this beside it.
 *
 * ── TWO SERIES, ONE PER BUSINESS ──────────────────────────────────────────────────
 * B2 and German Note are run as separate businesses (lib/business-line) with their own
 * paperwork, and a single shared run of numbers made a student's identifier say nothing about
 * which business issued it - "B2-0184" on a German Note agreement read as a mistake. Each line
 * now has its OWN prefix and its OWN counter, so the two series are read and quoted
 * independently and neither is perturbed by growth in the other.
 *
 * The line is never asked for: it is DERIVED from the programme level being recorded
 * (`lineForKind`), the same way revenue is split, so a level added later lands on the right
 * side with no backfill.
 *
 * Pure and dependency-free so the backfill script, the server action and the UI all agree
 * on one format.
 */

import type { BusinessLine } from "./business-line";

/** Prefix per business line. Values are the literal text printed on agreements and invoices. */
export const STUDENT_CODE_PREFIXES: Record<BusinessLine, string> = {
  B2: "B2",
  GERMAN_NOTE: "GN",
};

/** Kept as the historic export - "B2" is still the default series for anything unattributed. */
export const STUDENT_CODE_PREFIX = STUDENT_CODE_PREFIXES.B2;

const PAD = 4;

/** Every prefix we issue, longest first so a parse can't match a prefix that is another's stem. */
const KNOWN_PREFIXES: { prefix: string; line: BusinessLine }[] = (
  Object.entries(STUDENT_CODE_PREFIXES) as [BusinessLine, string][]
)
  .map(([line, prefix]) => ({ prefix, line }))
  .sort((a, b) => b.prefix.length - a.prefix.length);

export type StudentCodeParts = { line: BusinessLine; prefix: string; number: number };

/**
 * 1 → "B2-0001"; `(1, "GERMAN_NOTE")` → "GN-0001". Numbers past 9999 simply grow ("B2-10000");
 * they never wrap or collide.
 *
 * `line` defaults to B2 so every historic call site keeps issuing exactly what it issued before.
 */
export function formatStudentCode(n: number, line: BusinessLine = "B2"): string {
  return `${STUDENT_CODE_PREFIXES[line]}-${String(n).padStart(PAD, "0")}`;
}

/**
 * "GN-0042" → { line: "GERMAN_NOTE", prefix: "GN", number: 42 }. Anything not in one of our
 * formats → null, so a code carried over from another system can't crash the generator.
 */
export function parseStudentCodeParts(code: string | null | undefined): StudentCodeParts | null {
  if (!code) return null;
  const v = code.trim().toUpperCase();
  for (const { prefix, line } of KNOWN_PREFIXES) {
    const m = new RegExp(`^${prefix}-(\\d+)$`).exec(v);
    if (!m) continue;
    const n = Number(m[1]);
    if (!Number.isSafeInteger(n) || n <= 0) return null;
    return { line, prefix, number: n };
  }
  return null;
}

/**
 * The number inside one of our codes, ignoring which series it belongs to.
 *
 * Kept because callers that only want "is this one of ours, and what number is it" (the
 * duplicate-code tests, the backfill log) never cared about the line.
 */
export function parseStudentCode(code: string | null | undefined): number | null {
  return parseStudentCodeParts(code)?.number ?? null;
}

/**
 * The next free number IN ONE SERIES, given every code already issued.
 *
 * Codes from the other series are skipped rather than counted, which is the whole point of
 * separate counters: issuing German Note's 3rd student must give GN-0003 even when 180 B2
 * students exist. `line` defaults to B2 to match `formatStudentCode`.
 */
export function nextStudentNumber(
  existing: Array<string | null | undefined>,
  line: BusinessLine = "B2",
): number {
  let max = 0;
  for (const c of existing) {
    const parts = parseStudentCodeParts(c);
    if (parts && parts.line === line && parts.number > max) max = parts.number;
  }
  return max + 1;
}

/**
 * Tidy a hand-typed student number into the one form the rest of the app compares against.
 *
 * The code is read aloud on calls and typed into a search box, so "b2-7 " and "B2-7" have to be
 * the same student. Upper-cased and stripped of whitespace for that reason; NOT reformatted into
 * `B2-0007`, because the founder may deliberately want a code from another system, and silently
 * rewriting what someone typed is how an identifier stops matching the paperwork it came from.
 *
 * Blank becomes null, which is the "no code" the column already models.
 */
export function normalizeStudentCode(raw: string | null | undefined): string | null {
  const v = (raw ?? "").trim().toUpperCase().replace(/\s+/g, "");
  return v || null;
}

/** Name + code for display: "Anna Smith · B2-0001". Falls back cleanly pre-backfill. */
export function labelWithCode(name: string, code: string | null | undefined): string {
  return code ? `${name} · ${code}` : name;
}

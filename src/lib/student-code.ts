/**
 * Human-readable student numbers (§6.1) - "B2-0001".
 *
 * Duplicate names are the problem this solves: the roster already holds two "Anna Smith"
 * and two "Karthik", and a payment has been credited to the wrong one. A cuid cannot be
 * read down a phone line, so every screen that shows a student name shows this beside it.
 *
 * Pure and dependency-free so the backfill script, the server action and the UI all agree
 * on one format.
 */

export const STUDENT_CODE_PREFIX = "B2";
const PAD = 4;

/** 1 → "B2-0001". Numbers past 9999 simply grow ("B2-10000"); they never wrap or collide. */
export function formatStudentCode(n: number): string {
  return `${STUDENT_CODE_PREFIX}-${String(n).padStart(PAD, "0")}`;
}

/** "B2-0042" → 42. Anything not in our format → null, so a hand-edited code can't crash the generator. */
export function parseStudentCode(code: string | null | undefined): number | null {
  if (!code) return null;
  const m = /^B2-(\d+)$/.exec(code.trim().toUpperCase());
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** The next free number given every code already issued. */
export function nextStudentNumber(existing: Array<string | null | undefined>): number {
  let max = 0;
  for (const c of existing) {
    const n = parseStudentCode(c);
    if (n !== null && n > max) max = n;
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

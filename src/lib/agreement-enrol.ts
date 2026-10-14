/**
 * Whether a signed agreement has become a student yet - derived, never stored.
 *
 * Pure and isomorphic, like lib/agreement-state.ts, and separate from server/agreement-enrol.ts
 * for a hard reason as well as a tidy one: that file is `"use server"`, where every export must be
 * an async function. A synchronous helper exported from there fails `next build` with "Only async
 * functions are allowed to be exported in a 'use server' file" - which `tsc` does not catch.
 *
 * The rule here is the one the action enforces, so the page never offers a button the server would
 * refuse.
 */

/** What the agreement page needs to decide whether to prompt, and with what wording. */
export type EnrolmentState =
  | { kind: "enrolled"; studentId: string; code: string | null }
  | { kind: "ready"; leadName: string }
  | { kind: "ambiguous"; count: number }
  | { kind: "no-client" };

/** Takes what `getAgreementDetail` already selects, so the page costs no extra query. */
export function enrolmentState(row: {
  student: { id: string; code: string | null } | null;
  lead: { id: string; name: string; students: { id: string; code: string | null }[] } | null;
}): EnrolmentState {
  if (row.student) return { kind: "enrolled", studentId: row.student.id, code: row.student.code };
  if (!row.lead) return { kind: "no-client" };
  const existing = row.lead.students;
  // Exactly one is unambiguous: the agreement was raised against the lead and never linked, which
  // is the normal shape. More than one and we must not guess which person this document binds.
  if (existing.length === 1) {
    return { kind: "enrolled", studentId: existing[0].id, code: existing[0].code };
  }
  if (existing.length > 1) return { kind: "ambiguous", count: existing.length };
  return { kind: "ready", leadName: row.lead.name };
}

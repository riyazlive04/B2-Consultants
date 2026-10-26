import test from "node:test";
import assert from "node:assert/strict";
import { enrolmentState } from "../agreement-enrol";

/**
 * Whether a signed agreement still needs enrolling.
 *
 * The case that produced this: `signAgreement` creates no Student by design, and the only path to
 * one was a manual trip to Contacts -> "Convert to student" that nothing on the agreement ever
 * mentioned. A client signed, never became a student, and so never appeared in Students or could
 * be given a portal login - which read as "after signing, account creation is not working".
 *
 * The rule pinned here is the REFUSAL as much as the prompt: an agreement with no contact, or a
 * contact with several students, must not guess which person the document binds.
 */

const lead = (students: { id: string; code: string | null }[] = []) => ({
  id: "lead_1",
  name: "Monisha",
  students,
});

test("a signed agreement with a contact and no student prompts to enrol", () => {
  assert.deepEqual(enrolmentState({ student: null, lead: lead() }), {
    kind: "ready",
    leadName: "Monisha",
  });
});

test("an agreement already linked to a student reports that student", () => {
  const state = enrolmentState({ student: { id: "stu_1", code: "B2-0042" }, lead: lead() });
  assert.deepEqual(state, { kind: "enrolled", studentId: "stu_1", code: "B2-0042" });
});

test("a contact with exactly one student is adopted, not duplicated", () => {
  // The normal shape when the agreement was raised against the lead and never linked back.
  // Prompting here would mint a second student record for the same person.
  const state = enrolmentState({ student: null, lead: lead([{ id: "stu_9", code: "B2-0009" }]) });
  assert.deepEqual(state, { kind: "enrolled", studentId: "stu_9", code: "B2-0009" });
});

test("a contact with several students refuses to guess - and names the candidates", () => {
  const state = enrolmentState({
    student: null,
    lead: lead([
      { id: "stu_1", code: "B2-0001" },
      { id: "stu_2", code: "B2-0002" },
    ]),
  });
  /**
   * The CANDIDATES ride along now (issue C6).
   *
   * The refusal to guess is unchanged and is still what this test is about. What was wrong is
   * that it was a dead end: the card could only say "two records, link it by hand", naming
   * neither and linking to neither - so the one state that exists because a human must decide
   * was the one state with nothing to decide with. Listing them is not guessing; the server
   * still demands an explicit `adoptStudentId` and re-checks it belongs to this lead.
   */
  assert.deepEqual(state, {
    kind: "ambiguous",
    count: 2,
    candidates: [
      { id: "stu_1", code: "B2-0001" },
      { id: "stu_2", code: "B2-0002" },
    ],
  });
});

test("an agreement raised against nobody has nothing to enrol", () => {
  // Real: B2-GM-2026-0002 on live carries neither leadId nor studentId.
  assert.deepEqual(enrolmentState({ student: null, lead: null }), { kind: "no-client" });
});

test("a student with no code is still a student", () => {
  // `code` is nullable, and a missing one must not read as "not enrolled yet".
  const state = enrolmentState({ student: { id: "stu_3", code: null }, lead: null });
  assert.deepEqual(state, { kind: "enrolled", studentId: "stu_3", code: null });
});

test("the agreement's own link wins over the contact's students", () => {
  // If the document says which student it binds, that is the answer - even where the lead has
  // several, which would otherwise be ambiguous.
  const state = enrolmentState({
    student: { id: "stu_direct", code: "B2-0100" },
    lead: lead([
      { id: "stu_1", code: "B2-0001" },
      { id: "stu_2", code: "B2-0002" },
    ]),
  });
  assert.deepEqual(state, { kind: "enrolled", studentId: "stu_direct", code: "B2-0100" });
});

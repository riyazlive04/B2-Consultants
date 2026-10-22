import { test } from "node:test";
import assert from "node:assert/strict";
import { canonicalPayload, type AgreementData } from "../agreement";
import {
  docBodyHashInput,
  isInkField,
  isSignerFilled,
  signerInputFields,
  validateDocBody,
  validateSignerValues,
  type DocBody,
  type DocField,
} from "../agreement-doc";
import { fillFields } from "../agreement-fill";

/**
 * The field kinds a signer interacts with - the consent tick, the text box, the upload - and the
 * co-signer role that signs before them.
 *
 * The consent checkbox is the reason most of this exists: the whole point of "I have read §8 -
 * payments are non-refundable" is that signing without it must be IMPOSSIBLE, and that it cannot
 * be ticked afterwards. The first half is tested here; the second is the database trigger.
 */

const DATA: AgreementData = {
  student: { fullName: "Priya Raghunathan", address: "12 MG Road", phone: "+919876543210", email: "" },
  batch: { number: "Batch 12", startDate: "2026-07-04" },
  payment: { option: "FULL", totalInrMinor: "6999900", dueMilestone: "Before commencement of Week 1" },
};

const CTX = { documentNo: "B2-GM-2026-0007", asOf: new Date("2026-10-22T09:00:00Z") };

const SIGN_CREATOR: DocField = { id: "f1", kind: "SIGNATURE", signer: "CREATOR" };
const SIGN_STUDENT: DocField = { id: "f2", kind: "SIGNATURE", signer: "STUDENT" };

function body(fields: DocField[], extra?: Partial<DocBody>): DocBody {
  return {
    kind: "PDF",
    fields: fields.map((f) => ({ page: 1, x: 0.1, y: 0.1, w: 0.2, h: 0.05, ...f })),
    sourceName: "a.pdf",
    sourceSha256: "a".repeat(64),
    pageCount: 1,
    ...extra,
  };
}

// ─────────────────────────── Which kinds are which ───────────────────────────

test("ink fields are the two that come from a pad, and nothing else", () => {
  assert.equal(isInkField("SIGNATURE"), true);
  assert.equal(isInkField("INITIALS"), true);
  for (const kind of ["DATE", "NAME", "TEXT", "CHECKBOX", "ATTACHMENT"] as const) {
    assert.equal(isInkField(kind), false);
  }
});

test("a TEXT box is the creator's to type OR the signer's, depending on whose it is", () => {
  // The same kind, two completely different behaviours - this is the distinction that decides
  // whether a value lives in the frozen body or in `signerFieldValues`.
  assert.equal(isSignerFilled({ kind: "TEXT", signer: "CREATOR" }), false);
  assert.equal(isSignerFilled({ kind: "TEXT", signer: "STUDENT" }), true);
  assert.equal(isSignerFilled({ kind: "CHECKBOX", signer: "GUARDIAN" }), true);
  // A signature is never "filled in" - it comes from the pad.
  assert.equal(isSignerFilled({ kind: "SIGNATURE", signer: "STUDENT" }), false);
});

test("signerInputFields is the ceremony's checklist, per signer", () => {
  const fields: DocField[] = [
    SIGN_CREATOR,
    SIGN_STUDENT,
    { id: "f3", kind: "CHECKBOX", signer: "STUDENT", required: true },
    { id: "f4", kind: "TEXT", signer: "GUARDIAN" },
    { id: "f5", kind: "TEXT", signer: "CREATOR", value: "typed while drafting" },
  ];
  assert.deepEqual(signerInputFields(fields, "STUDENT").map((f) => f.id), ["f3"]);
  assert.deepEqual(signerInputFields(fields, "GUARDIAN").map((f) => f.id), ["f4"]);
  // The founder's own text box is not something anybody is asked to fill at signing.
  assert.deepEqual(signerInputFields(fields, "CREATOR").map((f) => f.id), []);
});

// ─────────────────────────── The required gate ───────────────────────────

test("an unticked REQUIRED checkbox blocks signing", () => {
  const fields: DocField[] = [
    SIGN_STUDENT,
    { id: "c1", kind: "CHECKBOX", signer: "STUDENT", required: true, label: "I have read §8" },
  ];

  const unticked = validateSignerValues(fields, "STUDENT", {});
  assert.equal(unticked.length, 1);
  assert.equal(unticked[0]!.fieldId, "c1");
  assert.match(unticked[0]!.message, /I have read §8/);

  // Explicitly false is still not ticked - a deliberate "no" is not consent.
  assert.equal(validateSignerValues(fields, "STUDENT", { c1: false }).length, 1);
  assert.equal(validateSignerValues(fields, "STUDENT", { c1: true }).length, 0);
});

test("an OPTIONAL checkbox never blocks anything", () => {
  const fields: DocField[] = [{ id: "c1", kind: "CHECKBOX", signer: "STUDENT" }];
  assert.equal(validateSignerValues(fields, "STUDENT", {}).length, 0);
});

test("required text and uploads must be non-empty, not merely present", () => {
  const fields: DocField[] = [
    { id: "t1", kind: "TEXT", signer: "STUDENT", required: true, label: "Passport number" },
    { id: "a1", kind: "ATTACHMENT", signer: "STUDENT", required: true, label: "Photo ID" },
  ];
  assert.equal(validateSignerValues(fields, "STUDENT", { t1: "   ", a1: "" }).length, 2);
  assert.match(validateSignerValues(fields, "STUDENT", {})[1]!.message, /attach a file/i);
  assert.equal(validateSignerValues(fields, "STUDENT", { t1: "X1234", a1: "id.pdf" }).length, 0);
});

test("one signer's unfilled boxes are not held against another", () => {
  const fields: DocField[] = [
    { id: "c1", kind: "CHECKBOX", signer: "GUARDIAN", required: true },
  ];
  // The student must not be blocked by a box that belongs to the guardian.
  assert.equal(validateSignerValues(fields, "STUDENT", {}).length, 0);
  assert.equal(validateSignerValues(fields, "GUARDIAN", {}).length, 1);
});

test("`required` on a field nobody ever fills is flagged as an authoring mistake", () => {
  const problems = validateDocBody(
    body([SIGN_CREATOR, SIGN_STUDENT, { id: "d1", kind: "DATE", signer: "STUDENT", required: true }]),
  );
  assert.equal(problems.length, 1);
  assert.match(problems[0]!.message, /nothing is ever typed into it/);
});

// ─────────────────────────── The guardian ───────────────────────────

test("a guardian is not a required party - a document without one is complete", () => {
  assert.equal(validateDocBody(body([SIGN_CREATOR, SIGN_STUDENT])).length, 0);
});

test("a guardian with fields but nowhere to sign would deadlock, and is caught", () => {
  const problems = validateDocBody(
    body([SIGN_CREATOR, SIGN_STUDENT, { id: "g1", kind: "CHECKBOX", signer: "GUARDIAN", required: true }]),
  );
  assert.equal(problems.length, 1);
  assert.match(problems[0]!.message, /nowhere to sign/i);
});

test("a guardian with a signature box is fine", () => {
  const problems = validateDocBody(
    body([
      SIGN_CREATOR,
      SIGN_STUDENT,
      { id: "g1", kind: "SIGNATURE", signer: "GUARDIAN" },
      { id: "g2", kind: "CHECKBOX", signer: "GUARDIAN", required: true },
    ]),
  );
  assert.deepEqual(problems, []);
});

// ─────────────────────────── What each box prints ───────────────────────────

test("an unanswered checkbox is distinct from one deliberately left unticked", () => {
  const fields: DocField[] = [{ id: "c1", kind: "CHECKBOX", signer: "STUDENT" }];

  // Nobody has signed: empty box.
  const draft = fillFields({ fields, data: DATA, ctx: CTX, signers: {} });
  assert.equal(draft.get("c1")!.ticked, null);

  /**
   * They signed and left it alone: that is a "no", and it prints as one.
   *
   * Keyed off `signedAt`, deliberately - NOT off whether the ceremony happened to send a `false`.
   * The printed contract must not depend on a detail of how a form serialises an untouched
   * checkbox, and "they went through the ceremony and did not tick this" is the fact a reader
   * cares about either way.
   */
  const signed = fillFields({
    fields,
    data: DATA,
    ctx: CTX,
    signers: { STUDENT: { signedAt: new Date(), values: {} } },
  });
  assert.equal(signed.get("c1")!.ticked, false, "an untouched box on a SIGNED document is a no");

  const refused = fillFields({
    fields,
    data: DATA,
    ctx: CTX,
    signers: { STUDENT: { signedAt: new Date(), values: { c1: false } } },
  });
  assert.equal(refused.get("c1")!.ticked, false);

  const agreed = fillFields({
    fields,
    data: DATA,
    ctx: CTX,
    signers: { STUDENT: { signedAt: new Date(), values: { c1: true } } },
  });
  assert.equal(agreed.get("c1")!.ticked, true);
});

test("initials take the signer's ink; a guardian's name comes from their own row", () => {
  const fields: DocField[] = [
    { id: "i1", kind: "INITIALS", signer: "GUARDIAN" },
    { id: "n1", kind: "NAME", signer: "GUARDIAN" },
    { id: "n2", kind: "NAME", signer: "STUDENT" },
  ];
  const filled = fillFields({
    fields,
    data: DATA,
    ctx: CTX,
    signers: { GUARDIAN: { ink: "data:image/png;base64,AAA", name: "Rukmini Raghunathan" } },
  });
  assert.equal(filled.get("i1")!.ink, "data:image/png;base64,AAA");
  assert.equal(filled.get("n1")!.text, "Rukmini Raghunathan");
  // The student's name is known from the agreement itself, whether or not they have signed.
  assert.equal(filled.get("n2")!.text, "Priya Raghunathan");
});

test("a signer's TEXT box prints what THEY typed, not what the founder did", () => {
  const fields: DocField[] = [
    { id: "t1", kind: "TEXT", signer: "STUDENT", value: "founder's value - must be ignored" },
    { id: "t2", kind: "TEXT", signer: "CREATOR", value: "Fee is {{payment.total}}" },
  ];
  const filled = fillFields({
    fields,
    data: DATA,
    ctx: CTX,
    signers: { STUDENT: { values: { t1: "what the student typed" } } },
  });
  assert.equal(filled.get("t1")!.text, "what the student typed");
  // And the creator's own box still resolves its merge fields.
  assert.equal(filled.get("t2")!.text, "Fee is 69,999 INR");
});

// ─────────────────────────── The hash ───────────────────────────

test("per-document options enter the hash only when they are set", () => {
  const plain = body([SIGN_CREATOR, SIGN_STUDENT]);
  const base = canonicalPayload(DATA, "upload-pdf-v1", docBodyHashInput(plain));

  // An EMPTY options object must hash identically - `canonicalJson` drops undefined, not {}.
  const empty = canonicalPayload(DATA, "upload-pdf-v1", docBodyHashInput({ ...plain, options: {} }));
  assert.equal(empty, base, "an empty options object must not enter the hash");
  assert.ok(!base.includes("options"));

  const initialled = canonicalPayload(
    DATA,
    "upload-pdf-v1",
    docBodyHashInput({ ...plain, options: { initialEveryPage: true } }),
  );
  assert.notEqual(initialled, base, "a document that initials every page is a different document");
  assert.ok(initialled.includes("initialEveryPage"));
});

test("marking a box required changes the hash - it changes what was agreed", () => {
  const optional = body([SIGN_CREATOR, SIGN_STUDENT, { id: "c1", kind: "CHECKBOX", signer: "STUDENT" }]);
  const mandatory = body([
    SIGN_CREATOR,
    SIGN_STUDENT,
    { id: "c1", kind: "CHECKBOX", signer: "STUDENT", required: true },
  ]);
  assert.notEqual(
    canonicalPayload(DATA, "upload-pdf-v1", docBodyHashInput(optional)),
    canonicalPayload(DATA, "upload-pdf-v1", docBodyHashInput(mandatory)),
  );
});

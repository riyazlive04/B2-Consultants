import { test } from "node:test";
import assert from "node:assert/strict";
import { canonicalPayload, type AgreementData } from "../agreement";
import {
  docBodySchema,
  docBodyHashInput,
  nextFieldId,
  validateDocBody,
  describeFields,
  moveBlock,
  mapBlockText,
  type DocBody,
  type DocBlock,
  type DocCustomField,
} from "../agreement-doc";
import {
  mergeBlocks,
  mergeProblems,
  mergeValues,
  unresolvedMergeTokens,
  applyMerge,
} from "../agreement-merge";

const DATA: AgreementData = {
  student: {
    fullName: "Priya Raghunathan",
    address: "12 MG Road, Bengaluru 560001",
    phone: "+91 98765 43210",
    email: "priya@example.com",
  },
  batch: { number: "Batch 12", startDate: "2026-07-04" },
  payment: {
    option: "INSTALMENT",
    totalInrMinor: "6999900",
    planExtraInrMinor: "250000",
    instalments: [
      { amountInrMinor: "4399900", dueMilestone: "Before commencement of Week 1", dueDate: "2026-07-04" },
      { amountInrMinor: "2850000", dueMilestone: "Before the commencement of 2nd Sprint Week" },
    ],
  },
};

const BODY: DocBody = {
  kind: "DOCX",
  blocks: [
    { type: "heading", level: 1, runs: [{ text: "Coaching Agreement" }] },
    { type: "p", runs: [{ text: "Between B2 and {{student.fullName}} for {{payment.total}}." }] },
    { type: "field", fieldId: "f1" },
    { type: "field", fieldId: "f2" },
  ],
  fields: [
    { id: "f1", kind: "SIGNATURE", signer: "CREATOR" },
    { id: "f2", kind: "SIGNATURE", signer: "STUDENT" },
  ],
  sourceName: "agreement.docx",
  sourceSha256: "a".repeat(64),
};

// ─────────────────────────── The hash, which is the whole point ───────────────────────────

test("THE regression guard: a body-less payload is byte-identical to the pre-upload hash", () => {
  // This is what every GUIDED agreement in the table hashes, and what is printed on every signed
  // PDF. Passing no body must not materialise a `body` key - `canonicalJson` drops undefined.
  const withoutArg = canonicalPayload(DATA, "guided-v4");
  assert.equal(withoutArg, canonicalPayload(DATA, "guided-v4", undefined));
  assert.ok(!withoutArg.includes("body"), "a GUIDED agreement must not carry a body in its hash");
  assert.ok(withoutArg.startsWith('{"data":'), "keys are sorted: data, then templateVersion");
});

test("an uploaded body enters the hash, and moving a signature box changes it", () => {
  const base = canonicalPayload(DATA, "upload-docx-v1", docBodyHashInput(BODY));
  assert.ok(base.includes('"body"'));
  assert.notEqual(base, canonicalPayload(DATA, "upload-docx-v1"));

  const movedSigner: DocBody = {
    ...BODY,
    fields: [BODY.fields[0]!, { ...BODY.fields[1]!, signer: "CREATOR" }],
  };
  assert.notEqual(base, canonicalPayload(DATA, "upload-docx-v1", docBodyHashInput(movedSigner)));

  // Editing a word of the prose changes it too: for DOCX the blocks ARE the terms.
  const reworded: DocBody = {
    ...BODY,
    blocks: mapBlockText(BODY.blocks!, (t) => t.replace("Coaching", "Consulting")),
  };
  assert.notEqual(base, canonicalPayload(DATA, "upload-docx-v1", docBodyHashInput(reworded)));
});

test("a PDF body commits to the digest of its bytes, not the bytes, and not its filename", () => {
  const pdf: DocBody = {
    kind: "PDF",
    fields: [
      { id: "f1", kind: "SIGNATURE", signer: "CREATOR", page: 1, x: 0.1, y: 0.8, w: 0.3, h: 0.07 },
      { id: "f2", kind: "SIGNATURE", signer: "STUDENT", page: 1, x: 0.55, y: 0.8, w: 0.3, h: 0.07 },
    ],
    sourceName: "signed-draft.pdf",
    sourceSha256: "b".repeat(64),
    pageCount: 3,
  };
  const input = docBodyHashInput(pdf);
  assert.ok(!("blocks" in input), "a PDF body has no blocks to hash");
  assert.equal(
    canonicalPayload(DATA, "upload-pdf-v1", input),
    canonicalPayload(DATA, "upload-pdf-v1", docBodyHashInput({ ...pdf, sourceName: "renamed.pdf" })),
    "a rename is not a change of terms",
  );
  assert.notEqual(
    canonicalPayload(DATA, "upload-pdf-v1", input),
    canonicalPayload(DATA, "upload-pdf-v1", docBodyHashInput({ ...pdf, sourceSha256: "c".repeat(64) })),
    "one changed byte of the document is a change of terms",
  );
});

// ─────────────────────────── Validation ───────────────────────────

test("a document with no counterparty signature box cannot be issued", () => {
  const creatorOnly: DocBody = {
    ...BODY,
    blocks: [{ type: "field", fieldId: "f1" }],
    fields: [BODY.fields[0]!],
  };
  const problems = validateDocBody(creatorOnly).map((p) => p.message);
  assert.equal(problems.length, 1);
  assert.match(problems[0]!, /signature box for the student/i);
  assert.equal(validateDocBody(BODY).length, 0);
});

test("a DOCX field that was never placed in the flow is reported", () => {
  const orphan: DocBody = {
    ...BODY,
    fields: [...BODY.fields, { id: "f3", kind: "DATE", signer: "STUDENT", label: "Date signed" }],
  };
  const problems = validateDocBody(orphan);
  assert.equal(problems.length, 1);
  assert.equal(problems[0]!.field, "f3");
  assert.match(problems[0]!.message, /not placed anywhere/i);
});

test("a signature zone with no field behind it is reported too", () => {
  const dangling: DocBody = { ...BODY, blocks: [...BODY.blocks!, { type: "field", fieldId: "f9" }] };
  assert.match(validateDocBody(dangling)[0]!.message, /no field behind it/i);
});

test("PDF fields must be placed, on a page that exists, inside the page", () => {
  const pdf: DocBody = {
    kind: "PDF",
    fields: [
      { id: "f1", kind: "SIGNATURE", signer: "CREATOR" },
      { id: "f2", kind: "SIGNATURE", signer: "STUDENT", page: 9, x: 0.9, y: 0.9, w: 0.3, h: 0.3 },
    ],
    sourceName: "d.pdf",
    sourceSha256: "a".repeat(64),
    pageCount: 2,
  };
  const messages = validateDocBody(pdf).map((p) => p.message);
  assert.ok(messages.some((m) => /has not been placed on a page/i.test(m)));
  assert.ok(messages.some((m) => /page 9, but the document has 2/i.test(m)));
  assert.ok(messages.some((m) => /runs off the edge/i.test(m)));
});

test("duplicate field ids are caught", () => {
  const dupe: DocBody = { ...BODY, fields: [BODY.fields[0]!, { ...BODY.fields[1]!, id: "f1" }] };
  assert.match(validateDocBody(dupe)[0]!.message, /share the id f1/);
});

// ─────────────────────────── Merge fields ───────────────────────────

test("merge values resolve from the structured data, in document money format", () => {
  const values = mergeValues(DATA, { documentNo: "B2-GM-2026-0007", asOf: new Date("2026-10-21T09:00:00Z") });
  assert.equal(values["student.fullName"], "Priya Raghunathan");
  assert.equal(values["student.firstName"], "Priya");
  assert.equal(values["payment.total"], "69,999 INR"); // no ₹ - it is absent from WinAnsi
  assert.equal(values["payment.planCharge"], "2,500 INR");
  assert.equal(values["payment.collects"], "72,499 INR");
  assert.equal(values["batch.startDate"], "04.07.2026");
  assert.equal(values["document.date"], "21.10.2026");
  assert.match(values["payment.schedule"]!, /^1\. 43,999 INR - Before commencement of Week 1 \(04\.07\.2026\)\n2\./);
});

test("rendering resolves tokens in place and keeps the marks", () => {
  const merged = mergeBlocks(
    [{ type: "p", runs: [{ text: "Fee: " }, { text: "{{payment.total}}", b: true }] }],
    DATA,
    { documentNo: "B2-GM-2026-0007", asOf: new Date() },
  );
  assert.deepEqual((merged[0] as Extract<DocBlock, { type: "p" }>).runs, [
    { text: "Fee: " },
    { text: "69,999 INR", b: true },
  ]);
});

test("an unknown token is never silently printed or silently dropped", () => {
  const blocks: DocBlock[] = [{ type: "p", runs: [{ text: "Owed: {{payment.totl}} by {{student.fullName}}" }] }];
  assert.deepEqual(unresolvedMergeTokens(blocks, []), ["payment.totl"]);
  // A token in a TEXT field's typed value counts as part of the document too.
  assert.deepEqual(
    unresolvedMergeTokens([], [{ id: "f1", kind: "TEXT", signer: "CREATOR", value: "{{nope}}" }]),
    ["nope"],
  );
  assert.deepEqual(unresolvedMergeTokens(BODY.blocks!, BODY.fields), []);
  // Until it is fixed it stays verbatim rather than becoming a hole in the sentence.
  assert.equal(applyMerge("a {{nope}} b", {}), "a {{nope}} b");
});

// ─────────────────── The founder's own fields: {{custom.*}} ───────────────────

const CUSTOM: DocCustomField[] = [
  { token: "visa_date", label: "Visa appointment", value: "14.11.2026" },
  { token: "cohort", label: "Cohort code" },
];

const CTX = { documentNo: "B2-GM-2026-0007", asOf: new Date("2026-10-21T09:00:00Z") };

test("a declared custom field resolves like any other token", () => {
  const values = mergeValues(DATA, { ...CTX, custom: CUSTOM });
  assert.equal(values["custom.visa_date"], "14.11.2026");
  // Declared but not filled in: deliberately ABSENT, so the token stays verbatim rather than
  // turning a clause into a sentence with a hole in it.
  assert.equal(values["custom.cohort"], undefined);
});

test("custom fields reach the prose through the merge context alone", () => {
  const merged = mergeBlocks(
    [{ type: "p", runs: [{ text: "Appointment: {{custom.visa_date}}" }] }],
    DATA,
    { ...CTX, custom: CUSTOM },
  );
  assert.deepEqual((merged[0] as Extract<DocBlock, { type: "p" }>).runs, [
    { text: "Appointment: 14.11.2026" },
  ]);
});

test("a custom token is answerable only once it has a value", () => {
  const blocks: DocBlock[] = [
    { type: "p", runs: [{ text: "{{custom.visa_date}} and {{custom.cohort}} and {{custom.nope}}" }] },
  ];
  assert.deepEqual(unresolvedMergeTokens(blocks, [], CUSTOM), ["custom.cohort", "custom.nope"]);
  // With no declarations at all, every one of them is simply unknown.
  assert.equal(unresolvedMergeTokens(blocks, []).length, 3);
});

test("the two custom failures read differently - declared-but-empty is not a typo", () => {
  const blocks: DocBlock[] = [
    { type: "p", runs: [{ text: "{{custom.cohort}} {{custom.nope}} {{payment.totl}}" }] },
  ];
  const problems = mergeProblems(blocks, [], CUSTOM);
  assert.match(problems[0]!, /Cohort code.*has no value yet/);
  assert.match(problems[1]!, /not a field this app can fill/);
  assert.match(problems[2]!, /not a field this app can fill/);
  assert.deepEqual(mergeProblems(BODY.blocks!, BODY.fields), []);
});

test("one token declared twice is refused rather than resolved to whichever won", () => {
  const body: DocBody = {
    ...BODY,
    options: { custom: [CUSTOM[0]!, { token: "visa_date", label: "Something else" }] },
  };
  assert.ok(validateDocBody(body).some((p) => /defined twice/.test(p.message)));
  assert.ok(!validateDocBody({ ...BODY, options: { custom: CUSTOM } }).some((p) => /twice/.test(p.message)));
});

test("a custom field's value enters the content hash - it is printed prose", () => {
  const withCustom: DocBody = { ...BODY, options: { custom: CUSTOM } };
  const changed: DocBody = {
    ...BODY,
    options: { custom: [{ ...CUSTOM[0]!, value: "15.11.2026" }, CUSTOM[1]!] },
  };
  assert.notDeepEqual(docBodyHashInput(withCustom), docBodyHashInput(BODY));
  assert.notDeepEqual(docBodyHashInput(withCustom), docBodyHashInput(changed));
  // And a document that declares none hashes exactly as it did before they existed.
  assert.deepEqual(docBodyHashInput({ ...BODY, options: {} }), docBodyHashInput(BODY));
});

test("a custom name is lower-case, dot-free and bounded", () => {
  const ok = (token: string) =>
    docBodySchema.safeParse({ ...BODY, options: { custom: [{ token, label: "x" }] } }).success;
  assert.ok(ok("visa_date"));
  assert.ok(!ok("Visa_Date"), "upper case would make two names for one token");
  assert.ok(!ok("visa.date"), "the dot separates the namespace from the name");
  assert.ok(!ok("2026_intake"), "a name starts with a letter");
  assert.ok(!ok(""));
});

test("whitespace inside the braces is tolerated - a founder will type it", () => {
  assert.equal(applyMerge("{{ student.fullName }}", { "student.fullName": "Priya" }), "Priya");
});

// ─────────────────────────── Small helpers ───────────────────────────

test("field ids are sequential, and survive a gap", () => {
  assert.equal(nextFieldId([]), "f1");
  assert.equal(nextFieldId([{ id: "f1" }, { id: "f4" }]), "f5");
  assert.equal(nextFieldId([{ id: "custom" }]), "f1");
});

test("describeFields reads as a sentence", () => {
  assert.equal(describeFields(BODY.fields), "2 signatures");
  assert.equal(describeFields([]), "No fields placed");
});

test("moveBlock is a no-op out of range rather than a throw", () => {
  const blocks = BODY.blocks!;
  assert.deepEqual(moveBlock(blocks, 0, 99), blocks);
  assert.equal(moveBlock(blocks, 0, 1)[1], blocks[0]);
});

test("the body schema round-trips what the editor stores", () => {
  const parsed = docBodySchema.parse(BODY);
  assert.deepEqual(parsed.fields, BODY.fields);
  assert.equal(docBodySchema.safeParse({ ...BODY, kind: "GUIDED" }).success, false);
});

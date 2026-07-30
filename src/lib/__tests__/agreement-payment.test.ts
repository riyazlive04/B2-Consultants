import { test } from "node:test";
import assert from "node:assert/strict";
import { agreementDataSchema, canonicalPayload } from "../agreement";

/**
 * The agreement schema is also the DESERIALIZER for frozen snapshots, and `contentHash` hashes
 * the PARSED object. So a schema change is retroactive: it can alter the hash printed on a
 * contract that has already been signed.
 *
 * These tests exist to pin that down. The payment-structure work (Error Log N3/N5) widened the
 * instalment cap and added optional add-ons, and the thing that must NOT change is how an
 * agreement stored under the old rules parses and hashes.
 */

/** A two-instalment agreement exactly as rows were stored before N3/N5. */
const LEGACY = {
  student: {
    fullName: "Rahaman, Ameenur",
    address: "12 MG Road, Bengaluru 560001, India",
    phone: "+919876543210",
    email: "",
  },
  batch: { number: "Batch 12", startDate: "2026-08-01" },
  payment: {
    option: "INSTALMENT" as const,
    totalInrMinor: "6999900",
    instalments: [
      { amountInrMinor: "4399900", dueMilestone: "Before commencement of Week 1" },
      { amountInrMinor: "2600000", dueMilestone: "Before the commencement of 2nd Sprint Week" },
    ],
  },
};

test("a legacy 2-instalment agreement still parses after the cap was widened", () => {
  const parsed = agreementDataSchema.safeParse(LEGACY);
  assert.equal(parsed.success, true, "an executed contract must never stop parsing");
});

test("THE regression guard: a legacy agreement hashes to the same bytes as before", () => {
  const parsed = agreementDataSchema.parse(LEGACY);

  // The canonical payload is what gets SHA-256'd and printed on every page. If this string
  // changes, every already-signed PDF's integrity check breaks.
  const payload = canonicalPayload(parsed, "v1");

  // `addOns` was added as OPTIONAL with no default precisely so it stays absent here. A
  // `.default([])` would have introduced `"addOns":[]` into this string on every historic row.
  assert.ok(!payload.includes("addOns"), "an absent optional field must not materialise in the hash");

  // Byte-for-byte: the object a legacy row parses to is unchanged by N3/N5.
  assert.equal(
    payload,
    canonicalPayload(
      {
        student: LEGACY.student,
        batch: LEGACY.batch,
        payment: LEGACY.payment,
      } as typeof parsed,
      "v1",
    ),
  );
});

test("the plans the business actually sells are now recordable (N3)", () => {
  const plan = (n: number) => ({
    ...LEGACY,
    payment: {
      option: "INSTALMENT" as const,
      totalInrMinor: String(n * 100000),
      instalments: Array.from({ length: n }, (_, i) => ({
        amountInrMinor: "100000",
        dueMilestone: `Instalment ${i + 1}`,
      })),
    },
  });

  // 2 EMI (as before), 4 EMI (bundle) and 6 EMI (three courses) — all previously rejected
  // except the first, which is what made a real 4- or 6-EMI offer impossible to record.
  for (const n of [2, 4, 6]) {
    assert.equal(agreementDataSchema.safeParse(plan(n)).success, true, `${n} instalments must be valid`);
  }
});

test("the plan is still bounded at both ends", () => {
  const plan = (n: number) => ({
    ...LEGACY,
    payment: {
      option: "INSTALMENT" as const,
      totalInrMinor: String(n * 100000),
      instalments: Array.from({ length: n }, () => ({
        amountInrMinor: "100000",
        dueMilestone: "Instalment",
      })),
    },
  });

  // One "instalment" is a full payment wearing the wrong option; seven is past what any
  // template covers. Both stay rejected.
  assert.equal(agreementDataSchema.safeParse(plan(1)).success, false);
  assert.equal(agreementDataSchema.safeParse(plan(7)).success, false);
});

test("instalments must still add up to the total, at every plan length", () => {
  // The invariant a founder editing a form at 11pm will break. Widening the cap must not
  // weaken it — a 6-EMI plan that does not sum is exactly as wrong as a 2-EMI one.
  const bad = {
    ...LEGACY,
    payment: {
      option: "INSTALMENT" as const,
      totalInrMinor: "600000",
      instalments: Array.from({ length: 6 }, () => ({
        amountInrMinor: "90000", // 6 × 90,000 = 540,000 ≠ 600,000
        dueMilestone: "Instalment",
      })),
    },
  };
  const res = agreementDataSchema.safeParse(bad);
  assert.equal(res.success, false);
  assert.match(res.success ? "" : res.error.issues[0].message, /add up to/);
});

test("add-ons are itemised and bounded (N5)", () => {
  const withAddOns = {
    ...LEGACY,
    addOns: [
      { label: "Course books", amountInrMinor: "60000" },
      { label: "Materials", amountInrMinor: "30000" },
    ],
  };
  assert.equal(agreementDataSchema.safeParse(withAddOns).success, true);

  // Present add-ons DO enter the hash — a signed contract must commit to its own line items.
  const payload = canonicalPayload(agreementDataSchema.parse(withAddOns), "v1");
  assert.ok(payload.includes("addOns"), "an add-on that exists must be part of what was signed");
  assert.ok(payload.includes("Course books"));
});

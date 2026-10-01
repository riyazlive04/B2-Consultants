import test from "node:test";
import assert from "node:assert/strict";
import { firstShare, planShares, remainingShares } from "../instalment-amounts";

/**
 * These numbers become an income row AND a receivable, so the two must sum back to the fee
 * exactly. A paise lost here is a plan that never reads as paid in full and a student chased
 * for ever.
 */

test("the fee plus the surcharge is divided equally", () => {
  const shares = planShares({ inr: "40000", eur: "" }, { inr: "600", eur: "" }, 4);
  assert.deepEqual(shares.map((s) => s.inr), ["10150.00", "10150.00", "10150.00", "10150.00"]);
});

test("the shares always add back to fee + surcharge, to the paise", () => {
  // 10,000.03 + 1 does not divide by 3, which is exactly the case that loses money.
  const shares = planShares({ inr: "10000.03", eur: "" }, { inr: "1", eur: "" }, 3);
  const total = shares.reduce((a, s) => a + BigInt(s.inr.replace(".", "")), BigInt(0));
  assert.equal(total, BigInt(1000103));
  // The remainder goes on the LAST instalment, so the earlier ones are the quoted round figure.
  assert.deepEqual(shares.map((s) => s.inr), ["3333.67", "3333.67", "3333.69"]);
});

test("the first share is what is banked today, the rest are the schedule", () => {
  const shares = planShares({ inr: "30000", eur: "" }, { inr: "", eur: "" }, 3);
  assert.equal(firstShare(shares).inr, "10000.00");
  assert.deepEqual(remainingShares(shares).map((s) => s.inr), ["10000.00", "10000.00"]);
  assert.equal(remainingShares(shares).length, 2);
});

test("a currency the fee was not agreed in stays absent, never zero", () => {
  // "0.00" in the euro box would be submitted and ADDED to the rupee column (lib/money), so an
  // absent currency has to come back as "" the whole way through.
  const shares = planShares({ inr: "40000", eur: "" }, { inr: "600", eur: "" }, 4);
  assert.ok(shares.every((s) => s.eur === ""));
});

test("a euro-only plan splits in euros and leaves rupees absent", () => {
  const shares = planShares({ inr: "", eur: "1200" }, { inr: "", eur: "60" }, 3);
  assert.deepEqual(shares.map((s) => s.eur), ["420.00", "420.00", "420.00"]);
  assert.ok(shares.every((s) => s.inr === ""));
});

test("a genuinely split payment carries both currencies", () => {
  const shares = planShares({ inr: "20000", eur: "100" }, { inr: "", eur: "" }, 2);
  assert.deepEqual(shares, [
    { inr: "10000.00", eur: "50.00" },
    { inr: "10000.00", eur: "50.00" },
  ]);
});

test("a surcharge typed into a currency the fee does not use cannot open a second ledger", () => {
  const shares = planShares({ inr: "40000", eur: "" }, { inr: "", eur: "50" }, 4);
  assert.ok(shares.every((s) => s.eur === ""));
  assert.deepEqual(shares.map((s) => s.inr), ["10000.00", "10000.00", "10000.00", "10000.00"]);
});

test("nothing to split yields nothing, rather than a row of zeroes", () => {
  assert.deepEqual(planShares({ inr: "", eur: "" }, { inr: "", eur: "" }, 4), []);
  assert.deepEqual(planShares({ inr: "40000", eur: "" }, { inr: "", eur: "" }, null), []);
  assert.deepEqual(planShares({ inr: "40000", eur: "" }, { inr: "", eur: "" }, 1), []);
  assert.deepEqual(planShares({ inr: "40000", eur: "" }, { inr: "", eur: "" }, 0), []);
  assert.deepEqual(firstShare([]), { inr: "", eur: "" });
  assert.deepEqual(remainingShares([]), []);
});

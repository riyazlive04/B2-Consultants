import test from "node:test";
import assert from "node:assert/strict";
import {
  firstShare, planGap, planShares, planTotalText, remainingShares, sumMoneyText,
} from "../instalment-amounts";

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

// ───────────────── A TYPED FIRST INSTALMENT ─────────────────
//
// The commonest plan in the business - a bigger payment up front, the balance spread - could not
// be recorded at all: the first instalment was `total ÷ count`, derived and submitted through a
// hidden field. These cover the rule that replaced it: the typed figure stands, and the REST
// absorbs the difference, so the plan still sums to the same total.

test("a typed first instalment re-cuts the remaining ones, keeping the total", () => {
  const shares = planShares({ inr: "40000", eur: "" }, { inr: "", eur: "" }, 4, { inr: "20000", eur: "" });
  assert.deepEqual(shares.map((s) => s.inr), ["20000.00", "6666.66", "6666.66", "6666.68"]);
  // Still exactly ₹40,000 - the remainder lands on the last instalment, to the paise.
  assert.equal(sumMoneyText(shares).inr, "40000.00");
});

test("the surcharge is still collected when the first instalment is typed", () => {
  const shares = planShares({ inr: "40000", eur: "" }, { inr: "600", eur: "" }, 3, { inr: "20600", eur: "" });
  assert.deepEqual(shares.map((s) => s.inr), ["20600.00", "10000.00", "10000.00"]);
  assert.equal(sumMoneyText(shares).inr, "40600.00");
});

test("an empty override is not an override - the equal split stands", () => {
  // The amount boxes report their value on mount, so "" must mean "nobody typed", not "zero".
  const typed = planShares({ inr: "40000", eur: "" }, { inr: "", eur: "" }, 4, { inr: "", eur: "" });
  const untouched = planShares({ inr: "40000", eur: "" }, { inr: "", eur: "" }, 4);
  assert.deepEqual(typed, untouched);
});

test("a first instalment above the total never produces negative instalments", () => {
  // A mistake the form names on screen rather than burying in a row of minus signs.
  const shares = planShares({ inr: "40000", eur: "" }, { inr: "", eur: "" }, 3, { inr: "50000", eur: "" });
  assert.deepEqual(shares.map((s) => s.inr), ["50000.00", "0.00", "0.00"]);
});

test("a euro-only plan honours a typed euro first instalment", () => {
  const shares = planShares({ inr: "", eur: "1200" }, { inr: "", eur: "" }, 3, { inr: "", eur: "600" });
  assert.deepEqual(shares.map((s) => s.eur), ["600.00", "300.00", "300.00"]);
  assert.ok(shares.every((s) => s.inr === ""));
});

// ───────────────── RECONCILING THE PARTS ─────────────────

test("the total to collect is the fee plus the surcharge, in the fee's currencies", () => {
  assert.deepEqual(planTotalText({ inr: "40000", eur: "" }, { inr: "600", eur: "" }), {
    inr: "40600.00",
    eur: "",
  });
  // A surcharge in a currency the fee does not use is ignored here, exactly as planShares
  // ignores it - otherwise the reconciliation would report a gap the schedule cannot have.
  assert.deepEqual(planTotalText({ inr: "40000", eur: "" }, { inr: "", eur: "50" }), {
    inr: "40000.00",
    eur: "",
  });
});

test("planGap is zero when the parts match, and signed when they do not", () => {
  const total = planTotalText({ inr: "40000", eur: "" }, { inr: "600", eur: "" });
  const shares = planShares({ inr: "40000", eur: "" }, { inr: "600", eur: "" }, 4);
  assert.deepEqual(planGap(total, shares), { inr: BigInt(0), eur: BigInt(0) });

  // Hand-edited rows that bill ₹1,000 more than the price above them.
  const over = [...shares.slice(0, 3), { inr: "11150", eur: "" }];
  assert.equal(planGap(total, over).inr, BigInt(100000));
  const under = [...shares.slice(0, 3), { inr: "9150", eur: "" }];
  assert.equal(planGap(total, under).inr, BigInt(-100000));
});

test("summing keeps an unused currency unused", () => {
  assert.deepEqual(sumMoneyText([{ inr: "100", eur: "" }, { inr: "50", eur: "" }]), {
    inr: "150.00",
    eur: "",
  });
  assert.deepEqual(sumMoneyText([]), { inr: "", eur: "" });
});

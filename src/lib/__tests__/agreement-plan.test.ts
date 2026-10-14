import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AGREEMENT_MAX_INSTALMENTS,
  AGREEMENT_MIN_INSTALMENTS,
  agreementDueDates,
  agreementPlanTotal,
  agreementShares,
  sumShares,
} from "../agreement-plan";

/**
 * The agreement's §7 plan is now derived rather than typed, which moves the risk: a form that
 * fills its own boxes is only as trustworthy as the arithmetic behind them, and the boxes it
 * fills become binding terms the moment the student signs.
 *
 * So the two invariants that matter are pinned here:
 *   - the instalments ALWAYS sum to the fee plus the plan charge, at every plan length and
 *     whatever the first one was agreed at (`agreementDataSchema` refuses a plan that does not,
 *     so a derivation that loses a paise makes the form unable to save at all);
 *   - the dates are the programme's own dates, anchored on commencement rather than on today.
 */

const INR = (rupees: number) => BigInt(rupees) * BigInt(100);
const ZERO = BigInt(0);

test("the fee divides equally, with the remainder on the last instalment", () => {
  // 69,999 over 6 is not a whole number of paise per part - the case a naive divide loses.
  const shares = agreementShares(INR(69_999), ZERO, 6);
  assert.equal(shares.length, 6);
  assert.equal(sumShares(shares), INR(69_999), "the parts must sum to the fee exactly");
  // Equal up to the last, which absorbs the difference.
  assert.deepEqual(new Set(shares.slice(0, 5).map(String)).size, 1);
  assert.ok(shares[5] >= shares[0], "the remainder lands on the last part, never below it");
});

test("the plan charge is collected ON TOP of the fee", () => {
  const shares = agreementShares(INR(69_999), INR(600), 3);
  assert.equal(sumShares(shares), INR(70_599));
  assert.equal(agreementPlanTotal(INR(69_999), INR(600)), INR(70_599));
});

test("a typed first instalment re-cuts the rest, and the plan still sums", () => {
  // The plan the business sells most: a bigger payment up front, the balance spread.
  const shares = agreementShares(INR(40_000), ZERO, 4, INR(20_000));
  assert.equal(shares[0], INR(20_000), "what was agreed is what is charged");
  assert.equal(shares.length, 4);
  assert.equal(sumShares(shares), INR(40_000));
  // 20,000 over the remaining three - NOT 40,000 over four with the first one overwritten.
  assert.equal(sumShares(shares.slice(1)), INR(20_000));
});

test("a first instalment above the total never produces negative rows", () => {
  // A mistake the form names on screen (the parts are reconciled against the price). Filling the
  // rows below it with minus signs would bury the thing the founder needs to see.
  const shares = agreementShares(INR(10_000), ZERO, 3, INR(25_000));
  assert.equal(shares[0], INR(25_000));
  assert.ok(
    shares.slice(1).every((s) => s >= ZERO),
    "no instalment may be negative",
  );
});

test("nothing is derived from an unanswered question", () => {
  assert.deepEqual(agreementShares(INR(69_999), ZERO, null), [], "no count yet");
  assert.deepEqual(agreementShares(ZERO, ZERO, 3), [], "no fee yet");
  assert.deepEqual(agreementShares(INR(69_999), ZERO, 1), [], "one 'instalment' is a full payment");
  assert.deepEqual(agreementShares(INR(69_999), ZERO, 2.5), [], "a fractional count is not a plan");
});

test("a negative surcharge cannot discount the fee", () => {
  // `minorUnits` refuses one on the way in, but this is the function the FORM divides by, and a
  // box can hold anything mid-keystroke. A charge is a charge or it is nothing.
  assert.equal(agreementPlanTotal(INR(1_000), BigInt(-500)), INR(1_000));
});

test("instalment 1 falls due at commencement, and the rest follow the chosen rule", () => {
  const monthly = agreementDueDates("MONTH_FIRST", "2026-12-15", 3);
  assert.deepEqual(monthly, ["2026-12-15", "2027-01-01", "2027-02-01"]);

  const thirty = agreementDueDates("DAYS_30", "2026-12-15", 3);
  assert.deepEqual(thirty, ["2026-12-15", "2027-01-14", "2027-02-13"]);
});

test("the series is anchored, so a long plan never drifts", () => {
  // Each date is start + i × interval, not previous + interval - so no rounding accumulates.
  const dates = agreementDueDates("DAYS_30", "2026-01-01", 6);
  assert.equal(dates.length, 6);
  assert.equal(dates[0], "2026-01-01");
  assert.equal(dates[5], "2026-05-31"); // 1 Jan + 5 × 30 days
});

test("an unusable start date yields no dates rather than an invalid one", () => {
  // The form then leaves the boxes alone and says the start date is still needed. A row of
  // "Invalid Date" in a contract is worse than an empty one.
  assert.deepEqual(agreementDueDates("MONTH_FIRST", "", 3), []);
  assert.deepEqual(agreementDueDates("MONTH_FIRST", "not-a-date", 3), []);
  assert.deepEqual(agreementDueDates("MONTH_FIRST", "2026-12-15", 0), []);
});

test("the bounds the form clamps to are the bounds the schema enforces", () => {
  // These two constants are read by AgreementForm to clamp the count box. If they drifted from
  // `agreementDataSchema`'s .min(2).max(6), the form would happily draw a plan the server
  // refuses - which is the exact failure the clamp exists to prevent.
  assert.equal(AGREEMENT_MIN_INSTALMENTS, 2);
  assert.equal(AGREEMENT_MAX_INSTALMENTS, 6);
});

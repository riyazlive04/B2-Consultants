/**
 * Book-order trigger — spec §9.2 / Part 2 §4.4.
 *
 * The rule the founders stated: pay a large sum up front → order now; on EMI → defer.
 *
 * The case that matters most is `emiStudentWhoHasPaidEnoughGetsBooks`. The spec phrases the
 * defer condition as "if the student is on EMI", but the REASON it gives is "they haven't
 * fully paid" — so the actual variable is cash collected. Keying off the payment plan would
 * hold books back from an EMI customer who has been paying reliably for months, which is the
 * opposite of what the rule is for.
 *
 * Run: npm test
 */

import assert from "node:assert/strict";
import { test, describe } from "node:test";
import { decideBookOrder, initialBookOrderStatus } from "../book-order";
import { DEFAULT_BOOK_ORDER_CONFIG, coerceBookOrderConfig } from "../config-schema";

const rupees = (n: number) => n * 100; // → paise

describe("book order — the ordering trigger", () => {
  test("₹30,000 up front orders immediately (BO-007)", () => {
    const d = decideBookOrder(rupees(30_000), DEFAULT_BOOK_ORDER_CONFIG);
    assert.equal(d.order, true);
    assert.equal(d.reason, "threshold_met");
    assert.equal(d.shortfallInrMinor, 0);
  });

  test("a part-paid EMI student is deferred (BO-008)", () => {
    const d = decideBookOrder(rupees(5_000), DEFAULT_BOOK_ORDER_CONFIG);
    assert.equal(d.order, false);
    assert.equal(d.reason, "below_threshold");
    assert.equal(d.shortfallInrMinor, rupees(25_000));
  });

  test("the threshold is inclusive — exactly ₹30,000 orders", () => {
    assert.equal(decideBookOrder(rupees(30_000), DEFAULT_BOOK_ORDER_CONFIG).order, true);
    assert.equal(decideBookOrder(rupees(29_999), DEFAULT_BOOK_ORDER_CONFIG).order, false);
  });

  test("an EMI student who HAS paid enough gets their books", () => {
    // The plan is irrelevant; only the cash matters. Three ₹11k instalments = ₹33k paid.
    const d = decideBookOrder(rupees(33_000), DEFAULT_BOOK_ORDER_CONFIG);
    assert.equal(d.order, true, "paying past the threshold on EMI must still release the order");
  });

  test("zero paid defers and reports the full shortfall", () => {
    const d = decideBookOrder(0, DEFAULT_BOOK_ORDER_CONFIG);
    assert.equal(d.order, false);
    assert.equal(d.shortfallInrMinor, rupees(30_000));
  });

  test("a negative balance cannot read as having paid", () => {
    // A refund overshoot must never look like credit toward books.
    const d = decideBookOrder(-rupees(5_000), DEFAULT_BOOK_ORDER_CONFIG);
    assert.equal(d.order, false);
    assert.equal(d.shortfallInrMinor, rupees(30_000));
  });

  test("the explanation names both numbers, so a hold is never mysterious", () => {
    const d = decideBookOrder(rupees(5_000), DEFAULT_BOOK_ORDER_CONFIG);
    assert.match(d.explain, /5,000/);
    assert.match(d.explain, /30,000/);
    assert.match(d.explain, /25,000/); // what's still needed
  });
});

describe("book order — config", () => {
  test("a tuned threshold is honoured (§18.3 leaves the figure open)", () => {
    const tuned = coerceBookOrderConfig({ orderThresholdInrMinor: rupees(15_000), requireFreshQuotePerLevel: true });
    assert.equal(decideBookOrder(rupees(15_000), tuned).order, true);
    assert.equal(decideBookOrder(rupees(14_000), tuned).order, false);
  });

  test("a zero threshold orders for everyone", () => {
    const free = coerceBookOrderConfig({ orderThresholdInrMinor: 0, requireFreshQuotePerLevel: false });
    assert.equal(decideBookOrder(0, free).order, true);
  });

  test("an invalid config falls back to the shipped threshold", () => {
    assert.equal(decideBookOrder(rupees(30_000), coerceBookOrderConfig({ junk: 1 })).order, true);
    assert.equal(decideBookOrder(rupees(100), coerceBookOrderConfig(null)).order, false);
  });
});

describe("book order — initial status", () => {
  test("ordering starts by asking for a quote, never by jumping to ORDERED", () => {
    // §9.2: "get a quotation first" — we don't know the amount until the publisher says.
    assert.equal(initialBookOrderStatus(decideBookOrder(rupees(30_000))), "QUOTE_REQUESTED");
  });

  test("below the threshold opens as DEFERRED", () => {
    assert.equal(initialBookOrderStatus(decideBookOrder(rupees(1_000))), "DEFERRED");
  });
});

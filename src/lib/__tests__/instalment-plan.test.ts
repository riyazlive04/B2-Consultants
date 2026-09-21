/**
 * Instalment-plan arithmetic - the surcharge lookup, the exact split, and the due-date walk.
 *
 * All pure, no DB, no clock: dates are passed in. The split cases carry the weight - a plan
 * that doesn't sum back to the total means a receivable that can never reach zero, so the
 * student stays "owing" forever after paying in full. That is the failure this file exists
 * to prevent, and it only shows up on totals that don't divide evenly.
 *
 * Run: npm test
 */

import assert from "node:assert/strict";
import { test, describe } from "node:test";
import {
  instalmentDueDates,
  instalmentExtraFor,
  isPlanPaidInFull,
  pickPlanForPayment,
  settleDecision,
  splitInstalments,
  studentNameKey,
  totalToCollect,
  type MoneyMinor,
  type SettleInstalment,
} from "../instalment-plan";
import { DEFAULT_INSTALMENT_PLAN_CONFIG, type InstalmentPlanConfig } from "../config-schema";

const m = (inr: number, eur = 0): MoneyMinor => ({ inr: BigInt(inr), eur: BigInt(eur) });
const sum = (rows: MoneyMinor[]) =>
  rows.reduce((a, r) => ({ inr: a.inr + r.inr, eur: a.eur + r.eur }), m(0));

const CONFIG: InstalmentPlanConfig = {
  defaultIntervalDays: 30,
  tiers: [
    { count: 2, extraInrMinor: 40_000, extraEurMinor: 370 },
    { count: 3, extraInrMinor: 60_000, extraEurMinor: 550 },
  ],
};

describe("instalmentExtraFor", () => {
  test("returns the tier's flat surcharge for a priced length", () => {
    assert.deepEqual(instalmentExtraFor(3, CONFIG), m(60_000, 550));
  });

  test("an unpriced length costs nothing - never an invented charge", () => {
    assert.deepEqual(instalmentExtraFor(7, CONFIG), m(0, 0));
  });

  test("the shipped default prices only the 3-part plan the founder stated", () => {
    assert.deepEqual(instalmentExtraFor(3, DEFAULT_INSTALMENT_PLAN_CONFIG), m(60_000, 0));
    assert.deepEqual(instalmentExtraFor(2, DEFAULT_INSTALMENT_PLAN_CONFIG), m(0, 0));
    assert.deepEqual(instalmentExtraFor(4, DEFAULT_INSTALMENT_PLAN_CONFIG), m(0, 0));
  });

  test("the surcharge is flat, NOT per instalment", () => {
    // ₹600 once on a 3-part plan - the whole point of the founder's answer.
    const extra = instalmentExtraFor(3, CONFIG);
    assert.equal(extra.inr, BigInt(60_000));
    assert.notEqual(extra.inr, BigInt(60_000) * BigInt(3));
  });
});

describe("totalToCollect", () => {
  test("adds the surcharge to the agreed fee", () => {
    // ₹1,50,000 fee + ₹600 plan extra = ₹1,50,600
    assert.deepEqual(totalToCollect(m(15_000_000), m(60_000)), m(15_060_000));
  });

  test("keeps the two currencies independent", () => {
    assert.deepEqual(totalToCollect(m(0, 140_000), m(0, 550)), m(0, 140_550));
  });
});

describe("splitInstalments", () => {
  test("splits an even total into equal parts", () => {
    const rows = splitInstalments(m(15_060_000), 3);
    assert.equal(rows.length, 3);
    assert.deepEqual(rows.map((r) => r.inr), [BigInt(5_020_000), BigInt(5_020_000), BigInt(5_020_000)]);
  });

  test("an indivisible total still sums back exactly - remainder on the last row", () => {
    // 100 paise over 3 → 33 / 33 / 34
    const rows = splitInstalments(m(100), 3);
    assert.deepEqual(rows.map((r) => Number(r.inr)), [33, 33, 34]);
    assert.equal(sum(rows).inr, BigInt(100));
  });

  test("sums back exactly across many awkward totals and counts", () => {
    for (const total of [1, 7, 99, 100_001, 15_060_001, 999_999_999]) {
      for (const count of [2, 3, 4, 6, 7, 11, 24]) {
        const rows = splitInstalments(m(total, total), count);
        assert.equal(rows.length, count);
        assert.equal(sum(rows).inr, BigInt(total), `inr ${total}/${count}`);
        assert.equal(sum(rows).eur, BigInt(total), `eur ${total}/${count}`);
      }
    }
  });

  test("every instalment before the last is the amount the student was quoted", () => {
    const rows = splitInstalments(m(100), 3);
    assert.equal(rows[0].inr, rows[1].inr);
  });

  test("a single instalment takes the whole total", () => {
    assert.deepEqual(splitInstalments(m(12_345), 1), [m(12_345)]);
  });

  test("a nonsense count yields no schedule rather than dividing by zero", () => {
    assert.deepEqual(splitInstalments(m(100), 0), []);
    assert.deepEqual(splitInstalments(m(100), -3), []);
    assert.deepEqual(splitInstalments(m(100), 2.5), []);
  });
});

describe("instalmentDueDates", () => {
  const first = new Date(Date.UTC(2026, 7, 15)); // 15 Aug 2026

  test("walks forward by the interval from the first due date", () => {
    const dates = instalmentDueDates(first, 3, 30);
    assert.deepEqual(
      dates.map((d) => d.toISOString().slice(0, 10)),
      ["2026-08-15", "2026-09-14", "2026-10-14"],
    );
  });

  test("crosses a month and a year boundary correctly", () => {
    const dates = instalmentDueDates(new Date(Date.UTC(2026, 11, 20)), 3, 30);
    assert.deepEqual(
      dates.map((d) => d.toISOString().slice(0, 10)),
      ["2026-12-20", "2027-01-19", "2027-02-18"],
    );
  });

  test("does not mutate the date it was handed", () => {
    const before = first.toISOString();
    instalmentDueDates(first, 6, 30);
    assert.equal(first.toISOString(), before);
  });

  test("no drift accumulates - the nth date is exactly n intervals out", () => {
    const dates = instalmentDueDates(first, 12, 30);
    const days = (dates[11].getTime() - dates[0].getTime()) / 86_400_000;
    assert.equal(days, 11 * 30);
  });

  test("stays at UTC midnight so it matches the @db.Date columns", () => {
    for (const d of instalmentDueDates(first, 4, 30)) {
      assert.equal(d.toISOString().slice(10), "T00:00:00.000Z");
    }
  });

  test("a nonsense count yields no dates", () => {
    assert.deepEqual(instalmentDueDates(first, 0, 30), []);
  });
});

// ── Settling a plan from a recorded payment (FIN-06 / FIN-07 / FIN-08) ─────────────────────────
//
// The failure these guard against is the live dunning ladder chasing a student who has paid - and
// its mirror image, a payment that silently stops the chase on a debt that is still owed.

const day = (n: number) => new Date(Date.UTC(2026, 8, n));
/** A same-currency INR row: aggInr is just the INR amount. */
const inr = (paise: number) => ({ inr: BigInt(paise), eur: BigInt(0), aggInr: BigInt(paise) });
const inst = (
  id: string,
  seq: number,
  paise: number,
  due: Date,
  status: SettleInstalment["status"] = "DUE",
): SettleInstalment => ({ id, seq, dueDate: due, status, ...inr(paise) });

/** The e2e plan: Rs 10,000 x 3, instalment 1 recorded with the plan and stored PAID. */
const plan3 = () => [
  inst("i1", 1, 1_000_000, day(1), "PAID"),
  inst("i2", 2, 1_000_000, day(10), "OVERDUE"),
  inst("i3", 3, 1_000_000, day(30)),
];

describe("settleDecision", () => {
  test("exactly one instalment's worth settles the earliest unpaid one and moves next-due on", () => {
    const d = settleDecision(inr(1_000_000), plan3());
    assert.deepEqual(d.settleIds, ["i2"]);
    assert.deepEqual(d.nextDueDate, day(30));
    assert.equal(d.allPaid, false);
    assert.equal(d.shortfall, false);
  });

  test("an OVERDUE instalment is settled like a DUE one - this is what stops the chase (FIN-08)", () => {
    const d = settleDecision(inr(1_000_000), plan3());
    assert.ok(d.settleIds.includes("i2"));
  });

  test("already-paid instalments are skipped, never paid twice", () => {
    const rows = plan3();
    rows[1].status = "PAID";
    assert.deepEqual(settleDecision(inr(1_000_000), rows).settleIds, ["i3"]);
  });

  test("the last instalment leaves nothing unpaid and no next due", () => {
    const rows = plan3();
    rows[1].status = "PAID";
    const d = settleDecision(inr(1_000_000), rows);
    assert.equal(d.allPaid, true);
    assert.equal(d.nextDueDate, null);
  });

  test("paying two instalments at once settles both", () => {
    const d = settleDecision(inr(2_000_000), plan3());
    assert.deepEqual(d.settleIds, ["i2", "i3"]);
    assert.equal(d.allPaid, true);
  });

  test("an overpayment settles only whole instalments - the remainder is carried nowhere", () => {
    const d = settleDecision(inr(1_500_000), plan3());
    assert.deepEqual(d.settleIds, ["i2"]);
    assert.deepEqual(d.nextDueDate, day(30));
    assert.equal(d.allPaid, false);
  });

  test("an underpayment settles nothing and leaves the instalment chaseable", () => {
    const d = settleDecision(inr(999_999), plan3());
    assert.deepEqual(d.settleIds, []);
    assert.equal(d.shortfall, true);
    assert.deepEqual(d.nextDueDate, day(10));
  });

  test("earliest means earliest DUE DATE, whatever order the rows arrive in", () => {
    const rows = [inst("late", 3, 100, day(30)), inst("early", 2, 100, day(10))];
    assert.deepEqual(settleDecision(inr(100), rows).settleIds, ["early"]);
  });

  test("a EUR plan paid in EUR compares cents exactly, ignoring FX drift in the aggregates", () => {
    const eurInst: SettleInstalment = {
      id: "e2", seq: 2, dueDate: day(10), status: "DUE",
      inr: BigInt(0), eur: BigInt(10_000), aggInr: BigInt(900_000), // stamped at 90
    };
    // Paid at a stronger rupee: the INR aggregate is LOWER, but the euros are exactly right.
    const paid = { inr: BigInt(0), eur: BigInt(10_000), aggInr: BigInt(880_000) };
    assert.deepEqual(settleDecision(paid, [eurInst]).settleIds, ["e2"]);
  });

  test("a cross-currency payment is judged on the INR aggregate at each row's own rate", () => {
    const inrInst = inst("x", 2, 900_000, day(10));
    const enough = { inr: BigInt(0), eur: BigInt(10_000), aggInr: BigInt(900_000) };
    const short = { inr: BigInt(0), eur: BigInt(9_999), aggInr: BigInt(899_910) };
    assert.deepEqual(settleDecision(enough, [inrInst]).settleIds, ["x"]);
    assert.deepEqual(settleDecision(short, [inrInst]).settleIds, []);
  });

  test("a plan with nothing unpaid settles nothing and is not a shortfall", () => {
    const d = settleDecision(inr(100), [inst("p", 1, 100, day(1), "PAID")]);
    assert.deepEqual(d.settleIds, []);
    assert.equal(d.allPaid, true);
    assert.equal(d.shortfall, false);
  });
});

describe("pickPlanForPayment", () => {
  const linked = { id: "L", studentId: "stu_1", studentName: "Asha Rao" };
  const unlinked = { id: "U", studentId: null, studentName: "Asha  rao " };

  test("an id-linked payment finds the id-linked plan", () => {
    assert.deepEqual(pickPlanForPayment({ studentId: "stu_1", studentName: "Asha Rao" }, [linked]), { planId: "L" });
  });

  test("an id-linked plan is NEVER matched by name alone - a namesake cannot settle it", () => {
    assert.deepEqual(pickPlanForPayment({ studentId: null, studentName: "Asha Rao" }, [linked]), { skip: "no-plan" });
    assert.deepEqual(pickPlanForPayment({ studentId: "stu_2", studentName: "Asha Rao" }, [linked]), { skip: "no-plan" });
  });

  test("an unlinked plan is matched by name, ignoring case and spacing", () => {
    assert.deepEqual(pickPlanForPayment({ studentId: null, studentName: "asha rao" }, [unlinked]), { planId: "U" });
  });

  test("two plausible plans is ambiguous - settle nothing, leave it to the admin", () => {
    assert.deepEqual(
      pickPlanForPayment({ studentId: "stu_1", studentName: "Asha Rao" }, [linked, unlinked]),
      { skip: "ambiguous" },
    );
    const twin = { id: "U2", studentId: null, studentName: "Asha Rao" };
    assert.deepEqual(pickPlanForPayment({ studentId: null, studentName: "Asha Rao" }, [unlinked, twin]), { skip: "ambiguous" });
  });

  test("no plan at all is a no-op", () => {
    assert.deepEqual(pickPlanForPayment({ studentId: null, studentName: "Asha Rao" }, []), { skip: "no-plan" });
  });

  test("the name key matches the balance maths' normalisation", () => {
    assert.equal(studentNameKey("  Asha   RAO "), "asha rao");
  });
});

describe("isPlanPaidInFull", () => {
  const due = m(3_000_000, 33_333);

  test("every instalment paid and nothing left to collect: paid in full (FIN-07)", () => {
    assert.equal(isPlanPaidInFull({ allInstalmentsPaid: true, toCollect: due, paid: m(3_000_000, 33_333) }), true);
    assert.equal(isPlanPaidInFull({ allInstalmentsPaid: true, toCollect: due, paid: m(3_100_000, 34_000) }), true);
  });

  test("a balance that reads zero is not enough while an instalment is unpaid", () => {
    assert.equal(isPlanPaidInFull({ allInstalmentsPaid: false, toCollect: due, paid: m(9_000_000, 99_999) }), false);
  });

  test("all instalments paid but money still owed (schedule and fee disagree): stays live", () => {
    assert.equal(isPlanPaidInFull({ allInstalmentsPaid: true, toCollect: due, paid: m(2_999_999, 33_333) }), false);
  });

  test("FX drift that leaves either currency view owing keeps the plan open", () => {
    assert.equal(isPlanPaidInFull({ allInstalmentsPaid: true, toCollect: due, paid: m(3_000_000, 33_332) }), false);
  });
});

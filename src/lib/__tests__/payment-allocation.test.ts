import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { allocatePayments, isSettled, studentKey } from "../payment-allocation";

const inr = (n: number) => ({ inr: n, eur: 0 });
const plan = (id: string, total: number, createdAt = "2026-01-01") => ({
  id,
  toCollect: inr(total),
  createdAt,
});

describe("allocating payments across one student's plans (FIN-12)", () => {
  test("THE BUG: four plans for one student no longer all read the same collected figure", () => {
    const plans = [
      plan("a", 10_000, "2026-01-01"),
      plan("b", 10_000, "2026-01-02"),
      plan("c", 10_000, "2026-01-03"),
      plan("d", 10_000, "2026-01-04"),
    ];
    // One payment, typed under the student's name, naming no plan - exactly the shape that used
    // to be handed to all four.
    const { byPlan } = allocatePayments(plans, [{ pendingPaymentId: null, amount: inr(11_525) }]);

    assert.equal(byPlan.get("a")!.paid.inr, 10_000, "the oldest plan fills first");
    assert.equal(byPlan.get("b")!.paid.inr, 1_525, "the remainder carries to the next one");
    assert.equal(byPlan.get("c")!.paid.inr, 0);
    assert.equal(byPlan.get("d")!.paid.inr, 0);
    // The old behaviour: 4 x 11,525 credited against 40,000 owed.
    const collected = [...byPlan.values()].reduce((a, v) => a + v.paid.inr, 0);
    assert.equal(collected, 11_525, "the money is credited ONCE in total");
  });

  test("the summary strip adds up: total - collected = still to collect", () => {
    const plans = [plan("a", 30_000, "2026-01-01"), plan("b", 10_001, "2026-01-02")];
    const { byPlan } = allocatePayments(plans, [
      { pendingPaymentId: "a", amount: inr(35_000) }, // deliberately overpaid
      { pendingPaymentId: null, amount: inr(4_000) },
    ]);
    const total = 30_000 + 10_001;
    const collected = [...byPlan.values()].reduce((a, v) => a + v.paid.inr, 0);
    const balance = [...byPlan.values()].reduce((a, v) => a + v.balance.inr, 0);
    assert.equal(total - collected, balance, "no row can credit more than its own total");
  });

  test("a payment that names its plan is credited to that plan and no other", () => {
    const plans = [plan("a", 10_000, "2026-01-01"), plan("b", 10_000, "2026-01-02")];
    const { byPlan } = allocatePayments(plans, [{ pendingPaymentId: "b", amount: inr(10_000) }]);
    assert.equal(byPlan.get("a")!.paid.inr, 0, "the older plan is NOT filled first when told otherwise");
    assert.equal(byPlan.get("b")!.balance.inr, 0);
  });

  test("overpaying a named plan is reported, not absorbed", () => {
    const { byPlan } = allocatePayments([plan("a", 30_000)], [
      { pendingPaymentId: "a", amount: inr(35_000) },
    ]);
    assert.equal(byPlan.get("a")!.paid.inr, 30_000, "collected is capped at the plan's own total");
    assert.equal(byPlan.get("a")!.overpaid.inr, 5_000);
    assert.equal(byPlan.get("a")!.balance.inr, 0);
  });

  test("a named overpayment does not crowd out unlinked money still looking for a home", () => {
    const plans = [plan("a", 10_000, "2026-01-01"), plan("b", 10_000, "2026-01-02")];
    const { byPlan, unapplied } = allocatePayments(plans, [
      { pendingPaymentId: "a", amount: inr(15_000) },
      { pendingPaymentId: null, amount: inr(10_000) },
    ]);
    assert.equal(byPlan.get("a")!.overpaid.inr, 5_000);
    assert.equal(byPlan.get("b")!.paid.inr, 10_000, "plan b still gets the unlinked payment in full");
    assert.equal(unapplied.inr, 0);
  });

  test("money left over once every plan is full is held as unapplied, never invented onto a plan", () => {
    const { byPlan, unapplied } = allocatePayments([plan("a", 5_000)], [
      { pendingPaymentId: null, amount: inr(8_000) },
    ]);
    assert.equal(byPlan.get("a")!.paid.inr, 5_000);
    assert.equal(unapplied.inr, 3_000);
  });

  test("a payment with no plan at all is unapplied rather than lost", () => {
    const { unapplied } = allocatePayments([], [{ pendingPaymentId: null, amount: inr(2_500) }]);
    assert.equal(unapplied.inr, 2_500);
  });

  test("a link to an archived or deleted plan behaves as unlinked money", () => {
    const { byPlan } = allocatePayments([plan("live", 10_000)], [
      { pendingPaymentId: "archived-and-gone", amount: inr(4_000) },
    ]);
    assert.equal(byPlan.get("live")!.paid.inr, 4_000, "the payment still arrived");
  });

  test("the two currencies fill up independently", () => {
    const plans = [
      { id: "a", toCollect: { inr: 10_000, eur: 0 }, createdAt: "2026-01-01" },
      { id: "b", toCollect: { inr: 0, eur: 500 }, createdAt: "2026-01-02" },
    ];
    const { byPlan } = allocatePayments(plans, [
      { pendingPaymentId: null, amount: { inr: 10_000, eur: 500 } },
    ]);
    assert.equal(byPlan.get("a")!.balance.inr, 0);
    assert.equal(byPlan.get("b")!.balance.eur, 0, "the euro side is not blocked by the rupee one");
  });

  test("the order is the plans' own age, not the order they were handed over", () => {
    const plans = [plan("newer", 5_000, "2026-03-01"), plan("older", 5_000, "2026-01-01")];
    const { byPlan } = allocatePayments(plans, [{ pendingPaymentId: null, amount: inr(5_000) }]);
    assert.equal(byPlan.get("older")!.paid.inr, 5_000);
    assert.equal(byPlan.get("newer")!.paid.inr, 0);
  });

  test("two plans created in the same instant still allocate deterministically", () => {
    const a = allocatePayments(
      [plan("b", 5_000, "2026-01-01"), plan("a", 5_000, "2026-01-01")],
      [{ pendingPaymentId: null, amount: inr(5_000) }],
    );
    const b = allocatePayments(
      [plan("a", 5_000, "2026-01-01"), plan("b", 5_000, "2026-01-01")],
      [{ pendingPaymentId: null, amount: inr(5_000) }],
    );
    assert.equal(a.byPlan.get("a")!.paid.inr, b.byPlan.get("a")!.paid.inr);
    assert.equal(a.byPlan.get("a")!.paid.inr, 5_000, "the id breaks the tie, both ways round");
  });
});

describe("when a plan counts as collected in full", () => {
  test("a plan with no schedule goes on its balance alone - the case that stuck on Active", () => {
    assert.equal(isSettled({ balance: { inr: 0, eur: 0 }, instalmentCount: 0, unpaidInstalments: 0 }), true);
  });

  test("a zero balance with instalments still due is NOT settled", () => {
    assert.equal(
      isSettled({ balance: { inr: 0, eur: 0 }, instalmentCount: 6, unpaidInstalments: 3 }),
      false,
      "this is the Riyaz case - the ladder has to agree before the plan is closed",
    );
  });

  test("money still owed is never settled, however the schedule looks", () => {
    assert.equal(isSettled({ balance: { inr: 500, eur: 0 }, instalmentCount: 0, unpaidInstalments: 0 }), false);
    assert.equal(isSettled({ balance: { inr: 0, eur: 50 }, instalmentCount: 2, unpaidInstalments: 0 }), false);
  });

  test("a cent of FX residue in a currency nobody quoted does NOT hold the plan open", () => {
    // The live case: a ₹2,50,000 plan collected to the rupee read "₹0.00 / 0,01 €" and stayed
    // Active, because the plan and the payments were stamped at different rates on different days.
    assert.equal(
      isSettled({ balance: { inr: 0, eur: 1 }, instalmentCount: 0, unpaidInstalments: 0, quotedIn: "INR" }),
      true,
    );
    // ...and the mirror case, for a plan quoted in euro.
    assert.equal(
      isSettled({ balance: { inr: 3, eur: 0 }, instalmentCount: 0, unpaidInstalments: 0, quotedIn: "EUR" }),
      true,
    );
  });

  test("the quoted currency still decides - residue is forgiven, real money is not", () => {
    assert.equal(
      isSettled({ balance: { inr: 50_000, eur: 0 }, instalmentCount: 0, unpaidInstalments: 0, quotedIn: "INR" }),
      false,
      "₹500 outstanding on a rupee-quoted plan is money, not rounding",
    );
  });

  test("a genuinely two-currency plan has to clear BOTH sides", () => {
    assert.equal(
      isSettled({ balance: { inr: 0, eur: 1 }, instalmentCount: 0, unpaidInstalments: 0, quotedIn: "BOTH" }),
      false,
    );
  });

  test("omitting quotedIn keeps the strictest reading", () => {
    // A caller that has not said which side was quoted must never close a debt by accident.
    assert.equal(isSettled({ balance: { inr: 0, eur: 1 }, instalmentCount: 0, unpaidInstalments: 0 }), false);
  });
});

describe("pairing a payment with a plan", () => {
  test("an id always wins over a name", () => {
    assert.notEqual(studentKey("s1", "Anna Smith"), studentKey(null, "Anna Smith"));
    assert.equal(studentKey("s1", "Anna Smith"), studentKey("s1", "someone retyped it"));
  });

  test("names pair case- and whitespace-insensitively", () => {
    assert.equal(studentKey(null, "  anna   smith "), studentKey(null, "Anna Smith"));
  });
});

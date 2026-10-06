import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_PAYMENT_TYPES_CONFIG,
  paymentTypesConfigSchema,
  type PaymentTypesConfig,
} from "../config-schema";
import {
  isLockedPaymentType,
  paymentTypeKind,
  paymentTypeLabel,
  paymentTypeOptions,
  suggestNextBillingDate,
} from "../payment-types";
import {
  ALL_PAYMENT_METHODS,
  currenciesInPlay,
  defaultMethodFor,
  methodsForCurrencies,
} from "../payment-methods";

const cfg = (types: PaymentTypesConfig["types"]): PaymentTypesConfig => ({ types });

describe("payment types - the config guards live data", () => {
  it("accepts the shipped default", () => {
    assert.equal(paymentTypesConfigSchema.safeParse(DEFAULT_PAYMENT_TYPES_CONFIG).success, true);
  });

  /**
   * Every Income row ever recorded stores one of these two codes, and the settlement engine
   * branches on them by name - so dropping one would change what thousands of historic rows mean.
   */
  it("refuses to drop a locked type", () => {
    const res = paymentTypesConfigSchema.safeParse(
      cfg([{ code: "FULL_PAYMENT", label: "Full payment", kind: "FULL", active: true }]),
    );
    assert.equal(res.success, false);
    assert.match(res.success ? "" : res.error.issues[0].message, /INSTALMENT/);
  });

  it("refuses to re-kind a locked type", () => {
    const res = paymentTypesConfigSchema.safeParse(
      cfg([
        { code: "FULL_PAYMENT", label: "Full payment", kind: "FULL", active: true },
        // Re-kinding this would stop every existing plan being chased.
        { code: "INSTALMENT", label: "Instalment", kind: "SUBSCRIPTION", active: true },
      ]),
    );
    assert.equal(res.success, false);
  });

  it("allows a locked type to be RELABELLED and switched off", () => {
    const res = paymentTypesConfigSchema.safeParse(
      cfg([
        { code: "FULL_PAYMENT", label: "Paid up front", kind: "FULL", active: true },
        { code: "INSTALMENT", label: "EMI", kind: "INSTALMENT", active: false },
      ]),
    );
    assert.equal(res.success, true);
  });

  it("refuses two rows with the same code", () => {
    const res = paymentTypesConfigSchema.safeParse(
      cfg([
        { code: "FULL_PAYMENT", label: "Full payment", kind: "FULL", active: true },
        { code: "INSTALMENT", label: "Instalment", kind: "INSTALMENT", active: true },
        { code: "INSTALMENT", label: "Instalment again", kind: "INSTALMENT", active: true },
      ]),
    );
    assert.equal(res.success, false);
  });

  it("refuses a list with nothing active - the form would have nothing to offer", () => {
    const res = paymentTypesConfigSchema.safeParse(
      cfg([
        { code: "FULL_PAYMENT", label: "Full payment", kind: "FULL", active: false },
        { code: "INSTALMENT", label: "Instalment", kind: "INSTALMENT", active: false },
      ]),
    );
    assert.equal(res.success, false);
  });

  it("knows which codes are locked", () => {
    assert.equal(isLockedPaymentType("INSTALMENT"), true);
    assert.equal(isLockedPaymentType("SUBSCRIPTION"), false);
  });
});

describe("payment types - reading a stored code back", () => {
  it("resolves a founder-added type to its kind", () => {
    const config = cfg([
      ...DEFAULT_PAYMENT_TYPES_CONFIG.types,
      { code: "MEMBERSHIP", label: "Membership", kind: "SUBSCRIPTION", active: true },
    ]);
    assert.equal(paymentTypeKind(config, "MEMBERSHIP"), "SUBSCRIPTION");
    assert.equal(paymentTypeLabel(config, "MEMBERSHIP"), "Membership");
  });

  /**
   * FULL is the safe fallback: it asks for nothing further and raises no receivable, so an
   * unrecognised code can never invent a debt or start chasing somebody.
   */
  it("falls back to FULL for a code nobody configured", () => {
    assert.equal(paymentTypeKind(DEFAULT_PAYMENT_TYPES_CONFIG, "NONSENSE"), "FULL");
  });

  it("still offers a deactivated type while editing the row that holds it", () => {
    const config = cfg([
      { code: "FULL_PAYMENT", label: "Full payment", kind: "FULL", active: true },
      { code: "INSTALMENT", label: "Instalment", kind: "INSTALMENT", active: false },
    ]);
    const codes = paymentTypeOptions(config, "INSTALMENT").map((o) => o.value);
    assert.deepEqual(codes, ["FULL_PAYMENT", "INSTALMENT"]);
    // ...and says so, rather than looking like an ordinary choice.
    assert.match(paymentTypeOptions(config, "INSTALMENT")[1].label, /no longer offered/);
  });

  it("leaves a deactivated type out of a NEW entry's list", () => {
    const config = cfg([
      { code: "FULL_PAYMENT", label: "Full payment", kind: "FULL", active: true },
      { code: "INSTALMENT", label: "Instalment", kind: "INSTALMENT", active: false },
    ]);
    assert.deepEqual(paymentTypeOptions(config).map((o) => o.value), ["FULL_PAYMENT"]);
  });
});

describe("suggestNextBillingDate", () => {
  it("steps whole calendar months, clamping a short one", () => {
    assert.equal(suggestNextBillingDate("2026-01-31", "MONTHLY"), "2026-02-28");
    assert.equal(suggestNextBillingDate("2026-03-15", "MONTHLY"), "2026-04-15");
  });

  it("handles the longer intervals", () => {
    assert.equal(suggestNextBillingDate("2026-01-15", "QUARTERLY"), "2026-04-15");
    assert.equal(suggestNextBillingDate("2026-01-15", "HALF_YEARLY"), "2026-07-15");
    assert.equal(suggestNextBillingDate("2026-01-15", "YEARLY"), "2027-01-15");
    assert.equal(suggestNextBillingDate("2026-01-15", "WEEKLY"), "2026-01-22");
  });

  it("returns nothing it cannot work out, so the box is left alone", () => {
    assert.equal(suggestNextBillingDate("", "MONTHLY"), "");
    assert.equal(suggestNextBillingDate("2026-01-15", "FORTNIGHTLY"), "");
  });
});

describe("payment methods - narrowed to the currency entered", () => {
  it("hides the euro-only rails from a rupee payment", () => {
    const inr = methodsForCurrencies(["INR"]);
    assert.equal(inr.includes("BANK_TRANSFER_EUR"), false);
    assert.equal(inr.includes("PAYPAL"), false);
    assert.equal(inr.includes("UPI"), true);
  });

  it("offers exactly the five euro rails the founder named", () => {
    assert.deepEqual([...methodsForCurrencies(["EUR"])], [
      "CREDIT_CARD", "PAYPAL", "BANK_TRANSFER_EUR", "CASH", "OTHER",
    ]);
  });

  it("offers everything for a genuine split payment - both rails were used", () => {
    assert.deepEqual([...methodsForCurrencies(["INR", "EUR"])], [...ALL_PAYMENT_METHODS]);
  });

  it("offers everything on an untouched form - an empty dropdown reads as broken", () => {
    assert.deepEqual([...methodsForCurrencies([])], [...ALL_PAYMENT_METHODS]);
  });

  it("reads which currencies will actually be submitted", () => {
    assert.deepEqual(currenciesInPlay({ inr: "1000", eur: "" }), ["INR"]);
    assert.deepEqual(currenciesInPlay({ inr: "", eur: "500" }), ["EUR"]);
    assert.deepEqual(currenciesInPlay({ inr: "1000", eur: "500" }), ["INR", "EUR"]);
    assert.deepEqual(currenciesInPlay({ inr: "", eur: "" }), []);
  });

  /**
   * The bug this prevents: pick UPI, then type a euro amount. UPI is no longer in the list, so a
   * control left on it would show one thing and submit another.
   */
  it("drops a chosen method that the new currency no longer offers", () => {
    assert.equal(defaultMethodFor(["EUR"], "UPI"), "CREDIT_CARD");
    assert.equal(defaultMethodFor(["INR"], "PAYPAL"), "BANK_TRANSFER_INR");
  });

  it("keeps a chosen method that is still valid", () => {
    assert.equal(defaultMethodFor(["EUR"], "PAYPAL"), "PAYPAL");
    assert.equal(defaultMethodFor(["INR"], "UPI"), "UPI");
    assert.equal(defaultMethodFor(["EUR"], "CASH"), "CASH");
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  asInvoiceCurrency,
  computeInvoiceTotals,
  convertMinorPreview,
  dominantLevelCode,
  formatMinorForDocument,
  lineTotalMinor,
  otherCurrency,
  taxLine,
} from "../invoice-money";
import {
  DEFAULT_INVOICE_SETTINGS,
  invoiceSettingsSchema,
} from "../config-schema";

const line = (unitPrice: string, quantity = 1) => ({ unitPrice, quantity });

describe("invoice totals - the ladder is computed in the issued currency", () => {
  it("adds up lines, then discount, then tax", () => {
    const t = computeInvoiceTotals([line("1000", 2), line("500")], "250", 10);
    assert.equal(t.subtotalMinor, 250000n); // 2x1000 + 500
    assert.equal(t.discountMinor, 25000n);
    assert.equal(t.taxableMinor, 225000n);
    assert.equal(t.taxMinor, 22500n); // 10% of the DISCOUNTED base, not the subtotal
    assert.equal(t.totalMinor, 247500n);
  });

  /** A quantity of 0 or a missing one is treated as 1 - a line still charges for something. */
  it("floors quantity at one", () => {
    assert.equal(lineTotalMinor({ unitPrice: "99.99", quantity: 0 }), 9999n);
  });

  /**
   * A discount bigger than the invoice must not produce a negative tax base. Before this, a
   * taxable amount of -₹500 would have generated NEGATIVE tax - an invoice crediting the
   * customer for tax nobody charged.
   */
  it("floors the taxable amount at zero when the discount swallows the invoice", () => {
    const t = computeInvoiceTotals([line("100")], "500", 18);
    assert.equal(t.taxableMinor, 0n);
    assert.equal(t.taxMinor, 0n);
    assert.equal(t.totalMinor, 0n);
  });

  it("handles a fractional rate and rounds the tax once, half-up", () => {
    // 7.5% of ₹1,000.05 = ₹75.00375 → 7500 paise
    const t = computeInvoiceTotals([line("1000.05")], "", 7.5);
    assert.equal(t.taxMinor, 7500n);
  });

  /** The reason the math is done in the entered currency: tax must equal rate x base exactly. */
  it("gives a euro invoice a tax line that equals the rate times its own base", () => {
    const t = computeInvoiceTotals([line("1000")], "", 19);
    assert.equal(t.taxableMinor, 100000n);
    assert.equal(t.taxMinor, 19000n);
    assert.equal(t.totalMinor, 119000n);
  });

  it("refuses to be fooled by a junk rate", () => {
    assert.equal(computeInvoiceTotals([line("100")], "", Number.NaN).taxMinor, 0n);
    assert.equal(computeInvoiceTotals([line("100")], "", -5).taxMinor, 0n);
    // Capped at 100: a tax that exceeds the fee is a typo, not a rate.
    assert.equal(computeInvoiceTotals([line("100")], "", 500).taxMinor, 10000n);
  });
});

describe("the tax line - zero means NO line, not a line reading zero", () => {
  it("disappears at 0%", () => {
    assert.equal(taxLine("GST", 0), null);
    assert.equal(taxLine("VAT", -1), null);
  });

  it("names itself and prints whole and fractional rates cleanly", () => {
    assert.equal(taxLine("GST", 18), "GST (18%)");
    assert.equal(taxLine("VAT", 7.5), "VAT (7.5%)");
  });

  it("falls back to 'Tax' rather than printing an empty bracket", () => {
    assert.equal(taxLine("", 19), "Tax (19%)");
    assert.equal(taxLine(null, 19), "Tax (19%)");
  });
});

describe("currency", () => {
  it("defaults anything unrecognised to the historic currency", () => {
    assert.equal(asInvoiceCurrency("EUR"), "EUR");
    assert.equal(asInvoiceCurrency("INR"), "INR");
    assert.equal(asInvoiceCurrency(undefined), "INR");
    assert.equal(asInvoiceCurrency("USD"), "INR");
  });

  it("pairs each currency with the other one", () => {
    assert.equal(otherCurrency("INR"), "EUR");
    assert.equal(otherCurrency("EUR"), "INR");
  });

  it("converts both ways at a given rate, and not at all without one", () => {
    assert.equal(convertMinorPreview(900000n, 90, "INR", "EUR"), 10000n);
    assert.equal(convertMinorPreview(10000n, 90, "EUR", "INR"), 900000n);
    assert.equal(convertMinorPreview(10000n, 0, "EUR", "INR"), 10000n);
    assert.equal(convertMinorPreview(10000n, 90, "EUR", "EUR"), 10000n);
  });

  /**
   * The PDF's built-in Helvetica is WinAnsi-encoded and has no ₹, which printed as a blank box
   * on the one surface a customer is most likely to keep.
   */
  it("writes document money with an ISO code and no symbol", () => {
    assert.equal(formatMinorForDocument(12500050n, "INR").includes("₹"), false);
    assert.match(formatMinorForDocument(12500050n, "INR"), /INR$/);
    assert.equal(formatMinorForDocument(12500050n, "EUR").includes("€"), false);
    assert.match(formatMinorForDocument(12500050n, "EUR"), /EUR$/);
  });
});

describe("programme attribution - which level a paid invoice posts its income against", () => {
  const l = (levelCode: string | null, unit: number, quantity = 1) => ({
    levelCode,
    quantity,
    unitPriceMinor: BigInt(unit),
  });

  it("is the biggest programme line, not the first one", () => {
    assert.equal(dominantLevelCode([l("GN_A1", 5000), l("ELITE", 20000)]), "ELITE");
  });

  it("adds a programme's lines together before comparing", () => {
    // Two GN_A1 lines of 6,000 beat one ELITE line of 10,000.
    assert.equal(dominantLevelCode([l("GN_A1", 6000, 2), l("ELITE", 10000)]), "GN_A1");
  });

  it("ignores hand-typed lines, and gives up honestly when there are only those", () => {
    assert.equal(dominantLevelCode([l(null, 99999), l("GN_B1", 100)]), "GN_B1");
    assert.equal(dominantLevelCode([l(null, 99999)]), null);
    assert.equal(dominantLevelCode([]), null);
  });
});

describe("invoice settings", () => {
  it("accepts the shipped default", () => {
    assert.equal(invoiceSettingsSchema.safeParse(DEFAULT_INVOICE_SETTINGS).success, true);
  });

  /**
   * Shipped at 0 on purpose: a default rate invented by a source file would print on a real
   * document as a tax demand nobody authorised.
   */
  it("charges nothing until a founder types a rate", () => {
    assert.equal(DEFAULT_INVOICE_SETTINGS.tax.INR.percent, 0);
    assert.equal(DEFAULT_INVOICE_SETTINGS.tax.EUR.percent, 0);
    assert.equal(taxLine(DEFAULT_INVOICE_SETTINGS.tax.INR.label, DEFAULT_INVOICE_SETTINGS.tax.INR.percent), null);
  });

  it("rejects a rate that is not a rate", () => {
    const bad = {
      ...DEFAULT_INVOICE_SETTINGS,
      tax: { ...DEFAULT_INVOICE_SETTINGS.tax, EUR: { label: "VAT", percent: 120 } },
    };
    assert.equal(invoiceSettingsSchema.safeParse(bad).success, false);
  });

  /** Every issuer field is optional, because an invoice must never print an invented tax number. */
  it("accepts an issuer with nothing filled in", () => {
    const parsed = invoiceSettingsSchema.safeParse({
      issuer: {},
      tax: DEFAULT_INVOICE_SETTINGS.tax,
    });
    assert.equal(parsed.success, true);
    assert.deepEqual(parsed.success ? parsed.data.issuer.addressLines : null, []);
    assert.equal(parsed.success ? parsed.data.issuer.taxId : null, "");
  });
});

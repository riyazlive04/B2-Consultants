import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  amountInWords,
  documentNumber,
  invoiceIssueGaps,
  isProvisionalNumber,
  issueBlockedMessage,
  provisionalNumber,
  sequenceKey,
  type IssueCheckInput,
} from "../invoice-compliance";
import { DEFAULT_INVOICE_SETTINGS, coerceInvoiceSettings } from "../config-schema";
import { AGREEMENT_INVOICE_TERMS, AGREEMENT_PROVIDER } from "../agreement";

describe("document numbers - INV-yy9999", () => {
  it("is the prefix, the two-digit year and a four-digit counter", () => {
    assert.equal(documentNumber("INV", 2026, 1), "INV-260001");
    assert.equal(documentNumber("INV", 2026, 42), "INV-260042");
    assert.equal(documentNumber("RCT", 2027, 9999), "RCT-279999");
    assert.equal(documentNumber("EST", 2030, 7), "EST-300007");
  });

  it("refuses a 10,000th document rather than printing a five-digit tail", () => {
    assert.throws(() => documentNumber("INV", 2026, 10000), /series is full/);
    assert.throws(() => documentNumber("INV", 2026, 0), RangeError);
    assert.throws(() => documentNumber("INV", 2026, 1.5), RangeError);
  });

  it("keeps one counter per series per year", () => {
    assert.equal(sequenceKey("INV", 2026), "INV-26");
    assert.notEqual(sequenceKey("INV", 2026), sequenceKey("INV", 2027));
    assert.notEqual(sequenceKey("INV", 2026), sequenceKey("RCT", 2026));
  });

  it("can never confuse a draft's placeholder with a real number", () => {
    assert.ok(isProvisionalNumber(provisionalNumber("A1B2C3D4E5")));
    assert.ok(!isProvisionalNumber("INV-260001"));
    assert.ok(!isProvisionalNumber("INV-0007")); // the pre-October format stays a real number
  });
});

const complete: IssueCheckInput = {
  issuer: {
    name: "B2 Consultants",
    ownerName: "Ameenur Rahaman Servarr Basha",
    addressLines: ["Alter Weg 49"],
    postcode: "64385",
    city: "Reichelsheim",
    country: "Germany",
    taxId: "012 345 67890",
  },
  customerName: "Priya Nair",
  customerAddress: "12 MG Road\nBengaluru 560038",
  servicePeriodStart: new Date("2026-11-02T00:00:00Z"),
  taxPercent: 0,
  taxNote: "Not taxable in Germany.",
};

describe("what an invoice needs before it can be issued (§14 Abs. 4 UStG)", () => {
  it("issues when every required fact is there", () => {
    assert.deepEqual(invoiceIssueGaps(complete), []);
  });

  it("needs the tax number, which no default can supply", () => {
    const gaps = invoiceIssueGaps({ ...complete, issuer: { ...complete.issuer, taxId: " " } });
    assert.equal(gaps.length, 1);
    assert.match(gaps[0], /Steuernummer/);
  });

  it("needs the owner's own name, not only the trading name", () => {
    assert.match(invoiceIssueGaps({ ...complete, issuer: { ...complete.issuer, ownerName: "" } })[0], /legal name/);
  });

  it("needs the customer's address and the service date", () => {
    const gaps = invoiceIssueGaps({ ...complete, customerAddress: null, servicePeriodStart: null });
    assert.equal(gaps.length, 2);
    assert.match(gaps.join(), /postal address/);
    assert.match(gaps.join(), /service date/);
  });

  it("needs a reason when no tax is charged - but not when tax is", () => {
    assert.match(invoiceIssueGaps({ ...complete, taxNote: null })[0], /why no tax/);
    assert.deepEqual(invoiceIssueGaps({ ...complete, taxNote: null, taxPercent: 19 }), []);
  });

  it("lists every gap in one message", () => {
    const msg = issueBlockedMessage(invoiceIssueGaps({ ...complete, customerAddress: "", taxNote: "" }));
    assert.match(msg, /^This invoice can't be issued yet\. Add .*postal address.*; .*why no tax/);
  });
});

describe("the defaults are the business's real details", () => {
  it("prints the agreement's party block on a never-saved config", () => {
    const iss = DEFAULT_INVOICE_SETTINGS.issuer;
    assert.equal(iss.ownerName, AGREEMENT_PROVIDER.name);
    assert.deepEqual(iss.addressLines, ["Alter Weg 49"]);
    assert.equal(iss.postcode, "64385");
    assert.equal(iss.city, "Reichelsheim");
    assert.match(iss.bankDetails, /DE74 5001 0517 6000 2479 49/);
    // The one fact a file cannot know - so a default config can't issue until it is entered.
    assert.equal(iss.taxId, "");
  });

  it("reads a config saved before ownerName / tax notes existed", () => {
    const old = {
      issuer: { ...DEFAULT_INVOICE_SETTINGS.issuer, ownerName: undefined },
      tax: { INR: { label: "GST", percent: 0 }, EUR: { label: "VAT", percent: 0 } },
    };
    const read = coerceInvoiceSettings(JSON.parse(JSON.stringify(old)));
    assert.equal(read.issuer.ownerName, "");
    assert.equal(read.tax.EUR.note, "");
  });

  it("restates the agreement's payment terms, clause by clause, with no late fee", () => {
    assert.equal(AGREEMENT_INVOICE_TERMS.length, 3);
    assert.match(AGREEMENT_INVOICE_TERMS[0], /^§7\.3.*No penalty fee/);
    assert.match(AGREEMENT_INVOICE_TERMS[1], /^§7\.4.*2\.5%/);
    assert.match(AGREEMENT_INVOICE_TERMS[2], /^§8.*non-refundable and non-transferable/);
  });
});

describe("amount in words", () => {
  it("reads rupees the Indian way - lakh and crore", () => {
    assert.equal(amountInWords(12_500_000n, "INR"), "Indian Rupees One Lakh Twenty-Five Thousand Only");
    assert.equal(amountInWords(12_500_050n, "INR"), "Indian Rupees One Lakh Twenty-Five Thousand and Fifty Paise Only");
    assert.equal(amountInWords(123_456_789_00n, "INR"), "Indian Rupees Twelve Crore Thirty-Four Lakh Fifty-Six Thousand Seven Hundred Eighty-Nine Only");
  });

  it("reads euros the international way", () => {
    assert.equal(amountInWords(125_000n, "EUR"), "Euros One Thousand Two Hundred Fifty Only");
    assert.equal(amountInWords(1_234_567_01n, "EUR"), "Euros One Million Two Hundred Thirty-Four Thousand Five Hundred Sixty-Seven and One Cent Only");
  });

  it("handles nothing and round hundreds", () => {
    assert.equal(amountInWords(0n, "INR"), "Indian Rupees Zero Only");
    assert.equal(amountInWords(30_000n, "EUR"), "Euros Three Hundred Only");
  });
});

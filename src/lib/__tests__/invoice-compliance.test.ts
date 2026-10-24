import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  amountInWords,
  documentNumber,
  invoiceIssueGaps,
  invoiceIssueGapsFor,
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

/**
 * THE DRAFT HAS TO BE ABLE TO ANSWER THIS TOO.
 *
 * `invoiceIssueGaps` was reached from exactly one place - inside the transaction that issues -
 * so no screen could ask a draft whether it was issuable, and the editor drew a Send button on
 * every draft including the ones the server would refuse. Pressing it returned four requirements
 * at once, which was the first the operator heard of any of them; on a fresh install, and on
 * live where the Tax ID is still blank, that is EVERY invoice.
 *
 * `invoiceIssueGapsFor` is what both sides now call. These tests exist to keep them the same
 * computation: the tax-note fallback below is the part that would otherwise drift, because it
 * decides issuability and lives on neither the invoice nor the check.
 */
describe("asking a draft what it still needs", () => {
  const draftOf = (over: Partial<Parameters<typeof invoiceIssueGapsFor>[0]["invoice"]> = {}) => ({
    customerName: complete.customerName,
    customerAddress: complete.customerAddress,
    servicePeriodStart: complete.servicePeriodStart,
    taxPercent: complete.taxPercent,
    taxNote: complete.taxNote,
    ...over,
  });

  it("agrees with the issue-time check when everything is present", () => {
    assert.deepEqual(
      invoiceIssueGapsFor({ issuer: complete.issuer, invoice: draftOf(), fallbackTaxNote: "" }),
      [],
    );
  });

  it("a 0% invoice with no note of its own inherits the Console's note", () => {
    // The rule that makes setting the note ONCE unblock every waiting draft. A readiness check
    // that skipped it would report a gap the issue path does not see - two answers, one question.
    const gaps = invoiceIssueGapsFor({
      issuer: complete.issuer,
      invoice: draftOf({ taxNote: null }),
      fallbackTaxNote: "Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.",
    });
    assert.deepEqual(gaps, []);
  });

  it("...and is still short of one when neither the invoice nor the Console has a note", () => {
    const gaps = invoiceIssueGapsFor({
      issuer: complete.issuer,
      invoice: draftOf({ taxNote: null }),
      fallbackTaxNote: "   ",
    });
    assert.equal(gaps.length, 1);
    assert.match(gaps[0], /why no tax/);
  });

  it("a note is irrelevant once tax is actually charged", () => {
    assert.deepEqual(
      invoiceIssueGapsFor({
        issuer: complete.issuer,
        invoice: draftOf({ taxNote: null, taxPercent: 19 }),
        fallbackTaxNote: "",
      }),
      [],
    );
  });

  it("takes the editor's date-input string as readily as the row's Date", () => {
    // The editor's DTO carries "YYYY-MM-DD" (and "" for unset); the row carries a Date. Only
    // presence matters, and both spellings have to reach the same verdict.
    assert.deepEqual(
      invoiceIssueGapsFor({
        issuer: complete.issuer,
        invoice: draftOf({ servicePeriodStart: "2026-11-02" }),
        fallbackTaxNote: "",
      }),
      [],
    );
    const unset = invoiceIssueGapsFor({
      issuer: complete.issuer,
      invoice: draftOf({ servicePeriodStart: "" }),
      fallbackTaxNote: "",
    });
    assert.equal(unset.length, 1);
    assert.match(unset[0], /service date or period/);
  });

  it("names every blocker a fresh install has, so the draft can list them", () => {
    // The exact state found on 24/10/2026: issuer block filled except the Tax ID, a rupee
    // invoice with no customer address, no service date and no tax note anywhere.
    const gaps = invoiceIssueGapsFor({
      issuer: { ...complete.issuer, taxId: "" },
      invoice: draftOf({ customerAddress: null, servicePeriodStart: null, taxNote: null }),
      fallbackTaxNote: "",
    });
    assert.equal(gaps.length, 4);
    assert.match(issueBlockedMessage(gaps), /Steuernummer/);
  });
});

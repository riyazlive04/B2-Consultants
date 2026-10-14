/**
 * Render SAMPLE invoices through the real document code.
 *
 *   npm run sample:invoice
 *
 * (The script sets TSX_TSCONFIG_PATH itself: the app's tsconfig leaves JSX to Next, and a plain
 * node run has no compiler after esbuild, so the document modules - which never import React -
 * would fail on classic `React.createElement`. See tsconfig.scripts.json.)
 *
 * Writes `sample-invoice-inr.pdf` and `sample-invoice-eur.pdf` to the project root. Nothing here
 * touches the database: it hands `renderInvoicePdf` the same shape `payments-metrics` builds, so
 * what comes out is exactly what a real invoice prints - the brand mark, the registered issuer
 * block, the line items, the tax line, both currencies and the "issued by" footer.
 *
 * Two files because the two halves of the business bill differently: a rupee invoice for a B2
 * coaching tier under GST, and a euro invoice for German Note levels under VAT. The second is
 * also the case the old single-currency document could not produce at all.
 *
 * The issuer details below are PLACEHOLDERS for the sample only. The real ones live in
 * Console → Money → Invoicing and are read at print time; anything left blank there is simply
 * left off the document rather than printed as a placeholder.
 */

import { writeFile } from "node:fs/promises";
import path from "node:path";
import { renderInvoicePdf, type InvoicePdfData } from "../src/documents/invoice-pdf";
import { renderReceiptPdf } from "../src/documents/receipt-pdf";
import { formatMinorForDocument, taxLine, type InvoiceCurrencyCode } from "../src/lib/invoice-money";
import { AGREEMENT_INVOICE_TERMS, AGREEMENT_RECEIPT_TERM } from "../src/lib/agreement";
import { amountInWords } from "../src/lib/invoice-compliance";

const RATE = 92.4; // INR per EUR, as an invoice would have stamped it

const issuer: InvoicePdfData["issuer"] = {
  name: "B2 Consultants",
  ownerName: "Erika Mustermann",
  addressLines: ["Beispielstraße 12"],
  city: "Reichelsheim",
  postcode: "64385",
  country: "Germany",
  email: "billing@b2consultants.de",
  phone: "+49 6164 000000",
  website: "b2consultants.de",
  taxId: "DE000000000",
  registrationNo: "HRB 00000",
  bankDetails: "B2 Consultants\nIBAN  DE00 0000 0000 0000 0000 00\nBIC   XXXXDEFFXXX\nReference: the invoice number",
  paymentTerms: "Payable within 14 days of the issue date. Late payment may pause course access.",
};

type SampleLine = { description: string; quantity: number; unitMinor: bigint };

/** Build one finished document from a few honest inputs, exactly as the server does. */
function sample(opts: {
  number: string;
  currency: InvoiceCurrencyCode;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  customerAddress: string[];
  issueDate: string;
  dueDate: string;
  servicePeriod: string;
  agreementRef: string | null;
  lines: SampleLine[];
  discountMinor: bigint;
  taxLabel: string;
  taxPercent: number;
  paidMinor: bigint;
  notes: string | null;
  taxNote?: string;
}): InvoicePdfData {
  const { currency } = opts;
  const money = (m: bigint) => formatMinorForDocument(m, currency);
  const subtotal = opts.lines.reduce((a, l) => a + l.unitMinor * BigInt(l.quantity), 0n);
  const taxableRaw = subtotal - opts.discountMinor;
  const taxable = taxableRaw > 0n ? taxableRaw : 0n;
  const tax = BigInt(Math.round((Number(taxable) * opts.taxPercent) / 100));
  const total = taxable + tax;
  const converted = currency === "INR"
    ? BigInt(Math.round(Number(total) / RATE))
    : BigInt(Math.round(Number(total) * RATE));
  const other: InvoiceCurrencyCode = currency === "INR" ? "EUR" : "INR";
  const balance = total - opts.paidMinor;

  return {
    kind: "INVOICE",
    number: opts.number,
    status: balance <= 0n ? "PAID" : opts.paidMinor > 0n ? "PARTIAL" : "SENT",
    currency,
    issuer,
    issueDate: opts.issueDate,
    dueDate: opts.dueDate,
    customerName: opts.customerName,
    customerEmail: opts.customerEmail,
    customerPhone: opts.customerPhone,
    customerAddressLines: opts.customerAddress,
    servicePeriod: opts.servicePeriod,
    agreementRef: opts.agreementRef,
    agreementTerms: opts.agreementRef ? [...AGREEMENT_INVOICE_TERMS] : [],
    paymentReference: opts.number,
    taxNote: opts.taxPercent > 0 ? null : opts.taxNote ?? null,
    issuedByName: "Ameen Khan",
    items: opts.lines.map((l) => ({
      description: l.description,
      quantity: l.quantity,
      unitPriceDisplay: money(l.unitMinor),
      lineTotalDisplay: money(l.unitMinor * BigInt(l.quantity)),
    })),
    subtotalDisplay: money(subtotal),
    discountDisplay: opts.discountMinor > 0n ? money(opts.discountMinor) : null,
    taxLineLabel: taxLine(opts.taxLabel, opts.taxPercent),
    taxDisplay: opts.taxPercent > 0 ? money(tax) : null,
    totalDisplay: money(total),
    convertedTotalDisplay: formatMinorForDocument(converted, other),
    convertedRateNote: `Converted at 1 EUR = ${RATE.toFixed(2)} INR on the issue date`,
    amountPaidDisplay: money(opts.paidMinor),
    balanceDisplay: money(balance > 0n ? balance : 0n),
    settled: balance <= 0n,
    notes: opts.notes,
  };
}

const inr = sample({
  number: "INV-260042",
  currency: "INR",
  customerName: "Priya Nair",
  customerEmail: "priya.nair@example.com",
  customerPhone: "+91 98765 43210",
  customerAddress: ["12 MG Road, Indiranagar", "Bengaluru 560038", "India"],
  issueDate: "07/10/2026",
  dueDate: "21/10/2026",
  servicePeriod: "02/11/2026 - 31/01/2027",
  agreementRef: "B2-GM-2026-0042",
  lines: [
    { description: "Guided - 90-day placement coaching", quantity: 1, unitMinor: 15_000_000n },
    { description: "Resume & LinkedIn rebuild (add-on)", quantity: 1, unitMinor: 500_000n },
  ],
  discountMinor: 500_000n,
  taxLabel: "GST",
  taxPercent: 0,
  taxNote: "Example only - the reason no tax is charged, as set in Console > Money > Invoicing.",
  paidMinor: 5_000_000n,
  notes: "Instalment 1 of 3 received. The balance falls due on the date above.",
});

const eur = sample({
  number: "INV-260043",
  currency: "EUR",
  customerName: "Lukas Brandt",
  customerEmail: "lukas.brandt@example.de",
  customerPhone: "+49 151 0000000",
  customerAddress: ["Hauptstraße 5", "60311 Frankfurt am Main", "Germany"],
  issueDate: "07/10/2026",
  dueDate: "21/10/2026",
  servicePeriod: "01/11/2026",
  agreementRef: null,
  lines: [
    { description: "German Note - GN A1 course", quantity: 1, unitMinor: 49_000n },
    { description: "German Note - GN A2 course", quantity: 1, unitMinor: 54_000n },
    { description: "Printed course books (A1 + A2)", quantity: 2, unitMinor: 1_400n },
  ],
  discountMinor: 5_000n,
  taxLabel: "VAT",
  taxPercent: 19,
  paidMinor: 0n,
  notes: "Seats are held for 7 days from the issue date.",
});

// Wrapped in main() rather than written at the top level: tsx transpiles a script in this repo
// to CJS, where top-level await is a syntax error.
async function main(): Promise<void> {
  const root = path.resolve(__dirname, "..");
  for (const [file, data] of [
    ["sample-invoice-inr.pdf", inr],
    ["sample-invoice-eur.pdf", eur],
  ] as const) {
    const bytes = await renderInvoicePdf(data);
    const out = path.join(root, file);
    await writeFile(out, bytes);
    console.log(`${out}  (${(bytes.length / 1024).toFixed(1)} KB)`);
  }
  const receipt = await renderReceiptPdf({
    receiptNumber: "RCT-260017",
    receiptDate: "08/10/2026",
    issuer,
    currency: "INR",
    customerName: inr.customerName,
    customerAddressLines: inr.customerAddressLines,
    customerEmail: inr.customerEmail,
    amountDisplay: formatMinorForDocument(5_000_000n, "INR"),
    amountWords: amountInWords(5_000_000n, "INR"),
    method: "Bank transfer",
    reference: "UTR 412345678901",
    invoiceNumber: inr.number,
    invoiceDate: inr.issueDate,
    invoiceTotalDisplay: inr.totalDisplay,
    paidToDateDisplay: inr.amountPaidDisplay,
    balanceDisplay: inr.balanceDisplay,
    settled: false,
    agreementRef: inr.agreementRef,
    agreementTerm: AGREEMENT_RECEIPT_TERM,
    recordedByName: "Ameen Khan",
  });
  const receiptOut = path.join(root, "sample-receipt-inr.pdf");
  await writeFile(receiptOut, receipt);
  console.log(`${receiptOut}  (${(receipt.length / 1024).toFixed(1)} KB)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

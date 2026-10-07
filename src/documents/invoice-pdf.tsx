import { Document, Page, Text, View, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import type { Style } from "@react-pdf/stylesheet";
import { PdfBrandMark, BRAND_INDIGO } from "./pdf-brand";

/**
 * The invoice / estimate PDF - the document a customer prints, files and pays against.
 *
 * PURE: it takes pre-formatted display data (`server/payments-metrics.invoiceDocument`) and lays
 * it out. Nothing here formats money, converts a currency or reads a setting, so the PDF and the
 * public web page can never disagree about what was billed.
 *
 * ── WHAT MAKES IT A REAL INVOICE, NOT A RECEIPT-LOOKING PAGE ──────────────────────
 * Three things were missing, and each of them is the kind of omission that gets an invoice
 * queried or rejected:
 *
 *   · THE ISSUER. "B2 Consultants / Reichelsheim, Germany" was hard-coded here. An invoice has to
 *     state who is issuing it - registered name, full address, and the tax registration it is
 *     charging tax under. Those are facts about a company, so they now come from the founder's
 *     own settings and EVERY EMPTY ONE IS OMITTED rather than printed as a placeholder.
 *
 *   · WHO RAISED IT. A document nobody is named on is a document nobody can be asked about.
 *
 *   · HOW TO PAY IT. An invoice that does not say where the money goes is asking the customer to
 *     go and find out.
 *
 * ── GLYPHS ───────────────────────────────────────────────────────────────────────
 * The built-in Helvetica uses WinAnsi encoding, which has no ₹ (U+20B9) - it renders as a blank
 * box. Every amount therefore arrives here already written as "1,25,000.50 INR"
 * (`formatMinorForDocument`), which is also the normal convention on a cross-border invoice.
 */

export type InvoicePdfData = {
  kind: "INVOICE" | "ESTIMATE";
  number: string;
  status: string;
  currency: "INR" | "EUR";
  issuer: {
    name: string;
    addressLines: string[];
    city: string;
    postcode: string;
    country: string;
    email: string;
    phone: string;
    website: string;
    taxId: string;
    registrationNo: string;
    bankDetails: string;
    paymentTerms: string;
  };
  issueDate: string; // formatted DD/MM/YYYY
  dueDate: string | null;
  customerName: string;
  customerEmail: string | null;
  customerPhone: string | null;
  issuedByName: string | null;
  items: { description: string; quantity: number; unitPriceDisplay: string; lineTotalDisplay: string }[];
  subtotalDisplay: string;
  /** null when nothing was discounted - the row is dropped rather than printed as zero. */
  discountDisplay: string | null;
  /** e.g. "VAT (19%)", or null when the invoice carries no tax at all. */
  taxLineLabel: string | null;
  taxDisplay: string | null;
  totalDisplay: string;
  convertedTotalDisplay: string;
  convertedRateNote: string;
  amountPaidDisplay: string;
  balanceDisplay: string;
  settled: boolean;
  notes: string | null;
};

const INK = "#16203A";
const MUTED = "#636F85";
const LINE = "#CBD6E6";
const LINE_SOFT = "#E2E9F3";

const s = StyleSheet.create({
  // A flex COLUMN page, so the footer can be pinned with `marginTop: auto`. It was positioned
  // absolutely against the page's bottom edge - which react-pdf resolves against the laid-out
  // CONTENT height, not the paper, so on any invoice shorter than a full page the footer was
  // placed past the end of the sheet and simply never printed. (The old "Thank you" footer had
  // the same style and the same silent failure.)
  page: {
    padding: 40, paddingBottom: 36, fontSize: 9.5, fontFamily: "Helvetica", color: INK,
    lineHeight: 1.45, flexDirection: "column",
  },
  between: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  brand: { fontSize: 18, fontFamily: "Helvetica-Bold", color: BRAND_INDIGO },
  // An explicit lineHeight, because the page's 1.45 does NOT reach a Text with its own font
  // size here: without it the title's line box was shorter than its own 24pt capitals and the
  // invoice number printed straight through the bottom of the word "INVOICE".
  title: { fontSize: 24, fontFamily: "Helvetica-Bold", letterSpacing: 1, lineHeight: 1.25 },
  muted: { color: MUTED },
  label: { color: MUTED, fontSize: 7.5, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 3 },
  bold: { fontFamily: "Helvetica-Bold" },
  rule: { borderBottomWidth: 1, borderColor: LINE, marginTop: 18 },

  parties: { flexDirection: "row", marginTop: 22 },
  party: { flex: 1, paddingRight: 16 },
  meta: { width: 170 },
  metaRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 1.5 },

  th: { flexDirection: "row", backgroundColor: "#F4F7FC", paddingVertical: 6, paddingHorizontal: 8, marginTop: 24 },
  td: { flexDirection: "row", borderBottomWidth: 1, borderColor: LINE_SOFT, paddingVertical: 7, paddingHorizontal: 8 },
  cDesc: { flex: 5 },
  cQty: { flex: 1, textAlign: "right" },
  cUnit: { flex: 2, textAlign: "right" },
  cTot: { flex: 2, textAlign: "right" },

  totals: { marginTop: 14, alignSelf: "flex-end", width: 240 },
  totalRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2.5 },
  grand: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    marginTop: 6, paddingVertical: 7, paddingHorizontal: 8,
    backgroundColor: "#F4F7FC", borderLeftWidth: 3, borderColor: BRAND_INDIGO,
  },
  grandText: { fontFamily: "Helvetica-Bold", fontSize: 12 },

  blocks: { flexDirection: "row", marginTop: 26 },
  block: { flex: 1, paddingRight: 16 },

  footer: {
    marginTop: "auto", paddingTop: 8,
    borderTopWidth: 1, borderColor: LINE_SOFT,
    flexDirection: "row", justifyContent: "space-between",
    color: MUTED, fontSize: 7.5,
  },
});

/** A line of text, or nothing at all when it is empty - no blank rows, no placeholders. */
function Line({ children, style }: { children?: string | null; style?: Style | Style[] }) {
  if (!children || !children.trim()) return null;
  return <Text style={style}>{children}</Text>;
}

/** A labelled block that disappears entirely when it has nothing to say. */
function Block({ label, text }: { label: string; text: string | null }) {
  if (!text || !text.trim()) return null;
  return (
    <View style={s.block}>
      <Text style={s.label}>{label}</Text>
      {text.split("\n").map((l, i) => (
        <Text key={i}>{l}</Text>
      ))}
    </View>
  );
}

function InvoiceDoc({ inv }: { inv: InvoicePdfData }) {
  const title = inv.kind === "ESTIMATE" ? "ESTIMATE" : "INVOICE";
  const iss = inv.issuer;
  // "64385 Reichelsheim" is one line in German practice; either half alone still reads correctly.
  const cityLine = [iss.postcode, iss.city].filter(Boolean).join(" ");

  return (
    <Document
      title={`${title} ${inv.number}`}
      author={iss.name}
      subject={`${title} ${inv.number} for ${inv.customerName}`}
    >
      <Page size="A4" style={s.page}>
        {/* ── Header: who is issuing, and what this document is ── */}
        <View style={s.between}>
          <View style={{ flexDirection: "row", alignItems: "flex-start" }}>
            <PdfBrandMark size={40} />
            <View style={{ marginLeft: 11 }}>
              <Text style={s.brand}>{iss.name}</Text>
              <View style={{ marginTop: 2 }}>
                {iss.addressLines.map((l, i) => (
                  <Text key={i} style={s.muted}>{l}</Text>
                ))}
                <Line style={s.muted}>{cityLine}</Line>
                <Line style={s.muted}>{iss.country}</Line>
              </View>
            </View>
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={s.title}>{title}</Text>
            <Text style={[s.bold, { marginTop: 4 }]}>{inv.number}</Text>
            <Text style={s.muted}>{inv.status}</Text>
          </View>
        </View>

        <View style={s.rule} />

        {/* ── Parties and dates ── */}
        <View style={s.parties}>
          <View style={s.party}>
            <Text style={s.label}>Bill to</Text>
            <Text style={s.bold}>{inv.customerName}</Text>
            <Line style={s.muted}>{inv.customerEmail}</Line>
            <Line style={s.muted}>{inv.customerPhone}</Line>
          </View>
          <View style={s.party}>
            <Text style={s.label}>Contact</Text>
            <Line style={s.muted}>{iss.email}</Line>
            <Line style={s.muted}>{iss.phone}</Line>
            <Line style={s.muted}>{iss.website}</Line>
          </View>
          <View style={s.meta}>
            <View style={s.metaRow}>
              <Text style={s.muted}>Issued</Text>
              <Text>{inv.issueDate}</Text>
            </View>
            {inv.dueDate ? (
              <View style={s.metaRow}>
                <Text style={s.muted}>Due</Text>
                <Text style={s.bold}>{inv.dueDate}</Text>
              </View>
            ) : null}
            <View style={s.metaRow}>
              <Text style={s.muted}>Currency</Text>
              <Text>{inv.currency}</Text>
            </View>
            {iss.taxId ? (
              <View style={s.metaRow}>
                <Text style={s.muted}>Tax ID</Text>
                <Text>{iss.taxId}</Text>
              </View>
            ) : null}
            {iss.registrationNo ? (
              <View style={s.metaRow}>
                <Text style={s.muted}>Reg. no.</Text>
                <Text>{iss.registrationNo}</Text>
              </View>
            ) : null}
          </View>
        </View>

        {/* ── What is being charged for ── */}
        <View style={s.th}>
          <Text style={[s.cDesc, s.label, { marginBottom: 0 }]}>Description</Text>
          <Text style={[s.cQty, s.label, { marginBottom: 0 }]}>Qty</Text>
          <Text style={[s.cUnit, s.label, { marginBottom: 0 }]}>Unit price</Text>
          <Text style={[s.cTot, s.label, { marginBottom: 0 }]}>Amount</Text>
        </View>
        {inv.items.map((it, i) => (
          <View key={i} style={s.td} wrap={false}>
            <Text style={s.cDesc}>{it.description}</Text>
            <Text style={s.cQty}>{it.quantity}</Text>
            <Text style={s.cUnit}>{it.unitPriceDisplay}</Text>
            <Text style={[s.cTot, s.bold]}>{it.lineTotalDisplay}</Text>
          </View>
        ))}

        {/* ── What it comes to. A row that would read zero is left out entirely. ── */}
        <View style={s.totals}>
          <View style={s.totalRow}>
            <Text style={s.muted}>Subtotal</Text>
            <Text>{inv.subtotalDisplay}</Text>
          </View>
          {inv.discountDisplay ? (
            <View style={s.totalRow}>
              <Text style={s.muted}>Discount</Text>
              <Text>-{inv.discountDisplay}</Text>
            </View>
          ) : null}
          {inv.taxLineLabel && inv.taxDisplay ? (
            <View style={s.totalRow}>
              <Text style={s.muted}>{inv.taxLineLabel}</Text>
              <Text>{inv.taxDisplay}</Text>
            </View>
          ) : null}
          <View style={s.grand}>
            <Text style={s.grandText}>{inv.settled ? "Total paid" : "Total due"}</Text>
            <Text style={s.grandText}>{inv.settled ? inv.totalDisplay : inv.balanceDisplay}</Text>
          </View>
          {/* The conversion is a courtesy, stated as one. Never a second amount owed. */}
          <View style={[s.totalRow, { marginTop: 4 }]}>
            {/* "approx." spelled out: U+2248 is not in WinAnsi and would print as a blank box. */}
            <Text style={[s.muted, { fontSize: 7.5 }]}>approx. {inv.convertedTotalDisplay}</Text>
            <Text style={[s.muted, { fontSize: 7.5 }]}>Total {inv.totalDisplay}</Text>
          </View>
          <Text style={[s.muted, { fontSize: 7, textAlign: "right" }]}>{inv.convertedRateNote}</Text>
          {inv.amountPaidDisplay && !inv.settled ? (
            <View style={s.totalRow}>
              <Text style={[s.muted, { fontSize: 7.5 }]}>Paid to date</Text>
              <Text style={[s.muted, { fontSize: 7.5 }]}>{inv.amountPaidDisplay}</Text>
            </View>
          ) : null}
        </View>

        {/* ── How to pay, the terms, and anything written on this one ── */}
        <View style={s.blocks}>
          {!inv.settled ? <Block label="How to pay" text={iss.bankDetails} /> : null}
          <Block label="Terms" text={iss.paymentTerms} />
          <Block label="Notes" text={inv.notes} />
        </View>

        <View style={s.footer}>
          <Text>
            {inv.issuedByName ? `Issued by ${inv.issuedByName}` : iss.name}
            {iss.taxId ? ` · ${iss.taxId}` : ""}
          </Text>
          {/*
            A plain string, not a `render` page counter. `render` is only evaluated for a FIXED
            element, and `fixed` only behaves for one positioned against the page - which this
            footer deliberately is not any more (see the `page` style). A counter that silently
            printed nothing is worse than no counter, and the number is what a reader quoting
            this page back to us actually needs.
          */}
          <Text>{inv.number}</Text>
        </View>
      </Page>
    </Document>
  );
}

export async function renderInvoicePdf(inv: InvoicePdfData): Promise<Buffer> {
  return renderToBuffer(<InvoiceDoc inv={inv} />);
}

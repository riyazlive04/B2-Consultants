import { Document, Page, Text, View, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import { PdfBrandMark, BRAND_INDIGO } from "./pdf-brand";
import type { InvoicePdfData } from "./invoice-pdf";

/**
 * The payment receipt - the written confirmation of payment the coaching agreement promises
 * (§7.4: "Receipt of payment shall be confirmed in writing by B2 Consultants").
 *
 * An invoice asks for money; a receipt says it arrived. It must let anyone holding it answer, with
 * nothing else to hand: who paid whom, how much (in figures AND words), when, by what means and
 * with what transaction reference, against which invoice, and what is still owed. It is NOT a tax
 * invoice and says so - the tax facts live on the invoice it names, and a second document that
 * looked like one would be a second invoice for the same supply.
 *
 * PURE, like the invoice: everything arrives pre-formatted from `payments-metrics.receiptDocument`.
 * Amounts are "1,25,000.50 INR", never "₹" - WinAnsi Helvetica has no rupee glyph.
 */

export type ReceiptPdfData = {
  receiptNumber: string;
  receiptDate: string;
  issuer: InvoicePdfData["issuer"];
  currency: "INR" | "EUR";
  customerName: string;
  customerAddressLines: string[];
  customerEmail: string | null;
  amountDisplay: string;
  amountWords: string;
  method: string;
  reference: string | null;
  invoiceNumber: string;
  invoiceDate: string;
  invoiceTotalDisplay: string;
  paidToDateDisplay: string;
  balanceDisplay: string;
  settled: boolean;
  agreementRef: string | null;
  agreementTerm: string | null;
  recordedByName: string | null;
};

const INK = "#16203A";
const MUTED = "#636F85";
const LINE = "#CBD6E6";
const LINE_SOFT = "#E2E9F3";

const s = StyleSheet.create({
  page: {
    padding: 40, paddingBottom: 36, fontSize: 9.5, fontFamily: "Helvetica", color: INK,
    lineHeight: 1.45, flexDirection: "column",
  },
  between: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  brand: { fontSize: 18, fontFamily: "Helvetica-Bold", color: BRAND_INDIGO, lineHeight: 1.25 },
  title: { fontSize: 22, fontFamily: "Helvetica-Bold", letterSpacing: 1, lineHeight: 1.25 },
  muted: { color: MUTED },
  bold: { fontFamily: "Helvetica-Bold" },
  label: { color: MUTED, fontSize: 7.5, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 3 },
  rule: { borderBottomWidth: 1, borderColor: LINE, marginTop: 18 },
  amountBox: {
    marginTop: 22, paddingVertical: 12, paddingHorizontal: 14,
    backgroundColor: "#F4F7FC", borderLeftWidth: 3, borderColor: BRAND_INDIGO,
  },
  amount: { fontSize: 18, fontFamily: "Helvetica-Bold", lineHeight: 1.3 },
  row: { flexDirection: "row", borderBottomWidth: 1, borderColor: LINE_SOFT, paddingVertical: 6 },
  rowLabel: { width: 170, color: MUTED },
  rowValue: { flex: 1 },
  footer: {
    marginTop: "auto", paddingTop: 8, borderTopWidth: 1, borderColor: LINE_SOFT,
    flexDirection: "row", justifyContent: "space-between", color: MUTED, fontSize: 7.5,
  },
});

function Row({ label, value, bold }: { label: string; value: string | null; bold?: boolean }) {
  if (!value || !value.trim()) return null;
  return (
    <View style={s.row} wrap={false}>
      <Text style={s.rowLabel}>{label}</Text>
      <Text style={bold ? [s.rowValue, s.bold] : s.rowValue}>{value}</Text>
    </View>
  );
}

function ReceiptDoc({ r }: { r: ReceiptPdfData }) {
  const iss = r.issuer;
  const cityLine = [iss.postcode, iss.city].filter(Boolean).join(" ");
  return (
    <Document title={`Receipt ${r.receiptNumber}`} author={iss.name} subject={`Payment receipt ${r.receiptNumber} for ${r.customerName}`}>
      <Page size="A4" style={s.page}>
        <View style={s.between}>
          <View style={{ flexDirection: "row", alignItems: "flex-start" }}>
            <PdfBrandMark size={40} />
            <View style={{ marginLeft: 11 }}>
              <Text style={s.brand}>{iss.name}</Text>
              <View style={{ marginTop: 2 }}>
                {iss.ownerName ? <Text style={s.muted}>Proprietor: {iss.ownerName}</Text> : null}
                {iss.addressLines.map((l, i) => <Text key={i} style={s.muted}>{l}</Text>)}
                {cityLine ? <Text style={s.muted}>{cityLine}</Text> : null}
                {iss.country ? <Text style={s.muted}>{iss.country}</Text> : null}
                {iss.taxId ? <Text style={s.muted}>Tax no. {iss.taxId}</Text> : null}
              </View>
            </View>
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={s.title}>PAYMENT RECEIPT</Text>
            <Text style={[s.bold, { marginTop: 4 }]}>{r.receiptNumber}</Text>
            <Text style={s.muted}>{r.receiptDate}</Text>
          </View>
        </View>

        <View style={s.rule} />

        <View style={{ marginTop: 18 }}>
          <Text style={s.label}>Received from</Text>
          <Text style={s.bold}>{r.customerName}</Text>
          {r.customerAddressLines.map((l, i) => <Text key={i} style={s.muted}>{l}</Text>)}
          {r.customerEmail ? <Text style={s.muted}>{r.customerEmail}</Text> : null}
        </View>

        <View style={s.amountBox}>
          <Text style={s.label}>Amount received</Text>
          <Text style={s.amount}>{r.amountDisplay}</Text>
          <Text style={{ marginTop: 2 }}>{r.amountWords}</Text>
        </View>

        <View style={{ marginTop: 18 }}>
          <Row label="Date of payment" value={r.receiptDate} />
          <Row label="Payment method" value={r.method} />
          <Row label="Transaction reference" value={r.reference} />
          <Row label="Against invoice" value={`${r.invoiceNumber} dated ${r.invoiceDate}`} bold />
          <Row label="Agreement" value={r.agreementRef} />
          <Row label="Invoice total" value={r.invoiceTotalDisplay} />
          <Row label="Paid to date (incl. this payment)" value={r.paidToDateDisplay} />
          <Row label="Balance outstanding" value={r.settled ? `Nil - invoice ${r.invoiceNumber} paid in full` : r.balanceDisplay} bold />
        </View>

        <View style={{ marginTop: 20 }}>
          <Text style={[s.muted, { fontSize: 8 }]}>
            This receipt confirms payment against the invoice named above. It is not a tax invoice; the tax
            details of the supply are stated on that invoice.
          </Text>
          {r.agreementTerm ? <Text style={[s.muted, { fontSize: 8, marginTop: 3 }]}>{r.agreementTerm}</Text> : null}
          <Text style={[s.muted, { fontSize: 8, marginTop: 3 }]}>
            Computer-generated receipt, valid without signature.
          </Text>
        </View>

        <View style={s.footer}>
          <Text>
            {r.recordedByName ? `Recorded by ${r.recordedByName}` : iss.name}
            {iss.email ? ` · ${iss.email}` : ""}
          </Text>
          <Text>{r.receiptNumber}</Text>
        </View>
      </Page>
    </Document>
  );
}

export async function renderReceiptPdf(r: ReceiptPdfData): Promise<Buffer> {
  return renderToBuffer(<ReceiptDoc r={r} />);
}

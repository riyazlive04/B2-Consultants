import { Document, Page, Text, View, StyleSheet, renderToBuffer } from "@react-pdf/renderer";

/** Invoice / estimate PDF (Synamate parity). Pure — takes pre-formatted display data. */

export type InvoicePdfData = {
  kind: "INVOICE" | "ESTIMATE";
  number: string;
  status: string;
  issueDate: string; // formatted DD/MM/YYYY
  dueDate: string | null;
  customerName: string;
  customerEmail: string | null;
  items: { description: string; quantity: number; unitPriceDisplay: string; lineTotalDisplay: string }[];
  subtotalDisplay: string;
  discountDisplay: string;
  taxPercent: number;
  taxDisplay: string;
  totalDisplay: string;
  totalEurDisplay: string;
  balanceDisplay: string;
  notes: string | null;
};

const s = StyleSheet.create({
  page: { padding: 40, fontSize: 10, fontFamily: "Helvetica", color: "#16203A" },
  row: { flexDirection: "row" },
  between: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  brand: { fontSize: 20, fontFamily: "Helvetica-Bold", color: "#0A64E2" },
  h: { fontSize: 22, fontFamily: "Helvetica-Bold" },
  muted: { color: "#636F85" },
  label: { color: "#636F85", fontSize: 8, textTransform: "uppercase", marginBottom: 2 },
  block: { marginTop: 24 },
  th: { flexDirection: "row", borderBottomWidth: 1, borderColor: "#CBD6E6", paddingBottom: 6, marginTop: 18 },
  td: { flexDirection: "row", borderBottomWidth: 1, borderColor: "#E2E9F3", paddingVertical: 6 },
  cDesc: { flex: 4 },
  cQty: { flex: 1, textAlign: "right" },
  cUnit: { flex: 2, textAlign: "right" },
  cTot: { flex: 2, textAlign: "right" },
  totals: { marginTop: 14, alignSelf: "flex-end", width: 220 },
  totalRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2 },
  grand: { flexDirection: "row", justifyContent: "space-between", paddingTop: 6, marginTop: 4, borderTopWidth: 1, borderColor: "#CBD6E6" },
  grandText: { fontFamily: "Helvetica-Bold", fontSize: 13 },
  notes: { marginTop: 28, color: "#4A566E" },
  footer: { position: "absolute", bottom: 30, left: 40, right: 40, textAlign: "center", color: "#8A95A8", fontSize: 8 },
});

function InvoiceDoc({ inv }: { inv: InvoicePdfData }) {
  const title = inv.kind === "ESTIMATE" ? "ESTIMATE" : "INVOICE";
  return (
    <Document>
      <Page size="A4" style={s.page}>
        <View style={s.between}>
          <View>
            <Text style={s.brand}>B2 Consultants</Text>
            <Text style={s.muted}>Reichelsheim, Germany</Text>
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={s.h}>{title}</Text>
            <Text style={s.muted}>{inv.number}</Text>
            <Text style={{ marginTop: 4 }}>{inv.status}</Text>
          </View>
        </View>

        <View style={[s.between, s.block]}>
          <View>
            <Text style={s.label}>Bill to</Text>
            <Text>{inv.customerName}</Text>
            {inv.customerEmail ? <Text style={s.muted}>{inv.customerEmail}</Text> : null}
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={s.label}>Issued</Text>
            <Text>{inv.issueDate}</Text>
            {inv.dueDate ? (
              <>
                <Text style={[s.label, { marginTop: 6 }]}>Due</Text>
                <Text>{inv.dueDate}</Text>
              </>
            ) : null}
          </View>
        </View>

        <View style={s.th}>
          <Text style={s.cDesc}>Description</Text>
          <Text style={s.cQty}>Qty</Text>
          <Text style={s.cUnit}>Unit</Text>
          <Text style={s.cTot}>Amount</Text>
        </View>
        {inv.items.map((it, i) => (
          <View key={i} style={s.td}>
            <Text style={s.cDesc}>{it.description}</Text>
            <Text style={s.cQty}>{it.quantity}</Text>
            <Text style={s.cUnit}>{it.unitPriceDisplay}</Text>
            <Text style={s.cTot}>{it.lineTotalDisplay}</Text>
          </View>
        ))}

        <View style={s.totals}>
          <View style={s.totalRow}><Text style={s.muted}>Subtotal</Text><Text>{inv.subtotalDisplay}</Text></View>
          <View style={s.totalRow}><Text style={s.muted}>Discount</Text><Text>-{inv.discountDisplay}</Text></View>
          <View style={s.totalRow}><Text style={s.muted}>Tax ({inv.taxPercent}%)</Text><Text>{inv.taxDisplay}</Text></View>
          <View style={s.grand}><Text style={s.grandText}>Total</Text><Text style={s.grandText}>{inv.totalDisplay}</Text></View>
          <View style={s.totalRow}><Text style={s.muted}>({inv.totalEurDisplay})</Text><Text style={s.muted}>Balance {inv.balanceDisplay}</Text></View>
        </View>

        {inv.notes ? (
          <View style={s.notes}>
            <Text style={s.label}>Notes</Text>
            <Text>{inv.notes}</Text>
          </View>
        ) : null}

        <Text style={s.footer}>Thank you for your business · B2 Consultants</Text>
      </Page>
    </Document>
  );
}

export async function renderInvoicePdf(inv: InvoicePdfData): Promise<Buffer> {
  return renderToBuffer(<InvoiceDoc inv={inv} />);
}

import { Document, Page, Text, View, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import { BRAND_INDIGO, PdfBrandMark } from "./pdf-brand";
import { formatInrMinor } from "@/lib/format";
import type { TerminationReport } from "@/server/termination-report";

/**
 * The offboarding record, as a filed document.
 *
 * Deliberately states what did NOT move as prominently as what did. Someone reading this a year
 * later is usually trying to answer one of two questions — "what were they responsible for" or
 * "why is this old commission still in their name" — and the second is only answerable if the
 * document says the attribution was left alone on purpose.
 */

const s = StyleSheet.create({
  page: { padding: 40, fontSize: 10, color: "#16203A", fontFamily: "Helvetica" },
  header: { flexDirection: "row", alignItems: "center", marginBottom: 18 },
  headerText: { marginLeft: 10 },
  title: { fontSize: 16, fontFamily: "Helvetica-Bold" },
  sub: { fontSize: 9, color: "#5B6478", marginTop: 2 },
  h2: { fontSize: 11, fontFamily: "Helvetica-Bold", marginTop: 18, marginBottom: 6, color: BRAND_INDIGO },
  row: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: "#E3E6EF", paddingVertical: 4 },
  cell: { flex: 1 },
  cellNum: { width: 70, textAlign: "right", fontFamily: "Helvetica-Bold" },
  label: { color: "#5B6478" },
  body: { marginTop: 4, lineHeight: 1.5 },
  note: { marginTop: 6, fontSize: 9, color: "#5B6478", lineHeight: 1.5 },
  footer: { position: "absolute", bottom: 28, left: 40, right: 40, fontSize: 8, color: "#8A91A3" },
});

function Line({ label, value }: { label: string; value: string | number }) {
  return (
    <View style={s.row}>
      <Text style={[s.cell, s.label]}>{label}</Text>
      <Text style={s.cellNum}>{typeof value === "number" ? value.toLocaleString("en-IN") : value}</Text>
    </View>
  );
}

function TerminationDoc({ r }: { r: TerminationReport }) {
  const generated = new Date(r.generatedAt).toLocaleString("en-GB", { timeZone: "Asia/Kolkata" });
  const held = r.holds.categories.filter((c) => c.count > 0);

  return (
    <Document title={`Offboarding record — ${r.profile.name}`}>
      <Page size="A4" style={s.page}>
        <View style={s.header}>
          <PdfBrandMark size={34} />
          <View style={s.headerText}>
            <Text style={s.title}>Offboarding record</Text>
            <Text style={s.sub}>
              {r.profile.name} · {r.profile.roleTitle} · {r.profile.email}
            </Text>
          </View>
        </View>

        <Text style={s.h2}>Tenure</Text>
        <Line
          label="Joined"
          value={r.tenure.joined ? new Date(r.tenure.joined).toLocaleDateString("en-GB") : "not recorded"}
        />
        <Line label="Months served" value={r.tenure.months ?? "—"} />
        <Line label="First-call share at departure" value={`${r.profile.firstCallSharePct}%`} />

        <Text style={s.h2}>Roles and responsibilities</Text>
        <Text style={s.body}>
          {r.profile.keyResponsibilities?.trim() ||
            "No responsibilities were recorded on this person's profile. What they actually held is listed under Handover below."}
        </Text>

        <Text style={s.h2}>Work recorded</Text>
        <Line label="Calls logged" value={r.work.callsLogged} />
        <Line label="Conversations (spoke)" value={r.work.conversationsHad} />
        <Line label="Leads owned" value={r.work.leadsOwnedEver} />
        <Line label="Leads won" value={r.work.leadsWon} />
        <Line label="Discovery calls recorded" value={r.work.discoveryOutcomes} />
        <Line label="…of which highly qualified" value={r.work.highlyQualified} />
        <Line label="Booked calls attended" value={r.work.bookingsAttended} />
        <Line label="Daily logs submitted" value={r.work.dailyLogsSubmitted} />

        <Text style={s.h2}>Paid</Text>
        <Line label="Commission and bonus" value={formatInrMinor(r.earnings.commissionInrMinor)} />
        <Line label="Payout runs" value={r.earnings.payouts} />

        <Text style={s.h2}>Handover</Text>
        {held.length === 0 ? (
          <Text style={s.body}>Nothing was outstanding — no open leads, calls, tasks or accounts.</Text>
        ) : (
          held.map((c) => <Line key={c.key} label={c.label} value={c.count} />)
        )}

        <Text style={s.note}>
          Open work was reassigned. Their call history, recorded discovery outcomes, stage changes,
          audit entries and past commission attribution were deliberately NOT reassigned — those
          are a record of what happened, and commission is derived from them at the time it is
          read. Rewriting them would have credited someone else with work this person did.
        </Text>

        <Text style={s.footer} fixed>
          Generated {generated} IST · B2 Consultants · confidential
        </Text>
      </Page>
    </Document>
  );
}

export async function renderTerminationReportPdf(report: TerminationReport): Promise<Buffer> {
  return renderToBuffer(<TerminationDoc r={report} />);
}

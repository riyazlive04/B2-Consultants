import { Document, Page, Text, View, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import { BRAND_INDIGO, PdfBrandMark } from "./pdf-brand";
import { DAY_NAMES, formatDuration } from "@/lib/curriculum";
import type { ClassroomBatchView } from "@/server/student-classroom";

/**
 * THE STUDENT'S TIMETABLE, AS A DOCUMENT (@15:36, @16:33).
 *
 * ── Why a PDF when the app already shows this ──────────────────────────────────────────
 * Because the founders asked for a document, and because the app is not where this gets used.
 * A student plans their month against a partner's shifts and a day job; a coach forwards the
 * cohort's dates to a tutor covering a week. Both of those are things you print, attach or hold
 * up - and a page behind a login is none of them. An `.ics` feed is the cheaper cousin and is
 * worth offering alongside, but it answers "put this in my calendar", not "show me the plan".
 *
 * ── What it deliberately does NOT carry ────────────────────────────────────────────────
 * JOIN LINKS. This file can be forwarded, printed, left on a desk or mailed to the wrong
 * address, and a Zoom URL in it is a door into a live class for whoever ends up holding it. The
 * timetable says when; the app says how to get in, behind the login that already knows who you
 * are. Nor does it carry attendance marks, which are between a student and their coach and have
 * no business on a document that gets handed around.
 *
 * ── Why it re-uses `ClassroomBatchView` ────────────────────────────────────────────────
 * That view is already the student's own, privacy-filtered classroom - it is what the screen
 * renders, with no roster, no classmate's marks and no internal notes. Building the document
 * from a second query would be a second chance to leak something the screen does not show.
 *
 * No dependency added: `@react-pdf/renderer` already drives the agreement, the invoice and the
 * offboarding record.
 */

const s = StyleSheet.create({
  page: { padding: 40, fontSize: 10, color: "#16203A", fontFamily: "Helvetica" },
  header: { flexDirection: "row", alignItems: "center", marginBottom: 16 },
  headerText: { marginLeft: 10 },
  title: { fontSize: 16, fontFamily: "Helvetica-Bold" },
  sub: { fontSize: 9, color: "#5B6478", marginTop: 2 },
  weekHead: {
    marginTop: 14,
    marginBottom: 4,
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
    color: BRAND_INDIGO,
  },
  row: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: "#E3E6EF", paddingVertical: 4 },
  when: { width: 132 },
  what: { flex: 1, paddingRight: 8 },
  kind: { width: 74, textAlign: "right", color: "#5B6478", fontSize: 9 },
  framework: { fontSize: 9, color: "#5B6478" },
  meta: { marginTop: 10, fontSize: 9, color: "#5B6478", lineHeight: 1.5 },
  note: { marginTop: 14, fontSize: 9, color: "#5B6478", lineHeight: 1.5 },
  footer: { position: "absolute", bottom: 28, left: 40, right: 40, fontSize: 8, color: "#8A91A3" },
});

/** "Sat 11 Oct · 08:00 PM IST" - the same shape `formatClassTime` prints in a reminder. */
function whenLine(dateYmd: string, timeHm: string | null): string {
  const day = DAY_NAMES[new Date(`${dateYmd}T00:00:00Z`).getUTCDay()].slice(0, 3);
  const [y, m, d] = dateYmd.split("-");
  const month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(m) - 1];
  const date = `${day} ${Number(d)} ${month} ${y}`;
  if (!timeHm) return date;
  const [hh, mm] = timeHm.split(":").map(Number);
  const period = hh < 12 ? "AM" : "PM";
  const h12 = String(hh % 12 === 0 ? 12 : hh % 12).padStart(2, "0");
  return `${date} · ${h12}:${mm.toString().padStart(2, "0")} ${period} IST`;
}

export type TimetableDoc = {
  studentName: string;
  batch: ClassroomBatchView;
  generatedAt: string;
};

function TimetableBody({ doc }: { doc: TimetableDoc }) {
  const { batch } = doc;

  /**
   * Grouped by programme week, with the undated ones last.
   *
   * `weekNumber` is null for every German Note class and anything scheduled ad hoc - only a
   * generated B2 timetable fills it - so the grouping has to tolerate a cohort that has none.
   * Falling back to one flat list is right there: a German Note student's timetable is a list
   * of dates, and inventing "Week 1" over it would be a label the app does not use anywhere else.
   */
  const weeks = new Map<number | null, typeof batch.sessions>();
  for (const session of batch.sessions) {
    const key = session.weekNumber ?? null;
    weeks.set(key, [...(weeks.get(key) ?? []), session]);
  }
  const ordered = [...weeks.entries()].sort((a, b) => {
    if (a[0] === null) return 1;
    if (b[0] === null) return -1;
    return a[0] - b[0];
  });

  return (
    <Page size="A4" style={s.page} wrap>
      <View style={s.header}>
        <PdfBrandMark size={34} />
        <View style={s.headerText}>
          <Text style={s.title}>Class timetable</Text>
          <Text style={s.sub}>
            {doc.studentName} · {batch.name}
            {batch.code ? ` (${batch.code})` : ""} · {batch.level}
          </Text>
        </View>
      </View>

      <Text style={s.meta}>
        {batch.coachName
          ? `${batch.line === "B2" ? "Coach" : "Tutor"}: ${batch.coachName}`
          : "Coach to be confirmed"}
        {batch.curriculumName ? `\n Curriculum: ${batch.curriculumName}` : ""}
        {batch.sprintStartYmd ? `\n Sprint starts: ${whenLine(batch.sprintStartYmd, null)}` : ""}
        {batch.sprintEndYmd ? `\n Sprint ends: ${whenLine(batch.sprintEndYmd, null)}` : ""}
      </Text>

      {batch.sessions.length === 0 ? (
        <Text style={s.note}>
          No classes are scheduled on this cohort yet. Your coach will confirm the dates with you,
          and this document is worth printing again once they have.
        </Text>
      ) : (
        ordered.map(([week, sessions]) => (
          <View key={String(week)} wrap={false}>
            <Text style={s.weekHead}>
              {week === null ? "Other sessions" : `Week ${week}`}
            </Text>
            {sessions.map((session) => (
              <View key={session.id} style={s.row}>
                <Text style={s.when}>
                  {session.delivery === "PRE_RECORDED"
                    ? `From ${whenLine(session.dateYmd, null)}`
                    : whenLine(session.dateYmd, session.timeHm)}
                </Text>
                <View style={s.what}>
                  <Text>{session.title}</Text>
                  {session.framework && <Text style={s.framework}>{session.framework}</Text>}
                </View>
                <Text style={s.kind}>
                  {session.delivery === "PRE_RECORDED"
                    ? "Recording"
                    : formatDuration(session.durationMins) || "Live"}
                </Text>
              </View>
            ))}
          </View>
        ))
      )}

      {/*
        Said on the document because the document cannot be kept up to date.
        A printed timetable is a snapshot the moment it leaves the server, and a student holding
        a three-week-old copy of a rescheduled class needs to know which of the two to trust.
      */}
      <Text style={s.note}>
        Printed {new Date(doc.generatedAt).toLocaleString("en-GB", { timeZone: "Asia/Kolkata" })} IST.
        Classes can move - the app always has the current times, and the join link for each class
        appears there shortly before it starts. Join links are deliberately not printed here.
      </Text>

      <Text style={s.footer} fixed>
        {batch.name} · timetable for {doc.studentName}
      </Text>
    </Page>
  );
}

export async function renderTimetablePdf(doc: TimetableDoc): Promise<Buffer> {
  return renderToBuffer(
    <Document title={`Timetable - ${doc.batch.name} - ${doc.studentName}`}>
      <TimetableBody doc={doc} />
    </Document>,
  );
}

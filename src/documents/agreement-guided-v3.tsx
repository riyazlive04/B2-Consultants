/**
 * Guided Mode coaching agreement — the renderer, pinned as template version "guided-v3".
 *
 * This file IS the document. Preview and sealed artifact are the same component rendered by the
 * same engine (server: renderToBuffer), so there is no second rendering path to drift.
 *
 * THREE THINGS THAT WILL BITE YOU IF YOU EDIT THIS:
 *
 * 1. GLYPHS. The built-in Helvetica/Times use WinAnsi encoding. The characters the master
 *    document uses — ☒ ☐ ⚠ ✓ ₹ ◦ — are NOT in it and render as blank boxes. So checkboxes and
 *    warning icons are drawn as <Svg>, sub-bullets use "–", and money is written "69,999 INR"
 *    (see formatInrPlainForDocument). "•" and "§" and "–" ARE in WinAnsi and are safe as literal text.
 *    Don't paste a glyph in here without checking it, and don't "fix" it by registering a
 *    Unicode font just to get a tick.
 *
 * 2. HYPHENATION is on by default and will chop legal text mid-syllable. Disabled below.
 *
 * 3. OUTPUT IS NOT DETERMINISTIC. PDFKit stamps a creation date and document id, so rendering
 *    the same data twice yields different bytes. Hash the sealed bytes once, at signing, and
 *    never re-render to verify — that is what `dataSha256` is for.
 *
 * Bumping the clauses means bumping AGREEMENT_TEMPLATE_VERSION and adding a new file, not
 * editing this one: already-signed agreements must keep rendering the terms they were signed on.
 */

import {
  Document,
  Page,
  Text,
  View,
  Image,
  StyleSheet,
  Font,
  Svg,
  Path,
  Polyline,
} from "@react-pdf/renderer";
import type { ReactNode } from "react";
import { deviceRows, userAgentMismatch, type StoredDevice } from "@/lib/device";
import {
  AGREEMENT_BANKS,
  AGREEMENT_PROVIDER,
  formatGermanDate,
  formatGermanDateOf,
  formatInrPlainForDocument,
  shortHash,
  type AgreementData,
} from "@/lib/agreement";

// Legal prose must never be hyphenated. One word in, the same word out.
Font.registerHyphenationCallback((word) => [word]);

const INK = "#1a1a1a";
const HEADING = "#1F4E79";
const SUBHEAD = "#2E74B5";
const RULE = "#1F4E79";
const LINE = "#9CB4CE";
const CALLOUT_BG = "#DEEAF6";
const TABLE_HEAD = "#2E5C8A";
const MUTED = "#5A6B7B";
const WARN = "#8A5A00";

const s = StyleSheet.create({
  page: {
    paddingTop: 42,
    paddingBottom: 64,
    paddingHorizontal: 52,
    fontFamily: "Helvetica",
    fontSize: 9.5,
    lineHeight: 1.45,
    color: INK,
  },
  runningHead: {
    position: "absolute",
    top: 18,
    left: 52,
    right: 52,
    fontSize: 6.5,
    color: MUTED,
  },
  footer: {
    position: "absolute",
    bottom: 26,
    left: 52,
    right: 52,
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
  },
  pageNo: { fontSize: 7, color: MUTED },

  title: { fontSize: 19, fontFamily: "Helvetica-Bold", color: HEADING, textAlign: "center" },
  subtitle: { fontSize: 10.5, color: SUBHEAD, textAlign: "center", marginTop: 3 },

  h2: { fontSize: 12.5, fontFamily: "Helvetica-Bold", color: HEADING, marginTop: 16 },
  h2Rule: { borderBottomWidth: 1.4, borderBottomColor: RULE, marginTop: 3, marginBottom: 8 },
  h3: { fontSize: 10, fontFamily: "Helvetica-Bold", color: SUBHEAD, marginTop: 11, marginBottom: 3 },

  p: { marginBottom: 5, textAlign: "justify" },
  bold: { fontFamily: "Helvetica-Bold" },
  italic: { fontFamily: "Helvetica-Oblique" },

  bulletRow: { flexDirection: "row", marginBottom: 4, paddingRight: 4 },
  bulletDot: { width: 14, textAlign: "center", color: INK },
  bulletBody: { flex: 1, textAlign: "justify" },

  callout: {
    backgroundColor: CALLOUT_BG,
    borderLeftWidth: 3,
    borderLeftColor: SUBHEAD,
    paddingVertical: 7,
    paddingHorizontal: 9,
    marginVertical: 7,
  },
  calloutText: { color: "#1F3E5A", fontSize: 9 },

  table: { borderWidth: 0.8, borderColor: LINE, marginVertical: 7 },
  tr: { flexDirection: "row", borderBottomWidth: 0.8, borderBottomColor: LINE },
  trLast: { flexDirection: "row" },
  th: {
    backgroundColor: TABLE_HEAD,
    color: "#FFFFFF",
    fontFamily: "Helvetica-Bold",
    fontSize: 8.5,
    padding: 5,
  },
  td: { padding: 5, fontSize: 9 },
  cellDivider: { borderRightWidth: 0.8, borderRightColor: LINE },

  partyRow: { flexDirection: "row", marginBottom: 2 },
  partyLabel: { width: 62, fontFamily: "Helvetica-Bold" },

  sigBlock: { flexDirection: "row", justifyContent: "space-between", marginTop: 18 },
  sigCol: { width: "46%" },
  sigLabel: { fontFamily: "Helvetica-Bold", color: HEADING, fontSize: 10 },
  sigImage: { height: 26, marginBottom: 1 },
  sigRule: { borderBottomWidth: 0.8, borderBottomColor: INK, marginTop: 2 },
  sigCaption: { fontSize: 7.5, color: MUTED, marginTop: 2 },

  bankGrid: { flexDirection: "row", gap: 10, marginTop: 8 },
  bankCard: { flex: 1, backgroundColor: "#EEF3F9", padding: 8 },

  watermark: {
    position: "absolute",
    top: 330,
    left: 0,
    right: 0,
    textAlign: "center",
    fontSize: 62,
    fontFamily: "Helvetica-Bold",
    color: "#C8D6E5",
    opacity: 0.35,
    transform: "rotate(-32deg)",
  },
});

// ───────────────────────────── Glyph-free primitives ─────────────────────────────

/** ☒ / ☐ without the glyph — a bordered box plus a drawn tick. */
function CheckBox({ checked }: { checked: boolean }) {
  return (
    <View
      style={{
        width: 9,
        height: 9,
        borderWidth: 0.9,
        borderColor: INK,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {checked && (
        <Svg width={7} height={7} viewBox="0 0 8 8">
          <Polyline points="0.8,4.2 3,6.3 7.2,1.4" stroke={HEADING} strokeWidth={1.5} fill="none" />
        </Svg>
      )}
    </View>
  );
}

/** ⚠ without the glyph. */
function WarnIcon() {
  return (
    <Svg width={9} height={9} viewBox="0 0 10 10" style={{ marginTop: 1.5 }}>
      <Path d="M5 0.7 L9.5 9.1 L0.5 9.1 Z" stroke={WARN} strokeWidth={0.9} fill="none" />
      <Path d="M5 3.4 L5 6.1" stroke={WARN} strokeWidth={0.9} />
      <Path d="M5 7.3 L5 7.9" stroke={WARN} strokeWidth={0.9} />
    </Svg>
  );
}

function H2({ children }: { children: ReactNode }) {
  return (
    <View wrap={false}>
      <Text style={s.h2}>{children}</Text>
      <View style={s.h2Rule} />
    </View>
  );
}

const H3 = ({ children }: { children: ReactNode }) => <Text style={s.h3}>{children}</Text>;
const P = ({ children }: { children: ReactNode }) => <Text style={s.p}>{children}</Text>;

function Bullet({ children, sub }: { children: ReactNode; sub?: boolean }) {
  return (
    <View style={[s.bulletRow, sub ? { paddingLeft: 16 } : {}]}>
      {/* "•" and "–" are both in WinAnsi; "◦" is not. */}
      <Text style={s.bulletDot}>{sub ? "–" : "•"}</Text>
      <Text style={s.bulletBody}>{children}</Text>
    </View>
  );
}

function Callout({ children, warn }: { children: ReactNode; warn?: boolean }) {
  return (
    <View style={[s.callout, warn ? { borderLeftColor: WARN } : {}]} wrap={false}>
      <View style={{ flexDirection: "row", gap: 6 }}>
        {warn && <WarnIcon />}
        <Text style={[s.calloutText, warn ? { color: WARN, flex: 1 } : { flex: 1 }]}>{children}</Text>
      </View>
    </View>
  );
}

function Party({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.partyRow}>
      <Text style={s.partyLabel}>{label}</Text>
      <Text style={{ flex: 1 }}>{value}</Text>
    </View>
  );
}

// ───────────────────────────── Document ─────────────────────────────

/** One line of the audit trail, already flattened for print. */
export type CertificateEvent = {
  label: string;
  at: Date;
  detail?: string | null;
};

export type AgreementDocProps = {
  documentNo: string;
  dataSha256: string;
  data: AgreementData;
  /** PNG data URLs. Absent while the document is still being read. */
  founderSignature?: string | null;
  studentSignature?: string | null;
  founderSignedAt?: Date | null;
  signedAt?: Date | null;
  /**
   * Appended as a final page on the sealed copy only. Note it cannot contain the PDF's own
   * SHA-256 — that hash is taken *of these bytes* after rendering. `pdfSha256` lives in the
   * database and on the download page, exactly as a DocuSign certificate works.
   */
  certificate?: {
    events: CertificateEvent[];
    signerIp?: string | null;
    signerUserAgent?: string | null;
    otpVerifiedAt?: Date | null;
    deliveredTo?: string | null; // masked
    /** How the signature was physically made. Reported half is a claim; observed half is not. */
    device?: StoredDevice | null;
  } | null;
};

/** "Tue 07 Jul 2026, 03:30 PM IST" — the trail must be unambiguous about zone. */
function stamp(d: Date): string {
  return `${new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
    timeZone: "Asia/Kolkata",
  }).format(d)} IST`;
}

function Brand() {
  return (
    <View style={{ alignItems: "center", marginBottom: 10 }}>
      <View style={{ borderWidth: 1.2, borderColor: INK, paddingHorizontal: 9, paddingTop: 2, paddingBottom: 0 }}>
        <Text style={{ fontFamily: "Times-Bold", fontSize: 20 }}>B2</Text>
      </View>
      <Text style={{ fontSize: 4.6, letterSpacing: 1.6, marginTop: 1.5 }}>CONSULTANTS</Text>
    </View>
  );
}

export function AgreementGuidedV3({
  documentNo,
  dataSha256,
  data,
  founderSignature,
  studentSignature,
  founderSignedAt,
  signedAt,
  certificate,
}: AgreementDocProps) {
  const { student, batch, payment } = data;
  const executed = !!signedAt;
  const startDate = formatGermanDate(batch.startDate);

  // The reader must be able to see, at a glance, that an unsigned copy is not a contract.
  const watermark = executed ? null : "UNSIGNED";

  const Chrome = () => (
    <>
      <Text style={s.runningHead} fixed>
        {AGREEMENT_PROVIDER.entity} · Document {documentNo} · Content hash {shortHash(dataSha256)}
      </Text>
      {watermark && (
        <Text style={s.watermark} fixed>
          {watermark}
        </Text>
      )}
      <View style={s.footer} fixed>
        <Text
          style={s.pageNo}
          render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`}
        />
        {/* The master initials every page. Only a signed copy carries the mark. */}
        {studentSignature ? (
          <Image src={studentSignature} style={{ height: 20 }} />
        ) : (
          <Text style={s.pageNo}>{student.fullName}</Text>
        )}
      </View>
    </>
  );

  return (
    <Document
      title={`Coaching & Consulting Agreement — ${student.fullName} — ${documentNo}`}
      author={AGREEMENT_PROVIDER.entity}
      subject="Guided Mode Programme"
      creator={AGREEMENT_PROVIDER.entity}
      producer={AGREEMENT_PROVIDER.entity}
    >
      <Page size="A4" style={s.page}>
        <Chrome />
        <Brand />

        <Text style={s.title}>COACHING &amp; CONSULTING AGREEMENT</Text>
        <Text style={s.subtitle}>Guided Mode - B2 Consultants</Text>
        <View style={{ borderBottomWidth: 1.4, borderBottomColor: RULE, marginTop: 6, marginBottom: 14 }} />

        <Text style={{ marginBottom: 8 }}>between</Text>
        <Party label="Name:" value={student.fullName} />
        <Party label="Address:" value={student.address} />
        <Text style={[s.italic, { marginTop: 6, marginBottom: 10, color: MUTED }]}>
          – hereinafter referred to as “the Student” – and
        </Text>

        <Party label="Name:" value={AGREEMENT_PROVIDER.name} />
        <Party label="Address:" value={AGREEMENT_PROVIDER.address} />
        <Party label="Entity:" value={AGREEMENT_PROVIDER.entity} />
        <Text style={[s.italic, { marginTop: 6, marginBottom: 10, color: MUTED }]}>
          – hereinafter referred to as “B2 Consultants” –
        </Text>

        <Text style={{ marginBottom: 4 }}>it is hereby agreed as follows:</Text>

        <H2>§1 Services Provided</H2>
        <Bullet>
          B2 Consultants agrees to provide group coaching and consulting services as detailed in Annexure A
          titled “Guided Mode Programme.” Please refer to Annexure A for the complete service specification.
        </Bullet>
        <Bullet>
          The programme is limited exclusively to the services outlined in Annexure A and will not extend
          beyond these specified offerings.
        </Bullet>
        <Bullet>
          All services are delivered by B2 Consultants personnel, including designated Consultants and the
          appointed delivery team acting on behalf of B2 Consultants as an entity.
        </Bullet>
        <Bullet>
          Guided Mode is a group-based programme. Sessions are conducted in batches with other enrolled
          students. Personalised 1-on-1 coaching is not included in this programme tier.
        </Bullet>

        <H2>§2 Batch Assignment &amp; Programme Timeline</H2>
        <H3>2.1 Batch Confirmation</H3>
        <P>
          The Student has been assigned to the batch and start date confirmed at the time of the onboarding
          call. The specific batch timetable - including session dates, times, and topics - is communicated to
          the Student in writing prior to Week 1. The Student confirms acceptance of the assigned batch by
          signing this Agreement.
        </P>

        <View style={s.table}>
          <View style={s.tr}>
            <Text style={[s.th, s.cellDivider, { width: "24%" }]}>Field</Text>
            <Text style={[s.th, s.cellDivider, { width: "44%" }]}>Detail</Text>
            <Text style={[s.th, { width: "32%" }]}>Confirmed by Student</Text>
          </View>
          {[
            { field: "Batch Number", detail: batch.number, confirm: null },
            { field: "Programme Start Date", detail: startDate, confirm: "Confirmed" },
            {
              field: "Batch Schedule",
              detail: "As per the Batch Timetable communicated at onboarding",
              confirm: "Received & Accepted",
            },
            {
              field: "Session Format",
              detail: "Live virtual (recorded) + pre-recorded modules",
              confirm: "Acknowledged",
            },
          ].map((r, i, arr) => (
            <View key={r.field} style={i === arr.length - 1 ? s.trLast : s.tr}>
              <Text style={[s.td, s.cellDivider, { width: "24%" }]}>{r.field}</Text>
              <Text style={[s.td, s.cellDivider, { width: "44%" }]}>{r.detail}</Text>
              <View style={[s.td, { width: "32%", flexDirection: "row", alignItems: "center", gap: 5 }]}>
                {r.confirm && (
                  <>
                    <CheckBox checked />
                    <Text>{r.confirm}</Text>
                  </>
                )}
              </View>
            </View>
          ))}
        </View>

        <Callout warn>
          Batch schedules are fixed once confirmed. B2 Consultants reserves the right to make minor
          adjustments to session dates or times due to operational or force-majeure reasons, with reasonable
          advance notice. The Student cannot request batch transfers after signing.
        </Callout>

        <H3>2.2 Programme Structure</H3>
        <P>The Guided Mode programme runs across the following phases:</P>
        <View style={s.callout}>
          <Text style={[s.calloutText, s.bold]}>
            Phase 1 - Guided Coaching (Weeks 1–4, Live &amp; Pre-Recorded Sessions)
          </Text>
          <Text style={s.calloutText}>
            Structured group sessions covering: Kick Off, Resume Building, Social Profile Building, Effective
            Networking (pre-recorded), Special Q&amp;A, Job Search &amp; Application (OIC Session), German
            Interview Structure (pre-recorded) and Final Special Q&amp;A. Session format and timetable as per
            confirmed Batch Schedule.
          </Text>
          <Text style={[s.calloutText, s.bold, { marginTop: 6 }]}>
            Phase 2 - 90-Day Sprint Programme (starts after the Final Special Q&amp;A of Phase 1)
          </Text>
          <Text style={s.calloutText}>
            Structured 90-day execution sprint. Weekly assigned tasks, accountability tracking via Green /
            Yellow / Red Flag system, and job application execution. Extended Support eligibility is assessed
            at the end of this phase.
          </Text>
          <Text style={[s.calloutText, s.bold, { marginTop: 6 }]}>
            Phase 3 - Ongoing Support (from Sprint start through Month 12)
          </Text>
          <Text style={s.calloutText}>
            Group Q&amp;A calls (2x per month) shared with Elite programme members for the remaining programme
            duration. Access to all session recordings for 12 months from programme start. Lifetime access to
            Skool community and WhatsApp group.
          </Text>
          <Text style={[s.calloutText, s.bold, { marginTop: 6 }]}>
            Total Programme Duration: 12 months from the programme start date.
          </Text>
        </View>

        <Bullet>
          While B2 Consultants endeavours to maximise the Student’s success in the German job market, a 100%
          job placement guarantee cannot be given. External factors - including interviewer preferences, the
          Student’s market competitiveness, and employer-specific requirements - influence hiring decisions. B2
          Consultants commits to providing structured preparation, strategy, and support throughout the
          programme.
        </Bullet>

        <H2>§3 Delivery Format</H2>
        <P>
          3.1 Live sessions are conducted virtually via Zoom or an equivalent video-conferencing platform at
          the scheduled batch times. The following sessions are delivered live:
        </P>
        <Bullet sub>Week 1: Kick Off</Bullet>
        <Bullet sub>Week 2: Resume Building</Bullet>
        <Bullet sub>Week 2: Social Profile Building</Bullet>
        <Bullet sub>Week 3: Special Q&amp;A</Bullet>
        <Bullet sub>Week 3: Job Search &amp; Application (OIC Session)</Bullet>
        <Bullet sub>Week 4: Final Special Q&amp;A</Bullet>

        <P>
          3.2 The following sessions are delivered as pre-recorded video modules. These videos are made
          available to the Student via the Skool community platform and are not subject to live scheduling:
        </P>
        <Bullet sub>Effective Networking</Bullet>
        <Bullet sub>German Interview Structure</Bullet>
        <Callout>
          Pre-recorded sessions reflect the content valid at the time of recording. B2 Consultants may update
          these videos at its discretion. Students will be notified of any significant structural changes to
          pre-recorded content.
        </Callout>
        <P>
          3.3 All live sessions are recorded. Recordings are made available to the Student within a reasonable
          time after each session.
        </P>
        <P>
          3.4 The Student is granted access to all session recordings for a period of 12 months from the
          programme start date. Lifetime access is granted to the Skool community and WhatsApp group.
        </P>
        <P>
          3.5 Attendance at live sessions is strongly encouraged. B2 Consultants is not obligated to provide
          personalised recaps for sessions missed by the Student; the session recording serves as the primary
          make-up resource.
        </P>

        <H2>§4 Confidentiality &amp; Data Protection</H2>
        <P>
          4.1 B2 Consultants commits to using any confidential information provided by the Student solely for
          purposes directly related to the agreed-upon services.
        </P>
        <P>
          4.2 B2 Consultants is responsible for safeguarding the Student’s personal data against unauthorised
          access and must comply with data protection laws as stipulated by the GDPR.
        </P>
        <P>
          4.3 All personal data will be securely stored and deleted upon completion of the advisory services,
          at the latest.
        </P>
        <P>
          4.4 The Student acknowledges that Guided Mode is a group programme. Other enrolled students will be
          present during live sessions. The Student agrees not to share, reproduce, or distribute session
          recordings, materials, or any proprietary content shared during the programme.
        </P>

        <H2>§5 Obligations of the Student</H2>
        <P>
          5.1 The Student commits to attending all scheduled live sessions in their assigned batch on time and
          at the confirmed batch timings.
        </P>
        <P>
          5.2 The Student commits to completing all weekly sprint tasks assigned during Phase 2 by the stated
          deadlines, and to maintaining an active Green Flag status throughout the 90-Day Sprint.
        </P>
        <P>
          5.3 The Student commits to actively participating in all interviews scheduled during the programme
          period.
        </P>
        <P>
          5.4 Upon receiving a job offer or entering into an employment agreement with a German employer, the
          Student agrees to promptly notify B2 Consultants.
        </P>
        <P>
          5.5 The Student acknowledges that eligibility for THE INTERVIEW OR WE DON’T GIVE UP GUARANTEE (§6) is
          conditional upon active participation, full execution of all assigned strategies, and verifiable
          compliance - including timely action on B2 Consultants’ formal recommendations, where applicable.
          Passive consumption of content without implementation shall not qualify for Extended Support
          consideration under any circumstance.
        </P>

        <H2>§6 THE INTERVIEW OR WE DON’T GIVE UP GUARANTEE</H2>
        <H3>6.1 Scope &amp; Primary Objective</H3>
        <P>
          The primary objective of the Guided Mode Programme is to secure interview invitations from German
          employers for the Student. B2 Consultants’ core obligation under this programme is fulfilled upon the
          Student receiving at least one confirmed interview invitation from any German employer at any point
          during the programme term - hereinafter referred to as “Advance Progress.” If the Student does not
          achieve Advance Progress by the end of the 90-Day Sprint despite full compliance, B2 Consultants
          commits to continue providing structured coaching, accountability, and execution support - at no
          additional cost - under the terms set out in §6.3 below. B2 Consultants does not give up on a
          compliant Student.
        </P>

        <H3>6.2 Definition of Advance Progress</H3>
        <P>
          “Advance Progress” is defined as the Student receiving a formal or informal interview invitation
          (telephone screening, video interview, or in-person interview) from any German employer during the
          programme period or any Extended Support period under this Guarantee. The Student’s performance in
          the interview is solely the Student’s responsibility.
        </P>
        <Callout warn>
          Receiving even one confirmed interview invitation at any point during the programme or any Extended
          Support period permanently discharges B2 Consultants’ Guarantee obligation, regardless of the
          interview outcome or whether a job offer follows.
        </Callout>

        <H3>6.3 Guarantee Tracks</H3>
        <P>
          This Guarantee operates on two tracks based on the Student’s legal status in Germany at the programme
          start date.
        </P>

        <H3>6.3.1 In-Germany Track</H3>
        <P>
          This track applies to Students who, at the programme start date, hold a valid German residence permit
          conferring the legal right to seek and accept employment in Germany - including but not limited to
          the Opportunity Card (Chancenkarte), EU Blue Card, work visa, student visa with work authorisation,
          or German/EU citizenship.
        </P>
        <P>
          If, upon completion of the full 90-Day Sprint Programme (Phase 2) with verified full compliance as
          defined in §6.5, the Student has not achieved Advance Progress, B2 Consultants will activate Extended
          Support as follows:
        </P>
        <Bullet>Cycle Length: Extended Support is provided in renewable 30-day cycles.</Bullet>
        <Bullet>
          Inclusions per cycle: Continued weekly task assignment and review, continued Green/Yellow/Red Flag
          accountability tracking, continued access to bi-monthly group Q&amp;A calls, and continued Skool
          community access.
        </Bullet>
        <Bullet>
          Re-compliance check: Eligibility for each successive 30-day cycle requires the Student to re-establish
          full compliance per §6.5 within that cycle.
        </Bullet>
        <Bullet>
          Maximum duration: Extended Support is capped at the programme’s 12-month boundary, i.e., 12 months
          from the programme start date. No Extended Support is available beyond this 12-month boundary under
          any circumstance.
        </Bullet>
        <Bullet>
          Continuing Work Rights Obligation: The Student must maintain valid German residence and
          work-authorisation status throughout the Extended Support period. If the Student’s legal status
          changes such that they no longer hold a valid permit conferring work rights, the Student is obligated
          to notify B2 Consultants in writing within 14 days. Loss of valid work-rights status converts the
          Student’s eligibility to the Out-of-Germany Track from the date of status change, and the
          requirements of §6.3.2 apply prospectively.
        </Bullet>

        <H3>6.3.2 Out-of-Germany Track</H3>
        <P>
          This track applies to Students who, at the programme start date, do not hold a valid German residence
          permit as defined in §6.3.1.
        </P>
        <P>
          If, upon completion of the full 90-Day Sprint Programme (Phase 2) with verified full compliance as
          defined in §6.5, the Student has not achieved Advance Progress, the following sequence applies:
        </P>
        <Bullet>
          Diagnostic Window (30 days following the 90-Day Sprint): B2 Consultants will analyse the Student’s
          performance, application data, and market response to identify the structural barriers to Advance
          Progress. During this window, B2 Consultants will continue providing accountability and coaching
          support.
        </Bullet>
        <Bullet>
          Formal Geographic Recommendation: Within the 30-day Diagnostic Window, B2 Consultants will issue a
          formal written recommendation regarding the Student’s geographic positioning - typically advising
          application for the German Opportunity Card (Chancenkarte) or equivalent residence pathway. This
          recommendation is grounded in B2 Consultants’ assessment that for candidates outside Germany,
          geographic presence is the dominant factor limiting interview conversion.
        </Bullet>
        <Bullet>
          Submission Window (90 days from the formal recommendation date): The Student must, within 90 days of
          receiving the formal written recommendation, submit a complete application for the German Opportunity
          Card (Chancenkarte) or equivalent recommended pathway to the appropriate German authorities.
          Documentary proof of submission (acknowledgement receipt from the relevant German embassy, consulate,
          or Ausländerbehörde) must be provided to B2 Consultants. Mere commencement of documentation gathering
          does not satisfy this requirement.
        </Bullet>
        <Bullet>
          Conditional Extended Support: If the Student submits the application within the 90-day Submission
          Window and provides documentary proof of submission, Extended Support continues in renewable 30-day
          cycles per §6.3.1, capped at the programme’s 12-month boundary (12 months from the programme start
          date). No Extended Support is available beyond this 12-month boundary under any circumstance.
        </Bullet>
        <Bullet>
          Termination of Guarantee: If the Student does not submit the application within the 90-day Submission
          Window, the Guarantee obligation terminates in full. The Student remains entitled to standard
          programme deliverables (recordings, community access, group Q&amp;A calls) for the remainder of the
          12-month programme period.
        </Bullet>

        <H3>6.4 Mock Interview Sessions</H3>
        <P>
          Across the entire 12-month programme period, the Student is entitled to a maximum of five (5) mock
          interview preparation sessions in total. This cap applies inclusive of the 90-Day Sprint, the
          Diagnostic Window (where applicable), and any Extended Support period.
        </P>
        <Bullet>
          Mock interview sessions are activated per confirmed interview invitation, up to the cap of five (5).
        </Bullet>
        <Bullet>
          The Student must notify B2 Consultants of each interview invitation with no less than 48 hours’
          advance notice for mock session scheduling.
        </Bullet>
        <Bullet>
          Beyond the cap of five mock sessions, additional live mock interview sessions may be purchased
          separately at B2 Consultants’ then-prevailing rate, subject to availability. The Student also retains
          access to pre-recorded mock interview preparation content available through the Skool community at no
          additional cost.
        </Bullet>

        <H3>6.5 Full Compliance Requirements</H3>
        <P>
          To remain eligible for Extended Support under §6.3 - both at the end of the 90-Day Sprint and during
          each subsequent 30-day cycle - the Student must demonstrate full verifiable compliance with ALL of
          the following conditions:
        </P>
        <Bullet>
          Task Completion: All weekly tasks assigned by B2 Consultants must be completed and submitted by
          stated deadlines. Screenshot-based documentation must be maintained and submitted upon request.
        </Bullet>
        <Bullet>
          Green Flag Status: The Student must maintain a “Green Flag” status throughout the Sprint and each
          Extended Support cycle as defined in the Student Commitment Form and Onboarding Document signed at
          programme commencement. Falling into “Yellow or Red Flag” status and failing to remediate within the
          stipulated timeframe disqualifies the Student from Extended Support eligibility.
        </Bullet>
        <Bullet>
          Community Participation: The Student must actively participate in the Skool community, completing all
          mandatory onboarding milestones within the first 7 days.
        </Bullet>
        <Bullet>
          Session Attendance: The Student must have attended a minimum of 90% of live Phase 1 sessions. Absence
          exceeding 10% of live sessions - unless documented and approved by B2 Consultants - disqualifies the
          Student from Extended Support eligibility.
        </Bullet>
        <Bullet>
          OIC Session Attendance: The Student must have attended the OIC (Optimization, Implementation &amp;
          Conversion) group session.
        </Bullet>
        <Bullet>
          Application Volume Compliance: The Student must meet the minimum weekly application volume targets as
          defined in the Student Commitment Form. Failure to meet these targets constitutes a Yellow or Red
          Flag breach.
        </Bullet>
        <Bullet>
          Payment Compliance: All payments must have been made in full and on schedule. Any outstanding payment
          disqualifies the Student from Extended Support eligibility.
        </Bullet>
        <Bullet>
          Coaching Responsiveness: During Extended Support cycles, the Student must implement coaching feedback
          provided by B2 Consultants within the timelines specified for each feedback item. For Out-of-Germany
          Track Students, this expressly includes timely submission of the Opportunity Card application per
          §6.3.2. For In-Germany Track Students, this includes the obligation to maintain valid work-rights
          status per §6.3.1.
        </Bullet>

        <H3>6.6 Termination of Extended Support</H3>
        <P>
          B2 Consultants reserves the right to terminate Extended Support, with written notice, if any of the
          following conditions arise:
        </P>
        <Bullet>
          The Student fails to maintain Green Flag status for two (2) consecutive Extended Support cycles.
        </Bullet>
        <Bullet>
          The Student fails to implement coaching feedback during two (2) consecutive Extended Support cycles.
        </Bullet>
        <Bullet>
          For Out-of-Germany Track Students, the Student fails to submit the Opportunity Card application (with
          documentary proof) within the 90-day Submission Window per §6.3.2.
        </Bullet>
        <Bullet>
          For In-Germany Track Students, the Student loses valid German work-rights status and fails to
          remediate within 60 days of status change.
        </Bullet>
        <Bullet>
          The Student is verifiably ineligible for the German job market due to factors outside coaching scope,
          including but not limited to misrepresented qualifications, expired or invalid work-eligibility
          status, withdrawal from active job search, or factual disqualifications such as expired credentials.
        </Bullet>
        <Bullet>The 12-month boundary from the programme start date is reached.</Bullet>
        <P>Termination of Extended Support under this section does not entitle the Student to any refund of fees paid.</P>

        <H3>6.7 Activation Process</H3>
        <P>
          To activate Extended Support, the Student must submit a compiled proof dossier containing evidence of
          full compliance with all conditions in §6.5 within 14 days of completing the 90-Day Sprint. Incomplete
          or unverified submissions will be rejected. Approved activations will be processed within 10 business
          days of validation.
        </P>

        <H2>§7 Payment</H2>
        <H3>7.1 Total Programme Fee</H3>
        <Text style={[s.bold, { marginBottom: 4 }]}>
          Total Programme Fee (INR): {formatInrPlainForDocument(payment.totalInrMinor)}
        </Text>

        <H3>7.2 Payment Option (select one)</H3>
        <P>
          The Student shall select one of the following payment options. The selected option and agreed amounts
          are binding upon signing.
        </P>

        <View style={s.table}>
          <View style={s.tr}>
            <Text style={[s.th, s.cellDivider, { width: "8%" }]} />
            <Text style={[s.th, s.cellDivider, { width: "32%" }]}>Payment Option</Text>
            <Text style={[s.th, s.cellDivider, { width: "24%" }]}>Amount (INR)</Text>
            <Text style={[s.th, { width: "36%" }]}>Due Milestone</Text>
          </View>

          <View style={s.tr}>
            <View style={[s.td, s.cellDivider, { width: "8%", alignItems: "center" }]}>
              <CheckBox checked={payment.option === "FULL"} />
            </View>
            <Text style={[s.td, s.cellDivider, s.bold, { width: "32%" }]}>Option A - Full Payment</Text>
            <Text style={[s.td, s.cellDivider, { width: "24%" }]}>
              {formatInrPlainForDocument(payment.totalInrMinor)}
            </Text>
            <Text style={[s.td, { width: "36%" }]}>
              {payment.option === "FULL" ? payment.dueMilestone : "Before commencement of Week 1"}
            </Text>
          </View>

          <View style={payment.option === "FULL" ? s.trLast : s.tr}>
            <View style={[s.td, s.cellDivider, { width: "8%", alignItems: "center" }]}>
              <CheckBox checked={payment.option === "INSTALMENT"} />
            </View>
            <Text style={[s.td, s.cellDivider, s.bold, { width: "32%" }]}>Option B - Instalment Plan (Max 2)</Text>
            <Text style={[s.td, s.cellDivider, { width: "24%" }]} />
            <Text style={[s.td, { width: "36%" }]} />
          </View>

          {payment.option === "INSTALMENT" &&
            payment.instalments.map((inst, i, arr) => (
              <View key={i} style={i === arr.length - 1 ? s.trLast : s.tr}>
                <Text style={[s.td, s.cellDivider, { width: "8%" }]} />
                <Text style={[s.td, s.cellDivider, { width: "32%", paddingLeft: 16 }]}>Instalment {i + 1}</Text>
                <Text style={[s.td, s.cellDivider, { width: "24%" }]}>{formatInrPlainForDocument(inst.amountInrMinor)}</Text>
                <Text style={[s.td, { width: "36%" }]}>{inst.dueMilestone}</Text>
              </View>
            ))}
        </View>

        <H3>7.3 Access &amp; Missed Payment Policy</H3>
        <P>
          The Student’s access to live sessions is conditional on payment being received as agreed. The
          following policy applies in the event of a missed or delayed payment:
        </P>
        <Bullet>
          If a payment instalment is not received by its due milestone, the Student will not be permitted to
          attend the live session(s) falling within that unpaid period.
        </Bullet>
        <Bullet>
          In lieu of live attendance, the recording of any missed live session will be made available to the
          Student once the outstanding payment is received and confirmed.
        </Bullet>
        <Bullet>
          B2 Consultants accepts no liability for any impact on the Student’s programme progress, sprint
          timeline, or Extended Support eligibility resulting from self-imposed payment delays.
        </Bullet>
        <Callout>
          There is no penalty fee for late payment. However, access to live sessions is a paid entitlement.
          Until payment is received, the Student’s entitlement is limited to recordings of sessions already
          held.
        </Callout>

        <H3>7.4 Payment Method</H3>
        <P>
          Payments shall be made to B2 Consultants via bank transfer/credit card (excl. 2.5% credit card
          payment processing fee) to the details provided in this Agreement. Receipt of payment shall be
          confirmed in writing by B2 Consultants.
        </P>

        <H2>§8 Refund &amp; Cancellation Policy</H2>
        <P>
          8.1 All payments made by the Student to B2 Consultants are strictly non-refundable and
          non-transferable. The Student’s sole recourse in the event of non-performance is limited to the
          Extended Support obligations outlined in §6 (THE INTERVIEW OR WE DON’T GIVE UP GUARANTEE).
        </P>
        <P>
          8.2 Withdrawal from the programme, discontinuation of participation, or early termination - whether
          voluntary or due to personal, professional, or other reasons - does not entitle the Student to any
          refund of fees paid, nor does it preserve the Student’s eligibility for Extended Support under §6.
        </P>
        <P>
          8.3 Because Guided Mode operates as a batch group programme, session slots and delivery resources are
          allocated in advance. The Student acknowledges that any withdrawal creates an irrecoverable cost to
          B2 Consultants, reinforcing the non-refundable nature of payments.
        </P>

        <View style={{ borderTopWidth: 0.8, borderTopColor: LINE, marginTop: 16, paddingTop: 10 }} wrap={false}>
          <P>
            By appending their signatures below, both parties affirm their understanding of and consent to all
            stipulations detailed in this Agreement.
          </P>

          <View style={s.sigBlock}>
            <View style={s.sigCol}>
              <Text style={s.sigLabel}>B2 Consultants (Coach/Mentor)</Text>
              <Text style={{ color: MUTED, marginBottom: 6 }}>{AGREEMENT_PROVIDER.name}</Text>
              <View style={{ height: 28, flexDirection: "row", alignItems: "flex-end", gap: 10 }}>
                <Text>{founderSignedAt ? formatGermanDateOf(founderSignedAt) : ""}</Text>
                {founderSignature && <Image src={founderSignature} style={s.sigImage} />}
              </View>
              <View style={s.sigRule} />
              <Text style={s.sigCaption}>Date &amp; Signature</Text>
            </View>

            <View style={s.sigCol}>
              <Text style={s.sigLabel}>Student Name</Text>
              <Text style={{ color: MUTED, marginBottom: 6 }}>{student.fullName}</Text>
              <View style={{ height: 28, flexDirection: "row", alignItems: "flex-end", gap: 10 }}>
                <Text>{signedAt ? formatGermanDateOf(signedAt) : ""}</Text>
                {studentSignature && <Image src={studentSignature} style={s.sigImage} />}
              </View>
              <View style={s.sigRule} />
              <Text style={s.sigCaption}>Date &amp; Signature</Text>
            </View>
          </View>

          <Text style={[s.sigLabel, { marginTop: 16 }]}>Bank Details - B2 Consultants</Text>
          <View style={s.bankGrid}>
            {AGREEMENT_BANKS.map((b) => (
              <View key={b.iban} style={s.bankCard}>
                <Text style={[s.bold, { color: HEADING }]}>{b.title}</Text>
                <Text>IBAN: {b.iban}</Text>
                <Text>BIC: {b.bic}</Text>
                <Text style={{ color: MUTED }}>{b.holder}</Text>
              </View>
            ))}
          </View>
        </View>
      </Page>

      {/* ───────────────────────────── Annexure A ───────────────────────────── */}
      <Page size="A4" style={s.page}>
        <Chrome />
        <Brand />
        <Text style={[s.title, { fontSize: 16 }]}>ANNEXURE A</Text>
        <Text style={s.subtitle}>Guided Mode Programme - Service Specification</Text>
        <View style={{ borderBottomWidth: 1.4, borderBottomColor: RULE, marginTop: 6, marginBottom: 12 }} />

        <H2>1. Phase 1 - Group Coaching Sessions (Weeks 1–4)</H2>
        <P>
          All sessions in Phase 1 are delivered as part of the Student’s assigned batch. Live sessions are
          conducted virtually and recorded. Pre-recorded sessions are delivered as video modules via the Skool
          community platform.
        </P>

        <H3>1.1 Week 1 - Kick Off [LIVE]</H3>
        <P>
          Programme orientation, German job market overview, the B2 Consultants system, mindset preparation,
          and sprint readiness briefing. Duration: 1.5 - 2 hours.
        </P>
        <H3>1.2 Week 2 - Resume Building [LIVE]</H3>
        <P>
          Guided group session on building a German-format resume tailored to the German job market. Students
          complete their resume as a live guided exercise. Duration: 2 hours.
        </P>
        <H3>1.3 Week 2 - Social Profile Building [LIVE]</H3>
        <P>
          Guided group session on building and optimising the Student’s LinkedIn and Xing profile for the
          German market. Duration: 3 hours.
        </P>
        <H3>1.4 Week 3 - Effective Networking [PRE-RECORDED]</H3>
        <P>
          Strategy and execution on LinkedIn and Xing networking for the German market. Delivered as a
          pre-recorded video module provided via the Skool community platform. Duration: 1.5 - 2 hours.
        </P>
        <Callout>
          This session is pre-recorded. The video reflects content valid at the time of recording. B2
          Consultants will issue an updated version if there is a material change to the session structure or
          content.
        </Callout>
        <H3>1.5 Week 3 - Special Q&amp;A [LIVE]</H3>
        <P>
          Live open Q&amp;A session for the batch. Students may submit questions in advance or ask live.
          Duration: 1 hour.
        </P>
        <H3>1.6 Week 3 - Job Search &amp; Application - OIC Session [LIVE]</H3>
        <P>
          The core Optimization, Implementation &amp; Conversion (OIC) session. Covers how to search, approach,
          and apply for jobs in the Open German Job Market in a structured, systematic way. Duration: 3 hours.
        </P>
        <H3>1.7 Week 4 - German Interview Structure [PRE-RECORDED]</H3>
        <P>
          Delivered as a pre-recorded video module covering German job interview structure, cultural
          expectations, preparation methodology, and dos and don’ts specific to the German hiring context.
          Duration: 1.5 - 2 hours.
        </P>
        <Callout>
          This session is pre-recorded. The video reflects content valid at the time of recording. B2
          Consultants will issue an updated version if there is a material change to the session structure or
          content.
        </Callout>
        <H3>1.8 Week 4 - Final Special Q&amp;A [LIVE]</H3>
        <P>
          Final live Q&amp;A session for the batch immediately before sprint commencement. The 90-Day Sprint
          begins following this session. Duration: 1.5 hours.
        </P>

        <H2>2. Phase 2 - 90-Day Sprint Programme</H2>
        <Callout>
          <Text style={s.bold}>
            The 90-Day Sprint commences immediately after the Final Special Q&amp;A session of Phase 1.
          </Text>
        </Callout>
        <Bullet>
          Weekly tasks are assigned by B2 Consultants and must be completed and submitted by the stated
          deadline each week.
        </Bullet>
        <Bullet>
          The Student’s progress is tracked via the Progress Tracking Dashboard using the Green / Yellow / Red
          Flag accountability system, as defined in the Student Commitment Form signed at onboarding.
        </Bullet>
        <Bullet>
          The Sprint is the Extended Support eligibility assessment period. All conditions of §6.5 must be
          satisfied throughout these 90 days for Extended Support consideration.
        </Bullet>

        <H2>3. Mock Interview Preparation Sessions</H2>
        <P>
          Upon receiving a confirmed interview invitation from a German employer, the Student is entitled to a
          mock interview preparation session with B2 Consultants prior to the interview, subject to the cap
          defined in §6.4.
        </P>
        <Bullet>
          A maximum of five (5) mock interview sessions will be provided across the 12-month programme period
          (per §6.4). Beyond this cap, additional sessions may be purchased at B2 Consultants’ then-prevailing
          rate, subject to availability; pre-recorded mock preparation content remains available in the Skool
          community at no additional cost.
        </Bullet>
        <Bullet>
          Sessions are conducted virtually and are designed to prepare the Student for the specific role,
          company, and interview format.
        </Bullet>
        <Bullet>
          The Student must notify B2 Consultants of the interview invitation with sufficient advance notice to
          schedule the mock session. B2 Consultants cannot guarantee session availability for notifications
          received less than 48 hours before the interview.
        </Bullet>

        <H2>4. Community &amp; Ongoing Support (Phase 3)</H2>
        <H3>4.1 Session Recordings - 12-Month Access</H3>
        <P>
          The Student is granted access to all Phase 1 session recordings for a period of 12 months from the
          programme start date. Access expires at the end of the 12-month programme period.
        </P>
        <H3>4.2 Lifetime Skool Community Access</H3>
        <P>
          Permanent, non-expiring access to the B2 Consultants Skool community for peer support, shared
          resources, and ongoing engagement beyond the programme period.
        </P>
        <H3>4.3 Lifetime WhatsApp Group Access</H3>
        <P>
          Permanent access to the B2 Consultants WhatsApp group for announcements and community engagement.
        </P>
        <H3>4.4 Group Q&amp;A Calls - 2× per Month for 12 Months</H3>
        <P>
          Access to live virtual group Q&amp;A calls hosted by B2 Consultants, held twice per month for the
          full 12-month programme duration. These calls are shared with Elite programme members on a scheduled
          basis. Session recordings will be made available in the Skool community.
        </P>

        <H2>5. What Is NOT Included in Guided Mode</H2>
        <Callout>
          <Text style={s.bold}>
            The following are NOT part of the Guided Mode programme. These services are available exclusively
            under the Elite Coaching Programme:
          </Text>
        </Callout>
        <Bullet>Personalised 1-on-1 resume or cover letter written and personalised by B2 Consultants</Bullet>
        <Bullet>Personalised LinkedIn or Xing profile written by B2 Consultants</Bullet>
        <Bullet>Individual 1-on-1 OIC coaching calls</Bullet>
        <Bullet>Hidden German Job Market 1-on-1 strategy session</Bullet>
        <Text style={s.italic}>Students seeking these services are directed to the Elite Coaching Programme.</Text>

        <View style={{ borderTopWidth: 0.8, borderTopColor: LINE, marginTop: 18, paddingTop: 8 }}>
          <Text style={[s.italic, { textAlign: "center", color: MUTED }]}>End of Annexure A</Text>
          <Text style={{ textAlign: "center", fontSize: 7.5, color: MUTED, marginTop: 8 }}>
            {AGREEMENT_PROVIDER.name} • {AGREEMENT_PROVIDER.address}
          </Text>
          <Text style={{ textAlign: "center", fontSize: 7.5, color: MUTED }}>
            Mob: {AGREEMENT_PROVIDER.mobile} • {AGREEMENT_PROVIDER.email} • {AGREEMENT_PROVIDER.website}
          </Text>
        </View>
      </Page>

      {/* ─────────────────── Certificate of Completion (sealed copies only) ─────────────────── */}
      {certificate && executed && (
        <Page size="A4" style={s.page}>
          <Chrome />
          <Brand />
          <Text style={[s.title, { fontSize: 16 }]}>CERTIFICATE OF COMPLETION</Text>
          <Text style={s.subtitle}>Electronic signature audit trail</Text>
          <View style={{ borderBottomWidth: 1.4, borderBottomColor: RULE, marginTop: 6, marginBottom: 12 }} />

          <H2>Document</H2>
          <Party label="Reference" value={documentNo} />
          <Party label="Title" value="Coaching & Consulting Agreement — Guided Mode" />
          <Party label="Parties" value={`${AGREEMENT_PROVIDER.name} (B2 Consultants) and ${student.fullName}`} />
          <Party label="Executed" value={stamp(signedAt!)} />

          <H2>Integrity</H2>
          <P>
            The content hash below is the SHA-256 of the canonical representation of this agreement’s terms and
            of the template version used to render them. It is reproducible: re-rendering these terms under
            template {" "}
            <Text style={s.bold}>guided-v3</Text> yields this same hash. It appears in the header of every page
            of this document.
          </P>
          <View style={[s.callout, { marginTop: 4 }]}>
            <Text style={[s.calloutText, { fontFamily: "Courier", fontSize: 8 }]}>
              Content SHA-256: {dataSha256}
            </Text>
          </View>
          <P>
            A separate SHA-256 is taken of the final bytes of this PDF at the moment of sealing and stored
            alongside the record. It is not printed here — a file cannot contain its own hash. B2 Consultants
            can produce it on request to demonstrate that the stored artifact has not been altered.
          </P>

          <H2>Signer Verification</H2>
          <P>
            The Student’s signature was captured after a one-time code was delivered by WhatsApp to the number
            on record and entered correctly, binding the signature to control of that number.
          </P>
          {certificate.deliveredTo && <Party label="Delivered to" value={certificate.deliveredTo} />}
          {certificate.otpVerifiedAt && <Party label="Code verified" value={stamp(certificate.otpVerifiedAt)} />}
          {certificate.signerIp && <Party label="Signer IP" value={certificate.signerIp} />}
          {certificate.signerUserAgent && (
            <View style={s.partyRow}>
              <Text style={s.partyLabel}>User agent</Text>
              <Text style={{ flex: 1, fontSize: 7.5, color: MUTED }}>{certificate.signerUserAgent}</Text>
            </View>
          )}

          {certificate.device && (
            <>
              <H2>Signing Device</H2>
              <P>
                The Student signed by hand on the device below. The rows marked as reported are the browser’s
                own account of itself and could in principle be altered by the signer; the IP address and the
                request headers are observed by B2 Consultants’ server and cannot be.
              </P>
              <View style={s.table}>
                {deviceRows(certificate.device).map((row, i, arr) => (
                  <View key={row[0]} style={i === arr.length - 1 ? s.trLast : s.tr}>
                    <Text style={[s.td, s.cellDivider, { width: "32%", fontFamily: "Helvetica-Bold" }]}>
                      {row[0]}
                    </Text>
                    <Text style={[s.td, { width: "68%" }]}>{row[1]}</Text>
                  </View>
                ))}
              </View>
              <View style={s.partyRow}>
                <Text style={[s.partyLabel, { width: 78 }]}>Reported UA</Text>
                <Text style={{ flex: 1, fontSize: 7.5, color: MUTED }}>
                  {certificate.device.reported.userAgent || "not reported"}
                </Text>
              </View>
              {/* A discrepancy is not proof of anything. Hiding it would be. */}
              {userAgentMismatch(certificate.device) && (
                <Callout warn>
                  The user agent reported by the signer’s browser differs from the one carried by the request
                  our server received. This is recorded for completeness and does not by itself indicate that
                  the signature is invalid.
                </Callout>
              )}
            </>
          )}

          <H2>Audit Trail</H2>
          <View style={s.table}>
            <View style={s.tr}>
              <Text style={[s.th, s.cellDivider, { width: "30%" }]}>Event</Text>
              <Text style={[s.th, s.cellDivider, { width: "38%" }]}>Timestamp</Text>
              <Text style={[s.th, { width: "32%" }]}>Detail</Text>
            </View>
            {certificate.events.map((e, i, arr) => (
              <View key={`${e.label}-${i}`} style={i === arr.length - 1 ? s.trLast : s.tr}>
                <Text style={[s.td, s.cellDivider, { width: "30%" }]}>{e.label}</Text>
                <Text style={[s.td, s.cellDivider, { width: "38%" }]}>{stamp(e.at)}</Text>
                <Text style={[s.td, { width: "32%", fontSize: 7.5, color: MUTED }]}>{e.detail ?? ""}</Text>
              </View>
            ))}
          </View>

          <Text style={[s.sigCaption, { marginTop: 10 }]}>
            This certificate is generated by {AGREEMENT_PROVIDER.entity} and forms part of the executed
            agreement. The audit trail it reproduces is stored append-only and cannot be edited or deleted.
          </Text>
        </Page>
      )}
    </Document>
  );
}

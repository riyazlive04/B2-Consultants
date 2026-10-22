/**
 * The certificate of completion - the audit trail, printed.
 *
 * ── WHY THIS IS A SHARED COMPONENT AND THE GUIDED TEMPLATES ARE NOT ─────────────────────────
 * `agreement-guided-v3/v4.tsx` each carry their own copy of this page, and must: a signed
 * agreement has to go on rendering exactly the document it was signed as, so those files are
 * frozen and are not refactored into this one.
 *
 * The uploaded kinds are different. Both of them need this page, and they reach it by different
 * routes - the DOCX renderer includes it as a `<Page>` inside its own `<Document>`, while the PDF
 * overlay path has no react-pdf document at all and renders it standalone, then merges the result
 * onto the stamped original with pdf-lib. One layout, two mountings, so the certificate on an
 * uploaded Word agreement and the certificate on an uploaded PDF cannot drift apart.
 *
 * GLYPHS: same WinAnsi rule as the guided templates. Helvetica/Courier here have no ₹, ☒, ✓ or ◦ -
 * anything outside WinAnsi prints as a blank box. Stick to ASCII plus "§" and "•".
 */

import { Document, Page, Text, View, StyleSheet, Font } from "@react-pdf/renderer";
import { PdfBrandLockup } from "./pdf-brand";
import { deviceRows, userAgentMismatch, type StoredDevice } from "@/lib/device";
import { AGREEMENT_PROVIDER } from "@/lib/agreement";

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

export const certStyles = StyleSheet.create({
  page: {
    paddingTop: 42,
    paddingBottom: 64,
    paddingHorizontal: 52,
    fontFamily: "Helvetica",
    fontSize: 9.5,
    lineHeight: 1.45,
    color: INK,
  },
  title: { fontSize: 16, fontFamily: "Helvetica-Bold", color: HEADING, textAlign: "center" },
  subtitle: { fontSize: 10.5, color: SUBHEAD, textAlign: "center", marginTop: 3 },
  h2: { fontSize: 12.5, fontFamily: "Helvetica-Bold", color: HEADING, marginTop: 16, marginBottom: 6 },
  p: { marginBottom: 5, textAlign: "justify" },
  bold: { fontFamily: "Helvetica-Bold" },
  mono: { fontFamily: "Courier", fontSize: 8 },
  callout: {
    backgroundColor: CALLOUT_BG,
    borderLeftWidth: 3,
    borderLeftColor: SUBHEAD,
    paddingVertical: 7,
    paddingHorizontal: 9,
    marginVertical: 7,
  },
  calloutText: { color: "#1F3E5A", fontSize: 9 },
  warnBox: {
    backgroundColor: "#FDF4E3",
    borderLeftWidth: 3,
    borderLeftColor: WARN,
    paddingVertical: 7,
    paddingHorizontal: 9,
    marginVertical: 7,
  },
  warnText: { color: WARN, fontSize: 9 },
  table: { borderWidth: 0.8, borderColor: LINE, marginVertical: 7 },
  tr: { flexDirection: "row", borderBottomWidth: 0.8, borderBottomColor: LINE },
  trLast: { flexDirection: "row" },
  th: {
    backgroundColor: TABLE_HEAD,
    color: "#FFFFFF",
    fontFamily: "Helvetica-Bold",
    fontSize: 8.5,
    paddingVertical: 4,
    paddingHorizontal: 5,
  },
  td: { fontSize: 8.5, paddingVertical: 4, paddingHorizontal: 5 },
  cellDivider: { borderRightWidth: 0.8, borderRightColor: LINE },
  partyRow: { flexDirection: "row", marginBottom: 3 },
  partyLabel: { width: 78, color: MUTED, fontSize: 8.5 },
  partyValue: { flex: 1, fontSize: 8.5 },
  caption: { fontSize: 7.5, color: MUTED },
});

/** One line of the audit trail, already flattened for print. Mirrors the guided templates' type. */
export type CertificateEvent = { label: string; at: Date; detail?: string | null };

export type CertificateData = {
  events: CertificateEvent[];
  signerIp?: string | null;
  signerUserAgent?: string | null;
  otpVerifiedAt?: Date | null;
  /** Masked - "+91 ••••• 3210". Never the full number. */
  deliveredTo?: string | null;
  device?: StoredDevice | null;
};

export type CertificateProps = {
  documentNo: string;
  /** What this document is called on the certificate - the uploaded file's own title. */
  title: string;
  dataSha256: string;
  templateVersion: string;
  studentName: string;
  signedAt: Date;
  certificate: CertificateData;
};

/** "Tue 07 Jul 2026, 03:30 PM IST" - the trail must be unambiguous about zone. */
export function stamp(d: Date): string {
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

function Party({ label, value }: { label: string; value: string }) {
  return (
    <View style={certStyles.partyRow}>
      <Text style={certStyles.partyLabel}>{label}</Text>
      <Text style={certStyles.partyValue}>{value}</Text>
    </View>
  );
}

/** The page body, without the `<Page>` wrapper, so a caller can set its own page chrome. */
export function CertificateBody({
  documentNo,
  title,
  dataSha256,
  templateVersion,
  studentName,
  signedAt,
  certificate,
}: CertificateProps) {
  return (
    <>
      <View style={{ alignItems: "center", marginBottom: 10 }}>
        <PdfBrandLockup size={30} />
      </View>
      <Text style={certStyles.title}>CERTIFICATE OF COMPLETION</Text>
      <Text style={certStyles.subtitle}>Electronic signature audit trail</Text>
      <View style={{ borderBottomWidth: 1.4, borderBottomColor: RULE, marginTop: 6, marginBottom: 12 }} />

      <Text style={certStyles.h2}>Document</Text>
      <Party label="Reference" value={documentNo} />
      <Party label="Title" value={title} />
      <Party
        label="Parties"
        value={`${AGREEMENT_PROVIDER.name} (${AGREEMENT_PROVIDER.entity}) and ${studentName}`}
      />
      <Party label="Executed" value={stamp(signedAt)} />

      <Text style={certStyles.h2}>Integrity</Text>
      <Text style={certStyles.p}>
        The content hash below is the SHA-256 of the canonical representation of this agreement&apos;s terms,
        of the document body it was drawn up on, and of the template version used to render them. It is
        reproducible: the same terms and the same body under template{" "}
        <Text style={certStyles.bold}>{templateVersion}</Text> yield this same hash. It appears in the header
        of every page of this document.
      </Text>
      <View style={[certStyles.callout, { marginTop: 4 }]}>
        <Text style={[certStyles.calloutText, certStyles.mono]}>Content SHA-256: {dataSha256}</Text>
      </View>
      <Text style={certStyles.p}>
        A separate SHA-256 is taken of the final bytes of this PDF at the moment of sealing and stored
        alongside the record. It is not printed here - a file cannot contain its own hash.{" "}
        {AGREEMENT_PROVIDER.entity} can produce it on request to demonstrate that the stored artifact has not
        been altered.
      </Text>

      <Text style={certStyles.h2}>Signer Verification</Text>
      <Text style={certStyles.p}>
        The Student&apos;s signature was captured after a one-time code was delivered by WhatsApp to the
        number on record and entered correctly, binding the signature to control of that number.
      </Text>
      {certificate.deliveredTo && <Party label="Delivered to" value={certificate.deliveredTo} />}
      {certificate.otpVerifiedAt && <Party label="Code verified" value={stamp(certificate.otpVerifiedAt)} />}
      {certificate.signerIp && <Party label="Signer IP" value={certificate.signerIp} />}
      {certificate.signerUserAgent && (
        <View style={certStyles.partyRow}>
          <Text style={certStyles.partyLabel}>User agent</Text>
          <Text style={[certStyles.partyValue, certStyles.caption]}>{certificate.signerUserAgent}</Text>
        </View>
      )}

      {certificate.device && (
        <>
          <Text style={certStyles.h2}>Signing Device</Text>
          <Text style={certStyles.p}>
            The Student signed by hand on the device below. The rows marked as reported are the
            browser&apos;s own account of itself and could in principle be altered by the signer; the IP
            address and the request headers are observed by {AGREEMENT_PROVIDER.entity}&apos; server and
            cannot be.
          </Text>
          <View style={certStyles.table}>
            {deviceRows(certificate.device).map((row, i, arr) => (
              <View key={row[0]} style={i === arr.length - 1 ? certStyles.trLast : certStyles.tr}>
                <Text style={[certStyles.td, certStyles.cellDivider, { width: "32%" }, certStyles.bold]}>
                  {row[0]}
                </Text>
                <Text style={[certStyles.td, { width: "68%" }]}>{row[1]}</Text>
              </View>
            ))}
          </View>
          <View style={certStyles.partyRow}>
            <Text style={certStyles.partyLabel}>Reported UA</Text>
            <Text style={[certStyles.partyValue, certStyles.caption]}>
              {certificate.device.reported.userAgent || "not reported"}
            </Text>
          </View>
          {/* A discrepancy is not proof of anything. Hiding it would be. */}
          {userAgentMismatch(certificate.device) && (
            <View style={certStyles.warnBox}>
              <Text style={certStyles.warnText}>
                The user agent reported by the signer&apos;s browser differs from the one carried by the
                request our server received. This is recorded for completeness and does not by itself
                indicate that the signature is invalid.
              </Text>
            </View>
          )}
        </>
      )}

      <Text style={certStyles.h2}>Audit Trail</Text>
      <View style={certStyles.table}>
        <View style={certStyles.tr}>
          <Text style={[certStyles.th, certStyles.cellDivider, { width: "30%" }]}>Event</Text>
          <Text style={[certStyles.th, certStyles.cellDivider, { width: "38%" }]}>Timestamp</Text>
          <Text style={[certStyles.th, { width: "32%" }]}>Detail</Text>
        </View>
        {certificate.events.map((e, i, arr) => (
          <View key={`${e.label}-${i}`} style={i === arr.length - 1 ? certStyles.trLast : certStyles.tr}>
            <Text style={[certStyles.td, certStyles.cellDivider, { width: "30%" }]}>{e.label}</Text>
            <Text style={[certStyles.td, certStyles.cellDivider, { width: "38%" }]}>{stamp(e.at)}</Text>
            <Text style={[certStyles.td, { width: "32%" }, certStyles.caption]}>{e.detail ?? ""}</Text>
          </View>
        ))}
      </View>

      <Text style={[certStyles.caption, { marginTop: 10 }]}>
        This certificate is generated by {AGREEMENT_PROVIDER.entity} and forms part of the executed
        agreement. The audit trail it reproduces is stored append-only and cannot be edited or deleted.
      </Text>
    </>
  );
}

/** As a page inside somebody else's document - the DOCX renderer's use. */
export function CertificatePage(props: CertificateProps & { chrome?: React.ReactNode }) {
  const { chrome, ...rest } = props;
  return (
    <Page size="A4" style={certStyles.page}>
      {chrome}
      <CertificateBody {...rest} />
    </Page>
  );
}

/**
 * As a document of its own, for the PDF overlay path: rendered to bytes, then merged onto the
 * stamped original by `agreement-pdf-overlay`. react-pdf cannot write into an existing PDF, and
 * pdf-lib cannot typeset a paragraph - so each does the half it is good at.
 */
export function CertificateDocument(props: CertificateProps) {
  return (
    <Document title={`${props.documentNo} - certificate`}>
      <CertificatePage {...props} />
    </Document>
  );
}

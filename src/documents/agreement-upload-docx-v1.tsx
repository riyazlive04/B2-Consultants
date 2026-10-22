/**
 * The renderer for an UPLOADED WORD DOCUMENT, pinned as template version "upload-docx-v1".
 *
 * It typesets `DocBlock[]` - the block model `lib/docx-blocks` parses a `.docx` into - in B2's
 * document style, resolves merge fields on the way in, and draws each `{ type: "field" }` block
 * as a signature zone.
 *
 * ── THE SAME FOUR THINGS THAT BITE IN THE GUIDED TEMPLATES ──────────────────────────────────
 * 1. GLYPHS. Built-in Helvetica is WinAnsi. ₹ ☒ ✓ ◦ ⚠ are NOT in it and print as blank boxes.
 *    Money reaches here already written "69,999 INR" (`formatInrPlainForDocument`), bullets are
 *    "•" (which IS in WinAnsi), sub-bullets are "-". An uploaded document can of course contain
 *    anything, so `winAnsiSafe` strips what cannot be printed rather than letting a student
 *    receive a contract full of boxes.
 * 2. HYPHENATION is on by default and chops legal text mid-syllable. Disabled below.
 * 3. OUTPUT IS NOT DETERMINISTIC. PDFKit stamps a creation date, so the same input renders to
 *    different bytes. Hash the sealed bytes once, at signing; never re-render to verify.
 * 4. THIS FILE IS A FROZEN RENDERER. A change here changes what an already-signed agreement
 *    renders as, because `renderAgreementPdf` dispatches on the version stored on the row. A
 *    layout change means `upload-docx-v2.tsx` and a new entry in the dispatch map.
 *
 * What is NOT here, deliberately: Word's fonts, colours, margins, column widths, images, headers
 * and footers. This is a re-typesetting, not a reproduction - which is exactly the trade the
 * `PDF` document kind exists to avoid.
 */

import { Document, Page, Text, View, Image, StyleSheet, Font, Svg, Polyline, Rect } from "@react-pdf/renderer";
import { PdfBrandLockup } from "./pdf-brand";
import { CertificatePage, type CertificateData } from "./pdf-certificate";
import { AGREEMENT_PROVIDER, shortHash } from "@/lib/agreement";
import { runsText, type DocBlock, type DocInline, type DocOptions } from "@/lib/agreement-doc";
import { inkOf, type FilledField } from "@/lib/agreement-fill";
import { winAnsiSafe } from "@/lib/win-ansi";

Font.registerHyphenationCallback((word) => [word]);

const INK = "#1a1a1a";
const HEADING = "#1F4E79";
const SUBHEAD = "#2E74B5";
const RULE = "#1F4E79";
const LINE = "#9CB4CE";
const TABLE_HEAD = "#2E5C8A";
const MUTED = "#5A6B7B";
const ZONE_BG = "#F4F7FB";

const s = StyleSheet.create({
  page: {
    paddingTop: 46,
    paddingBottom: 64,
    paddingHorizontal: 52,
    fontFamily: "Helvetica",
    fontSize: 9.5,
    lineHeight: 1.45,
    color: INK,
  },
  runningHead: { position: "absolute", top: 18, left: 52, right: 52, fontSize: 6.5, color: MUTED },
  watermark: {
    position: "absolute",
    top: 320,
    left: 0,
    right: 0,
    textAlign: "center",
    fontSize: 72,
    fontFamily: "Helvetica-Bold",
    color: "#E6EDF5",
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

  h1: { fontSize: 15, fontFamily: "Helvetica-Bold", color: HEADING, marginTop: 14, marginBottom: 2 },
  h1Rule: { borderBottomWidth: 1.2, borderBottomColor: RULE, marginBottom: 8 },
  h2: { fontSize: 12, fontFamily: "Helvetica-Bold", color: HEADING, marginTop: 13, marginBottom: 4 },
  h3: { fontSize: 10, fontFamily: "Helvetica-Bold", color: SUBHEAD, marginTop: 10, marginBottom: 3 },

  p: { marginBottom: 5, textAlign: "justify" },
  bold: { fontFamily: "Helvetica-Bold" },
  italic: { fontFamily: "Helvetica-Oblique" },
  boldItalic: { fontFamily: "Helvetica-BoldOblique" },
  underline: { textDecoration: "underline" },
  link: { color: SUBHEAD },

  bulletRow: { flexDirection: "row", marginBottom: 3.5, paddingRight: 4 },
  bulletDot: { width: 16, textAlign: "right", paddingRight: 5, color: INK },
  bulletBody: { flex: 1, textAlign: "justify" },

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

  rule: { borderBottomWidth: 0.8, borderBottomColor: LINE, marginVertical: 10 },

  // ── Signature zones ──
  zone: {
    borderWidth: 0.8,
    borderColor: LINE,
    backgroundColor: ZONE_BG,
    paddingVertical: 8,
    paddingHorizontal: 10,
    marginVertical: 8,
  },
  zoneLabel: { fontSize: 8, color: MUTED, fontFamily: "Helvetica-Bold", marginBottom: 4 },
  zoneInkRow: { height: 42, flexDirection: "row", alignItems: "flex-end" },
  zoneInk: { height: 40, objectFit: "contain" },
  zoneLine: { borderBottomWidth: 0.8, borderBottomColor: "#7E8C9A", marginTop: 2 },
  zoneCaption: { fontSize: 7.5, color: MUTED, marginTop: 3 },
  zoneTextRow: { minHeight: 18, justifyContent: "flex-end" },
  zoneText: { fontSize: 10 },

  // A tick box sits INLINE with its label rather than in a panel: it is a sentence the signer
  // agrees to, not a space they sign in, and a bordered panel around one reads as a form field.
  checkRow: { flexDirection: "row", alignItems: "flex-start", marginVertical: 6, paddingRight: 4 },
  checkBoxCol: { width: 18, paddingTop: 1 },
  checkLabel: { flex: 1, fontSize: 9.5 },
  checkUnticked: { fontSize: 8, color: MUTED, marginTop: 2 },

  // Initials are a quarter the height of a signature zone and sit on one line.
  initialsZone: {
    borderWidth: 0.8,
    borderColor: LINE,
    backgroundColor: ZONE_BG,
    paddingVertical: 4,
    paddingHorizontal: 6,
    marginVertical: 6,
    width: 120,
  },
  initialsInkRow: { height: 22, flexDirection: "row", alignItems: "flex-end" },
  initialsInk: { height: 20, objectFit: "contain" },
});

export type UploadDocProps = {
  documentNo: string;
  dataSha256: string;
  templateVersion: string;
  /** The document's own title, for the running head and the certificate. */
  title: string;
  studentName: string;
  /** Blocks with merge fields ALREADY resolved - the renderer never sees a `{{token}}`. */
  blocks: DocBlock[];
  /** What each placed field prints, by field id (`lib/agreement-fill`). */
  filled: Map<string, FilledField>;
  /** Per-document switches - `initialEveryPage` is the one this renderer reads. */
  options?: DocOptions | null;
  signedAt?: Date | null;
  certificate?: CertificateData | null;
};

/** Inline runs → styled `<Text>` children. */
function Runs({ runs }: { runs: readonly DocInline[] }) {
  return (
    <>
      {runs.map((r, i) => {
        const style = [
          r.b && r.i ? s.boldItalic : r.b ? s.bold : r.i ? s.italic : null,
          r.u ? s.underline : null,
          r.href ? s.link : null,
        ].filter(Boolean);
        return (
          <Text key={i} style={style.length > 0 ? (style as never) : undefined}>
            {winAnsiSafe(r.text)}
          </Text>
        );
      })}
    </>
  );
}

/**
 * A signature zone.
 *
 * `wrap={false}` is load-bearing: a signature box split across a page break puts the ink on one
 * page and the name under it on the next, which on a contract looks like tampering.
 */
/**
 * A drawn tick, as SVG.
 *
 * NOT the character "\u2713". That glyph is absent from WinAnsi - the encoding of the built-in
 * Helvetica - and prints as a blank rectangle, which on a consent box is worse than nothing: an
 * empty-looking box beside "I have read §8" is exactly the fact in dispute. Same reasoning as the
 * guided templates, which draw their checkboxes rather than typing them.
 */
function TickBox({ ticked }: { ticked: boolean }) {
  return (
    <Svg width={11} height={11} viewBox="0 0 11 11">
      <Rect x={0.5} y={0.5} width={10} height={10} rx={1.5} stroke="#5A6B7B" strokeWidth={0.9} fill="#FFFFFF" />
      {ticked && (
        <Polyline points="2.4,5.8 4.4,8 8.7,2.9" stroke="#1F4E79" strokeWidth={1.5} fill="none" />
      )}
    </Svg>
  );
}

function Zone({ filled }: { filled: FilledField }) {
  const { field, caption, ink, text, ticked } = filled;

  // ── A consent tick: inline, with the sentence beside it ──
  if (field.kind === "CHECKBOX") {
    return (
      <View style={s.checkRow} wrap={false}>
        <View style={s.checkBoxCol}>
          <TickBox ticked={ticked === true} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={s.checkLabel}>{winAnsiSafe(caption)}</Text>
          {/* An optional box that was deliberately left unticked is a fact about what was agreed,
              so it is stated rather than being indistinguishable from "not yet signed". */}
          {ticked === false && <Text style={s.checkUnticked}>Not ticked by the signer.</Text>}
        </View>
      </View>
    );
  }

  // ── Initials ──
  if (field.kind === "INITIALS") {
    return (
      <View style={s.initialsZone} wrap={false}>
        <Text style={s.zoneLabel}>{winAnsiSafe(caption).toUpperCase()}</Text>
        <View style={s.initialsInkRow}>{ink ? <Image src={ink} style={s.initialsInk} /> : null}</View>
        <View style={s.zoneLine} />
        <Text style={s.zoneCaption}>Initials</Text>
      </View>
    );
  }

  if (field.kind === "SIGNATURE") {
    return (
      <View style={s.zone} wrap={false}>
        <Text style={s.zoneLabel}>{winAnsiSafe(caption).toUpperCase()}</Text>
        <View style={s.zoneInkRow}>{ink ? <Image src={ink} style={s.zoneInk} /> : null}</View>
        <View style={s.zoneLine} />
        <Text style={s.zoneCaption}>Signature</Text>
      </View>
    );
  }

  const footer =
    field.kind === "DATE"
      ? "Date"
      : field.kind === "NAME"
        ? "Printed name"
        : field.kind === "ATTACHMENT"
          ? "Attached by the signer"
          : "Detail";

  return (
    <View style={s.zone} wrap={false}>
      <Text style={s.zoneLabel}>{winAnsiSafe(caption).toUpperCase()}</Text>
      <View style={s.zoneTextRow}>
        {text ? <Text style={s.zoneText}>{winAnsiSafe(text)}</Text> : null}
      </View>
      <View style={s.zoneLine} />
      <Text style={s.zoneCaption}>{footer}</Text>
    </View>
  );
}

function Block({ block, filled }: { block: DocBlock; filled: Map<string, FilledField> }) {
  switch (block.type) {
    case "heading":
      return block.level === 1 ? (
        <View wrap={false}>
          <Text style={s.h1}>
            <Runs runs={block.runs} />
          </Text>
          <View style={s.h1Rule} />
        </View>
      ) : (
        <Text style={block.level === 2 ? s.h2 : s.h3} wrap={false}>
          <Runs runs={block.runs} />
        </Text>
      );

    case "p":
      return (
        <Text style={[s.p, block.align ? { textAlign: block.align } : {}]}>
          <Runs runs={block.runs} />
        </Text>
      );

    case "list":
      return (
        <View>
          {block.items.map((item, i) => (
            <View key={i} style={s.bulletRow}>
              <Text style={s.bulletDot}>{block.ordered ? `${i + 1}.` : "•"}</Text>
              <Text style={s.bulletBody}>
                <Runs runs={item} />
              </Text>
            </View>
          ))}
        </View>
      );

    case "table": {
      // Equal columns, widest row wins. Word's own column widths are not in the block model, and
      // guessing them from cell content produces worse tables than an even split.
      const columns = Math.max(1, ...block.rows.map((r) => r.cells.length));
      const width = `${100 / columns}%`;
      return (
        <View style={s.table}>
          {block.rows.map((row, i, arr) => (
            <View key={i} style={i === arr.length - 1 ? s.trLast : s.tr} wrap={false}>
              {Array.from({ length: columns }, (_, c) => (
                <Text
                  key={c}
                  style={[row.head ? s.th : s.td, c < columns - 1 ? s.cellDivider : {}, { width }]}
                >
                  <Runs runs={row.cells[c] ?? []} />
                </Text>
              ))}
            </View>
          ))}
        </View>
      );
    }

    case "field": {
      const f = filled.get(block.fieldId);
      // A zone with no field behind it is refused at issue (`validateDocBody`), so this can only
      // be a draft preview mid-edit. Print nothing rather than an error on a contract.
      return f ? <Zone filled={f} /> : null;
    }

    case "rule":
      return <View style={s.rule} />;

    case "pageBreak":
      // react-pdf has no "break here" element; an empty View that must not wrap and is taller
      // than the remaining space is the documented way, and `break` does exactly that.
      return <View break />;
  }
}

export function AgreementUploadDocxV1({
  documentNo,
  dataSha256,
  templateVersion,
  title,
  studentName,
  blocks,
  filled,
  options,
  signedAt,
  certificate,
}: UploadDocProps) {
  const executed = !!signedAt;
  const studentInk = inkOf(filled, "STUDENT");
  const creatorInk = inkOf(filled, "CREATOR");
  // `initialEveryPage` adds B2's mark beside the student's in the running footer. The student's
  // own mark has always been there - see the note in `Chrome`.
  const bothMarks = !!options?.initialEveryPage;

  const Chrome = () => (
    <>
      <Text style={s.runningHead} fixed>
        {AGREEMENT_PROVIDER.entity} · Document {documentNo} · Content hash {shortHash(dataSha256)}
      </Text>
      {!executed && (
        <Text style={s.watermark} fixed>
          UNSIGNED
        </Text>
      )}
      <View style={s.footer} fixed>
        <Text
          style={s.pageNo}
          render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`}
        />
        {/* The master initials every page. Only a signed copy carries the mark. */}
        <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 10 }}>
          {bothMarks && creatorInk && <Image src={creatorInk} style={{ height: 18 }} />}
          {studentInk ? (
            <Image src={studentInk} style={{ height: 20 }} />
          ) : (
            <Text style={s.pageNo}>{winAnsiSafe(studentName)}</Text>
          )}
        </View>
      </View>
    </>
  );

  return (
    <Document
      title={`${documentNo} - ${title}`}
      author={AGREEMENT_PROVIDER.entity}
      subject={title}
      creator={AGREEMENT_PROVIDER.entity}
      producer={AGREEMENT_PROVIDER.entity}
    >
      <Page size="A4" style={s.page}>
        <Chrome />
        <View style={{ alignItems: "center", marginBottom: 12 }}>
          <PdfBrandLockup size={30} />
        </View>
        {blocks.map((block, i) => (
          <Block key={i} block={block} filled={filled} />
        ))}
        <View style={{ borderTopWidth: 0.8, borderTopColor: LINE, marginTop: 18, paddingTop: 8 }}>
          <Text style={{ textAlign: "center", fontSize: 7.5, color: MUTED }}>
            {AGREEMENT_PROVIDER.name} • {AGREEMENT_PROVIDER.address}
          </Text>
          <Text style={{ textAlign: "center", fontSize: 7.5, color: MUTED }}>
            Mob: {AGREEMENT_PROVIDER.mobile} • {AGREEMENT_PROVIDER.email} • {AGREEMENT_PROVIDER.website}
          </Text>
        </View>
      </Page>

      {/* Sealed copies only: a certificate on a draft would make an unexecuted document look executed. */}
      {certificate && executed && (
        <CertificatePage
          chrome={<Chrome />}
          documentNo={documentNo}
          title={title}
          dataSha256={dataSha256}
          templateVersion={templateVersion}
          studentName={studentName}
          signedAt={signedAt!}
          certificate={certificate}
        />
      )}
    </Document>
  );
}

/** The document's printed title: its first heading, else the file it came from. */
export function uploadDocTitle(blocks: readonly DocBlock[], fallback: string): string {
  for (const b of blocks) {
    if (b.type === "heading") {
      const t = runsText(b.runs).trim();
      if (t) return t.slice(0, 120);
    }
  }
  return fallback;
}

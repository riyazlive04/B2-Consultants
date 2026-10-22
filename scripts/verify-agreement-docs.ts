/**
 * End-to-end check for uploaded agreement documents, with no database involved.
 *
 *   1. build a real .docx (the `docx` dep the WhatsApp doc scripts already use)
 *   2. parse it exactly as the upload route does
 *   3. render the DOCX path to a PDF
 *   4. build a PDF, stamp it through the PDF path with a fake signature
 *
 *   npm run verify:agreement-docs
 *
 * (It runs WITHOUT `--conditions=react-server`, unlike most scripts here: that condition resolves
 * React to its server subset, which refuses to load outside a framework. Same as `sample:invoice`.)
 *
 * Why a script and not a unit test: the two renderers are the one part of this feature a test
 * cannot usefully assert on. `@react-pdf/renderer` and `pdf-lib` produce non-deterministic bytes
 * (a creation date and a document id are stamped in), so there is nothing to compare against -
 * what matters is that a real .docx and a real .pdf go all the way through to a PDF that opens,
 * with the signature zones where they belong. The parsing and the rules underneath ARE unit
 * tested: see lib/__tests__/docx-blocks.test.ts and lib/__tests__/agreement-doc.test.ts.
 *
 * The four PDFs it writes are meant to be opened and looked at. Nothing here touches the
 * database, so it is safe to run against any environment.
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { Document, Packer, Paragraph, HeadingLevel, TextRun, Table, TableRow, TableCell } from "docx";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { parseUpload } from "@/server/agreement-upload";
import { renderAgreementPdf } from "@/server/agreement-render";
import { validateDocBody } from "@/lib/agreement-doc";
import { documentReadiness } from "@/server/agreement-body";
import { buildTimestampRequest } from "@/lib/rfc3161";
import type { AgreementData } from "@/lib/agreement";

const OUT = process.env.SMOKE_OUT ?? ".";


const DATA: AgreementData = {
  student: {
    fullName: "Priya Raghunathan",
    address: "12 MG Road, Bengaluru 560001",
    phone: "+919876543210",
    email: "priya@example.com",
  },
  batch: { number: "Batch 12", startDate: "2026-07-04" },
  payment: {
    option: "INSTALMENT",
    totalInrMinor: "6999900",
    planExtraInrMinor: "250000",
    instalments: [
      { amountInrMinor: "4399900", dueMilestone: "Before commencement of Week 1", dueDate: "2026-07-04" },
      { amountInrMinor: "2850000", dueMilestone: "Before the 2nd Sprint Week", dueDate: "2026-08-15" },
    ],
  },
};

/**
 * Something that looks like ink, as a real PNG.
 *
 * Generated with sharp rather than pasted as a base64 literal: both PDF engines decode the bytes
 * for real (png-js inside react-pdf, and pdf-lib's own decoder), and a literal that is even
 * slightly malformed fails with "incorrect data check" from zlib - which looks like a bug in the
 * stamping code and is not one.
 */
async function inkPng(): Promise<Buffer> {
  const { default: sharp } = await import("sharp");
  const w = 600;
  const h = 200;
  return sharp({ create: { width: w, height: h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([
      {
        input: Buffer.from(
          `<svg width="${w}" height="${h}"><path d="M20 150 C 120 20, 200 180, 300 90 S 480 20, 580 120" stroke="#102a43" stroke-width="7" fill="none" stroke-linecap="round"/></svg>`,
        ),
        top: 0,
        left: 0,
      },
    ])
    .png()
    .toBuffer();
}

async function buildDocx(): Promise<Buffer> {
  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({ text: "Coaching & Consulting Agreement", heading: HeadingLevel.HEADING_1 }),
          new Paragraph({
            children: [
              new TextRun("This agreement is made between "),
              new TextRun({ text: "{{provider.name}}", bold: true }),
              new TextRun(" and {{student.fullName}} of {{student.address}}."),
            ],
          }),
          new Paragraph({ text: "1. Programme", heading: HeadingLevel.HEADING_2 }),
          new Paragraph("The Student joins {{batch.number}}, starting {{batch.startDate}}."),
          new Paragraph({ text: "2. Fee", heading: HeadingLevel.HEADING_2 }),
          new Paragraph("The programme fee is {{payment.total}}, collected as {{payment.option}}."),
          new Paragraph("{{payment.schedule}}"),
          new Table({
            rows: [
              new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph("Instalment")] }),
                  new TableCell({ children: [new Paragraph("Due")] }),
                ],
              }),
              new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph("43,999 INR")] }),
                  new TableCell({ children: [new Paragraph("Week 1"), new Paragraph("04.07.2026")] }),
                ],
              }),
            ],
          }),
          new Paragraph({ text: "3. Signatures", heading: HeadingLevel.HEADING_2 }),
          new Paragraph("For B2 Consultants: [[sign:creator]] on [[date:creator]]"),
          new Paragraph("The Student: [[sign:student|Your signature]] on [[date:student]]"),
          new Paragraph("Printed name: [[name:student]]"),
          new Paragraph("Initials: [[initials:student|Initial here]]"),
          new Paragraph("A parent or guardian: [[sign:guardian]] on [[date:guardian]]"),
        ],
      },
    ],
  });
  return Packer.toBuffer(doc);
}

async function buildPdf(): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (const n of [1, 2]) {
    const page = pdf.addPage([595.28, 841.89]); // A4 in points
    page.drawText(`Coaching Agreement - page ${n}`, { x: 60, y: 760, size: 18, font });
    page.drawText("Exported from Word. Layout preserved exactly.", { x: 60, y: 730, size: 11, font });
    if (n === 2) {
      page.drawText("For B2 Consultants:", { x: 60, y: 300, size: 11, font });
      page.drawText("The Student:", { x: 330, y: 300, size: 11, font });
    }
  }
  return Buffer.from(await pdf.save());
}

/**
 * A FILLABLE PDF - one with its own AcroForm boxes, the kind `agreement-acroform.ts` reads.
 *
 * Field names are deliberately in the messy shapes real exports use (`student.sign_date`,
 * `studentFullName`, `b2_consultants_signature`), because the whole value of the importer is in
 * guessing who owns a box from a name somebody else chose.
 */
async function buildFillablePdf(): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const p1 = pdf.addPage([595.28, 841.89]);
  const p2 = pdf.addPage([595.28, 841.89]);
  p1.drawText("Coaching Agreement (fillable)", { x: 60, y: 780, size: 16, font });
  p2.drawText("Signatures", { x: 60, y: 260, size: 12, font });

  const form = pdf.getForm();
  form.createTextField("student_signature").addToPage(p2, { x: 60, y: 200, width: 180, height: 40 });
  form.createTextField("b2_consultants_signature").addToPage(p2, { x: 330, y: 200, width: 180, height: 40 });
  form.createTextField("student.sign_date").addToPage(p2, { x: 60, y: 150, width: 120, height: 20 });
  form.createTextField("studentFullName").addToPage(p2, { x: 330, y: 150, width: 160, height: 20 });
  form.createTextField("guardian_signature").addToPage(p2, { x: 330, y: 100, width: 160, height: 30 });

  const consent = form.createCheckBox("i_agree_refund_policy");
  consent.addToPage(p2, { x: 60, y: 110, width: 14, height: 14 });
  consent.enableRequired();

  // A push button has nothing to sign and must be SKIPPED rather than imported as a box.
  form.createButton("print_me").addToPage("Print", p1, { x: 60, y: 60, width: 60, height: 20 });

  return Buffer.from(await pdf.save());
}

async function main() {
  const INK = await inkPng();

  // ── 1. DOCX ──
  const docxBytes = await buildDocx();
  const docxParsed = await parseUpload({ bytes: docxBytes, filename: "gm-agreement.docx" });
  if (!docxParsed.ok) throw new Error(`docx parse failed: ${docxParsed.error}`);
  if (docxParsed.kind !== "DOCX") throw new Error("sniffed the wrong kind for a .docx");

  console.log(`DOCX  ${docxParsed.blocks.length} blocks, ${docxParsed.fields.length} fields from placeholders`);
  console.log(
    "      fields:",
    docxParsed.fields.map((f) => `${f.id}=${f.kind}/${f.signer}${f.label ? `(${f.label})` : ""}`).join(" "),
  );
  const docxBody = {
    kind: "DOCX" as const,
    blocks: docxParsed.blocks,
    fields: docxParsed.fields,
    sourceName: docxParsed.sourceName,
    sourceSha256: docxParsed.sourceSha256,
    pageCount: null,
    pageSizes: null,
  };
  const docxProblems = validateDocBody(docxBody);
  console.log("      validate:", docxProblems.length === 0 ? "signable" : docxProblems.map((p) => p.message));
  const ready = documentReadiness(docxBody);
  console.log("      readiness:", ready.ok ? "ready to send" : ready.problems);
  if (!ready.ok) throw new Error("a fully marked-up document should be ready to send");

  const unsignedDocx = await renderAgreementPdf({
    documentNo: "B2-GM-2026-0007",
    data: DATA,
    templateVersion: "upload-docx-v1",
    body: docxBody,
  });
  writeFileSync(join(OUT, "smoke-docx-unsigned.pdf"), unsignedDocx);
  console.log(`      unsigned render: ${unsignedDocx.length.toLocaleString()} bytes`);

  /**
   * The signed render exercises every field kind at once, including the ones a founder adds in
   * the designer rather than in Word: a ticked consent box, an untouched optional box, a typed
   * text box and an attachment. Plus `initialEveryPage`, so the footer stamping is covered.
   */
  const richBody = {
    ...docxBody,
    options: { initialEveryPage: true } as const,
    blocks: [
      ...docxParsed.blocks,
      { type: "field" as const, fieldId: "c1" },
      { type: "field" as const, fieldId: "c2" },
      { type: "field" as const, fieldId: "t1" },
      { type: "field" as const, fieldId: "at1" },
    ],
    fields: [
      ...docxParsed.fields,
      { id: "c1", kind: "CHECKBOX" as const, signer: "STUDENT" as const, required: true, label: "I have read section 8" },
      { id: "c2", kind: "CHECKBOX" as const, signer: "STUDENT" as const, label: "Send me the newsletter" },
      { id: "t1", kind: "TEXT" as const, signer: "STUDENT" as const, label: "Passport number" },
      { id: "at1", kind: "ATTACHMENT" as const, signer: "STUDENT" as const, label: "Photo ID" },
    ],
  };

  const signedDocx = await renderAgreementPdf({
    documentNo: "B2-GM-2026-0007",
    data: DATA,
    templateVersion: "upload-docx-v1",
    body: richBody,
    // What the student ticked and typed. `c2` is deliberately absent, not false: an untouched
    // optional box must render as unanswered rather than as a refusal.
    signerValues: { c1: true, t1: "X1234567", at1: "photo-id.pdf" },
    guardian: {
      name: "Rukmini Raghunathan",
      signaturePng: INK,
      signedAt: new Date("2026-10-20T08:00:00Z"),
      values: {},
    },
    founderSignaturePng: INK,
    studentSignaturePng: INK,
    founderSignedAt: new Date("2026-10-20T10:00:00Z"),
    signedAt: new Date("2026-10-21T09:30:00Z"),
    certificate: {
      events: [
        { label: "Agreement created", at: new Date("2026-10-19T08:00:00Z"), detail: null },
        { label: "Signed by student", at: new Date("2026-10-21T09:30:00Z"), detail: "203.0.113.7" },
      ],
      signerIp: "203.0.113.7",
      signerUserAgent: "Mozilla/5.0 (iPhone)",
      otpVerifiedAt: new Date("2026-10-21T09:29:00Z"),
      deliveredTo: "+91 ••••• 3210",
      device: null,
    },
  });
  writeFileSync(join(OUT, "smoke-docx-signed.pdf"), signedDocx);
  console.log(`      signed render:   ${signedDocx.length.toLocaleString()} bytes (includes the certificate page)`);

  // ── 2. PDF ──
  const pdfBytes = await buildPdf();
  const pdfParsed = await parseUpload({ bytes: pdfBytes, filename: "gm-agreement.pdf" });
  if (!pdfParsed.ok) throw new Error(`pdf parse failed: ${pdfParsed.error}`);
  if (pdfParsed.kind !== "PDF") throw new Error("sniffed the wrong kind for a .pdf");
  console.log(`PDF   ${pdfParsed.pageCount} pages, sizes ${JSON.stringify(pdfParsed.pageSizes)}`);

  const pdfBody = {
    kind: "PDF" as const,
    blocks: null,
    fields: [
      { id: "f1", kind: "SIGNATURE" as const, signer: "CREATOR" as const, page: 2, x: 0.1, y: 0.66, w: 0.28, h: 0.07 },
      { id: "f2", kind: "SIGNATURE" as const, signer: "STUDENT" as const, page: 2, x: 0.55, y: 0.66, w: 0.28, h: 0.07 },
      { id: "f3", kind: "DATE" as const, signer: "STUDENT" as const, page: 2, x: 0.55, y: 0.75, w: 0.18, h: 0.035 },
      { id: "f4", kind: "TEXT" as const, signer: "CREATOR" as const, page: 1, x: 0.1, y: 0.2, w: 0.5, h: 0.035, value: "Fee: {{payment.total}}" },
      // A tick box and initials, drawn as vectors by the stamper: pdf-lib THROWS on a glyph
      // WinAnsi cannot encode, so a typed tick would fail the whole stamp rather than look wrong.
      { id: "f5", kind: "CHECKBOX" as const, signer: "STUDENT" as const, page: 2, x: 0.1, y: 0.86, w: 0.03, h: 0.018, required: true, label: "I agree" },
      { id: "f6", kind: "INITIALS" as const, signer: "STUDENT" as const, page: 1, x: 0.8, y: 0.9, w: 0.1, h: 0.045 },
    ],
    sourceName: pdfParsed.sourceName,
    sourceSha256: pdfParsed.sourceSha256,
    pageCount: pdfParsed.pageCount,
    pageSizes: pdfParsed.pageSizes,
  };
  const pdfReady = documentReadiness(pdfBody);
  console.log("      readiness:", pdfReady.ok ? "ready to send" : pdfReady.problems);
  if (!pdfReady.ok) throw new Error("a fully placed PDF should be ready to send");

  const unsignedPdf = await renderAgreementPdf({
    documentNo: "B2-GM-2026-0008",
    data: DATA,
    templateVersion: "upload-pdf-v1",
    body: { ...pdfBody, sourceBytes: pdfParsed.bytes },
  });
  writeFileSync(join(OUT, "smoke-pdf-unsigned.pdf"), unsignedPdf);
  console.log(`      unsigned stamp:  ${unsignedPdf.length.toLocaleString()} bytes`);

  const signedPdf = await renderAgreementPdf({
    documentNo: "B2-GM-2026-0008",
    data: DATA,
    templateVersion: "upload-pdf-v1",
    // `initialEveryPage` on a PDF stamps both marks into every page's footer - the thing the
    // guided clause sets have always done and an uploaded PDF could not.
    body: { ...pdfBody, options: { initialEveryPage: true }, sourceBytes: pdfParsed.bytes },
    signerValues: { f5: true },
    founderSignaturePng: INK,
    studentSignaturePng: INK,
    founderSignedAt: new Date("2026-10-20T10:00:00Z"),
    signedAt: new Date("2026-10-21T09:30:00Z"),
    certificate: {
      events: [{ label: "Signed by student", at: new Date("2026-10-21T09:30:00Z"), detail: "203.0.113.7" }],
      signerIp: "203.0.113.7",
      signerUserAgent: "Mozilla/5.0 (iPhone)",
      otpVerifiedAt: new Date("2026-10-21T09:29:00Z"),
      deliveredTo: "+91 ••••• 3210",
      device: null,
    },
  });
  writeFileSync(join(OUT, "smoke-pdf-signed.pdf"), signedPdf);

  const reopened = await PDFDocument.load(signedPdf);
  console.log(
    `      signed stamp:    ${signedPdf.length.toLocaleString()} bytes, ${reopened.getPageCount()} pages (2 + certificate)`,
  );
  if (reopened.getPageCount() !== 3) throw new Error("the certificate page did not get merged in");

  // ── 2b. A fillable PDF: the boxes should be read out of the document itself ──
  const fillable = await parseUpload({ bytes: await buildFillablePdf(), filename: "fillable.pdf" });
  if (!fillable.ok) throw new Error(`fillable parse failed: ${fillable.error}`);
  if (fillable.kind !== "PDF") throw new Error("sniffed the wrong kind for a fillable .pdf");

  console.log(`FORM  ${fillable.fields.length} fields read out of the PDF's own form boxes`);
  for (const f of fillable.fields) {
    console.log(
      `      ${f.id} ${f.kind.padEnd(9)} ${f.signer.padEnd(8)} p${f.page} ` +
        `x=${f.x!.toFixed(3)} y=${f.y!.toFixed(3)} w=${f.w!.toFixed(3)} h=${f.h!.toFixed(3)}` +
        `${f.required ? " required" : ""}  "${f.label ?? ""}"`,
    );
  }

  // The importer is a suggestion, but these four readings are the ones it exists to get right.
  const byKind = (kind: string, signer: string) =>
    fillable.fields.filter((f) => f.kind === kind && f.signer === signer);
  if (byKind("SIGNATURE", "STUDENT").length !== 1) throw new Error("the student's signature box was not read");
  if (byKind("SIGNATURE", "CREATOR").length !== 1) throw new Error("B2's signature box was not read");
  if (byKind("SIGNATURE", "GUARDIAN").length !== 1) throw new Error("the guardian's signature box was not read");
  if (byKind("DATE", "STUDENT").length !== 1) throw new Error("the date box was not read");
  if (byKind("NAME", "STUDENT").length !== 1) throw new Error("the printed-name box was not read");
  const tick = byKind("CHECKBOX", "STUDENT")[0];
  if (!tick) throw new Error("the consent checkbox was not read");
  if (!tick.required) throw new Error("the checkbox was marked required in the PDF and lost it on import");
  if (fillable.fields.some((f) => /print/i.test(f.label ?? ""))) {
    throw new Error("a push button was imported as a field");
  }
  // Every box must land on the page it was drawn on, inside the page.
  for (const f of fillable.fields) {
    if (f.page !== 2) throw new Error(`${f.id} landed on page ${f.page}, not the signature page`);
    if (f.x! + f.w! > 1.001 || f.y! + f.h! > 1.001) throw new Error(`${f.id} runs off the page`);
  }
  console.log("      every box landed on page 2, inside the page, with the right owner.");

  // ── 3. Read the text back out of the bytes ──
  //
  // The one assertion worth making about a rendered contract: the merge fields RESOLVED. A token
  // that silently survived into the PDF would be a `{{payment.total}}` printed in the middle of a
  // clause on a document somebody signs, and no amount of unit-testing the merge function catches
  // that if the renderer is handed the wrong blocks.
  // pdfjs-dist, NOT pdf-parse. pdf-parse bundles pdf.js 1.x, which rejects PDFKit's output with
  // "bad XRef entry" - the file is fine (pdf-lib and every reader open it), the parser is twenty
  // major versions old. pdfjs-dist is already a dependency for the field designer.
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const text = await extractText(pdfjs, signedDocx);

  const mustContain = [
    "Priya Raghunathan", // {{student.fullName}}
    "69,999 INR", // {{payment.total}}, in the document's own money format
    "Batch 12", // {{batch.number}}
    "04.07.2026", // {{batch.startDate}}, German convention
    "CERTIFICATE OF COMPLETION", // the audit trail page made it in
    "YOUR SIGNATURE", // the zone caption, from [[sign:student|Your signature]]
    "I have read section 8", // a consent checkbox, with its sentence beside the box
    "Not ticked by the signer", // ...and the optional one nobody touched, stated as such
    "X1234567", // what the student typed into their own TEXT box
    "photo-id.pdf", // the file they attached
    "INITIAL HERE", // an INITIALS zone, from [[initials:student|Initial here]]
  ];
  for (const needle of mustContain) {
    if (!text.includes(needle)) throw new Error(`the rendered PDF is missing "${needle}"`);
  }
  if (/\{\{|\[\[/.test(text)) {
    throw new Error("an unresolved merge token or placeholder survived into the rendered PDF");
  }
  console.log(`\nText check: ${mustContain.length} expected strings present, no unresolved tokens.`);

  // ── 4. The timestamp request, checked against a real ASN.1 parser ──
  await checkTimestampRequest();

  console.log("\nAll four renders produced a readable PDF.");
}

/**
 * Round-trip a TimeStampReq through OpenSSL.
 *
 * `lib/rfc3161.ts` writes its DER by hand, and the unit tests check it against the shape RFC 3161
 * specifies - but both were written by the same pair of eyes. OpenSSL is an independent parser,
 * and `ts -query -in` either understands these bytes or it does not. That is the check worth
 * having before anything is sent to an authority that will simply reject it.
 *
 * SKIPPED, not failed, when OpenSSL is not on the machine: it is not a dependency of the app.
 */
async function checkTimestampRequest() {
  const { createHash, randomBytes } = await import("node:crypto");
  const { execFileSync } = await import("node:child_process");
  const { writeFileSync, mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");

  const digest = createHash("sha256").update("the sealed agreement bytes").digest();
  const req = buildTimestampRequest(digest, randomBytes(8));

  const dir = mkdtempSync(join(tmpdir(), "b2-tsq-"));
  const file = join(dir, "request.tsq");
  writeFileSync(file, req);

  let out: string;
  try {
    out = execFileSync("openssl", ["ts", "-query", "-in", file, "-text"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (e) {
    console.log(`TSQ   skipped - OpenSSL could not be run (${e instanceof Error ? e.message.split("\n")[0] : "unknown"})`);
    return;
  }

  const flat = out.replace(/\s+/g, " ");
  const expectations: [string, RegExp][] = [
    ["version 1", /Version: 1/i],
    ["sha256 algorithm", /Hash Algorithm: sha256/i],
    ["certificate requested", /Certificate required: yes/i],
    ["a nonce", /Nonce: 0x[0-9A-F]+/i],
  ];
  for (const [what, re] of expectations) {
    if (!re.test(flat)) {
      throw new Error(`OpenSSL did not find ${what} in our timestamp request:\n${out}`);
    }
  }

  /**
   * The digest, against OpenSSL's hex DUMP of the message data.
   *
   * It prints the bytes as a dump - "c8 fb 05 1d 22 08 3b ca-07 ..." - so the comparison pulls
   * every hex pair out of that block and rejoins them. This is the assertion that actually
   * matters: everything else being well-formed is worthless if the request timestamps a different
   * digest from the one we sealed.
   */
  const dump = /Message data:([\s\S]*?)Policy OID/.exec(out)?.[1] ?? "";
  const dumped = (dump.match(/\b[0-9a-f]{2}\b/gi) ?? []).join("").toLowerCase();
  if (!dumped.includes(digest.toString("hex"))) {
    throw new Error(`OpenSSL read a different digest than the one we asked for:\n${out}`);
  }

  console.log("TSQ   OpenSSL parsed the request: version 1, sha256, our exact digest, nonce, certReq.");
}

/** Every text run in the document, flattened and whitespace-collapsed. */
async function extractText(
  pdfjs: {
    getDocument: (src: { data: Uint8Array; standardFontDataUrl?: string }) => { promise: Promise<unknown> };
  },
  bytes: Buffer,
): Promise<string> {
  type TextItem = { str?: string };
  type Page = { getTextContent: () => Promise<{ items: TextItem[] }> };
  type Doc = { numPages: number; getPage: (n: number) => Promise<Page> };

  // The font directory keeps pdf.js from warning on every page it cannot find Helvetica's metrics
  // in. Text extraction works without it; the warnings just make a clean run look like a failure.
  const doc = (await pdfjs.getDocument({
    data: new Uint8Array(bytes),
    standardFontDataUrl: new URL("../node_modules/pdfjs-dist/standard_fonts/", import.meta.url).pathname.replace(
      /^\/([A-Za-z]:)/,
      "$1",
    ),
  }).promise) as Doc;
  const parts: string[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const content = await (await doc.getPage(n)).getTextContent();
    for (const item of content.items) if (item.str) parts.push(item.str);
  }
  return parts.join(" ").replace(/\s+/g, " ");
}

main().catch((e) => {
  console.error("SMOKE FAILED:", e);
  process.exit(1);
});

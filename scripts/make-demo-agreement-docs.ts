/**
 * Write two sample agreement documents to disk, for uploading through the real UI.
 *
 *   npm run demo:agreement-docs           # writes to ./ (override with DEMO_OUT)
 *
 * ── WHY A SCRIPT AND NOT A SEED ─────────────────────────────────────────────────────────────
 * It deliberately does NOT touch the database. Uploading is the half of this feature most worth
 * seeing work - the parse, the placeholder detection, the field import - so these files are meant
 * to be dragged into the upload box like a founder would, rather than injected behind it.
 *
 * `demo-agreement.docx` carries every placeholder the Word syntax supports, including a guardian
 * and a required consent tick. `demo-agreement-fillable.pdf` carries real AcroForm fields, so the
 * PDF path can demonstrate reading boxes out of a document that already declares them.
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
} from "docx";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const OUT = process.env.DEMO_OUT ?? ".";

async function docx(): Promise<Buffer> {
  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({ text: "Coaching & Consulting Agreement", heading: HeadingLevel.HEADING_1 }),
          new Paragraph({
            children: [
              new TextRun("This agreement is made between "),
              new TextRun({ text: "{{provider.name}}", bold: true }),
              new TextRun(" of {{provider.address}} (“B2 Consultants”) and "),
              new TextRun({ text: "{{student.fullName}}", bold: true }),
              new TextRun(" of {{student.address}} (“the Student”) on {{document.date}}."),
            ],
          }),
          new Paragraph({ text: "1. The programme", heading: HeadingLevel.HEADING_2 }),
          new Paragraph("The Student joins {{batch.number}}, which commences on {{batch.startDate}}."),
          new Paragraph("The programme includes:"),
          // A bulleted list, so the block editor has a list to show - it is one of the block
          // types a founder is most likely to meet and least likely to have in a test file.
          new Paragraph({ text: "Weekly live coaching sessions", bullet: { level: 0 } }),
          new Paragraph({ text: "Two pre-recorded modules, released at the start", bullet: { level: 0 } }),
          new Paragraph({ text: "Sprint-week reviews and written feedback", bullet: { level: 0 } }),
          new Paragraph({ text: "Extended support, subject to section 6", bullet: { level: 0 } }),
          new Paragraph({
            children: [
              new TextRun("Document reference: "),
              new TextRun({ text: "{{document.no}}", bold: true }),
            ],
          }),

          new Paragraph({ text: "2. Fees", heading: HeadingLevel.HEADING_2 }),
          new Paragraph("The programme fee is {{payment.total}}, payable as {{payment.option}}."),
          new Paragraph("Where a plan applies, the plan charge is {{payment.planCharge}} and the total collected is {{payment.collects}}."),
          new Paragraph("Schedule:"),
          new Paragraph("{{payment.schedule}}"),
          new Table({
            rows: [
              new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph("Item")] }),
                  new TableCell({ children: [new Paragraph("Amount")] }),
                ],
              }),
              new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph("Programme fee")] }),
                  new TableCell({ children: [new Paragraph("{{payment.total}}")] }),
                ],
              }),
              new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph("Books and materials")] }),
                  new TableCell({ children: [new Paragraph("{{payment.addOns}}")] }),
                ],
              }),
            ],
          }),

          new Paragraph({ text: "3. Refunds", heading: HeadingLevel.HEADING_2 }),
          new Paragraph(
            "All payments are strictly non-refundable and non-transferable. Withdrawal, discontinuation or early termination does not entitle the Student to a refund.",
          ),
          // A REQUIRED tick box: the student cannot sign without agreeing to this one.
          new Paragraph("[[check:student|I have read and accept the refund policy in section 3]]"),

          new Paragraph({ text: "4. Your details", heading: HeadingLevel.HEADING_2 }),
          new Paragraph("Passport or ID number: [[text:student|Passport or ID number]]"),
          new Paragraph("Please attach a photo of your ID: [[file:student|Photo ID]]"),

          /**
           * A Word page break, which does NOT survive the conversion.
           *
           * mammoth converts a `.docx` to SEMANTIC html - headings, paragraphs, lists - and a page
           * break is presentational, so it emits nothing for one. The document is re-typeset here
           * anyway, where Word's pagination means nothing: page breaks are added in the editor
           * ("Page break" on the insert row) and the renderer honours those. Left in this sample
           * so the behaviour is visible rather than surprising.
           */
          new Paragraph({ text: "5. Signatures", heading: HeadingLevel.HEADING_2, pageBreakBefore: true }),
          new Paragraph("For B2 Consultants: [[sign:creator]]  dated [[date:creator]]"),
          new Paragraph("The Student: [[sign:student|Your signature]]  dated [[date:student]]"),
          new Paragraph("Printed name: [[name:student]]"),
          new Paragraph("Initials: [[initials:student|Initial here]]"),
          new Paragraph(
            "If the Student is under 18, a parent or guardian must co-sign BEFORE the Student signs:",
          ),
          new Paragraph("Parent or guardian: [[sign:guardian]]  dated [[date:guardian]]"),
          new Paragraph("Guardian name: [[text:guardian|Your full name]]"),
        ],
      },
    ],
  });
  return Packer.toBuffer(doc);
}

async function fillablePdf(): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const grey = rgb(0.38, 0.42, 0.47);

  const p1 = pdf.addPage([595.28, 841.89]);
  p1.drawText("Coaching & Consulting Agreement", { x: 56, y: 770, size: 18, font: bold });
  p1.drawText("Exported from Word - this page's layout is preserved exactly.", {
    x: 56,
    y: 745,
    size: 10,
    font,
    color: grey,
  });
  let y = 700;
  for (const line of [
    "1. The Student joins the programme named in the schedule.",
    "2. The fee is as quoted, payable per the agreed plan.",
    "3. All payments are non-refundable and non-transferable.",
    "4. This document is signed electronically.",
  ]) {
    p1.drawText(line, { x: 56, y, size: 11, font });
    y -= 22;
  }

  const p2 = pdf.addPage([595.28, 841.89]);
  p2.drawText("Signatures", { x: 56, y: 770, size: 14, font: bold });
  p2.drawText("For B2 Consultants", { x: 56, y: 300, size: 10, font, color: grey });
  p2.drawText("The Student", { x: 320, y: 300, size: 10, font, color: grey });
  p2.drawText("Date", { x: 56, y: 230, size: 10, font, color: grey });
  p2.drawText("Printed name", { x: 320, y: 230, size: 10, font, color: grey });
  p2.drawText("I accept the refund policy", { x: 80, y: 180, size: 10, font, color: grey });

  /**
   * Real form fields, named the messy way real exports name them - `student.sign_date`,
   * `studentFullName`, `b2_consultants_signature`. The importer guesses the kind and the owner
   * from those names, and the whole value of it is in handling names somebody else chose.
   */
  const form = pdf.getForm();
  form.createTextField("b2_consultants_signature").addToPage(p2, { x: 56, y: 250, width: 200, height: 44 });
  form.createTextField("student_signature").addToPage(p2, { x: 320, y: 250, width: 200, height: 44 });
  form.createTextField("student.sign_date").addToPage(p2, { x: 56, y: 196, width: 130, height: 24 });
  form.createTextField("studentFullName").addToPage(p2, { x: 320, y: 196, width: 200, height: 24 });
  const consent = form.createCheckBox("student_accepts_refund_policy");
  consent.addToPage(p2, { x: 58, y: 176, width: 16, height: 16 });
  consent.enableRequired();

  return Buffer.from(await pdf.save());
}

async function main() {
  const a = join(OUT, "demo-agreement.docx");
  const b = join(OUT, "demo-agreement-fillable.pdf");
  writeFileSync(a, await docx());
  writeFileSync(b, await fillablePdf());
  console.log(`Wrote:\n  ${a}\n  ${b}\n`);
  console.log("Upload either at  /agreements/templates  →  New template.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

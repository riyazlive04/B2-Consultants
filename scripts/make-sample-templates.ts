/**
 * A library of sample agreement documents, for trying the template designer against something
 * that looks like real work.
 *
 *   npm run demo:agreement-templates          # writes to ./ (override with DEMO_OUT)
 *
 * ── WHY SEVERAL, AND WHY THESE ─────────────────────────────────────────────────────────────
 * One sample document only ever exercises one shape. These five are deliberately different from
 * each other, because the things that break in this feature are shape-dependent:
 *
 *   · a LONG contract with tables and lists        - the block editor at realistic length
 *   · a SHORT one-page waiver                      - a document with a single signature
 *   · one needing a GUARDIAN                       - the co-signer ordering rule
 *   · one in EUROS with different terms            - merge fields that are not the B2 defaults
 *   · an addendum with no signature for B2 at all  - the readiness gate REFUSING to send
 *
 * The last one is included on purpose: it should be rejected by `validateDocBody` until a
 * countersignature box is added. A sample set where everything passes teaches nothing about what
 * the gate is for.
 *
 * Nothing here touches the database. Upload them at /agreements/templates → New template.
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  AlignmentType,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";

const OUT = process.env.DEMO_OUT ?? ".";

/** A heading + body helper, so each sample reads as prose rather than as builder calls. */
const h1 = (text: string) => new Paragraph({ text, heading: HeadingLevel.HEADING_1 });
const h2 = (text: string) => new Paragraph({ text, heading: HeadingLevel.HEADING_2 });
const p = (text: string) => new Paragraph(text);
const bullet = (text: string) => new Paragraph({ text, bullet: { level: 0 } });
const centred = (text: string) =>
  new Paragraph({ text, alignment: AlignmentType.CENTER });

function table(rows: string[][], head = true): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: rows.map(
      (cells, i) =>
        new TableRow({
          children: cells.map(
            (c) =>
              new TableCell({
                children: [
                  new Paragraph({
                    children: [new TextRun({ text: c, bold: head && i === 0 })],
                  }),
                ],
              }),
          ),
        }),
    ),
  });
}

async function build(children: (Paragraph | Table)[]): Promise<Buffer> {
  return Packer.toBuffer(new Document({ sections: [{ children }] }));
}

// ───────────────────────────── 1. The long one ─────────────────────────────

const eliteCoaching = () =>
  build([
    h1("Elite Coaching Programme Agreement"),
    p(
      "This agreement is made on {{document.date}} between {{provider.name}} of {{provider.address}} " +
        "(“{{provider.entity}}”) and {{student.fullName}} of {{student.address}} (“the Student”), " +
        "under document reference {{document.no}}.",
    ),

    h2("1. The programme"),
    p("The Student joins {{batch.number}}, commencing {{batch.startDate}}."),
    p("Elite Mode includes everything in Guided Mode, and in addition:"),
    bullet("One-to-one strategy sessions with the lead coach"),
    bullet("Portfolio and application review before each submission"),
    bullet("Interview preparation, including mock interviews with written feedback"),
    bullet("Priority access to employer introductions"),

    h2("2. Fees and payment"),
    p("The programme fee is {{payment.total}}, payable as {{payment.option}}."),
    p("Where an instalment plan applies, the plan charge is {{payment.planCharge}} and the total collected is {{payment.collects}}."),
    table([
      ["Item", "Amount"],
      ["Programme fee", "{{payment.total}}"],
      ["Instalment plan charge", "{{payment.planCharge}}"],
      ["Books and materials", "{{payment.addOns}}"],
      ["Total collected", "{{payment.collects}}"],
    ]),
    p("The agreed schedule is:"),
    p("{{payment.schedule}}"),

    h2("3. Refunds"),
    p(
      "All payments are strictly non-refundable and non-transferable. Withdrawal, discontinuation " +
        "or early termination does not entitle the Student to a refund of fees paid.",
    ),
    p("[[check:student|I have read and accept the refund policy in section 3]]"),

    h2("4. The Student's commitments"),
    bullet("Attend the live sessions, or watch the recording within seven days"),
    bullet("Submit work by the agreed dates"),
    bullet("Keep course material private to the Student"),

    h2("5. Contact details"),
    p("Primary contact number: {{student.phone}}. Email: {{student.email}}."),
    p("Passport or ID number: [[text:student|Passport or ID number]]"),
    p("Please attach a photo of your ID: [[file:student|Photo ID]]"),

    h2("6. Signatures"),
    p("For {{provider.entity}}: [[sign:creator]]  dated [[date:creator]]"),
    p("The Student: [[sign:student|Your signature]]  dated [[date:student]]"),
    p("Printed name: [[name:student]]"),
    p("Initials: [[initials:student|Initial here]]"),
  ]);

// ───────────────────────────── 2. The short one ─────────────────────────────

const workshopWaiver = () =>
  build([
    h1("Workshop Attendance & Consent"),
    p(
      "{{student.fullName}} is registered for the {{batch.number}} workshop on {{batch.startDate}}, " +
        "run by {{provider.entity}}. Reference {{document.no}}.",
    ),
    p(
      "Workshop places are allocated in advance and the fee of {{payment.total}} is non-refundable " +
        "once the place is confirmed.",
    ),
    p("[[check:student|I confirm my attendance and accept that the fee is non-refundable]]"),
    p("[[check:student|I consent to photographs taken during the workshop being used by B2 Consultants]]"),
    h2("Signatures"),
    p("For {{provider.entity}}: [[sign:creator]]"),
    p("Attendee: [[sign:student]]  dated [[date:student]]"),
  ]);

// ───────────────────────────── 3. The one needing a guardian ─────────────────────────────

const minorStudent = () =>
  build([
    h1("Coaching Agreement — Student Under 18"),
    p(
      "This agreement is made between {{provider.name}} (“{{provider.entity}}”) and " +
        "{{student.fullName}} of {{student.address}} (“the Student”), who is under 18 years of age, " +
        "and is countersigned by the Student's parent or guardian.",
    ),

    h2("1. The programme"),
    p("The Student joins {{batch.number}}, commencing {{batch.startDate}}, for a fee of {{payment.total}}."),

    h2("2. Parental consent"),
    p(
      "The parent or guardian confirms that they have read this agreement in full, consent to the " +
        "Student taking part, and accept responsibility for the fees set out above.",
    ),
    p("[[check:guardian|I consent to the Student taking part and accept responsibility for the fees]]"),

    h2("3. Signatures"),
    p(
      "THE PARENT OR GUARDIAN SIGNS FIRST. The Student cannot sign until the guardian's part is " +
        "complete.",
    ),
    p("Parent or guardian: [[sign:guardian]]  dated [[date:guardian]]"),
    p("Guardian's full name: [[text:guardian|Your full name]]"),
    p("The Student: [[sign:student]]  dated [[date:student]]"),
    p("For {{provider.entity}}: [[sign:creator]]  dated [[date:creator]]"),
  ]);

// ───────────────────────────── 4. The euro one ─────────────────────────────

const germanNote = () =>
  build([
    h1("German Note — Tutoring Agreement"),
    centred("Sprachkurs · Vereinbarung"),
    p(
      "Between {{provider.name}}, {{provider.address}}, and {{student.fullName}} of " +
        "{{student.address}}, dated {{document.date}}.",
    ),

    h2("1. Lessons"),
    p("The Student joins {{batch.number}} from {{batch.startDate}}."),
    bullet("Two live lessons each week, ninety minutes each"),
    bullet("Written homework after every lesson, corrected and returned"),
    bullet("One mock examination before the official test date"),

    h2("2. Fees"),
    p("The course fee is {{payment.total}}, payable as {{payment.option}}."),
    p("{{payment.schedule}}"),

    h2("3. Attendance"),
    p(
      "A lesson cancelled with less than 24 hours' notice is treated as delivered. Lessons " +
        "cancelled by the tutor are rescheduled at no cost.",
    ),
    p("[[check:student|I have read and accept the cancellation terms in section 3]]"),

    h2("4. Signatures"),
    p("For {{provider.entity}}: [[sign:creator]]  dated [[date:creator]]"),
    p("The Student: [[sign:student]]  dated [[date:student]]"),
    p("Printed name: [[name:student]]"),
  ]);

// ───────────────────────────── 5. The deliberately incomplete one ─────────────────────────────

const paymentAddendum = () =>
  build([
    h1("Payment Plan Addendum"),
    p(
      "This addendum varies the payment terms of agreement {{document.no}} between " +
        "{{provider.entity}} and {{student.fullName}}. All other terms are unchanged.",
    ),
    h2("1. Revised schedule"),
    p("The fee of {{payment.total}} plus a plan charge of {{payment.planCharge}} is now payable as:"),
    p("{{payment.schedule}}"),
    p("Total collected under this plan: {{payment.collects}}."),
    h2("2. Acceptance"),
    p("[[check:student|I accept the revised payment schedule above]]"),
    p("The Student: [[sign:student]]  dated [[date:student]]"),
    /**
     * NO countersignature box, deliberately.
     *
     * `validateDocBody` refuses to issue this until one is added, and that refusal is the point:
     * it is the quickest way to see the readiness gate do its job on a document that otherwise
     * looks finished.
     */
  ]);

// ───────────────────────────── Write them ─────────────────────────────

/**
 * The set, with the names and blurbs the template library shows.
 *
 * Exported because `seed-sample-templates.ts` loads these same builders and puts them through the
 * real upload parser - so what lands in the database is what an upload of these files would have
 * produced, not a hand-written row that only resembles one.
 */
export const SAMPLES: {
  file: string;
  name: string;
  description: string;
  note: string;
  build: () => Promise<Buffer>;
}[] = [
  {
    file: "elite-coaching-agreement.docx",
    name: "Elite Coaching Programme Agreement",
    description:
      "The full contract: programme, fees, refund policy, ID collection and both signatures. The one to try the editor on.",
    note: "Long contract: tables, lists, every field kind",
    build: eliteCoaching,
  },
  {
    file: "workshop-waiver.docx",
    name: "Workshop Attendance & Consent",
    description: "A single page for a one-day workshop: two consent ticks and one signature each side.",
    note: "One page, two consent ticks",
    build: workshopWaiver,
  },
  {
    file: "minor-student-agreement.docx",
    name: "Coaching Agreement — Student Under 18",
    description:
      "For a student under 18. The parent or guardian signs first; the student's ceremony waits until they have.",
    note: "Needs a parent or guardian to co-sign first",
    build: minorStudent,
  },
  {
    file: "german-note-tutoring.docx",
    name: "German Note — Tutoring Agreement",
    description: "The euro-priced tutoring course, with its own lesson and cancellation terms.",
    note: "Euro programme, different terms",
    build: germanNote,
  },
  {
    file: "payment-plan-addendum.docx",
    name: "Payment Plan Addendum",
    description:
      "Varies the payment terms of an existing agreement. Deliberately missing a box for B2 to sign, so the readiness gate stops it.",
    note: "INCOMPLETE on purpose - no box for B2 to sign",
    build: paymentAddendum,
  },
];

async function main() {
  console.log(`Writing ${SAMPLES.length} sample agreement documents to ${OUT}\n`);
  for (const { file, build: make, note } of SAMPLES) {
    writeFileSync(join(OUT, file), await make());
    console.log(`  ${file.padEnd(32)} ${note}`);
  }
  console.log("\nUpload them at /agreements/templates -> New template.");
  console.log("Or load all five straight into the local database: npm run demo:agreement-templates:seed");
}

// Only when run directly, so importing the builders does not write files.
if (process.argv[1] && process.argv[1].includes("make-sample-templates")) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

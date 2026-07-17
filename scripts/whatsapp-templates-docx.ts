/**
 * Generates `WhatsApp_Templates_for_Approval.docx` — the submission pack B2 hands to whoever
 * approves copy, then pastes into WATI.
 *
 * Content is DERIVED, never retyped: bodies come from the real SOP constants via
 * `submissionBody()`, so this file cannot drift from what the app actually sends. Re-run it after
 * any template change.
 *
 * Run: npm run docs:whatsapp
 */

import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import { writeFileSync } from "node:fs";
import path from "node:path";
import {
  SUBMISSION_TEMPLATES,
  submissionBody,
  lintTemplate,
  BODY_CHAR_LIMIT,
  type SubmissionTemplate,
} from "../src/lib/whatsapp-submission";

const INK = "1A1A1A";
const MUTED = "666666";
const ACCENT = "1F5C4A";
const RISK = "B3261E";
const RULE = "DDDDDD";
const SHADE = "F4F6F5";

const FONT = "Calibri";
const MONO = "Consolas";

// ── small builders ────────────────────────────────────────────────────────────

const p = (text: string, opts: { size?: number; bold?: boolean; color?: string; italics?: boolean; spacing?: number; font?: string } = {}) =>
  new Paragraph({
    spacing: { after: opts.spacing ?? 80 },
    children: [
      new TextRun({
        text,
        size: opts.size ?? 20,
        bold: opts.bold,
        italics: opts.italics,
        color: opts.color ?? INK,
        font: opts.font ?? FONT,
      }),
    ],
  });

const h1 = (text: string) =>
  new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 240, after: 120 },
    children: [new TextRun({ text, size: 32, bold: true, color: INK, font: FONT })],
  });

const h2 = (text: string) =>
  new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 200, after: 100 },
    children: [new TextRun({ text, size: 26, bold: true, color: ACCENT, font: FONT })],
  });

const bullet = (text: string, color = INK) =>
  new Paragraph({
    bullet: { level: 0 },
    spacing: { after: 60 },
    children: [new TextRun({ text, size: 20, color, font: FONT })],
  });

/** A ☐ line the approver physically ticks. */
const checkbox = (text: string, bold = false) =>
  new Paragraph({
    spacing: { after: 70 },
    children: [
      new TextRun({ text: "☐   ", size: 22, color: INK, font: FONT }),
      new TextRun({ text, size: 20, bold, color: INK, font: FONT }),
    ],
  });

const spacer = (h = 120) => new Paragraph({ spacing: { after: h }, children: [] });

const rule = () =>
  new Paragraph({
    spacing: { before: 120, after: 120 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: RULE } },
    children: [],
  });

function cell(text: string, opts: { bold?: boolean; mono?: boolean; shade?: boolean; width?: number; color?: string } = {}) {
  return new TableCell({
    width: opts.width ? { size: opts.width, type: WidthType.PERCENTAGE } : undefined,
    shading: opts.shade ? { type: ShadingType.CLEAR, fill: SHADE } : undefined,
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
    children: [
      new Paragraph({
        children: [
          new TextRun({
            text,
            size: 18,
            bold: opts.bold,
            color: opts.color ?? INK,
            font: opts.mono ? MONO : FONT,
          }),
        ],
      }),
    ],
  });
}

function table(headers: string[], rows: string[][], widths: number[], monoCols: number[] = []) {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 2, color: RULE },
      bottom: { style: BorderStyle.SINGLE, size: 2, color: RULE },
      left: { style: BorderStyle.SINGLE, size: 2, color: RULE },
      right: { style: BorderStyle.SINGLE, size: 2, color: RULE },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: RULE },
      insideVertical: { style: BorderStyle.SINGLE, size: 2, color: RULE },
    },
    rows: [
      new TableRow({
        tableHeader: true,
        children: headers.map((h, i) => cell(h, { bold: true, shade: true, width: widths[i] })),
      }),
      ...rows.map(
        (r) =>
          new TableRow({
            children: r.map((c, i) => cell(c, { width: widths[i], mono: monoCols.includes(i) })),
          }),
      ),
    ],
  });
}

/**
 * The message body, rendered as it will appear — monospaced, boxed, one paragraph per line so
 * Word preserves the SOP's blank lines exactly. Whoever approves this must see the real thing.
 */
function bodyBox(text: string): Paragraph[] {
  const lines = text.split("\n");
  return lines.map(
    (line, i) =>
      new Paragraph({
        spacing: { after: i === lines.length - 1 ? 0 : 40, before: i === 0 ? 40 : 0 },
        shading: { type: ShadingType.CLEAR, fill: SHADE },
        border: {
          left: { style: BorderStyle.SINGLE, size: 12, color: ACCENT },
          ...(i === 0 ? { top: { style: BorderStyle.SINGLE, size: 2, color: RULE } } : {}),
          ...(i === lines.length - 1 ? { bottom: { style: BorderStyle.SINGLE, size: 2, color: RULE } } : {}),
        },
        indent: { left: 160, right: 160 },
        children: [new TextRun({ text: line || " ", size: 19, font: MONO, color: INK })],
      }),
  );
}

// ── document sections ─────────────────────────────────────────────────────────

function cover(): Paragraph[] {
  return [
    new Paragraph({
      spacing: { after: 60 },
      children: [new TextRun({ text: "B2 Consultants", size: 22, bold: true, color: ACCENT, font: FONT })],
    }),
    new Paragraph({
      spacing: { after: 100 },
      children: [new TextRun({ text: "WhatsApp Templates for Approval", size: 44, bold: true, color: INK, font: FONT })],
    }),
    p("The nine outbound messages of the Outreach Specialist SOP (Steps 3–21), in the form WATI and Meta require.", {
      size: 22,
      color: MUTED,
    }),
    spacer(160),
    p(
      "Source of truth: Script for Outreach Specialist.docx, Steps 1–23. Every message body in this pack is generated directly from the text the application ships — it is not retyped, so this document and the app cannot disagree.",
      { size: 19, color: MUTED, italics: true },
    ),
    spacer(80),
    p("Read this first", { bold: true, size: 22 }),
    bullet("Business-initiated WhatsApp messages must be pre-approved templates. Until each one below is APPROVED in WATI and mapped in the app, the app will not send it — it queues the message for the specialist to send by hand instead. Nothing breaks; it just stays manual."),
    bullet("B2’s WATI account currently has no approved discovery or booking templates. All nine of these are new submissions."),
    bullet("Variables are written {{like_this}} — that is WATI’s named-parameter syntax. The SOP writes the same variables as [Prospect’s First Name]; the mapping is given per template."),
    bullet("*Asterisks* render as bold in WhatsApp. They are intentional and must be kept."),
    bullet("Links are literal text, not variables, so Meta reviews them once at approval rather than on every send."),
    rule(),
  ];
}

function summaryTable(): (Paragraph | Table)[] {
  return [
    h2("The nine templates at a glance"),
    table(
      ["SOP", "Template name", "Category", "Variables", "App touchpoint"],
      SUBMISSION_TEMPLATES.map((t) => [
        t.sopStep,
        t.name,
        t.category,
        t.vars.map((v) => v.name).join(", ") || "—",
        t.kind,
      ]),
      [8, 30, 14, 26, 22],
      [1, 4],
    ),
    spacer(100),
    p("All nine are MARKETING. Meta only allows UTILITY for a template that is non-promotional and carries no persuasive intent — anything with mixed content defaults to MARKETING. Every message in this pack sells something while it informs: the case studies link, the “*FREE*” framing, the “personalized game plan”, the re-booking CTAs on the two cancellations. That the prospect booked the appointment themselves is not enough on its own, and the call being a free sales call rather than a paid booking weakens the claim further.", {
      size: 19,
      color: MUTED,
    }),
    spacer(60),
    p("Note that a “reply YES to confirm” is NOT what makes these MARKETING — a confirmation request for a booked appointment is the textbook UTILITY case. It is the promotional copy around it that decides. The clearest proof is Steps 16 and 21: they ask for nothing at all, and they are still MARKETING, because they carry a re-booking link.", {
      size: 19,
      color: MUTED,
    }),
    spacer(60),
    p("Two consequences. Since April 2025 Meta approves a template as MARKETING whenever it judges it to be MARKETING, whatever you declared — and flags accounts that game the category, so declaring UTILITY here would buy a flag, not a cheaper message. And MARKETING templates are subject to Meta’s per-user marketing limits and require opt-in: B2 has that opt-in via the website form, so keep the form’s consent wording, it is the evidence. The cost B2 is accepting is that a time-critical confirmation reminder can be throttled for a prospect near their marketing cap — worth rechecking against real delivery rates once these are live.", {
      size: 19,
      color: MUTED,
    }),
    rule(),
  ];
}

function templateSection(t: SubmissionTemplate, index: number): (Paragraph | Table)[] {
  const body = submissionBody(t);
  const lint = lintTemplate(t);

  const out: (Paragraph | Table)[] = [
    new Paragraph({
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 280, after: 60 },
      pageBreakBefore: index > 0,
      children: [
        new TextRun({ text: `${index + 1}. ${t.sopStep} — `, size: 26, bold: true, color: INK, font: FONT }),
        new TextRun({ text: t.name, size: 26, bold: true, color: ACCENT, font: MONO }),
      ],
    }),

    table(
      ["Field", "Value"],
      [
        ["Template name", t.name],
        ["Category", t.category],
        ["Language", t.language],
        ["Header", t.header ?? "None"],
        ["Body length", `${body.length} / ${BODY_CHAR_LIMIT} characters`],
        ["App touchpoint (bind to this)", t.kind],
      ],
      [32, 68],
      [],
    ),
    spacer(100),

    p("Why this category", { bold: true, size: 20 }),
    p(t.categoryNote, { size: 19, color: MUTED, spacing: 120 }),

    p(t.proposedFix ? "Body — as the SOP writes it today" : "Body — paste exactly as shown", {
      bold: true,
      size: 20,
    }),
    ...bodyBox(body),
    spacer(140),
  ];

  // A wording change that needs a human's sign-off before submission. Shown as a diff-in-words:
  // what's wrong, what to change it to, and why — never applied silently.
  if (t.proposedFix) {
    out.push(
      new Paragraph({
        spacing: { before: 60, after: 80 },
        children: [
          new TextRun({ text: "⚠  Proposed change — needs B2 approval before submitting", size: 21, bold: true, color: RISK, font: FONT }),
        ],
      }),
    );
    out.push(p(t.proposedFix.reason, { size: 19, color: MUTED, spacing: 100 }));
    out.push(p("Replace the opening lines with:", { size: 19, bold: true }));
    out.push(...bodyBox(t.proposedFix.body));
    out.push(spacer(140));
  }

  if (t.vars.length) {
    out.push(p("Variables", { bold: true, size: 20 }));
    out.push(
      table(
        ["WATI variable", "SOP wording", "Sample value (submit this)", "Where the app gets it"],
        t.vars.map((v) => [`{{${v.name}}}`, v.sopName, v.sample, v.source]),
        [16, 24, 22, 38],
        [0],
      ),
    );
    out.push(spacer(120));
  }

  if (t.notes?.length) {
    out.push(p("Notes", { bold: true, size: 20 }));
    for (const n of t.notes) {
      const isDecision = n.startsWith("DECISION NEEDED") || n.startsWith("REJECTION RISK");
      out.push(bullet(n, isDecision ? RISK : INK));
    }
    out.push(spacer(80));
  }

  if (lint.issues.length) {
    out.push(p("⚠ Automated checks flagged this template", { bold: true, size: 20, color: RISK }));
    for (const i of lint.issues) out.push(bullet(i, RISK));
  }

  return out;
}

function checklist(): (Paragraph | Table)[] {
  return [
    new Paragraph({ pageBreakBefore: true, children: [] }),
    h1("Approval & go-live checklist"),
    p("Work top to bottom. Nothing in Part C can be done before Part B, and nothing in Part B before Part A.", {
      size: 19,
      color: MUTED,
      spacing: 160,
    }),

    h2("Part A — Approve the copy (B2, internal)"),
    checkbox("Every body below reads correctly to B2, including the *bold* markers and the 🇩🇪 emoji."),
    checkbox("The four links are current and live: optin.b2consultants.de/apply · optin.b2consultants.de/lang · casestudies.b2consultants.de/casestudies · optin.b2consultants.de/sss"),
    checkbox("Step 20’s added closing line is acceptable (the SOP’s wording ends on the Zoom link, which Meta commonly rejects — see that template’s note)."),
    checkbox("Decide how Step 19’s personalized video is delivered — see “Open decisions” below."),
    checkbox("Sender name confirmed: the {{sender}} value the prospect sees."),

    h2("Part B — Submit in WATI (per template)"),
    checkbox("Create the template with the EXACT name given — the app is mapped to these names."),
    checkbox("Set the category to MARKETING on all nine. This is deliberate — see “The nine templates at a glance”. Do not re-declare any of them UTILITY to save on send cost: Meta re-categorises them anyway and flags the account for it."),
    checkbox("Paste the body exactly. No trimming of blank lines — the spacing is part of the message."),
    checkbox("Declare the variables in the order shown and give each the sample value listed. Meta rejects submissions with missing or unrealistic samples."),
    checkbox("Language: en. If WATI insists on a locale, use en_GB and record which you chose."),
    checkbox("Submit and record the date. Review is usually minutes, but can take up to 24–48 hours."),
    checkbox("All nine show APPROVED in WATI. Note that a template can be approved and later re-categorised by Meta — recheck before go-live."),

    h2("Part C — Wire it into the app (Admin)"),
    checkbox("Set WATI_ENABLED=true, WATI_API_ENDPOINT and WATI_ACCESS_TOKEN in the environment.", true),
    checkbox("WhatsApp → Settings → Refresh templates. The nine names should appear in the catalogue."),
    checkbox("Bind each touchpoint to its template using the “App touchpoint” column in the table above. One template per touchpoint — never share one across two."),
    checkbox("For each template, enter its variable list in Settings exactly as declared in WATI. A mismatch does not send a broken message — the app blocks the send and tells you which variable is missing."),
    checkbox("Send a test message to your own number from WhatsApp → Settings. Confirm the variables resolve and the bold renders."),
    checkbox("Outreach → Settings → turn the engine ON.", true),
    checkbox("Backfill journeys for existing leads."),
    checkbox("Point a cron at /api/cron/outreach EVERY MINUTE with the CRON_SECRET header. Cron cadence is the engine’s timing resolution — a 15-minute cron cannot police the 5-minute reaction SLA.", true),
    checkbox("Leave every step on MANUAL for the first week. Watch the queue, confirm the right message is proposed at the right time for real prospects."),
    checkbox("Only then turn on auto-send, one step at a time, starting with the lowest-risk (Step 13 Disco welcome).", true),

    h2("Part D — Confirm it works end to end"),
    checkbox("A real opt-in appears in Outreach → Due now within one cron tick, with the SLA clock running."),
    checkbox("The specialist gets the opt-in email (needs EMAIL_ENABLED + RESEND_API_KEY + a from address)."),
    checkbox("A booking made with a different email/phone format than the opt-in still links to the same prospect."),
    checkbox("Replying YES to a confirmation message flips “WhatsApp Confirmed” — and replying “not interested” does NOT."),
    checkbox("Key Metrics exports with every column, including the CET appointment time."),
    rule(),
  ];
}

function wiring(): (Paragraph | Table)[] {
  return [
    new Paragraph({ pageBreakBefore: true, children: [] }),
    h1("How the app uses these templates"),
    p("What to do, and how it hangs together.", { size: 19, color: MUTED, spacing: 160 }),

    h2("The chain"),
    p("A message reaches a prospect only if every link holds. Each link fails closed — it stops and explains, rather than sending something wrong.", {
      size: 19,
      color: MUTED,
      spacing: 120,
    }),
    table(
      ["#", "Link", "Where it lives", "If it’s missing"],
      [
        ["1", "The SOP step becomes due", "Outreach engine (cron)", "Nothing appears in the queue."],
        ["2", "Variables resolve (name, date, time, zoom_link)", "The prospect’s Outreach card", "Send is blocked; the card says which variable is missing."],
        ["3", "The step is set to auto-send", "Outreach → Settings", "Stays in the queue for manual sending. This is the default."],
        ["4", "WATI is armed", "WATI_ENABLED + credentials", "Step stays DUE; the run notes say why."],
        ["5", "A template is bound to the touchpoint", "WhatsApp → Settings", "Step stays DUE — “No WATI template configured”."],
        ["6", "The template is APPROVED", "Meta, via WATI", "Send is skipped with the template’s real status."],
        ["7", "The prospect hasn’t opted out", "STOP replies", "Send is skipped and logged."],
      ],
      [5, 34, 27, 34],
      [],
    ),
    spacer(140),
    p("The practical consequence: you can turn the engine on today, before a single template is approved. The specialist gets a queue that tells them exactly what to send and when, with the message written and the variables filled. Approval upgrades that from copy-paste to automatic — it is not a prerequisite for using the system.", {
      size: 19,
      spacing: 140,
    }),

    h2("Manual vs auto-send"),
    p("Two independent switches, deliberately:", { size: 19, spacing: 80 }),
    bullet("Engine ON/OFF — does the SOP run at all? Schedules steps, runs booking checks, advances prospects."),
    bullet("Auto-send, per step — may THIS step send without a human? Every step is manual by default."),
    p("The engine can run with all nine steps manual. That is the default, and it is the shape the SOP already has — a person sends these messages today.", {
      size: 19,
      color: MUTED,
      spacing: 140,
    }),

    h2("Where each variable comes from"),
    table(
      ["Variable", "Filled from", "What to do if it’s blank"],
      [
        ["{{name}}", "The lead’s first name, captured at opt-in", "Fix the name on the contact record."],
        ["{{sender}}", "Key Metrics → “Resp. for TOUCHPOINT”; falls back to the default sender in Outreach → Settings", "Assign a touchpoint owner, or set the default name."],
        ["{{date}} / {{time}}", "The booked appointment (disco), or the SSS date/time — rendered in the prospect’s IST", "Confirm the booking is linked to the prospect."],
        ["{{zoom_link}}", "The Zoom link on the prospect’s Outreach card", "Copy it from the Discovery Specialist’s Google Calendar and paste it into the card. The app cannot fetch this yet."],
      ],
      [18, 46, 36],
      [0],
    ),
    spacer(140),

    h2("Open decisions"),
    p("Step 19’s personalized video", { bold: true, size: 20 }),
    bullet("The SOP attaches a video Ameen records for each prospect. That has to be a VIDEO HEADER on the template, not body text."),
    bullet("A per-send video means uploading each prospect’s file to WATI and passing its media id. The app does not do that today, and there is no field to hold the video.", RISK),
    bullet("Recommendation: submit the template with a video header, but keep Step 19 MANUAL. The specialist attaches the video in WhatsApp themselves, exactly as they do now. Automate it later if the volume justifies the build."),
    spacer(80),
    p("Zoom links", { bold: true, size: 20 }),
    bullet("Entered by hand per prospect today. Google Calendar integration — matching the meeting by date/time/prospect and alerting when calendar access is missing — is not built."),
    bullet("The templates fail closed without a link, so the worst case is a blocked send, never a message reading “<<INSERT ZOOM LINK HERE>>”."),
    spacer(80),
    p("Synamate", { bold: true, size: 20 }),
    bullet("Steps 17 and 22 cancel the appointment in this app. There is no Synamate API integration, so the SOP’s manual calendar step still applies."),
    rule(),
    p("Full technical detail: docs/OUTREACH_SOP.md · The audit behind it: docs/OUTREACH_SOP_GAP_REPORT.md", {
      size: 18,
      color: MUTED,
      italics: true,
    }),
  ];
}

// ── assemble ──────────────────────────────────────────────────────────────────

async function main() {
  const doc = new Document({
    creator: "B2 Consultants",
    title: "WhatsApp Templates for Approval",
    description: "The nine Outreach Specialist SOP messages, formatted for WATI/Meta submission.",
    styles: { default: { document: { run: { font: FONT, size: 20, color: INK } } } },
    sections: [
      {
        properties: { page: { margin: { top: 1000, right: 1000, bottom: 1000, left: 1000 } } },
        children: [
          ...cover(),
          ...summaryTable(),
          new Paragraph({ pageBreakBefore: true, children: [] }),
          h1("The templates"),
          p("One page each. Paste the body exactly as shown.", { size: 19, color: MUTED, spacing: 160 }),
          ...SUBMISSION_TEMPLATES.flatMap((t, i) => templateSection(t, i)),
          ...checklist(),
          ...wiring(),
          spacer(200),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({
                text: "Generated from the application source — re-run `npm run docs:whatsapp` after any template change.",
                size: 16,
                color: MUTED,
                italics: true,
                font: FONT,
              }),
            ],
          }),
        ],
      },
    ],
  });

  const out = path.resolve(process.cwd(), "..", "WhatsApp_Templates_for_Approval.docx");
  writeFileSync(out, await Packer.toBuffer(doc));

  console.log(`Wrote ${out}`);
  console.log(`${SUBMISSION_TEMPLATES.length} templates.`);
  for (const t of SUBMISSION_TEMPLATES) {
    const l = lintTemplate(t);
    const body = submissionBody(t);
    console.log(
      `  ${l.issues.length ? "!" : "✓"} ${t.name.padEnd(26)} ${t.category.padEnd(9)} ${String(body.length).padStart(4)} chars  ${t.vars.map((v) => `{{${v.name}}}`).join(" ")}`,
    );
    for (const i of l.issues) console.log(`      ⚠ ${i}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

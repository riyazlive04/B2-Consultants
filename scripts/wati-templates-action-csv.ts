/**
 * Generates `WhatsApp_Templates_Action_Required.csv` - the same work list as
 * `WhatsApp_Templates_Action_Required.docx`, shaped as one tab for B2's review spreadsheet.
 *
 * WHY A SECOND FORMAT AND NOT A SECOND LIST. The reviewer works in a Google Sheet, one row per
 * template, and the sheet they have holds the 26-template snapshot from October with the bodies in
 * a column. The templates that need approval now are not in it - which is the gap this closes.
 * The rows here come from `actionTemplates()` in the docx generator, IMPORTED, not rebuilt: two
 * readers of one list is fine, two derivations of it is how a Word document and a spreadsheet end
 * up disagreeing about what still needs submitting.
 *
 * Import, do not paste. Every body is multi-line, and a multi-line cell pasted into Sheets becomes
 * one row per line. File → Import → Insert new sheet(s) reads the quoting correctly.
 *
 * Run:  npm run docs:whatsapp:action:csv
 */

import { writeFileSync } from "node:fs";
import path from "node:path";
import { ACTION_GROUP, ACTION_ORDER, actionTemplates, type Tpl } from "./wati-templates-utility-docx";

/**
 * RFC 4180. Quoted unconditionally rather than only when a field contains a comma, a quote or a
 * newline: every body in this file contains newlines, every note contains commas, and a rule with
 * exceptions is a rule somebody will apply to the wrong field. A doubled `""` is the escape.
 */
const cell = (v: string) => `"${v.replace(/"/g, '""')}"`;
const row = (cells: string[]) => cells.map(cell).join(",");

const COLUMNS = [
  "#",
  "Do this",
  "Template name",
  "Category",
  "Language",
  "App touchpoint (bind to this)",
  "Group",
  "Purpose",
  "When it fires",
  "Body text (submit exactly this)",
  "Variables & sample values",
  "Body currently approved (what an edit would replace)",
  "Why it needs action",
  "Notes & open questions",
  "WATI status (fill in)",
  "Date submitted (fill in)",
];

/**
 * The same `name = sample` block the existing sheet uses in its "Sample values" column, so a
 * reviewer comparing the two tabs is reading one format rather than two.
 */
const vars = (t: Tpl) => t.vars.map((v) => `${v.name} = ${v.sample}`).join("\n");

function main() {
  const list = actionTemplates();

  const lines = [row(COLUMNS)];
  list.forEach((t, i) => {
    lines.push(
      row([
        String(i + 1),
        t.action?.label ?? "",
        t.name,
        t.category,
        "en",
        t.kind,
        // The action group, not the part of the app: this tab is a work list, and "do I create
        // this or edit it" is the question every row has to answer first.
        t.action ? ACTION_GROUP[t.action.group] : "",
        t.sub,
        t.fires,
        t.body,
        vars(t),
        t.action?.previousBody ?? "",
        t.action?.why ?? "",
        // The note carries the category rationale, the binding warnings and any open question.
        // It is long, and it is the column a reviewer asks for the moment they query a row.
        t.note ? `${t.note.tag}: ${t.note.text}` : "",
        "",
        "",
      ]),
    );
  });

  // CRLF and a BOM. Sheets is happy either way; Excel is not, and somebody always opens it in
  // Excel first - without the BOM the rupee signs and the middle dots arrive as mojibake, and
  // whoever sees that assumes the file is broken rather than the default encoding.
  const csv = "\ufeff" + lines.join("\r\n") + "\r\n";
  const out = path.resolve(process.cwd(), "..", "WhatsApp_Templates_Action_Required.csv");
  writeFileSync(out, csv, "utf8");

  console.log(`Wrote ${out}`);
  console.log(`${list.length} rows x ${COLUMNS.length} columns.`);
  for (const group of ACTION_ORDER) {
    const n = list.filter((t) => t.action?.group === group).length;
    if (n) console.log(`  ${n} - ${ACTION_GROUP[group]}`);
  }
  const withPrev = list.filter((t) => t.action?.previousBody).length;
  console.log(`${withPrev} rows carry the body they replace.`);
  console.log("Import into the sheet with File -> Import -> Insert new sheet(s). Do NOT paste: the bodies are multi-line.");
}

main();

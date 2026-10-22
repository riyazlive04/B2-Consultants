import { test } from "node:test";
import assert from "node:assert/strict";
import { blocksToHtml, zoneHtml } from "../blocks-html";
import { htmlToBlocks } from "../docx-blocks";
import type { DocBlock, DocField } from "../agreement-doc";

/**
 * THE ROUND TRIP IS THE WHOLE SAFETY STORY OF THE EDITOR.
 *
 * The document is edited in a `contenteditable` page, which means the browser owns the markup
 * while somebody types. The block model is the only thing ever saved, so every edit goes:
 *
 *     blocks → blocksToHtml → the page → htmlToBlocks → blocks
 *
 * If that is not the identity, a contract loses a heading level or a bold run every time it is
 * opened and saved - silently, and cumulatively. These tests are the thing standing in front of
 * that.
 */

const FIELDS: DocField[] = [
  { id: "f1", kind: "SIGNATURE", signer: "CREATOR" },
  { id: "f2", kind: "CHECKBOX", signer: "STUDENT", required: true, label: "I accept section 8" },
];

/** blocks → html → blocks, which must give back exactly what went in. */
function roundTrip(blocks: DocBlock[], fields: DocField[] = FIELDS): DocBlock[] {
  return htmlToBlocks(blocksToHtml(blocks, fields)).blocks;
}

test("headings, paragraphs and inline marks survive a round trip", () => {
  const blocks: DocBlock[] = [
    { type: "heading", level: 1, runs: [{ text: "Coaching Agreement" }] },
    { type: "heading", level: 3, runs: [{ text: "Annexure" }] },
    {
      type: "p",
      runs: [
        { text: "The " },
        { text: "Student", b: true },
        { text: " agrees to " },
        { text: "everything", i: true },
        { text: " herein", u: true },
        { text: "." },
      ],
    },
  ];
  assert.deepEqual(roundTrip(blocks), blocks);
});

test("bold+italic together, and a link, survive", () => {
  const blocks: DocBlock[] = [
    {
      type: "p",
      runs: [
        { text: "strongly italic", b: true, i: true },
        { text: " and " },
        { text: "a link", href: "https://b2consultants.de" },
      ],
    },
  ];
  assert.deepEqual(roundTrip(blocks), blocks);
});

test("lists survive, ordered and unordered", () => {
  const blocks: DocBlock[] = [
    { type: "list", ordered: false, items: [[{ text: "Weekly sessions" }], [{ text: "Reviews" }]] },
    { type: "list", ordered: true, items: [[{ text: "First" }], [{ text: "Second" }]] },
  ];
  assert.deepEqual(roundTrip(blocks), blocks);
});

test("tables survive, including the header row", () => {
  const blocks: DocBlock[] = [
    {
      type: "table",
      rows: [
        { head: true, cells: [[{ text: "Instalment" }], [{ text: "Due" }]] },
        { cells: [[{ text: "43,999 INR" }], [{ text: "Week 1" }]] },
      ],
    },
  ];
  assert.deepEqual(roundTrip(blocks), blocks);
});

/**
 * WHAT THE TOOLBAR'S TABLE BUTTONS BUILD, parsed.
 *
 * `DocumentCanvas` creates cells as `<td><br></td>` because that is what `blocksToHtml` writes
 * and what the parser reads back as an empty cell. Written as literal HTML rather than as blocks
 * so it fails if either half of the contract moves: build cells any other way - a `<p>` inside
 * the cell, say - and the row comes back empty with the text escaped into the document above it.
 */
test("an empty table built by the toolbar parses to empty cells, header row intact", () => {
  const inserted =
    "<table><tbody>" +
    "<tr><th><br></th><th><br></th></tr>" +
    "<tr><td><br></td><td><br></td></tr>" +
    "</tbody></table>";
  const blocks = htmlToBlocks(inserted).blocks;
  assert.deepEqual(blocks, [
    {
      type: "table",
      rows: [
        { head: true, cells: [[], []] },
        { cells: [[], []] },
      ],
    },
  ]);
  // And it survives the trip back out, so the first save after inserting one changes nothing.
  assert.deepEqual(roundTrip(blocks), blocks);
});

test("a ragged table - one row short of a cell - keeps every row it had", () => {
  // `addColumn` appends to a short row rather than skipping it, but a table imported from Word
  // can still arrive ragged, and the renderer pads with the widest row's column count.
  const blocks = htmlToBlocks(
    "<table><tbody><tr><th>A</th><th>B</th></tr><tr><td>only</td></tr></tbody></table>",
  ).blocks;
  assert.deepEqual(blocks, [
    {
      type: "table",
      rows: [
        { head: true, cells: [[{ text: "A" }], [{ text: "B" }]] },
        { cells: [[{ text: "only" }]] },
      ],
    },
  ]);
  assert.deepEqual(roundTrip(blocks), blocks);
});

test("alignment survives - the centre button must not undo itself on save", () => {
  const blocks: DocBlock[] = [
    { type: "p", align: "center", runs: [{ text: "Centred" }] },
    { type: "p", align: "justify", runs: [{ text: "Justified" }] },
    // `left` is the default and is deliberately NOT stored: a document that never used alignment
    // has to hash exactly as it did before alignment existed.
    { type: "p", runs: [{ text: "Default" }] },
  ];
  assert.deepEqual(roundTrip(blocks), blocks);
});

test("a signature zone survives as an ANCHOR, never as its caption text", () => {
  const blocks: DocBlock[] = [
    { type: "p", runs: [{ text: "Signed:" }] },
    { type: "field", fieldId: "f1" },
    { type: "p", runs: [{ text: "Agreed:" }] },
    { type: "field", fieldId: "f2" },
  ];
  const out = roundTrip(blocks);
  assert.deepEqual(out, blocks);

  // The caption the editor draws for the human must not end up in the contract as prose.
  const html = blocksToHtml(blocks, FIELDS);
  assert.ok(html.includes("I accept section 8"), "the caption is drawn for the editor");
  const text = out
    .flatMap((b) => (b.type === "p" ? b.runs.map((r) => r.text) : []))
    .join(" ");
  assert.ok(!text.includes("I accept section 8"), "...and must not survive as a paragraph");
});

test("rules and page breaks survive", () => {
  const blocks: DocBlock[] = [
    { type: "p", runs: [{ text: "Before" }] },
    { type: "rule" },
    { type: "pageBreak" },
    { type: "p", runs: [{ text: "After" }] },
  ];
  assert.deepEqual(roundTrip(blocks), blocks);
});

test("a whole document round-trips unchanged, twice", () => {
  const blocks: DocBlock[] = [
    { type: "heading", level: 1, runs: [{ text: "Coaching & Consulting Agreement" }] },
    { type: "p", runs: [{ text: "Between " }, { text: "{{provider.name}}", b: true }, { text: " and {{student.fullName}}." }] },
    { type: "heading", level: 2, runs: [{ text: "1. Fees" }] },
    { type: "p", align: "justify", runs: [{ text: "The fee is {{payment.total}}." }] },
    { type: "list", ordered: false, items: [[{ text: "Weekly sessions" }], [{ text: "Reviews" }]] },
    { type: "table", rows: [{ head: true, cells: [[{ text: "Item" }], [{ text: "Amount" }]] }] },
    { type: "rule" },
    { type: "field", fieldId: "f1" },
    { type: "pageBreak" },
    { type: "field", fieldId: "f2" },
  ];

  const once = roundTrip(blocks);
  assert.deepEqual(once, blocks);
  // Twice, because an edit-save-edit-save cycle is the realistic case and a lossy step would
  // only show up on the second pass.
  assert.deepEqual(roundTrip(once), blocks);
});

// ───────────────────────── What the browser does to our markup ─────────────────────────

test("contenteditable's own output is understood", () => {
  /**
   * This is roughly what a browser hands back after somebody types: `<div>` instead of `<p>`,
   * `<b>`/`<i>` instead of `<strong>`/`<em>`, a `<font>` tag, a stray `<span>`, and an inline
   * style for alignment. None of it is our markup; all of it has to parse.
   */
  const browserish =
    '<div style="text-align: center;">A <b>bold</b> and <i>italic</i> line</div>' +
    '<font face="Arial"><div>Plain after a font tag</div></font>' +
    '<div><span style="color: red">Coloured span</span></div>';

  const { blocks } = htmlToBlocks(browserish);
  assert.deepEqual(blocks, [
    {
      type: "p",
      align: "center",
      runs: [{ text: "A " }, { text: "bold", b: true }, { text: " and " }, { text: "italic", i: true }, { text: " line" }],
    },
    { type: "p", runs: [{ text: "Plain after a font tag" }] },
    { type: "p", runs: [{ text: "Coloured span" }] },
  ]);
});

test("a zone the browser moved or re-tagged is still a zone", () => {
  // contenteditable may rewrite the element or drop the class; the data attribute is what the
  // parser matches on, so the anchor survives either.
  const { blocks } = htmlToBlocks(
    '<p>Before</p><section data-field-id="f1"><span>anything at all</span></section><p>After</p>',
  );
  assert.deepEqual(blocks, [
    { type: "p", runs: [{ text: "Before" }] },
    { type: "field", fieldId: "f1" },
    { type: "p", runs: [{ text: "After" }] },
  ]);
});

test("the zone widget is atomic and carries what the editor needs to draw it", () => {
  const html = zoneHtml(FIELDS[1]!);
  assert.match(html, /contenteditable="false"/);
  assert.match(html, /data-field-id="f2"/);
  assert.match(html, /data-kind="CHECKBOX"/);
  assert.match(html, /data-signer="STUDENT"/);
});

test("text is escaped, so a contract may contain < & and quotes", () => {
  const blocks: DocBlock[] = [
    { type: "p", runs: [{ text: 'Fees < 70,000 & "terms" apply' }] },
  ];
  assert.deepEqual(roundTrip(blocks), blocks);
});

test("an empty paragraph keeps a line box, so the cursor can be put in it", () => {
  assert.match(blocksToHtml([{ type: "p", runs: [] }], []), /<p><br><\/p>/);
});

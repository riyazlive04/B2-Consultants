import { test } from "node:test";
import assert from "node:assert/strict";
import { htmlToBlocks } from "../docx-blocks";
import { MAX_FIELD_LABEL, type DocBlock } from "../agreement-doc";

/**
 * The parser is the only thing standing between a Word file and a contract, so these tests are
 * written against what MAMMOTH actually emits rather than against ideal HTML - in particular
 * `<td><p>…</p></td>`, which is the shape that breaks a naive "the last block tag wins" parser.
 */

const text = (b: DocBlock) =>
  b.type === "heading" || b.type === "p" ? b.runs.map((r) => r.text).join("") : "";

test("paragraphs, headings and inline marks", () => {
  const { blocks } = htmlToBlocks(
    "<h1>Coaching Agreement</h1><h4>Annexure</h4><p>The <strong>Student</strong> agrees to <em>everything</em>.</p>",
  );

  assert.equal(blocks.length, 3);
  assert.deepEqual(blocks[0], { type: "heading", level: 1, runs: [{ text: "Coaching Agreement" }] });
  // h4-h6 collapse onto level 3 - the renderer has three heading sizes.
  assert.equal(blocks[1]!.type === "heading" && blocks[1]!.level, 3);

  const p = blocks[2]!;
  assert.equal(p.type, "p");
  assert.deepEqual(p.type === "p" ? p.runs : null, [
    { text: "The " },
    { text: "Student", b: true },
    { text: " agrees to " },
    { text: "everything", i: true },
    { text: "." },
  ]);
});

test("adjacent runs with the same marks are merged (Word emits a <strong> per word)", () => {
  const { blocks } = htmlToBlocks("<p><strong>Non</strong><strong>-refundable</strong></p>");
  const p = blocks[0]!;
  assert.deepEqual(p.type === "p" ? p.runs : null, [{ text: "Non-refundable", b: true }]);
});

test("lists, and a nested list flattened with a hyphen", () => {
  const { blocks } = htmlToBlocks(
    "<ul><li>Weekly sessions<ul><li>Recorded</li></ul></li><li>Reviews</li></ul><ol><li>First</li></ol>",
  );

  const list = blocks.find((b) => b.type === "list" && !b.ordered);
  assert.ok(list && list.type === "list");
  assert.deepEqual(
    list.items.map((i) => i.map((r) => r.text).join("")),
    ["Weekly sessions", "- Recorded", "Reviews"],
  );

  const ordered = blocks.find((b) => b.type === "list" && b.ordered);
  assert.ok(ordered && ordered.type === "list");
});

test("THE one that matters: a table whose cells wrap their text in <p>", () => {
  const { blocks } = htmlToBlocks(
    "<table><tr><th><p>Instalment</p></th><th><p>Due</p></th></tr>" +
      "<tr><td><p>43,999 INR</p></td><td><p>Week 1</p><p>04.07.2026</p></td></tr></table>",
  );

  // Nothing escaped into the document around the table.
  assert.equal(blocks.length, 1);
  const table = blocks[0]!;
  assert.ok(table.type === "table");
  assert.equal(table.rows.length, 2);
  assert.equal(table.rows[0]!.head, true);
  assert.deepEqual(
    table.rows[0]!.cells.map((c) => c.map((r) => r.text).join("")),
    ["Instalment", "Due"],
  );
  // Two paragraphs in one cell become two lines in that cell, not two blocks.
  assert.deepEqual(
    table.rows[1]!.cells.map((c) => c.map((r) => r.text).join("")),
    ["43,999 INR", "Week 1\n04.07.2026"],
  );
});

test("a [[sign:…]] placeholder becomes a field block, splitting its paragraph", () => {
  const { blocks, fields } = htmlToBlocks(
    "<p>Signed by B2: [[sign:creator]] and by the student: [[sign:student|Your signature]]</p>",
  );

  assert.deepEqual(
    blocks.map((b) => (b.type === "field" ? `field:${b.fieldId}` : text(b))),
    ["Signed by B2:", "field:f1", "and by the student:", "field:f2"],
  );
  assert.deepEqual(fields, [
    { id: "f1", kind: "SIGNATURE", signer: "CREATOR" },
    { id: "f2", kind: "SIGNATURE", signer: "STUDENT", label: "Your signature" },
  ]);
});

test("placeholder aliases and the other field kinds", () => {
  const { fields } = htmlToBlocks(
    "<p>[[signature:b2]]</p><p>[[date:student]]</p><p>[[name:client]]</p><p>[[text:coach|Batch]]</p>",
  );
  assert.deepEqual(
    fields.map((f) => `${f.kind}/${f.signer}`),
    ["SIGNATURE/CREATOR", "DATE/STUDENT", "NAME/STUDENT", "TEXT/CREATOR"],
  );
  // Ids stay sequential across the whole document, never random - they are hashed.
  assert.deepEqual(fields.map((f) => f.id), ["f1", "f2", "f3", "f4"]);
});

/**
 * A CONSENT TICK IS A SENTENCE, AND IT MUST NOT FALL BACK TO PROSE.
 *
 * The label bound in `PLACEHOLDER_RE` is deliberately far looser than `MAX_FIELD_LABEL`, because
 * of how this failed before: the two were equal, so a label one character too long did not
 * truncate - it stopped the whole placeholder from matching, and the raw `[[check:student|…]]`
 * was typeset into the contract with no tick box and nothing said. Printing markup where a
 * signer's consent should be is the exact failure this module exists to prevent.
 */
test("a long tick-box label still parses as a field, truncated to the stored cap", () => {
  const clause =
    "I consent to photographs and video taken during the workshop being used by B2 Consultants " +
    "in its marketing material, on its website and on its social media channels, indefinitely";
  assert.ok(clause.length > 60, "the clause has to be longer than the old bound to prove anything");

  const { blocks, fields } = htmlToBlocks(`<p>[[check:student|${clause}]]</p>`);

  assert.deepEqual(blocks, [{ type: "field", fieldId: "f1" }], "a field block, not a paragraph");
  assert.equal(fields.length, 1);
  assert.equal(fields[0]!.kind, "CHECKBOX");
  assert.equal(fields[0]!.label, clause.slice(0, MAX_FIELD_LABEL));
  // And what it kept has to be storable, or the upload is rejected after a clean parse.
  assert.ok((fields[0]!.label?.length ?? 0) <= MAX_FIELD_LABEL);
});

test("an absurd label truncates rather than leaking markup into the document", () => {
  const { blocks, fields } = htmlToBlocks(`<p>[[text:student|${"x".repeat(900)}]]</p>`);
  assert.deepEqual(blocks, [{ type: "field", fieldId: "f1" }]);
  assert.equal(fields[0]!.label!.length, MAX_FIELD_LABEL);
});

test("entities decode, &nbsp; becomes a plain space, <br> becomes a newline", () => {
  const { blocks } = htmlToBlocks("<p>Fee&nbsp;&amp;&nbsp;terms &sect;7<br/>69,999&nbsp;INR</p>");
  assert.equal(text(blocks[0]!), "Fee & terms §7\n69,999 INR");
});

test("scripts, styles and unknown tags are dropped, their text with them where it is not prose", () => {
  const { blocks, dropped } = htmlToBlocks(
    '<p>Real text</p><script>alert(1)</script><style>p{}</style><p><img src="data:image/png;base64,AAA"/>After</p>',
  );
  const all = blocks.map(text).join("|");
  assert.ok(!all.includes("alert"), "a script body must never survive as text");
  assert.ok(!all.includes("p{}"));
  assert.equal(dropped.images, 1);
  assert.equal(all, "Real text|After");
});

test("only http(s) and mailto links keep their target", () => {
  const { blocks } = htmlToBlocks(
    '<p><a href="https://b2consultants.de">site</a> <a href="javascript:alert(1)">bad</a></p>',
  );
  const runs = blocks[0]!.type === "p" ? blocks[0]!.runs : [];
  assert.equal(runs.find((r) => r.text === "site")?.href, "https://b2consultants.de");
  assert.equal(runs.find((r) => r.text === "bad")?.href, undefined);
});

test("empty paragraphs vanish and an unclosed tag is still emitted", () => {
  const { blocks } = htmlToBlocks("<p></p><p>  </p><p>Last paragraph, never closed");
  assert.equal(blocks.length, 1);
  assert.equal(text(blocks[0]!), "Last paragraph, never closed");
});

test("a list inside a table cell flattens into lines instead of disappearing", () => {
  const { blocks } = htmlToBlocks("<table><tr><td><ul><li>One</li><li>Two</li></ul></td></tr></table>");
  const table = blocks[0]!;
  assert.ok(table.type === "table");
  assert.equal(table.rows[0]!.cells[0]!.map((r) => r.text).join(""), "- One\n- Two");
});

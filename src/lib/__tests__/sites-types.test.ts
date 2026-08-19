import test from "node:test";
import assert from "node:assert/strict";
import {
  normaliseItems,
  pagesOf,
  nextPageIndex,
  reachableItems,
  validateAnswer,
  answerToText,
  type FormItem,
} from "../sites-types";

/**
 * Three things are under test, and they are the three that fail silently.
 *
 * 1. NORMALISATION - every form saved before the Google-parity rebuild is still in the database in
 *    the old shape. If the upgrade-on-read drops a field, a live form quietly stops collecting it.
 * 2. BRANCHING - a required question inside a section nobody was routed to must not block the
 *    submit. Get this wrong and the form is permanently unsubmittable, but only for the
 *    respondents who took the other branch, so it looks like "some people can't submit".
 * 3. VALIDATION - the same function runs in the browser and in the server action. A disagreement
 *    between the two is a form that passes client-side and then fails after the button is pressed.
 */

const item = (over: Partial<FormItem> & { id: string; type: FormItem["type"] }): FormItem => ({
  key: over.id,
  label: over.id,
  ...over,
});

// ── Normalisation ───────────────────────────────────────────────────────────────

test("a legacy field survives the upgrade with its meaning intact", () => {
  const [f] = normaliseItems([
    { key: "city", label: "City", type: "select", required: true, options: ["Delhi", "Pune"] },
  ]);
  assert.equal(f.key, "city");
  assert.equal(f.type, "select");
  assert.equal(f.required, true);
  // A bare string[] becomes {label} objects - the shape the option editor and branching need.
  assert.deepEqual(f.options, [{ label: "Delhi" }, { label: "Pune" }]);
  assert.ok(f.id, "an id is derived for a row that never had one");
});

test("legacy `checkbox` stays a single tick - it is NOT re-read as multi-select", () => {
  const [f] = normaliseItems([{ key: "consent", label: "I agree", type: "checkbox" }]);
  assert.equal(f.type, "checkbox");
  assert.equal(f.options, undefined, "a single tick has no option list");
});

test("ids are stable across two reads of the same unsaved legacy form", () => {
  const raw = [{ key: "a", type: "text" }, { key: "b", type: "text" }];
  assert.deepEqual(normaliseItems(raw).map((f) => f.id), normaliseItems(raw).map((f) => f.id));
});

test("duplicate ids are made unique, or a branch target would be ambiguous", () => {
  const ids = normaliseItems([
    { id: "x", key: "a", type: "text" },
    { id: "x", key: "b", type: "text" },
  ]).map((f) => f.id);
  assert.equal(new Set(ids).size, 2);
});

test("junk in the JSON column does not throw", () => {
  assert.deepEqual(normaliseItems(null), []);
  assert.deepEqual(normaliseItems("nonsense"), []);
  assert.deepEqual(normaliseItems([null, 3, "x"]), []);
  assert.equal(normaliseItems([{ type: "not-a-type", key: "k" }])[0].type, "text");
});

// ── Pages and branching ─────────────────────────────────────────────────────────

const BRANCHED: FormItem[] = [
  item({
    id: "q1",
    type: "radio",
    key: "budget",
    options: [{ label: "Over 5 lakh" }, { label: "Under 1 lakh", goTo: "s_thanks" }],
  }),
  item({ id: "s_detail", type: "section", key: "" }),
  item({ id: "q2", type: "text", key: "timeline", required: true }),
  item({ id: "s_thanks", type: "section", key: "" }),
  item({ id: "q3", type: "text", key: "note" }),
];

test("pages split at each section item", () => {
  const pages = pagesOf(BRANCHED);
  assert.equal(pages.length, 3);
  assert.deepEqual(pages.map((p) => p.items.map((i) => i.key)), [["budget"], ["timeline"], ["note"]]);
});

test("a leading section does not produce an empty first page", () => {
  const pages = pagesOf([item({ id: "s", type: "section", key: "" }), item({ id: "q", type: "text", key: "q" })]);
  assert.equal(pages.length, 1);
  assert.equal(pages[0].items[0].key, "q");
});

test("an option's goTo jumps the section it skips", () => {
  const pages = pagesOf(BRANCHED);
  assert.equal(nextPageIndex(pages[0], { budget: "Under 1 lakh" }, pages), 2);
  assert.equal(nextPageIndex(pages[0], { budget: "Over 5 lakh" }, pages), 1, "no goTo → the next page");
});

test("the last answered branching question wins, as in Google Forms", () => {
  const items: FormItem[] = [
    item({ id: "a", type: "radio", key: "a", options: [{ label: "yes", goTo: "s2" }] }),
    item({ id: "b", type: "radio", key: "b", options: [{ label: "yes", goTo: "s3" }] }),
    item({ id: "s2", type: "section", key: "" }),
    item({ id: "s3", type: "section", key: "" }),
  ];
  const pages = pagesOf(items);
  assert.equal(nextPageIndex(pages[0], { a: "yes", b: "yes" }, pages), 2);
});

test("a backwards target is ignored - a cycle is unconstructable", () => {
  const items: FormItem[] = [
    item({ id: "q0", type: "text", key: "q0" }),
    item({ id: "s1", type: "section", key: "", goTo: "s1" }),
    item({ id: "q1", type: "text", key: "q1" }),
  ];
  const pages = pagesOf(items);
  assert.equal(nextPageIndex(pages[1], {}, pages), "submit", "self-reference falls through to the end");
});

test("the last page submits", () => {
  const pages = pagesOf(BRANCHED);
  assert.equal(nextPageIndex(pages[2], {}, pages), "submit");
});

test("a required question in a skipped branch is NOT reachable", () => {
  const reached = reachableItems(BRANCHED, { budget: "Under 1 lakh" }).map((i) => i.key);
  assert.deepEqual(reached, ["budget", "note"]);
  assert.ok(!reached.includes("timeline"), "the skipped required question must not block the submit");
});

test("the un-branched path sees every question", () => {
  assert.deepEqual(reachableItems(BRANCHED, { budget: "Over 5 lakh" }).map((i) => i.key), [
    "budget",
    "timeline",
    "note",
  ]);
});

// ── Validation ──────────────────────────────────────────────────────────────────

test("required is enforced, and blank optional answers pass", () => {
  const q = item({ id: "q", type: "text", key: "q", label: "Name", required: true });
  assert.match(validateAnswer(q, "")!, /required/);
  assert.equal(validateAnswer(q, "Asha"), null);
  assert.equal(validateAnswer({ ...q, required: false }, ""), null);
});

test("a required multi-select needs at least one box ticked", () => {
  const q = item({ id: "q", type: "checkboxes", key: "q", required: true, options: [{ label: "A" }] });
  assert.match(validateAnswer(q, [])!, /required/);
  assert.equal(validateAnswer(q, ["A"]), null);
});

test("choice answers must come from the list unless Other is on", () => {
  const q = item({ id: "q", type: "radio", key: "q", options: [{ label: "A" }, { label: "B" }] });
  assert.match(validateAnswer(q, "C")!, /pick one/);
  assert.equal(validateAnswer({ ...q, allowOther: true }, "C"), null, "Other is the whole point");
});

test("select at least / at most / exactly", () => {
  const q = item({
    id: "q",
    type: "checkboxes",
    key: "q",
    options: [{ label: "A" }, { label: "B" }, { label: "C" }],
    validation: { kind: "count", min: 2 },
  });
  assert.match(validateAnswer(q, ["A"])!, /at least 2/);
  assert.equal(validateAnswer(q, ["A", "B"]), null);
  assert.match(validateAnswer({ ...q, validation: { kind: "count", exactly: 2 } }, ["A", "B", "C"])!, /exactly 2/);
});

test("number range, whole numbers and the custom message", () => {
  const q = item({ id: "q", type: "number", key: "q", validation: { kind: "number", min: 1, max: 10 } });
  assert.match(validateAnswer(q, "0")!, /at least 1/);
  assert.match(validateAnswer(q, "11")!, /at most 10/);
  assert.equal(validateAnswer(q, "5"), null);
  const whole = item({ id: "q", type: "number", key: "q", validation: { kind: "number", integer: true, message: "Staff count only" } });
  assert.equal(validateAnswer(whole, "2.5"), "Staff count only", "the author's wording wins");
});

test("an uncompilable regex is ignored, not thrown - a typo must not take the form down", () => {
  const q = item({ id: "q", type: "text", key: "q", validation: { kind: "regex", pattern: "([" } });
  assert.equal(validateAnswer(q, "anything"), null);
});

test("regex can be required to match or to NOT match", () => {
  const must = item({ id: "q", type: "text", key: "q", validation: { kind: "regex", pattern: "^GN-" } });
  assert.equal(validateAnswer(must, "GN-1"), null);
  assert.ok(validateAnswer(must, "X-1"));
  const mustNot = item({ id: "q", type: "text", key: "q", validation: { kind: "regex", pattern: "test", mustMatch: false } });
  assert.ok(validateAnswer(mustNot, "a test value"));
  assert.equal(validateAnswer(mustNot, "a real value"), null);
});

test("a scale answer must be a whole number inside its own bounds", () => {
  const q = item({ id: "q", type: "scale", key: "q", scaleMin: 1, scaleMax: 5 });
  assert.equal(validateAnswer(q, "3"), null);
  assert.ok(validateAnswer(q, "6"));
  assert.ok(validateAnswer(q, "2.5"));
});

test("static items never produce an error, even marked required", () => {
  assert.equal(validateAnswer(item({ id: "s", type: "section", key: "", required: true }), undefined), null);
  assert.equal(validateAnswer(item({ id: "h", type: "heading", key: "", required: true }), undefined), null);
});

test("answerToText joins a multi-answer for the CSV and the contact record", () => {
  assert.equal(answerToText(["A", "B"]), "A, B");
  assert.equal(answerToText("A"), "A");
  assert.equal(answerToText(undefined), "");
});

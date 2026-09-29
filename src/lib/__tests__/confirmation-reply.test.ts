import test from "node:test";
import assert from "node:assert/strict";
import { isConfirmationReply, stripQuotedReply, htmlToText } from "../confirmation-reply";

/**
 * A wrong YES moves a card to Pre-Qualified & Confirmed and stops the ladder that would have
 * freed the slot, so the negative cases matter more than the positive ones here.
 */

// ───────────────────────── the affirmatives ─────────────────────────

test("the phrasings the SOP template asks for are confirmations", () => {
  for (const t of ["YES", "yes", "Yes please", "yess", "yep", "yup", "sure", "ok", "okay", "Confirmed", "confirming", "I'm in", "will join", "joining", "👍", "✅"]) {
    assert.equal(isConfirmationReply(t), true, `"${t}" should confirm`);
  }
});

test("leading whitespace and case never matter", () => {
  assert.equal(isConfirmationReply("   YeS  "), true);
});

// ───────────────────────── the refusals ─────────────────────────

test("a plain no is not a confirmation", () => {
  for (const t of ["no", "No thanks", "not interested", "can't make it", "cannot attend", "won't be able to", "unable to join", "please reschedule", "another time", "I'm busy"]) {
    assert.equal(isConfirmationReply(t), false, `"${t}" must not confirm`);
  }
});

test("a yes that takes itself back does not confirm", () => {
  // The reason the negation check runs first and scans the whole reply.
  assert.equal(isConfirmationReply("yes... actually no, can we move it?"), false);
  assert.equal(isConfirmationReply("Yes but I cannot make that time"), false);
});

test("an unrecognised reply is left for a human", () => {
  for (const t of ["", "   ", "what time is it again?", "who is this", "Thanks for the info", "K"]) {
    assert.equal(isConfirmationReply(t), false, `"${t}" must not confirm`);
  }
});

test("a word merely starting with an affirmative does not confirm", () => {
  // \b anchoring: "yesterday" and "okra" are not agreement.
  assert.equal(isConfirmationReply("yesterday was better"), false);
  assert.equal(isConfirmationReply("sured"), false);
});

// ───────────────────────── quoted email replies ─────────────────────────

test("a quoted original is stripped before judging", () => {
  const reply = [
    "Yes",
    "",
    "On Wed, 27 Aug 2026 at 09:14, B2 Consultants <hi@b2.de> wrote:",
    "> Please reply YES to confirm your participation.",
    "> If you cannot attend, let us know and we will reschedule.",
  ].join("\n");
  assert.equal(stripQuotedReply(reply), "Yes");
  // Without stripping, "cannot" and "reschedule" in the quote would reject a genuine yes - which
  // is what made email confirmation impossible before this existed.
  assert.equal(isConfirmationReply(reply, { quoted: true }), true);
  assert.equal(isConfirmationReply(reply), false);
});

test("Outlook's original-message divider is a quote marker", () => {
  const reply = "Confirmed\n\n-----Original Message-----\nFrom: B2\nPlease reply YES or we cannot hold it";
  assert.equal(isConfirmationReply(reply, { quoted: true }), true);
});

test("Outlook's inline header block is a quote marker", () => {
  const reply = "yes\n\nFrom: B2 Consultants\nSent: Wednesday\nSubject: Confirm\n\nyou cannot miss this";
  assert.equal(isConfirmationReply(reply, { quoted: true }), true);
});

test("a mobile signature ends the reply", () => {
  assert.equal(stripQuotedReply("Yes\n\nSent from my iPhone"), "Yes");
});

test("stripping a reply that quotes nothing leaves it whole", () => {
  assert.equal(stripQuotedReply("Yes I will be there"), "Yes I will be there");
});

test("a refusal above a quote is still a refusal", () => {
  // The guard that matters: stripping must never turn a no into a yes.
  const reply = "Sorry, I can't make it.\n\n> Please reply YES to confirm";
  assert.equal(isConfirmationReply(reply, { quoted: true }), false);
});

test("a reply that is nothing but the quoted original confirms nothing", () => {
  const reply = "> Please reply YES to confirm your participation.";
  assert.equal(stripQuotedReply(reply), "");
  assert.equal(isConfirmationReply(reply, { quoted: true }), false);
});

// ───────────────────────── html bodies ─────────────────────────

test("html is converted with its line breaks intact", () => {
  // The old helper collapsed everything to one line, which left stripQuotedReply nothing to cut on.
  const html = "<div>Yes</div><br><blockquote>Please reply YES or we cannot hold your slot</blockquote>";
  const text = htmlToText(html);
  assert.ok(text.startsWith("Yes"), `expected the reply first, got "${text}"`);
  assert.equal(isConfirmationReply(text, { quoted: true }), true);
});

test("a blockquoted original is dropped entirely", () => {
  const html = "<p>Confirmed</p><blockquote><p>you cannot reschedule after today</p></blockquote>";
  assert.ok(!htmlToText(html).includes("reschedule"));
  assert.equal(isConfirmationReply(htmlToText(html), { quoted: true }), true);
});

test("style and script contents never reach the text", () => {
  const html = "<style>.no{}</style><script>var cannot=1</script><p>yes</p>";
  const text = htmlToText(html);
  assert.ok(!text.includes("cannot"));
  assert.equal(isConfirmationReply(text, { quoted: true }), true);
});

test("an escaped plain-text quote is still recognised as a quote", () => {
  // A client that HTML-escapes a ">" quote would otherwise hide the marker behind &gt;.
  const html = "<div>Yes</div><div>&gt; we cannot hold the slot otherwise</div>";
  assert.equal(isConfirmationReply(htmlToText(html), { quoted: true }), true);
});

test("html entities are decoded rather than left as noise", () => {
  assert.equal(htmlToText("<p>Tom&nbsp;&amp;&nbsp;Jerry</p>"), "Tom & Jerry");
});

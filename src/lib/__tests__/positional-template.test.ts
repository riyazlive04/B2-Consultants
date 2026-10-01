import test from "node:test";
import assert from "node:assert/strict";
import { positionalVarMap, WHATSAPP_TEMPLATE_VAR_ORDER } from "../whatsapp";

/**
 * Positional WhatsApp templates ({{1}}, {{2}}, {{3}}).
 *
 * The case that produced this: `b2_booking_confirm_request` is APPROVED and declares ["1","2","3"],
 * while the confirm-or-cancel loop sends `name` / `slot_time` / `booking_url`. Looking each declared
 * name up in the vars found nothing, so every send was skipped - safe, and completely inert, which
 * is the failure mode that looks like "the feature does not work".
 *
 * The rule these tests pin is the REFUSAL as much as the translation: a wrong guess puts a real
 * value into the wrong sentence, which is worse than sending nothing.
 */

test("a positional booking template maps to the kind's variables in order", () => {
  const map = positionalVarMap("BOOKING_CONFIRM_REQUEST", ["1", "2", "3"]);
  assert.deepEqual(map, { "1": "name", "2": "slot_time", "3": "booking_url" });
});

test("a named template is left alone", () => {
  assert.equal(positionalVarMap("BOOKING_CONFIRM_REQUEST", ["name", "slot_time", "booking_url"]), null);
});

test("a mixed template is left alone rather than half-translated", () => {
  assert.equal(positionalVarMap("BOOKING_CONFIRM_REQUEST", ["1", "slot_time", "3"]), null);
});

test("it refuses to guess when the counts differ", () => {
  // AGREEMENT_SEND offers name, sign_url, sign_token, document_no - four, for three placeholders.
  // Zipping would put the signing link where the document number belongs.
  assert.equal(positionalVarMap("AGREEMENT_SEND", ["1", "2", "3"]), null);
  assert.equal(positionalVarMap("BOOKING_CONFIRM_REQUEST", ["1", "2"]), null);
});

test("params declared out of order still map by number", () => {
  const map = positionalVarMap("BOOKING_CONFIRM_REQUEST", ["3", "1", "2"]);
  assert.deepEqual(map, { "1": "name", "2": "slot_time", "3": "booking_url" });
});

test("double-digit placeholders sort numerically, not as strings", () => {
  // A 10-placeholder template must map {{10}} last, not between {{1}} and {{2}}.
  const kind = "BOOK_ORDER" as const;
  const canonical = WHATSAPP_TEMPLATE_VAR_ORDER[kind];
  const declared = canonical.map((_, i) => String(i + 1));
  const map = positionalVarMap(kind, declared)!;
  assert.equal(map["1"], canonical[0]);
  assert.equal(map[String(canonical.length)], canonical[canonical.length - 1]);
});

test("an empty declaration is not a positional template", () => {
  assert.equal(positionalVarMap("MANUAL", []), null);
});

test("the order used for mapping is the authored list, never the lead-facing superset", () => {
  // WHATSAPP_AVAILABLE_VARS unions the shared lead variables in for lead-facing kinds. If that
  // were the source, this would be longer than 3 and the booking case above would refuse.
  assert.deepEqual(WHATSAPP_TEMPLATE_VAR_ORDER.BOOKING_CONFIRM_REQUEST, ["name", "slot_time", "booking_url"]);
});

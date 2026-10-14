import test from "node:test";
import assert from "node:assert/strict";
import {
  positionalVarMap,
  WHATSAPP_AVAILABLE_VARS,
  WHATSAPP_KINDS,
  WHATSAPP_TEMPLATE_VAR_ORDER,
} from "../whatsapp";

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

/**
 * The agreement signing code. A one-time passcode is Meta's AUTHENTICATION category: the body is
 * fixed at a single placeholder (the code) and the category has no named parameters at all, so the
 * approved `b2_agreement_otp` declares ["1"] while the touchpoint offers ["name", "code"]. The
 * arity check refused, `buildParameters` fell back to looking up a variable called "1", found
 * nothing, and skipped - so the signing page could only ever say "we could not send your code".
 */
test("a one-placeholder authentication template maps to the code, not the name", () => {
  assert.deepEqual(positionalVarMap("AGREEMENT_OTP", ["1"]), { "1": "code" });
});

test("a two-placeholder OTP template still maps to the canonical order", () => {
  // The alternates must not shadow the authored list: a template that genuinely greets the student
  // and then gives the code is name-then-code, exactly as before.
  assert.deepEqual(positionalVarMap("AGREEMENT_OTP", ["1", "2"]), { "1": "name", "2": "code" });
});

test("a named OTP template is still left alone", () => {
  assert.equal(positionalVarMap("AGREEMENT_OTP", ["code"]), null);
});

test("every alternate positional layout is a subset of what its touchpoint offers", () => {
  // An alternate naming a variable the touchpoint cannot supply would map the placeholder onto a
  // value that is never populated - the same silent skip, moved one layer down.
  for (const kind of WHATSAPP_KINDS) {
    const offered = new Set(WHATSAPP_AVAILABLE_VARS[kind]);
    for (let n = 1; n <= 12; n++) {
      const map = positionalVarMap(kind, Array.from({ length: n }, (_, i) => String(i + 1)));
      if (!map) continue;
      for (const source of Object.values(map)) {
        assert.ok(offered.has(source), `${kind} maps a placeholder to {{${source}}}, which it does not offer`);
      }
    }
  }
});

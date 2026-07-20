/**
 * Field rules — the character gate every form in the app now depends on.
 *
 * Everything here is pure and isomorphic (no DB, no libphonenumber), so it tests exactly what
 * both sides run: the browser calls `filter` on each keystroke, the server action calls `schema`
 * on submit. The pairing is the point — a filter that drops a character its schema still accepts
 * is merely untidy, but a schema that rejects what the filter happily let a user type is a form
 * that cannot be submitted and does not say why. The `filter ∘ schema` block at the bottom pins
 * that agreement down.
 *
 * The name cases carry the weight. B2's contacts are Indian and German, so "Müller" and "अमीन"
 * are the normal case, not the exotic one — an ASCII-only rule would reject the customer rather
 * than the typo, and it would do it while looking perfectly reasonable to an English-speaking
 * reviewer.
 *
 * Run: npm test
 */

import assert from "node:assert/strict";
import { test, describe } from "node:test";
import { FIELD_RULES, intInRange, optionalRule } from "../field-rules";

const filter = (k: Parameters<typeof rules>[0]) => FIELD_RULES[k].filter;
const rules = (k: keyof typeof FIELD_RULES) => FIELD_RULES[k];
const accepts = (k: keyof typeof FIELD_RULES, v: string) => FIELD_RULES[k].schema.safeParse(v).success;
const messageFor = (k: keyof typeof FIELD_RULES, v: string) => {
  const r = FIELD_RULES[k].schema.safeParse(v);
  return r.success ? null : r.error.issues[0]?.message;
};

describe("name — letters only, but every alphabet's letters", () => {
  test("drops digits and symbols as they are typed", () => {
    assert.equal(filter("name")("Rahul7 Sharma!@#"), "Rahul Sharma");
  });

  test("keeps German umlauts — precomposed and NFD-decomposed alike", () => {
    assert.equal(filter("name")("Müller"), "Müller");
    // A Mac paste can deliver "u" + U+0308; stripping the mark would silently yield "Muller".
    assert.equal(filter("name")("Müller"), "Müller");
  });

  test("keeps non-Latin scripts", () => {
    assert.equal(filter("name")("अमीन"), "अमीन");
  });

  test("keeps the punctuation real names carry", () => {
    assert.equal(filter("name")("Müller-Schmidt"), "Müller-Schmidt");
    assert.equal(filter("name")("O'Brien"), "O'Brien");
    assert.equal(filter("name")("M. S. Dhoni"), "M. S. Dhoni");
  });

  test("keeps the name forms B2's own lead table actually contains", () => {
    // Both are real rows. "S/o" is "son of"; surname-first is common in the same data.
    assert.ok(accepts("name", "R.mani S/o rajavel"));
    assert.ok(accepts("name", "Rahaman, Ameenur"));
  });

  test("still refuses what the lead table shows is junk, not a name", () => {
    // Every one of these is a real value sitting in the `name` column today.
    assert.equal(accepts("name", "9442101988"), false);              // phone in the name box
    assert.equal(accepts("name", "Kanaguraj9003@gmail.com"), false); // email in the name box
    assert.equal(accepts("name", "Ok test ok 1000 123"), false);     // test data
    assert.equal(accepts("name", "Shama🦋"), false);                 // emoji
  });

  test("a trailing space survives so a second name can be typed", () => {
    assert.equal(filter("name")("Rahul "), "Rahul ");
  });

  test("schema names the offending class rather than saying 'invalid'", () => {
    assert.equal(messageFor("name", "Rahul7"), "Name can only contain letters");
  });

  test("schema squishes runs of whitespace and trims", () => {
    assert.equal(rules("name").schema.parse("  Rahul   Kumar "), "Rahul Kumar");
  });

  test("punctuation alone is not a name", () => {
    assert.equal(messageFor("name", "..."), "Enter a real name");
  });

  test("rejects empty and over-long", () => {
    assert.equal(accepts("name", ""), false);
    assert.equal(accepts("name", "a".repeat(161)), false);
  });
});

describe("phone — digits plus the punctuation people actually type", () => {
  test("drops letters", () => {
    assert.equal(filter("phone")("+91 98765abc43210"), "+91 9876543210");
  });

  test("keeps + ( ) - and spaces", () => {
    assert.equal(filter("phone")("+49 (0)151-234 5678"), "+49 (0)151-234 5678");
  });

  test("a + is only meaningful in the lead position", () => {
    assert.equal(filter("phone")("+91+98765"), "+9198765");
    assert.equal(filter("phone")("91+98765"), "9198765");
  });

  test("accepts both countries B2 actually contacts", () => {
    assert.ok(accepts("phone", "+91 98765 43210"));
    assert.ok(accepts("phone", "+49 151 23456789"));
  });

  test("rejects outside the E.164 digit range", () => {
    assert.equal(accepts("phone", "12345"), false);
    assert.equal(accepts("phone", "1234567890123456"), false);
  });
});

describe("money — digits and at most one dot", () => {
  test("drops letters and separators", () => {
    // The comma matters: cash-actions' moneyInput regex rejects it outright, so a typed
    // "25,000" used to fail on submit with no hint as to why.
    assert.equal(filter("money")("12a,345.6789"), "12345.67");
  });

  test("a second dot is a no-op, not a reset", () => {
    assert.equal(filter("money")("12.34.56"), "12.34");
  });

  test("drops a minus — no money input in the app takes one", () => {
    assert.equal(filter("money")("-50"), "50");
  });

  test("schema rejects what the filter would never produce", () => {
    assert.ok(accepts("money", "1200.50"));
    assert.equal(accepts("money", "1e5"), false);
    assert.equal(accepts("money", "1.234"), false);
  });
});

describe("int / rate", () => {
  test("int keeps digits only", () => {
    assert.equal(filter("int")("4a2.5-"), "425");
    assert.equal(accepts("int", "-1"), false);
  });

  test("rate is capped at 100", () => {
    assert.ok(accepts("rate", "12.5"));
    assert.equal(messageFor("rate", "101"), "Must be 100 or less");
  });

  test("intInRange bounds both ends", () => {
    assert.ok(intInRange(0, 10, "Score").safeParse("10").success);
    assert.equal(intInRange(0, 10, "Score").safeParse("11").success, false);
  });
});

describe("email / city / url", () => {
  test("email folds case — it is the key leads are matched on", () => {
    assert.equal(rules("email").schema.parse("Ameen@X.COM"), "ameen@x.com");
  });

  test("email drops spaces, rejects junk", () => {
    assert.equal(filter("email")("a b@ex.com"), "ab@ex.com");
    assert.equal(accepts("email", "nope"), false);
  });

  test("city is name-shaped", () => {
    assert.equal(filter("city")("Pune 411001"), "Pune ");
    assert.ok(accepts("city", "Baden-Württemberg"));
  });

  test("url adds the scheme rather than rejecting a lead over it", () => {
    // This sits on the PUBLIC booking form; "linkedin.com/in/x" must not cost a booking.
    assert.equal(rules("url").schema.parse("linkedin.com/in/x"), "https://linkedin.com/in/x");
    assert.equal(rules("url").schema.parse("http://x.com"), "http://x.com");
    assert.equal(accepts("url", "not a url"), false);
  });

  test("url refuses script-bearing schemes", () => {
    // Not hypothetical: forms' `redirectUrl` is assigned to window.location.href, and
    // `z.string().url()` alone ACCEPTS this — "//x" opens a JS comment, "%0A" closes it,
    // and alert(1) runs. The protocol allow-list is what stops it.
    assert.equal(accepts("url", "javascript://x%0Aalert(1)"), false);
    assert.equal(accepts("url", "javascript:alert(1)"), false);
    assert.equal(accepts("url", "vbscript://x"), false);
    assert.equal(accepts("url", "data:text/html,<script>alert(1)</script>"), false);
    assert.equal(messageFor("url", "javascript://x%0Aalert(1)"), "Links must start with http:// or https://");
  });
});

describe("optionalRule — an untouched box means 'not provided'", () => {
  test("blank and whitespace become undefined", () => {
    assert.equal(optionalRule("phone").parse(""), undefined);
    assert.equal(optionalRule("phone").parse("   "), undefined);
  });

  test("a supplied value is still checked", () => {
    assert.equal(optionalRule("phone").safeParse("abc").success, false);
    assert.equal(optionalRule("phone").parse("+91 98765 43210"), "+91 98765 43210");
  });
});

describe("filter ∘ schema — what a user can type, the server must accept", () => {
  // The filter is UX; the schema is the gate. If these disagree, a user types something the
  // box allows and then cannot submit, with an error that blames them for the kit's mistake.
  const cases: Array<[keyof typeof FIELD_RULES, string]> = [
    ["name", "Rahul7 Sharma!@#"],
    ["name", "Müller-Schmidt"],
    ["name", "अमीन"],
    ["name", "M. S. Dhoni"],
    ["phone", "+91 98765abc43210"],
    ["phone", "+49 (0)151-234 5678"],
    ["city", "Baden-Württemberg"],
    ["money", "12a,345.6789"],
    ["money", "1200"],
    ["int", "4a2"],
    ["rate", "12.5%"],
    ["email", "Ameen@X.COM"],
  ];

  for (const [kind, raw] of cases) {
    test(`${kind}: ${JSON.stringify(raw)}`, () => {
      const typed = FIELD_RULES[kind].filter(raw);
      const parsed = FIELD_RULES[kind].schema.safeParse(typed);
      assert.ok(
        parsed.success,
        `filter produced ${JSON.stringify(typed)} but schema rejected it: ${
          parsed.success ? "" : parsed.error.issues[0]?.message
        }`,
      );
    });
  }
});

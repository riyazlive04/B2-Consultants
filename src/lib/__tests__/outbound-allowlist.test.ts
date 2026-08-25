import assert from "node:assert/strict";
import test from "node:test";
import { checkRecipient, allowlistActive } from "../outbound-allowlist";

/** Run `fn` with OUTBOUND_ALLOWLIST set to `value` (undefined = unset), then restore. */
function withList<T>(value: string | undefined, fn: () => T): T {
  const prev = process.env.OUTBOUND_ALLOWLIST;
  if (value === undefined) delete process.env.OUTBOUND_ALLOWLIST;
  else process.env.OUTBOUND_ALLOWLIST = value;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env.OUTBOUND_ALLOWLIST;
    else process.env.OUTBOUND_ALLOWLIST = prev;
  }
}

test("unset allowlist imposes no restriction - production is unchanged", () => {
  withList(undefined, () => {
    assert.equal(allowlistActive(), false);
    assert.equal(checkRecipient("+919876543210", "whatsapp").allowed, true);
    assert.equal(checkRecipient("stranger@example.com", "email").allowed, true);
  });
});

test("an empty or whitespace value is also no restriction", () => {
  withList("   ", () => assert.equal(checkRecipient("+919876543210", "whatsapp").allowed, true));
});

test("a set allowlist blocks everyone not on it", () => {
  withList("+919000015961,support@sirahdigital.in", () => {
    assert.equal(allowlistActive(), true);
    assert.equal(checkRecipient("+919876543210", "whatsapp").allowed, false);
    assert.equal(checkRecipient("stranger@example.com", "email").allowed, false);
  });
});

test("listed recipients pass", () => {
  withList("+919000015961,support@sirahdigital.in", () => {
    assert.equal(checkRecipient("+919000015961", "whatsapp").allowed, true);
    assert.equal(checkRecipient("support@sirahdigital.in", "email").allowed, true);
  });
});

// The number reaches these functions in whatever shape its source stored it: WATI wants bare
// digits, leads carry E.164, and a hand-typed row may have spaces. All of them are the same
// person, and a guard that matched only one format would leak the other three.
test("phone matching is format-insensitive across E.164, bare digits and spacing", () => {
  withList("+91 90000 15961", () => {
    for (const shape of ["+919000015961", "919000015961", "9000015961", "+91 90000 15961", "0919000015961"]) {
      assert.equal(checkRecipient(shape, "whatsapp").allowed, true, `should allow ${shape}`);
    }
    assert.equal(checkRecipient("9000015962", "whatsapp").allowed, false, "a different number must not match");
  });
});

test("email matching is case-insensitive", () => {
  withList("Support@SirahDigital.in", () => {
    assert.equal(checkRecipient("support@sirahdigital.in", "email").allowed, true);
    assert.equal(checkRecipient("SUPPORT@SIRAHDIGITAL.IN", "email").allowed, true);
  });
});

// The failure this guards against: a var set to punctuation only would parse to two empty
// sets. If that read as "no restriction", the developer who thought they had configured a
// safety net would have disarmed it instead.
test("an unparseable allowlist blocks everything rather than allowing everything", () => {
  withList(",,,", () => {
    assert.equal(checkRecipient("+919000015961", "whatsapp").allowed, false);
    assert.equal(checkRecipient("support@sirahdigital.in", "email").allowed, false);
  });
});

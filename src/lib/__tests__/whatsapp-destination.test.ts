import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_WATI_SETTINGS, redirectedBodyPrefix, resolveDestination } from "../whatsapp";

/**
 * The test-recipient valve is the single rule standing between "we are wiring up templates" and
 * "we messaged 23,000 real people". It is worth asserting harder than its four lines suggest,
 * because every failure mode here is silent: a valve that quietly does nothing looks exactly like
 * a valve that works, right up until the messages land.
 */

const REAL = "919876543210";
const TEST = "917806966124";

describe("off by default", () => {
  test("a fresh install messages real recipients", () => {
    // The opposite default would be worse in a different way - nobody would ever receive
    // anything, and it would take a support ticket to find out why.
    assert.equal(DEFAULT_WATI_SETTINGS.testRecipient, null);
  });

  test("null, undefined and empty all mean off", () => {
    for (const off of [null, undefined, "", "   "]) {
      const d = resolveDestination(REAL, off);
      assert.equal(d.redirected, false);
      assert.equal(d.number, REAL, `"${off}" must not divert anything`);
    }
  });
});

describe("when armed, nothing reaches the real recipient", () => {
  test("the destination becomes the test number", () => {
    const d = resolveDestination(REAL, TEST);
    assert.equal(d.number, TEST);
  });

  test("the intended recipient is preserved, not discarded", () => {
    // Losing it would make the WhatsApp log unreadable: every row would show the same number
    // with no way to tell who each message was actually about.
    const d = resolveDestination(REAL, TEST);
    assert.ok(d.redirected);
    assert.equal(d.intended, REAL);
  });

  test("the real number NEVER appears as the destination", () => {
    for (const someone of [REAL, "4915112345678", "919000000001", "1"]) {
      const d = resolveDestination(someone, TEST);
      assert.equal(d.number, TEST, `${someone} must not be messaged`);
    }
  });

  test("a surrounding-whitespace setting still arms the valve", () => {
    // A number pasted with a trailing space must not silently mean "off".
    const d = resolveDestination(REAL, `  ${TEST}  `);
    assert.equal(d.redirected, true);
    assert.equal(d.number, TEST);
  });
});

describe("sending to the test number itself", () => {
  test("is not reported as a redirect", () => {
    // Otherwise every message to your own phone gets stamped as diverted, and the log stops
    // meaning anything.
    const d = resolveDestination(TEST, TEST);
    assert.equal(d.redirected, false);
    assert.equal(d.number, TEST);
  });
});

describe("the log stamp", () => {
  test("names who the message was really for", () => {
    const prefix = redirectedBodyPrefix(REAL);
    assert.ok(prefix.includes(REAL));
    assert.match(prefix, /TEST MODE/);
  });

  test("a stamped body can never read as a genuine contact record", () => {
    const body = redirectedBodyPrefix(REAL) + "Hi Priya, your call is confirmed";
    assert.ok(body.startsWith("["), "the marker leads, so truncated views still show it");
    assert.match(body, /TEST MODE/);
  });
});

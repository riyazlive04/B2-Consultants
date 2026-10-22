/**
 * Back links - where a page goes when it can be reached from more than one list.
 *
 * Pure and DB-free. The whitelist carries the weight: `?back=` arrives from the address bar,
 * so the one thing that must never happen is a raw URL out of the query ending up in an href.
 *
 * Run: npm test
 */

import assert from "node:assert/strict";
import { test, describe } from "node:test";
import { resolveBackLink, withBack } from "../back-link";

const FALLBACK = { href: "/students", label: "Students" };

describe("back-link - resolving the origin", () => {
  test("a known key resolves to its list", () => {
    assert.deepEqual(resolveBackLink("attendance", FALLBACK), {
      href: "/attendance",
      label: "Attendance",
    });
    assert.deepEqual(resolveBackLink("coaching", FALLBACK), {
      href: "/coaching",
      label: "My Teaching",
    });
  });

  test("no origin at all keeps the caller's default", () => {
    // A bookmark, a WhatsApp link, a refresh - all arrive without one, and all should land on
    // whichever list that person actually has.
    assert.deepEqual(resolveBackLink(undefined, FALLBACK), FALLBACK);
    assert.deepEqual(resolveBackLink(null, FALLBACK), FALLBACK);
    assert.deepEqual(resolveBackLink("", FALLBACK), FALLBACK);
  });

  test("A URL IS NEVER ECHOED BACK - only keys resolve", () => {
    // The whole reason the origin travels as a key. Any of these reaching an href would turn
    // every cohort page into a redirect of somebody else's choosing.
    for (const hostile of [
      "https://example.com",
      "//example.com",
      "/console",
      "javascript:alert(1)",
      "../../etc/passwd",
    ]) {
      assert.deepEqual(resolveBackLink(hostile, FALLBACK), FALLBACK, hostile);
    }
  });

  test("an unknown key is not an error, just a fallback", () => {
    // A link written before a key was renamed must still land somewhere sensible.
    assert.deepEqual(resolveBackLink("retired-section", FALLBACK), FALLBACK);
    assert.deepEqual(resolveBackLink("__proto__", FALLBACK), FALLBACK);
  });
});

describe("back-link - stamping the origin", () => {
  test("appends the key, choosing the right separator", () => {
    assert.equal(withBack("/batches/abc", "attendance"), "/batches/abc?back=attendance");
    assert.equal(withBack("/batches/abc?tab=2", "coaching"), "/batches/abc?tab=2&back=coaching");
  });

  test("round-trips: what is stamped is what resolves", () => {
    const stamped = withBack("/german-note/xyz", "attendance");
    const key = new URLSearchParams(stamped.split("?")[1]).get("back");
    assert.deepEqual(resolveBackLink(key, FALLBACK), { href: "/attendance", label: "Attendance" });
  });
});

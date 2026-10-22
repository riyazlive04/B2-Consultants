/**
 * Resources - the rules behind course material attached to a curriculum row, a batch or a class.
 *
 * Pure and DB-free.
 *
 * The one that earns its keep is `isSafeResourceUrl`. These links are typed by staff and
 * rendered as anchors in a STUDENT's browser, so a `javascript:` URL here is stored XSS against
 * the people the app exists to serve. It fails closed, and this test is what keeps it that way.
 *
 * Run: npm test
 */

import assert from "node:assert/strict";
import { test, describe } from "node:test";
import {
  guessKind,
  hostOf,
  isSafeResourceUrl,
  mergeForSession,
  scopeOf,
  sortResources,
} from "../resources";

describe("scopeOf", () => {
  test("names the single scope that is set", () => {
    assert.equal(scopeOf({ batchId: "b1" }), "batch");
    assert.equal(scopeOf({ sessionId: "s1" }), "session");
    assert.equal(scopeOf({ curriculumItemId: "c1" }), "curriculumItem");
  });

  test("refuses a row with no scope - it would belong to nothing", () => {
    assert.equal(scopeOf({}), null);
    assert.equal(scopeOf({ batchId: null, sessionId: null }), null);
  });

  test("refuses a row with two scopes - it would render twice", () => {
    assert.equal(scopeOf({ batchId: "b1", sessionId: "s1" }), null);
    assert.equal(scopeOf({ curriculumItemId: "c1", batchId: "b1", sessionId: "s1" }), null);
  });
});

describe("isSafeResourceUrl", () => {
  test("accepts ordinary http and https links", () => {
    assert.equal(isSafeResourceUrl("https://drive.google.com/file/d/abc/view"), true);
    assert.equal(isSafeResourceUrl("http://example.com/worksheet.pdf"), true);
    assert.equal(isSafeResourceUrl("  https://example.com/x  "), true);
  });

  test("refuses a javascript: URL - this is the stored-XSS case", () => {
    assert.equal(isSafeResourceUrl("javascript:alert(document.cookie)"), false);
    assert.equal(isSafeResourceUrl("JaVaScRiPt:alert(1)"), false);
  });

  test("refuses data: and file: - neither is ever course material", () => {
    assert.equal(isSafeResourceUrl("data:text/html;base64,PHNjcmlwdD4="), false);
    assert.equal(isSafeResourceUrl("file:///C:/Users/secret.txt"), false);
  });

  test("refuses anything that is not a URL at all", () => {
    assert.equal(isSafeResourceUrl(""), false);
    assert.equal(isSafeResourceUrl("   "), false);
    assert.equal(isSafeResourceUrl("drive.google.com/file"), false); // no scheme
    assert.equal(isSafeResourceUrl("not a link"), false);
  });
});

describe("hostOf", () => {
  test("gives the bare host, without www", () => {
    assert.equal(hostOf("https://www.drive.google.com/x"), "drive.google.com");
    assert.equal(hostOf("https://fathom.video/share/abc"), "fathom.video");
  });
  test("is null for junk rather than throwing", () => {
    assert.equal(hostOf("not a link"), null);
  });
});

describe("guessKind", () => {
  test("reads the file extension", () => {
    assert.equal(guessKind("https://example.com/german-cv.pdf"), "DOCUMENT");
    assert.equal(guessKind("https://example.com/deck.pptx"), "DOCUMENT");
  });
  test("knows the video hosts the team actually uses", () => {
    assert.equal(guessKind("https://fathom.video/share/abc"), "VIDEO");
    assert.equal(guessKind("https://youtu.be/abc"), "VIDEO");
  });
  test("treats a Google Doc as a template - they are handed out to copy", () => {
    assert.equal(guessKind("https://docs.google.com/document/d/abc/edit"), "TEMPLATE");
  });
  test("treats a job board as a tool", () => {
    assert.equal(guessKind("https://www.stepstone.de/jobs"), "TOOL");
    assert.equal(guessKind("https://www.linkedin.com/in/someone"), "TOOL");
  });
  test("falls back to a plain link rather than guessing wildly", () => {
    assert.equal(guessKind("https://example.com/some/page"), "LINK");
    assert.equal(guessKind(""), "LINK");
  });
});

describe("ordering", () => {
  const r = (orderIndex: number, title: string) => ({ orderIndex, title });

  test("sorts by the order staff chose, then by title", () => {
    assert.deepEqual(
      sortResources([r(2, "C"), r(0, "B"), r(0, "A")]).map((x) => x.title),
      ["A", "B", "C"],
    );
  });

  test("a class shows the curriculum's material first, then the cohort's, then this class's", () => {
    const merged = mergeForSession({
      session: [r(0, "Saturday's slides")],
      curriculumItem: [r(0, "Resume worksheet")],
      batch: [r(0, "Batch WhatsApp group")],
    });
    assert.deepEqual(merged.map((x) => x.title), [
      "Resume worksheet",
      "Batch WhatsApp group",
      "Saturday's slides",
    ]);
  });

  test("missing groups are simply absent, not an error", () => {
    assert.deepEqual(mergeForSession({}).length, 0);
    assert.deepEqual(mergeForSession({ batch: [r(0, "Only one")] }).map((x) => x.title), ["Only one"]);
  });
});

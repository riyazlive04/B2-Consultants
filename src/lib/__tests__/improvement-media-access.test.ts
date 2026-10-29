import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canReadImprovementMedia, type MediaViewer } from "../improvement-access";
import type { AppRole } from "../sections";

/**
 * WHO MAY OPEN THE MEDIA ON A REPORT, pinned in two ways.
 *
 * ── WHY THIS TEST EXISTS ───────────────────────────────────────────────────────────────────
 * Because the rule was wrong in production. The `improvements` section is ADMIN + HEAD, so a
 * head coach could read every word of every report - but the recording route admitted only
 * `improvements.triage`, so the `<video controls>` embedded in the report they had just been
 * given answered 403. Nothing failed loudly; the player simply did not play.
 *
 * That is the SAME failure as the delivery fence, where three read paths each re-derived the
 * rule and each left HEAD out (`server/batch-access.ts` exists because of it). So this file
 * pins the rule's behaviour AND the fact that nobody re-derives it.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..", "..");  // -> src/
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");

/**
 * One exported handler's BODY, brace-matched.
 *
 * Brace matching rather than "slice to the next export", because the doc comment above the next
 * handler sits between the two and talking about a rule is not the same as applying it - slicing
 * to the next declaration pulls that prose in and the assertion below reads it as code.
 */
function handlerBody(source: string, name: "GET" | "POST"): string {
  const at = source.indexOf(`export async function ${name}(`);
  assert.ok(at >= 0, `no ${name} handler found`);
  const open = source.indexOf("{", source.indexOf(")", at));
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  throw new Error(`unbalanced braces in ${name}`);
}

const ROUTES = [
  "app/api/improvements/[id]/recording/route.ts",
  "app/api/improvements/[id]/attachments/[attachmentId]/route.ts",
];

/** A viewer shaped like `requireSession()` returns, with no capability overrides. */
function sessionAs(role: AppRole, userId: string): MediaViewer {
  return { role, capabilities: {}, user: { id: userId } };
}

const MEDIA = { reporterId: "reporter-1", uploadedById: "reporter-1" };

describe("canReadImprovementMedia", () => {
  test("the founder and the developer can read it - they act on the report", () => {
    assert.ok(canReadImprovementMedia(sessionAs("ADMIN", "founder"), MEDIA));
  });

  test("THE HEAD COACH CAN READ IT - the regression this module was created for", () => {
    /**
     * Not a preference: a head coach holds the `improvements` section and sees the whole queue,
     * so a report whose recording and attachments 403 for them is a half-rendered screen. The
     * decision not to narrow the section instead is recorded in `lib/sections.ts`, knowing that
     * a recording of a money screen shows figures `finance`/`cash`/`pipeline` withhold from HEAD.
     */
    assert.ok(canReadImprovementMedia(sessionAs("HEAD", "head-coach"), MEDIA));
  });

  test("the reporter can read their own account of what happened", () => {
    assert.ok(canReadImprovementMedia(sessionAs("STUDENT", "reporter-1"), MEDIA));
    assert.ok(canReadImprovementMedia(sessionAs("TUTOR", "reporter-1"), MEDIA));
  });

  test("whoever uploaded it can read it, even if the report has been reassigned", () => {
    assert.ok(
      canReadImprovementMedia(sessionAs("USER", "uploader-9"), {
        reporterId: "somebody-else",
        uploadedById: "uploader-9",
      }),
    );
  });

  test("nobody else can, whatever their role", () => {
    // The point of the rule. A coach or a telecaller who happens to know a report id gets
    // nothing, and neither does a student who is not the reporter.
    for (const role of ["USER", "STUDENT", "TUTOR", "COACH"] as const) {
      assert.equal(
        canReadImprovementMedia(sessionAs(role, "unrelated-person"), MEDIA),
        false,
        `${role} should not read somebody else's media`,
      );
    }
  });
});

describe("no route re-derives the rule", () => {
  test("both media routes call canReadImprovementMedia", () => {
    for (const route of ROUTES) {
      const source = read(route);
      assert.match(
        source,
        /canReadImprovementMedia\(/,
        `${route} must defer to the shared rule`,
      );
    }
  });

  test("no route spells out its own capability check for reading media", () => {
    /**
     * The sabotage this catches: adding a fourth condition to a hand-written list in one route
     * and not the other, which is precisely how HEAD went missing from one of them. A route that
     * mentions `improvements.triage` itself has started keeping its own copy of the rule.
     */
    for (const route of ROUTES) {
      // Only inside the GET half - the POST handlers legitimately gate writes themselves.
      assert.doesNotMatch(
        handlerBody(read(route), "GET"),
        /hasCapability\s*\(/,
        `${route} reads media behind its own hasCapability call instead of the shared rule`,
      );
    }
  });

  test("writing media stays reporter-only, and is NOT behind the read rule", () => {
    /**
     * The read rule was widened to the head coach; the WRITE rule must not follow it. A report's
     * evidence is the reporter's own account, and a triager with something to add has
     * `ImprovementEvent` comments. Both POST handlers compare against `reporterId` directly.
     */
    for (const route of [
      "app/api/improvements/[id]/recording/route.ts",
      "app/api/improvements/[id]/attachments/route.ts",
    ]) {
      const post = handlerBody(read(route), "POST");
      assert.match(
        post,
        /reporterId !== session\.user\.id/,
        `${route} must refuse an upload from anybody but the reporter`,
      );
      assert.doesNotMatch(
        post,
        /canReadImprovementMedia/,
        `${route} must not let the READ rule authorise an upload`,
      );
    }
  });
});

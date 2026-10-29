import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { improvementRef } from "../improvement-ref";

/**
 * THE FENCES ROUND THE IMPROVEMENT ACTIONS.
 *
 * Three properties, each of which has already gone wrong somewhere in this codebase:
 *
 *  1. FILING IS UNGATED AND EVERYTHING ELSE IS NOT. The asymmetry is the design - a student or a
 *     tutor is the person most likely to hit a dead end and the least likely to have another way
 *     of telling anybody, so gating the Report button silences exactly the reports worth having.
 *     Deciding what happens to a report is a different job. Both halves of that are easy to get
 *     wrong later by copying the wrong neighbouring function, so both are pinned.
 *
 *  2. EVERY EXPORT IS `async`. `tsc` does not catch a non-async export in a `"use server"`
 *     module; only `next build` does, at the very end of a long build. The 24 Oct audit had to be
 *     run as a source scan for this exact reason, and found the same class of fault in three
 *     modules.
 *
 *  3. THE DIGEST RIDES THE EXISTING DAILY TICK. A cron route of its own would need a crontab
 *     entry AND a `STALE_AFTER_MINUTES` row, and `cron-stale-thresholds.test.ts` exists because
 *     the `agreements` job shipped without the second one and read STALE for 21 hours a day while
 *     working perfectly.
 *
 * A source scan, like the audits in docs/refactor/CHANGELOG.md §12 - there is no way to ask a
 * compiled server action which guard it called.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..", "..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");

const ACTIONS = "server/improvement-actions.ts";

/** Each exported function in a `"use server"` module, with its body. */
function exportedFunctions(source: string): { name: string; declaration: string; body: string }[] {
  const out: { name: string; declaration: string; body: string }[] = [];
  const re = /export\s+(async\s+)?function\s+([A-Za-z0-9_]+)\s*\(/g;
  const starts = [...source.matchAll(re)];
  for (let i = 0; i < starts.length; i++) {
    const at = starts[i].index!;
    const end = i + 1 < starts.length ? starts[i + 1].index! : source.length;
    out.push({
      name: starts[i][2],
      declaration: starts[i][0],
      body: source.slice(at, end),
    });
  }
  return out;
}

describe("improvement actions - who may do what", () => {
  test("the module really is a server-action module", () => {
    assert.match(read(ACTIONS).slice(0, 40), /"use server"/);
  });

  test("every exported action is async", () => {
    const notAsync = exportedFunctions(read(ACTIONS))
      .filter((f) => !f.declaration.includes("async"))
      .map((f) => f.name);
    assert.deepEqual(
      notAsync,
      [],
      `a "use server" export must be async or next build fails at the very end: ${notAsync.join(", ")}`,
    );
  });

  test("filing a report establishes a caller but needs no capability", () => {
    const submit = exportedFunctions(read(ACTIONS)).find((f) => f.name === "submitImprovement");
    assert.ok(submit, "submitImprovement is gone");
    assert.match(
      submit.body,
      /requireSession\(\)/,
      "submitImprovement must still establish who is reporting - the reporter is never taken from the payload",
    );
    assert.doesNotMatch(
      submit.body,
      /capabilityCheck|requireCapability|requireAdmin/,
      "filing a report has been gated behind a permission - that silences the people most likely to hit a dead end",
    );
  });

  test("it is rate limited, because it is the one write every role can make", () => {
    const submit = exportedFunctions(read(ACTIONS)).find((f) => f.name === "submitImprovement")!;
    assert.match(submit.body, /takeToken/, "submitImprovement has no brake at all");
  });

  test("every action other than filing is behind improvements.triage", () => {
    const ungated = exportedFunctions(read(ACTIONS))
      .filter((f) => f.name !== "submitImprovement")
      .filter((f) => !/capabilityCheck\("improvements\.triage"\)/.test(f.body))
      .map((f) => f.name);
    assert.deepEqual(
      ungated,
      [],
      `these decide what happens to a report and establish no permission: ${ungated.join(", ")}`,
    );
  });

  /**
   * A list read must not see archived rows, and this module reads reports in five places. The
   * rule is spread by hand across every query in this codebase (no Prisma middleware, by house
   * style), which is precisely why it needs a guard - the paid-so-far test exists for the same
   * reason, after two call sites disagreed about whether a student had paid.
   */
  test("every report this module reads is filtered to active", () => {
    const source = read(ACTIONS);
    const reads = [...source.matchAll(/prisma\.improvement\.find(?:First|Many)\(\{[\s\S]{0,200}?\}\)/g)];
    assert.ok(reads.length > 0, "no report reads found - has the module been restructured?");
    for (const r of reads) {
      assert.match(
        r[0],
        /\.\.\.ACTIVE|deletedAt/,
        `a report read with no archive filter: ${r[0].slice(0, 90)}…`,
      );
    }
  });

  test("a report is archived, never deleted", () => {
    const source = read(ACTIONS);
    assert.doesNotMatch(
      source,
      /prisma\.improvement\.delete/,
      "a declined report is the most valuable row in this table six months later - archive it",
    );
    assert.match(read("server/improvement-actions.ts"), /deletedAt: new Date\(\)/);
  });
});

describe("the reference", () => {
  test("is zero-padded to four digits and keeps sorting past them", () => {
    assert.equal(improvementRef(1), "IMP-0001");
    assert.equal(improvementRef(42), "IMP-0042");
    assert.equal(improvementRef(9999), "IMP-9999");
    // Deliberately widens rather than throwing: unlike an invoice number there is no legal
    // format here, and a counter that throws when it fills would refuse reports.
    assert.equal(improvementRef(10000), "IMP-10000");
  });

  test("is drawn inside the caller's transaction, so two reporters cannot collide", () => {
    const source = read("server/improvement-ref.ts");
    assert.match(source, /TransactionClient/, "the ref must be drawn inside the report's transaction");
    assert.match(source, /ON CONFLICT/, "the counter must be a single row-locked upsert, not max\\(\\)+1");
    assert.match(read("server/improvement-actions.ts"), /\$transaction\(async \(tx\) => \{[\s\S]{0,200}nextImprovementRef\(tx\)/);
  });
});

describe("the digest does not bring its own clock", () => {
  test("no cron route was added for it", () => {
    const cronDir = path.join(root, "app", "api", "cron");
    const jobs = fs.readdirSync(cronDir, { withFileTypes: true }).filter((e) => e.isDirectory());
    const added = jobs.filter((j) => /improvement/i.test(j.name)).map((j) => j.name);
    assert.deepEqual(
      added,
      [],
      `a new cron job needs a crontab entry AND a STALE_AFTER_MINUTES row (see cron-stale-thresholds.test.ts): ${added.join(", ")}`,
    );
  });

  test("it runs from the existing daily maintenance, inside its failure guard", () => {
    const source = read("server/daily-maintenance.ts");
    assert.match(
      source,
      /safe\("improvementDigest", runImprovementDigest\)/,
      "the digest must run inside `safe`, or a mailer outage fails the tick that also runs the overdue sweep",
    );
  });

  test("it is self-guarded to once a day, and moves its cursor only on a real send", () => {
    const source = read("server/improvement-digest.ts");
    assert.match(source, /istToday\(\)/, "an hourly tick would mail the digest every hour");
    // The day marker is stamped either way; the cursor is what must not move on a failure, or
    // the reports in that window are lost from every future digest.
    const afterFailure = source.slice(source.indexOf("if (!outcome.sent)"));
    assert.match(afterFailure, /CURSOR_KEY/, "the cursor is never advanced after a successful send");
    // Only an UPSERT of the cursor is forbidden here; reading it to work out the window is
    // exactly what this half of the function is for.
    const beforeFailure = source.slice(0, source.indexOf("if (!outcome.sent)"));
    assert.doesNotMatch(
      beforeFailure,
      /upsert\(\{\s*where: \{ key: CURSOR_KEY \}/,
      "the cursor moves before the send is known to have worked, so a paused mailer loses those reports",
    );
  });
});

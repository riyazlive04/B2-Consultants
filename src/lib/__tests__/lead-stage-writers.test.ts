import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * ONE DEAL, TWO STATUS FIELDS — the invariant that keeps them in step (P4).
 *
 * `Lead.stage` and `Opportunity.stageId` are two records of one thing, reconciled in application
 * code rather than by the database. Any site that writes the stage therefore has to do THREE
 * things, and doing two of them is a silent data bug:
 *
 *   1. update `Lead.stage`
 *   2. write a `LeadStageHistory` row — the pipeline's stage metrics read HISTORY, not the current
 *      column, so a stage change with no history row is invisible to every report that matters
 *   3. move the card on the Opportunity board
 *
 * ── Why this is a test and not a code change ────────────────────────────────────────────
 * Fifteen of the seventeen sites did all three correctly. Two did not, and they were the same bug
 * twice: `booking-automation.ts` and `outreach.ts` released an unconfirmed booking, sent the lead
 * back to `DISCO_NOT_BOOKED`, and left the card sitting in "Discovery Call Booked" claiming a call
 * that had just been cancelled. Both files even carried a comment about fixing exactly that
 * failure for the stage column, without carrying it through to the board.
 *
 * Both now go through `writeLeadStage`, which does all three in one place. The remaining sites are
 * each correct, and rewriting eleven live modules for no behaviour change would be a worse trade
 * than this: **a new site that forgets is now a failing test rather than a report three weeks
 * later that "the opportunity board is wrong".** New code should use `writeLeadStage`.
 *
 * It is a source scan because the thing being checked is a code-level obligation, not a runtime
 * one — there is no value to assert at runtime, only a habit to enforce.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(here, "..", "..", "server");

/** The balanced `{...}` argument object starting at or after `from`. */
function objectAt(src: string, from: number): string | null {
  const open = src.indexOf("{", from);
  if (open === -1) return null;
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") {
      depth -= 1;
      if (depth === 0) return src.slice(open, i + 1);
    }
  }
  return null;
}

type Site = { file: string; line: number; op: string };

function stageWriteSites(): Site[] {
  const out: Site[] = [];
  for (const name of fs.readdirSync(SERVER)) {
    if (!name.endsWith(".ts")) continue;
    const src = fs.readFileSync(path.join(SERVER, name), "utf8");
    const re = /\b(?:prisma|tx|db)\.lead\.(update|updateMany|upsert|create)\s*\(/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) {
      const arg = objectAt(src, m.index);
      if (!arg || !/\bstage\s*:/.test(arg)) continue;
      out.push({ file: name, line: src.slice(0, m.index).split("\n").length, op: m[1] });
    }
  }
  return out;
}

const SITES = stageWriteSites();
const FILES = [...new Set(SITES.map((s) => s.file))].sort();

/** The seam. The only module that is ALLOWED to be the one doing the three things by hand. */
const SEAM = "lead-stage-auto.ts";

describe("Lead.stage writers - the board cannot be left behind", () => {
  test("there is at least one write site, so a broken scan cannot pass silently", () => {
    // A regex that stopped matching would otherwise make every test below vacuously true.
    assert.ok(SITES.length > 5, `only found ${SITES.length} stage writes - the scan is broken`);
  });

  test("every file that writes a stage also files the lead on the board", () => {
    /*
      Two spellings count, and they are different jobs:
        · `syncDefaultOpportunity` MOVES an existing card to the column for the new stage
        · `ensureDefaultOpportunity` CREATES the card if the lead has none — which is what a
          creation path needs, and is idempotent so it is safe on a returning lead
      A file doing neither has a stage change the board never hears about.
    */
    const offenders = FILES.filter((f) => {
      const src = fs.readFileSync(path.join(SERVER, f), "utf8");
      return !/(sync|ensure)DefaultOpportunity|writeLeadStage/.test(src);
    });
    assert.deepEqual(
      offenders,
      [],
      `these write Lead.stage and never touch the Opportunity board: ${offenders.join(", ")} - ` +
        `use writeLeadStage() from server/lead-stage-auto.ts`,
    );
  });

  test("every file that writes a stage also writes its history", () => {
    const offenders = FILES.filter((f) => {
      const src = fs.readFileSync(path.join(SERVER, f), "utf8");
      return !/leadStageHistory\.create|writeLeadStage/.test(src);
    });
    assert.deepEqual(
      offenders,
      [],
      `these write Lead.stage with no LeadStageHistory row, so the change is invisible to the ` +
        `pipeline's own metrics: ${offenders.join(", ")}`,
    );
  });

  /**
   * The two sites that were wrong are named here so the regression has a test of its own rather
   * than only being covered by the general rule above. Both released an unconfirmed booking.
   */
  test("releasing an unconfirmed booking moves the card, in both places that do it", () => {
    for (const f of ["booking-automation.ts", "outreach.ts"]) {
      const src = fs.readFileSync(path.join(SERVER, f), "utf8");
      const at = src.indexOf('to: "DISCO_NOT_BOOKED"');
      assert.notEqual(at, -1, `${f} no longer sends a released booking back to DISCO_NOT_BOOKED`);
      // It must be an argument to the seam, not a hand-rolled update.
      const call = src.lastIndexOf("writeLeadStage", at);
      assert.ok(
        call !== -1 && at - call < 200,
        `${f} sets DISCO_NOT_BOOKED without going through writeLeadStage - the card will be left behind`,
      );
    }
  });

  /**
   * A ratchet on the hand-rolled sites, not on the total. It may only ever SHRINK: a new stage
   * write should use the seam, and this list is the record of the ones that predate it.
   */
  const HAND_ROLLED = [
    "automation.ts",
    "booking-actions.ts",
    "call-log-actions.ts",
    "contacts-actions.ts",
    "discovery-routing.ts",
    "lead-intake.ts",
    "offline-call-sync.ts",
    "opportunities-actions.ts",
    "pipeline-actions.ts",
  ];

  test("the files writing a stage by hand are exactly the known list", () => {
    const byHand = FILES.filter((f) => f !== SEAM).sort();
    assert.deepEqual(
      byHand,
      HAND_ROLLED,
      "a new module writes Lead.stage by hand - use writeLeadStage(), and shrink this list when " +
        "you convert an old one",
    );
  });
});

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * THE TWO RULES THE ARCHIVE PURGE HAD TO LEARN.
 *
 * ── 1. An issued invoice is never destroyed ─────────────────────────────────────────────
 * `purgeInvoice` refuses to hard-delete one by hand: it is a tax record (8 years in Germany) and
 * its number must never come free. `runRetentionPurge` deleted the very same rows 90 days later
 * without a word - so the archive was simultaneously the place you were told to leave an issued
 * invoice and the one place it was guaranteed to be destroyed from. The hand rule held only for
 * as long as nobody waited.
 *
 * ── 2. The founder's pruning switch governs it ──────────────────────────────────────────
 * This is the most destructive job in the app (archived leads, invoices, income and expenses,
 * cascades included) and it was the only one with no switch, while the far gentler growth-table
 * sweep beside it was gated. The Console showed one "Prune aged data (deletes)" toggle, off, over
 * a job that deleted the archive anyway.
 *
 * ── Why this test reads source ──────────────────────────────────────────────────────────
 * Both defects are in a QUERY and a guard clause, not in a calculation - there is no pure
 * function left to assert against. The repo already takes this approach where the mistake lives
 * in a statement rather than a value; see `paid-so-far-excludes-archived.test.ts`.
 */

const retention = fs.readFileSync(
  path.join(process.cwd(), "src", "server", "retention.ts"),
  "utf8",
);

/** The body of `runRetentionPurge`, so a rule in a NEIGHBOURING function cannot satisfy these. */
function purgeBody(): string {
  const start = retention.indexOf("export async function runRetentionPurge");
  assert.ok(start >= 0, "runRetentionPurge is gone - the purge guards need revisiting");
  const next = retention.indexOf("\nexport ", start + 1);
  return retention.slice(start, next === -1 ? undefined : next);
}

describe("the archive purge keeps what the law keeps", () => {
  test("it excludes issued invoices from the delete", () => {
    const body = purgeBody();
    assert.match(
      body,
      /issuedAt:\s*\{\s*not:\s*null\s*\}/,
      "the purge no longer mentions issuedAt - an issued invoice is a tax record and must be excluded",
    );
    assert.match(
      body,
      /NOT:/,
      "the issued-invoice exclusion is gone from the invoice query",
    );
  });

  test("the hand-delete still refuses one too, so the two agree", () => {
    const payments = fs.readFileSync(
      path.join(process.cwd(), "src", "server", "payments-actions.ts"),
      "utf8",
    );
    assert.match(
      payments,
      /existing\.kind === "INVOICE" && existing\.issuedAt/,
      "purgeInvoice no longer refuses an issued invoice - the purge was matched to this rule",
    );
  });
});

describe("the archive purge is switched off by default, like every other delete", () => {
  test("it reads the founder's pruning flag before deleting anything", () => {
    const body = purgeBody();
    assert.match(
      body,
      /getMaintenanceConfig\(\)/,
      "the purge no longer reads the maintenance config",
    );
    assert.match(
      body,
      /cfg\.retention\.enabled/,
      "the purge no longer honours the Console's pruning toggle",
    );
  });

  test("the flag is checked BEFORE the first delete, not after", () => {
    const body = purgeBody();
    const gate = body.indexOf("cfg.retention.enabled");
    const firstDelete = Math.min(
      ...[body.indexOf(".delete("), body.indexOf(".deleteMany(")].filter((i) => i >= 0),
    );
    assert.ok(gate >= 0 && firstDelete > gate, "something is deleted before the switch is read");
  });

  test("the same flag gates the growth-table sweep, so one switch means one thing", () => {
    assert.match(
      retention,
      /runRetentionSweep/,
      "the sweep is gone - check which flag the purge should now follow",
    );
    // Two readers of one flag is the point: a founder reading "Prune aged data" should not have
    // to know there are two jobs behind it.
    const readers = retention.match(/retention\.enabled/g) ?? [];
    assert.ok(readers.length >= 2, "only one job reads the pruning flag");
  });
});

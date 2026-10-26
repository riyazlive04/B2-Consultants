import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * "WHAT HAS THIS STUDENT PAID" HAS TO EXCLUDE ARCHIVED INCOME, EVERYWHERE IT IS ASKED.
 *
 * ── The bug ────────────────────────────────────────────────────────────────────────────
 * `book-order-actions` summed every Income row carrying a student's id, archived ones included.
 * A payment deleted as a mis-entry or a reversal therefore still counted as money received, so
 * `createBookOrder` would ship books against it and `releaseDeferredBookOrders` would quietly
 * un-defer an order on it.
 *
 * It was a bug rather than a choice, and the proof was in the same feature: `book-order-metrics`
 * spreads `ACTIVE` into the identical sum, so the panel displayed one figure while the decision
 * beside it used another. Confirmed on 24/10/2026 by archiving a student's ₹99,500 of income and
 * raising an order - which released, while the panel read ₹0.
 *
 * ── Why this test reads source ──────────────────────────────────────────────────────────
 * The defect was in a QUERY, not in a calculation: `decideBookOrder`'s arithmetic was always
 * right and is tested on its own. There is nothing pure left to assert, and the repo already
 * takes this approach where the mistake lives in a statement rather than a value (see
 * `fx-missing-rate.test.ts`, which reads the seed file).
 *
 * Deliberately a general guard, not a check on the two sites that were wrong: a third place that
 * asks this question is exactly how the first two came to disagree.
 */

const SERVER = path.join(process.cwd(), "src", "server");

/** Files that total `Income` with an explicit `studentId`, with the call's arguments. */
function studentIncomeSums(): { file: string; call: string }[] {
  const out: { file: string; call: string }[] = [];
  for (const name of fs.readdirSync(SERVER)) {
    if (!name.endsWith(".ts")) continue;
    const src = fs.readFileSync(path.join(SERVER, name), "utf8");
    for (const m of src.matchAll(/\b(?:prisma|tx|db)\.income\.(?:aggregate|groupBy)\s*\(/g)) {
      // Balanced-paren slice from the opening bracket.
      const open = m.index + m[0].length - 1;
      let depth = 0;
      let call = "";
      for (let i = open; i < src.length; i += 1) {
        if (src[i] === "(") depth += 1;
        else if (src[i] === ")") {
          depth -= 1;
          if (depth === 0) {
            call = src.slice(open, i + 1);
            break;
          }
        }
      }
      if (!/\bstudentId\b/.test(call)) continue; // not a per-student figure
      if (!/amountInrMinor/.test(call)) continue; // not a money total
      out.push({ file: name, call });
    }
  }
  return out;
}

describe("a student's paid-so-far", () => {
  test("is asked somewhere, so this guard is pointed at something", () => {
    assert.ok(
      studentIncomeSums().length > 0,
      "no per-student Income total found - these moved, and this test needs re-pointing",
    );
  });

  test("never counts archived payments, at any call site", () => {
    const offenders = studentIncomeSums()
      .filter(({ call }) => !/deletedAt|\.\.\.\s*(?:ACTIVE|INCOME_COUNTABLE)\b|where:\s*(?:ACTIVE|INCOME_COUNTABLE)\b/.test(call))
      .map(({ file, call }) => `${file}: ${call.replace(/\s+/g, " ").slice(0, 120)}`);

    assert.deepEqual(
      offenders,
      [],
      `these sum archived income into what a student has paid:\n  ${offenders.join("\n  ")}`,
    );
  });

  /**
   * ── THE SECOND WAY A PAYMENT STOPS BEING MONEY  (issue C2) ──────────────────────────────
   *
   * `reversedAt` is new, and it is the column that catches the case there was previously no way
   * to record: the payment was entered correctly and then the money went away again - a bounced
   * cheque, a reversed UPI, a recalled transfer. With no payment processor in this app, every
   * income row is a human recording a claim about a bank, so this is routine rather than exotic.
   *
   * What people did instead was ARCHIVE the row, which is why the guard above exists. But the
   * two are different facts and are stored separately (see `INCOME_COUNTABLE`), so a call site
   * that honours `deletedAt` and ignores `reversedAt` now counts bounced money as collected -
   * exactly the bug the first guard was written for, in a new column.
   *
   * So the same test, pointed at the new field. The fix at any site it flags is to spread
   * `INCOME_COUNTABLE` instead of `ACTIVE`, which satisfies both assertions at once.
   */
  test("never counts reversed payments, at any call site", () => {
    const offenders = studentIncomeSums()
      .filter(({ call }) => !/reversedAt|\.\.\.\s*INCOME_COUNTABLE\b|where:\s*INCOME_COUNTABLE\b/.test(call))
      .map(({ file, call }) => `${file}: ${call.replace(/\s+/g, " ").slice(0, 120)}`);

    assert.deepEqual(
      offenders,
      [],
      `these count bounced/reversed money as collected:\n  ${offenders.join("\n  ")}`,
    );
  });
});

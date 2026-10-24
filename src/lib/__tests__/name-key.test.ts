import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { nameKey, sameName } from "../name-key";

/**
 * THE KEY THAT DECIDES WHOSE MONEY IS WHOSE (P0b).
 *
 * `nameKey` was defined five times, identically, in five files - three server action modules and
 * two lib modules. Every one of them was deciding whether a payment typed as free text belongs to
 * a student record, so a change to any one copy would have split somebody's money in half with no
 * error anywhere.
 *
 * One definition now, and these tests pin both the behaviour and the fact that it is one.
 */

describe("nameKey - what counts as the same person", () => {
  test("case and surrounding whitespace do not matter", () => {
    assert.equal(nameKey("  Anita Rao "), "anita rao");
    assert.equal(nameKey("ANITA RAO"), nameKey("anita rao"));
  });

  test("runs of whitespace collapse, because a double space is a typo and not a different person", () => {
    assert.equal(nameKey("Anita   Rao"), "anita rao");
    assert.equal(nameKey("Anita\tRao"), "anita rao");
    assert.ok(sameName("Anita  Rao", "anita rao"));
  });

  test("an empty or blank name normalises to empty rather than throwing", () => {
    // It is reached with whatever was typed, and a blank payer name is a real row in this data.
    assert.equal(nameKey(""), "");
    assert.equal(nameKey("   "), "");
  });

  /**
   * The deliberate limits. Matching harder would link more - and a WRONG link quietly moves
   * somebody's money onto somebody else's record, where a missed one merely sits unattached and
   * shows up on Onboarding → Needs completing. Being wrong in the visible direction is the point.
   */
  test("it does not reorder name parts or strip punctuation", () => {
    assert.ok(!sameName("Anita Rao", "Rao, Anita"));
    assert.ok(!sameName("Anita Rao", "AnitaRao"));
  });

  test("a blank name does not match a real one", () => {
    // Guards the obvious disaster: `nameKey("") === nameKey("   ")` is true, and if a blank payer
    // row ever matched a blank-named student every unattached payment would land on them.
    assert.ok(!sameName("", "Anita Rao"));
  });
});

describe("nameKey - there is only one of it", () => {
  const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

  function filesUnder(dir: string): string[] {
    const out: string[] = [];
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) out.push(...filesUnder(p));
      else if (/\.tsx?$/.test(e.name)) out.push(p);
    }
    return out;
  }

  test("nothing defines its own copy of the rule", () => {
    const copies = filesUnder(SRC)
      .filter((f) => !f.endsWith(path.join("lib", "name-key.ts")))
      .filter((f) => /(?:const|function)\s+nameKey\s*[=(]/.test(fs.readFileSync(f, "utf8")))
      .map((f) => path.relative(SRC, f).replace(/\\/g, "/"));
    assert.deepEqual(
      copies,
      [],
      `a second definition of nameKey is back in: ${copies.join(", ")} - import it from lib/name-key.ts`,
    );
  });
});

describe("the money backfill runs from one place (P0b)", () => {
  const SERVER = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "server");
  const read = (f: string) => fs.readFileSync(path.join(SERVER, f), "utf8");

  /**
   * Six screens can create a student. Four of them backfilled the money typed under that name,
   * three of those linked INCOME only, and the fourth also linked the PENDING PAYMENT. So the
   * same person got a different amount of their own history depending on which door made them -
   * a converted lead's instalment plan stayed detached, with "paid so far" reading zero against
   * a plan they had been paying for months.
   */
  const DOORS = ["students-actions.ts", "german-note-actions.ts", "finance-actions.ts"];

  test("every creation door calls the shared backfill", () => {
    const missing = DOORS.filter((f) => !/linkOrphanMoneyToStudent\(/.test(read(f)));
    assert.deepEqual(missing, [], `these create a student without linking their money: ${missing.join(", ")}`);
  });

  test("no door still rolls its own income backfill", () => {
    const rolled = DOORS.filter((f) =>
      /income\.findMany\(\{\s*where:\s*\{\s*studentId:\s*null/.test(read(f)),
    );
    assert.deepEqual(rolled, [], `these have grown their own backfill again: ${rolled.join(", ")}`);
  });

  test("the shared backfill does both halves of the history", () => {
    const src = read("student-money-link.ts");
    assert.match(src, /income\.updateMany/, "payments are not linked");
    assert.match(src, /pendingPayment\.updateMany/, "receivables are not linked - that was the drift");
  });

  test("it only ever touches rows that belong to nobody", () => {
    const src = read("student-money-link.ts");
    // Two reads, two writes, and every one of them filtered on `studentId: null`. Re-attributing
    // a payment that already belongs to somebody is a human decision, never a backfill's.
    const guards = src.match(/studentId:\s*null/g) ?? [];
    assert.ok(
      guards.length >= 2,
      "the backfill no longer restricts itself to unattached rows - it could move somebody's money",
    );
  });
});

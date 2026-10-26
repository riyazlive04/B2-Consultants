import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * A PLAN'S PROGRAMME IS PICKED, NOT TYPED (P6).
 *
 * ── What went wrong, in real data ───────────────────────────────────────────────────────
 * `CurriculumTemplate.levelCode` is meant to hold a `Level.code`. The form offered a free-text
 * box with "GUIDED" as its placeholder, and the server validated it as
 * `z.string().trim().max(40)` - i.e. anything at all. On live, 23 Oct 2026, two of three plans
 * were filed under a programme that does not exist:
 *
 *   · "Guided"   - the catalogue code is upper-case
 *   · "Gudied30" - a typo, on a plan literally named "Guided"
 *
 * Neither could be matched to a programme by any screen that looks one up by code, and nothing in
 * the app could tell anybody. Both were corrected on 24 Oct 2026.
 *
 * ── Three layers now, and this file holds all three ─────────────────────────────────────
 *   1. the form offers a PICKER, so there is nothing to mistype
 *   2. the action re-checks against the catalogue, because a picker is a courtesy not a guard
 *   3. migration M2 puts a foreign key on the column, so the database itself refuses
 *
 * Layer 3 is the only permanent one, and it could not be applied until the data was clean. Layers
 * 1 and 2 are what stop it getting dirty again in the meantime - and they are what this tests,
 * because a source scan is what is available for a form and an action.
 */

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (p: string) => fs.readFileSync(path.join(SRC, p), "utf8");

describe("the plan form cannot produce a typo", () => {
  const form = () => read(path.join("components", "curriculum", "CurriculumPanel.tsx"));

  test("the programme field is a picker, not a text box", () => {
    const src = form();
    const field = src.slice(src.indexOf('name="levelCode"') - 600, src.indexOf('name="levelCode"') + 400);
    assert.match(field, /<Select/, "levelCode is not rendered as a Select - a text box can be mistyped");
    assert.doesNotMatch(
      field,
      /<TextInput[^>]*name="levelCode"/,
      "levelCode is back to a free-text box",
    );
  });

  test('"not decided yet" stays available, because the programme is genuinely optional', () => {
    // A plan can legitimately be drafted before anybody has decided what it teaches. Forcing a
    // choice would make somebody pick the nearest wrong answer.
    assert.match(form(), /not decided yet/i);
  });

  /**
   * The case this is here for: opening an OLD plan whose code is no longer in the catalogue, to
   * edit something unrelated, must not silently clear it. Dropping a value because it is no
   * longer offered is a decision for whoever is looking at it, not a side effect of saving.
   */
  test("a code already stored but missing from the catalogue is kept as an option", () => {
    const src = form();
    assert.match(src, /not in the catalogue/, "an unknown stored code would be silently cleared");
  });
});

describe("the plan action re-checks the programme server-side", () => {
  const action = () => read(path.join("server", "curriculum-actions.ts"));

  test("an unknown code is refused, with a sentence rather than a silent write", () => {
    const src = action();
    assert.match(src, /isKnownLevel\(/, "the action no longer validates levelCode at all");
    assert.match(
      src,
      /is not a programme in the catalogue/,
      "the refusal should name the problem and where to fix it",
    );
  });

  test("blank is still allowed, so a plan can be drafted before the programme is decided", () => {
    // `d.levelCode &&` - the guard only fires on a non-empty value.
    assert.match(action(), /if \(d\.levelCode && !\(await isKnownLevel/);
  });
});

describe("the permanent fix is written down and unblocked", () => {
  test("migration M2 exists, and says what had to happen before it could run", () => {
    const m2 = fs.readFileSync(
      path.join(SRC, "..", "docs", "refactor", "migrations", "M2_level_foreign_keys.sql"),
      "utf8",
    );
    assert.match(m2, /ON UPDATE CASCADE/, "renaming a level should propagate, not orphan rows");
    assert.match(m2, /curriculum_template_levelCode_fkey/, "the column that actually went wrong is not covered");
    // The audit query must stay in the file: it is the thing that proves the data is clean.
    assert.match(m2, /PRE-FLIGHT/);
  });
});

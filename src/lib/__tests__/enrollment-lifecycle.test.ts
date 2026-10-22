import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import {
  belongsOnRegister,
  decideDiscontinue,
  DEFAULT_DISCONTINUE_REASONS,
  DISCONTINUED_STATUS,
  ENROLLMENT_STATUSES,
  hasLeft,
  isDiscontinued,
  occupiesSeat,
  OTHER_REASON,
  SEATED_STATUSES,
  tallyReasons,
} from "../enrollment-lifecycle";

/**
 * THE ENROLMENT LIFECYCLE.
 *
 * Two kinds of test here, and the second is the important one:
 *   · the predicates, which decide who holds a seat and who is on a register;
 *   · a STRUCTURAL assertion that no finance path reads enrolment status at all. That is what
 *     makes "discontinuing is not a refund" a property of the codebase rather than a promise in
 *     a comment, and it is the single thing in this feature that could cost real money.
 */

describe("who has left", () => {
  test("DROPPED and COMPLETED have both ended; ACTIVE and PAUSED have not", () => {
    assert.equal(hasLeft("DROPPED"), true);
    assert.equal(hasLeft("COMPLETED"), true);
    assert.equal(hasLeft("ACTIVE"), false);
    // A paused student is coming back. Their seat is theirs and they stay on the register, so
    // the coach marks them EXCUSED rather than having them silently vanish from the cohort.
    assert.equal(hasLeft("PAUSED"), false);
  });

  test("only DROPPED is churn", () => {
    // `hasLeft` lumps the graduate and the leaver together for seats and registers, where they
    // behave identically. The churn breakdown must not: one is the outcome we sell.
    assert.equal(isDiscontinued("DROPPED"), true);
    assert.equal(isDiscontinued("COMPLETED"), false);
    assert.equal(DISCONTINUED_STATUS, "DROPPED");
  });

  test("a seat is held by exactly the statuses that have not ended", () => {
    for (const status of ENROLLMENT_STATUSES) {
      assert.equal(occupiesSeat(status), !hasLeft(status), status);
    }
    assert.deepEqual([...SEATED_STATUSES].sort(), ["ACTIVE", "PAUSED"]);
  });

  test("an unknown status is treated as present rather than gone", () => {
    // Fail-safe direction. A status this file has not been taught about must not silently
    // empty a register or free a seat; it shows up and somebody notices.
    assert.equal(hasLeft("SOMETHING_NEW"), false);
    assert.equal(occupiesSeat("SOMETHING_NEW"), true);
  });
});

describe("the register", () => {
  test("a departed student stays on a register they were marked on", () => {
    // A student who dropped in week six ATTENDED weeks one to five. Filtering them out would
    // remove their marks from those sheets, and the "complete" flag computed from them - which
    // rewrites the history of a class that was taught.
    assert.equal(belongsOnRegister("DROPPED", true), true);
    assert.equal(belongsOnRegister("COMPLETED", true), true);
  });

  test("a departed student comes off the registers they were never marked on", () => {
    // i.e. the future. Before this, a coach was asked every Saturday to mark a student who had
    // stopped coming, and the register could never read complete.
    assert.equal(belongsOnRegister("DROPPED", false), false);
    assert.equal(belongsOnRegister("COMPLETED", false), false);
  });

  test("a current student is on the register whether or not they have been marked", () => {
    for (const hasMark of [true, false]) {
      assert.equal(belongsOnRegister("ACTIVE", hasMark), true);
      assert.equal(belongsOnRegister("PAUSED", hasMark), true);
    }
  });
});

describe("the reason", () => {
  const vocabulary = [...DEFAULT_DISCONTINUE_REASONS];

  test("a reason is required", () => {
    // The whole point of the feature. A discontinue button with an optional reason produces a
    // churn report of nulls.
    const blank = decideDiscontinue({ reason: "   " }, vocabulary);
    assert.equal(blank.ok, false);
  });

  test("a reason on the list is stored as it stands", () => {
    const res = decideDiscontinue({ reason: "Financial difficulty", note: " spoke Friday " }, vocabulary);
    assert.ok(res.ok);
    assert.equal(res.decision.reason, "Financial difficulty");
    assert.equal(res.decision.note, "spoke Friday");
  });

  test("a reason NOT on the list is refused, not quietly stored", () => {
    // The vocabulary is editable, so a reason can legitimately disappear - but that decision is
    // taken in the Console. Accepting whatever arrives in the form field would make the
    // breakdown unaggregatable by the same back door the free-text box was built to close.
    const res = decideDiscontinue({ reason: "Vibes" }, vocabulary);
    assert.equal(res.ok, false);
  });

  test("OTHER requires the note, and the note becomes the reason", () => {
    const missing = decideDiscontinue({ reason: OTHER_REASON }, vocabulary);
    assert.equal(missing.ok, false);

    const res = decideDiscontinue({ reason: OTHER_REASON, note: "Moved to a different field" }, vocabulary);
    assert.ok(res.ok);
    assert.equal(res.decision.reason, "Moved to a different field");
    assert.notEqual(res.decision.reason, OTHER_REASON, "the sentinel must never be stored as a reason");
  });

  test("OTHER's free text is capped so one coach cannot widen the breakdown's column", () => {
    const res = decideDiscontinue({ reason: OTHER_REASON, note: "x".repeat(400) }, vocabulary);
    assert.ok(res.ok);
    assert.equal(res.decision.reason.length, 120);
  });

  test("the shipped vocabulary does not contain the OTHER sentinel", () => {
    assert.equal(DEFAULT_DISCONTINUE_REASONS.includes(OTHER_REASON), false);
  });
});

describe("the churn breakdown", () => {
  test("counts, percentages, and a stable order", () => {
    const rows = [
      { reason: "Financial difficulty" },
      { reason: "Financial difficulty" },
      { reason: "Not enough time" },
      { reason: "Found a job elsewhere" },
    ];
    const tally = tallyReasons(rows);
    assert.equal(tally[0].reason, "Financial difficulty");
    assert.equal(tally[0].count, 2);
    assert.equal(tally[0].pct, 50);
    // Equal counts sort alphabetically, so two refreshes of the same data do not reshuffle.
    assert.deepEqual(
      tally.slice(1).map((t) => t.reason),
      ["Found a job elsewhere", "Not enough time"],
    );
  });

  test("rows with no reason are counted, not dropped", () => {
    // Every enrolment dropped before this feature existed is one of these. Excluding them would
    // overstate the share of whichever reason happened to be recorded first.
    const tally = tallyReasons([{ reason: null }, { reason: null }, { reason: "Not enough time" }]);
    const unrecorded = tally.find((t) => t.reason === "Not recorded");
    assert.equal(unrecorded?.count, 2);
    assert.equal(unrecorded?.pct, 66.7);
    assert.equal(
      tally.reduce((a, t) => a + t.count, 0),
      3,
      "the counts must add back up to the rows handed in",
    );
  });

  test("a blank-but-present reason is treated as unrecorded, not as its own category", () => {
    const tally = tallyReasons([{ reason: "   " }, { reason: null }]);
    assert.equal(tally.length, 1);
    assert.equal(tally[0].count, 2);
  });

  test("no rows is an empty tally, not a divide by zero", () => {
    assert.deepEqual(tallyReasons([]), []);
  });
});

/* ────────────────────────────────────────────────────────────────────────────────────────
 * THE INVARIANT THAT GUARDS THE MONEY
 * ──────────────────────────────────────────────────────────────────────────────────────── */

const SERVER_DIR = join(process.cwd(), "src", "server");

/**
 * The finance paths, and what each one would cost if it started reading enrolment status.
 *
 * Every entry is a file that decides whether money is owed, recognised or chased. §8 of the
 * agreement is explicit that withdrawal earns no refund, so a discontinued student still owes
 * the instalments they signed for - and the reason that holds today is that none of these files
 * knows a student's enrolment status at all. They read `pending_payment.status` and `income`.
 */
const FINANCE_FILES: Record<string, string> = {
  "revenue-recognition.ts": "would stop recognising revenue the business has actually earned",
  "instalment-settlement.ts": "would leave a paid instalment unsettled, or settle one twice",
  "dunning.ts": "would stop chasing a debt that is still owed - the costliest of the three",
  "payments-metrics.ts": "would understate what is outstanding",
  "finance-posting.ts": "would post a different ledger entry depending on a coaching decision",
  "finance-autopost.ts": "would post, or not post, based on something outside Finance",
};

describe("discontinuing a student cannot touch the money", () => {
  for (const [file, cost] of Object.entries(FINANCE_FILES)) {
    test(`${file} does not read enrolment status - it ${cost}`, () => {
      const source = readFileSync(join(SERVER_DIR, file), "utf8");

      /**
       * What this looks for, and why it is a text search rather than a type.
       *
       * There is no type that can express "this file must not branch on enrolment status" -
       * `Enrollment.status` is an ordinary column and reading it typechecks perfectly. The
       * coupling would arrive as one innocuous line in a `where` clause during an unrelated
       * change, and nothing else in the toolchain would object. So the test reads the file.
       *
       * The patterns are the two shapes that coupling can take: a status filter inside an
       * `enrollment` relation filter, or a direct comparison against one of the four values.
       */
      const patterns: [RegExp, string][] = [
        [/enrollment\s*:\s*\{[^}]*status/s, "an `enrollment: { status: … }` relation filter"],
        [/prisma\.enrollment\.[a-zA-Z]+\(\s*\{[^;]*status\s*:/s, "a status filter on a direct enrolment query"],
        [/status\s*===?\s*["'](?:DROPPED|PAUSED)["']/, "a comparison against a student status"],
      ];

      for (const [pattern, what] of patterns) {
        assert.equal(
          pattern.test(source),
          false,
          `${file} now contains ${what}. Discontinuing a student must not change what they owe - see §8 of the agreement. If this coupling is genuinely intended, the decision belongs to the founders, not to a refactor.`,
        );
      }
    });
  }

  test("the list above still names real files", () => {
    // A renamed finance file would otherwise make this whole suite pass by not finding anything.
    const present = new Set(readdirSync(SERVER_DIR));
    for (const file of Object.keys(FINANCE_FILES)) {
      assert.ok(present.has(file), `${file} no longer exists - point this test at its replacement`);
    }
  });
});

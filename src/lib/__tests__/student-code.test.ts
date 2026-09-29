import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatStudentCode, nextStudentNumber, normalizeStudentCode, parseStudentCode } from "../student-code";

/**
 * The student number is now hand-editable, so `normalizeStudentCode` is what decides whether two
 * people typing the same identifier get the same student. It is three characters of regex doing
 * data-integrity work, which is exactly the kind of thing that is wrong twice before anyone
 * notices - the first draft of it stripped every letter S.
 */
describe("normalizeStudentCode", () => {
  it("folds the ways a human types the same code", () => {
    assert.equal(normalizeStudentCode("b2-0042"), "B2-0042");
    assert.equal(normalizeStudentCode("  B2-0042  "), "B2-0042");
    assert.equal(normalizeStudentCode("B2 - 0042"), "B2-0042");
  });

  it("keeps letters that a whitespace class must not eat", () => {
    // The bug this pins: /s+/ instead of /\s+/ silently deleted every S.
    assert.equal(normalizeStudentCode("SAP-STUDENT-7"), "SAP-STUDENT-7");
    assert.equal(normalizeStudentCode("s"), "S");
  });

  it("treats blank as no code rather than an empty one", () => {
    // `code` is nullable and unique - storing "" would make the SECOND blank student collide.
    assert.equal(normalizeStudentCode(""), null);
    assert.equal(normalizeStudentCode("   "), null);
    assert.equal(normalizeStudentCode(null), null);
    assert.equal(normalizeStudentCode(undefined), null);
  });

  it("leaves a foreign code in its own shape", () => {
    // Deliberately not reformatted into B2-nnnn: it may be the id another system prints.
    assert.equal(normalizeStudentCode("ext/9912.a"), "EXT/9912.A");
  });
});

describe("the generator still ignores hand-edited codes", () => {
  it("skips anything outside B2-nnnn when picking the next number", () => {
    assert.equal(parseStudentCode("EXT/9912.A"), null);
    // A custom code must not be able to push the counter somewhere absurd.
    assert.equal(nextStudentNumber(["B2-0007", "EXT/9912.A", null]), 8);
  });

  it("round-trips its own format", () => {
    assert.equal(parseStudentCode(formatStudentCode(42)), 42);
  });
});

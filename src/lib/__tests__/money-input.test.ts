import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { caretAfterFormat, toCanonicalMoney, toDisplayMoney } from "../money-input";
import { majorStringToMinor } from "../format";

/**
 * The guarantee these tests exist for: WHAT IS TYPED AND WHAT IS STORED ARE THE SAME NUMBER.
 *
 * A euro amount groups with dots and `majorStringToMinor` reads a dot as a decimal point, so
 * "125.000,50" parsed as-is is €125 - four orders of magnitude out, silently, in the ledger.
 * The display string therefore never reaches a server action; these functions are the pair that
 * convert between what the box shows and what the hidden input submits, and they have to be
 * exact inverses.
 */

describe("toDisplayMoney - grouping follows the currency", () => {
  it("groups rupees the Indian way, with a dot decimal", () => {
    assert.equal(toDisplayMoney("125000.50", "INR"), "1,25,000.50");
    assert.equal(toDisplayMoney("1000", "INR"), "1,000");
    assert.equal(toDisplayMoney("10000000", "INR"), "1,00,00,000");
  });

  it("groups euros the German way, with a comma decimal", () => {
    assert.equal(toDisplayMoney("125000.50", "EUR"), "125.000,50");
    assert.equal(toDisplayMoney("1000", "EUR"), "1.000");
    assert.equal(toDisplayMoney("999", "EUR"), "999");
  });

  it("leaves an empty value empty - absence is not zero", () => {
    assert.equal(toDisplayMoney("", "INR"), "");
    assert.equal(toDisplayMoney("", "EUR"), "");
  });

  it("does not pad decimals, so the caret is never pushed past them mid-typing", () => {
    assert.equal(toDisplayMoney("125.5", "INR"), "125.5");
    assert.equal(toDisplayMoney("125.", "INR"), "125.");
    assert.equal(toDisplayMoney("125.", "EUR"), "125,");
  });
});

describe("toCanonicalMoney - everything a person can type", () => {
  it("strips the grouping of its own currency", () => {
    assert.equal(toCanonicalMoney("1,25,000.50", "INR"), "125000.50");
    assert.equal(toCanonicalMoney("125.000,50", "EUR"), "125000.50");
  });

  it("strips a pasted currency symbol and spaces", () => {
    assert.equal(toCanonicalMoney("₹1,25,000.50", "INR"), "125000.50");
    assert.equal(toCanonicalMoney("125.000,50 €", "EUR"), "125000.50");
  });

  /**
   * The case that costs money. A euro figure pasted from a spreadsheet in the ENGLISH
   * convention has a dot followed by two digits and no comma - that is a decimal point, and
   * reading it as this currency's grouping would turn €125,000.50 into €12,500,050.
   */
  it("reads a foreign decimal mark as a decimal when it cannot be grouping", () => {
    assert.equal(toCanonicalMoney("125000.50", "EUR"), "125000.50");
    assert.equal(toCanonicalMoney("125000,50", "INR"), "125000.50");
  });

  it("reads a foreign mark as GROUPING when the digit run says so", () => {
    // Three trailing digits in a repeated pattern is thousands separation, not a decimal.
    assert.equal(toCanonicalMoney("125.000", "EUR"), "125000");
    assert.equal(toCanonicalMoney("1,25,000", "INR"), "125000");
  });

  it("keeps at most two decimals", () => {
    assert.equal(toCanonicalMoney("100.999", "INR"), "100.99");
  });

  it("returns absence, not zero, for a box with no digits", () => {
    assert.equal(toCanonicalMoney("", "INR"), "");
    assert.equal(toCanonicalMoney("₹", "INR"), "");
    assert.equal(toCanonicalMoney("abc", "EUR"), "");
  });

  it("survives a lone separator being typed", () => {
    assert.equal(toCanonicalMoney(".", "INR"), "");
    assert.equal(toCanonicalMoney(",", "EUR"), "");
  });
});

describe("display and canonical are exact inverses", () => {
  const cases = ["125000.50", "1000", "0.99", "10000000", "7.05", "999999999.99"];
  for (const canonical of cases) {
    it(`round-trips ${canonical} in both currencies`, () => {
      for (const ccy of ["INR", "EUR"] as const) {
        const shown = toDisplayMoney(canonical, ccy);
        assert.equal(toCanonicalMoney(shown, ccy), canonical, `${ccy}: ${shown}`);
      }
    });
  }

  /**
   * The end-to-end property: whatever the box SHOWS, the minor-unit value the server computes
   * from the canonical string is the amount the person meant. This is the assertion that would
   * have caught a euro figure being stored 1000× too small.
   */
  it("reaches the right minor units from a grouped euro display", () => {
    const shown = toDisplayMoney("125000.50", "EUR");
    assert.equal(shown, "125.000,50");
    assert.equal(majorStringToMinor(toCanonicalMoney(shown, "EUR")), BigInt(12500050));
    // And the trap it avoids: the display string parsed directly is four orders out.
    assert.equal(majorStringToMinor(shown), BigInt(12500));
  });
});

describe("caretAfterFormat - editing the middle of a grouped number", () => {
  it("keeps the caret after the digit just typed, not at the end", () => {
    // "1,25,000" with the caret after the "5" (index 4) regroups to the same string.
    const pos = caretAfterFormat("1,25,000", 4, "1,25,000", "INR");
    assert.equal(pos, 4);
  });

  it("moves past a separator that appeared to the left of the caret", () => {
    // Typed "1000" (caret at 4) -> shown "1,000": the caret belongs at the end, index 5.
    assert.equal(caretAfterFormat("1,000", 4, "1000", "INR"), 5);
  });

  it("never runs past the end of the string", () => {
    assert.equal(caretAfterFormat("999", 99, "999", "EUR"), 3);
  });
});

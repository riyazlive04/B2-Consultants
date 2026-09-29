import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  BOOK_ORDER_VARS,
  bookOrderBodySummary,
  buildBookOrderVars,
  formatBookOrderRef,
  nextBookOrderRef,
  parseBookOrderRefSeq,
} from "../book-order-message";
import { WHATSAPP_AVAILABLE_VARS } from "../whatsapp";

/**
 * The book-order template is the only one in the app addressed to a SUPPLIER rather than to the
 * person the record is about. Two things therefore matter more here than in any other touchpoint:
 * that the variable list matches the approved template exactly, and that a missing value refuses
 * to send rather than shipping "Ship to: " to a publisher.
 */

const COMPLETE = {
  publisherName: "Sharma Book House",
  orderRef: "BO-2026-0087",
  levelLabel: "German A1",
  studentName: "Priya Sharma",
  shipTo: "12 MG Road, Indiranagar, Bengaluru 560038",
  shipPhone: "+91 98450 12345",
};

describe("the variable list is the contract with the approved template", () => {
  test("matches WHATSAPP_AVAILABLE_VARS.BOOK_ORDER exactly", () => {
    // These drifting apart is precisely what produces "template expects {{ship_to}}, which this
    // touchpoint cannot supply" at send time - after the button has been pressed.
    assert.deepEqual([...BOOK_ORDER_VARS], [...WHATSAPP_AVAILABLE_VARS.BOOK_ORDER]);
  });

  test("declares the six fields WATI was given, in submission order", () => {
    assert.deepEqual(
      [...BOOK_ORDER_VARS],
      ["publisher_name", "order_ref", "level", "student_name", "ship_to", "ship_phone"],
    );
  });

  test("carries NO `name` variable - the recipient is not the subject", () => {
    // Every other touchpoint addresses the reader as the person the record is about. Adding
    // `name` here would invite exactly that mistake.
    assert.ok(!(BOOK_ORDER_VARS as readonly string[]).includes("name"));
  });
});

describe("order references", () => {
  test("formats as BO-YEAR-NNNN, zero padded", () => {
    assert.equal(formatBookOrderRef(2026, 87), "BO-2026-0087");
    assert.equal(formatBookOrderRef(2026, 1), "BO-2026-0001");
  });

  test("keeps its shape past four digits rather than truncating", () => {
    assert.equal(formatBookOrderRef(2026, 12345), "BO-2026-12345");
  });

  test("parses its own output", () => {
    assert.equal(parseBookOrderRefSeq("BO-2026-0087", 2026), 87);
  });

  test("a ref from another year is not this year's sequence", () => {
    assert.equal(parseBookOrderRefSeq("BO-2025-0087", 2026), null);
  });

  test("anything unparseable is null, never NaN", () => {
    // A NaN leaking into the allocator would compare false against every max and hand out a
    // duplicate number.
    for (const junk of ["", "BO-2026-", "BO-2026-abc", "nonsense", "BO-2026-0087-x"]) {
      assert.equal(parseBookOrderRefSeq(junk, 2026), null, junk);
    }
  });

  test("the first order of a year is 0001", () => {
    assert.equal(nextBookOrderRef([], 2026), "BO-2026-0001");
  });

  test("takes the next number after the highest, regardless of order", () => {
    assert.equal(nextBookOrderRef(["BO-2026-0003", "BO-2026-0001", "BO-2026-0002"], 2026), "BO-2026-0004");
  });

  test("gaps are NOT reused - a cancelled order does not hand its number on", () => {
    assert.equal(nextBookOrderRef(["BO-2026-0001", "BO-2026-0009"], 2026), "BO-2026-0010");
  });

  test("last year's refs don't hold this year's numbering back", () => {
    assert.equal(nextBookOrderRef(["BO-2025-0500"], 2026), "BO-2026-0001");
  });

  test("junk in the column cannot derail the allocator", () => {
    assert.equal(nextBookOrderRef(["", "legacy-ref", "BO-2026-0002"], 2026), "BO-2026-0003");
  });
});

describe("building the message variables", () => {
  test("a complete order yields all six values", () => {
    const res = buildBookOrderVars(COMPLETE);
    assert.ok(res.ok);
    assert.deepEqual(res.vars, {
      publisher_name: "Sharma Book House",
      order_ref: "BO-2026-0087",
      level: "German A1",
      student_name: "Priya Sharma",
      ship_to: "12 MG Road, Indiranagar, Bengaluru 560038",
      ship_phone: "+91 98450 12345",
    });
  });

  test("every declared variable is filled - no blanks reach WATI", () => {
    const res = buildBookOrderVars(COMPLETE);
    assert.ok(res.ok);
    for (const v of BOOK_ORDER_VARS) {
      assert.ok(res.vars[v].length > 0, `${v} must not be empty`);
    }
  });

  test("A MISSING SHIP-TO BLOCKS THE SEND - this is the one that ships books nowhere", () => {
    const res = buildBookOrderVars({ ...COMPLETE, shipTo: null });
    assert.ok(!res.ok);
    assert.deepEqual(res.missing, ["ship_to"]);
    assert.match(res.message, /ship-to address/);
  });

  test("whitespace is missing - a blank address passes a null check and still ships nowhere", () => {
    const res = buildBookOrderVars({ ...COMPLETE, shipTo: "   ", shipPhone: "\t" });
    assert.ok(!res.ok);
    assert.deepEqual(res.missing, ["ship_to", "ship_phone"]);
  });

  test("several gaps are all reported, so the fix is one trip not three", () => {
    const res = buildBookOrderVars({
      ...COMPLETE,
      publisherName: null,
      shipTo: null,
      shipPhone: undefined,
    });
    assert.ok(!res.ok);
    assert.deepEqual(res.missing, ["publisher_name", "ship_to", "ship_phone"]);
    assert.match(res.message, /and/, "reads as a sentence, not a list of keys");
  });

  test("values are trimmed - a trailing newline from a textarea is not sent to a supplier", () => {
    const res = buildBookOrderVars({ ...COMPLETE, shipTo: "  12 MG Road  \n" });
    assert.ok(res.ok);
    assert.equal(res.vars.ship_to, "12 MG Road");
  });

  test("the failure message names things to fix, not variable keys", () => {
    const res = buildBookOrderVars({ ...COMPLETE, studentName: "" });
    assert.ok(!res.ok);
    assert.ok(!res.message.includes("student_name"), "an admin should not be shown a variable name");
  });
});

describe("the log summary", () => {
  test("reads without a join - ref, level, student and publisher", () => {
    const res = buildBookOrderVars(COMPLETE);
    assert.ok(res.ok);
    const summary = bookOrderBodySummary(res.vars);
    for (const part of ["BO-2026-0087", "German A1", "Priya Sharma", "Sharma Book House"]) {
      assert.ok(summary.includes(part), `summary should carry ${part}`);
    }
  });
});

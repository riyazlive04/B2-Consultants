/**
 * Student CSV import — spec Part 2 §9.
 *
 * The tests that matter here are about NOT losing data:
 *  - `blankCellDoesNotWipe`: an import is usually a partial export. Treating an empty cell as
 *    "delete this" would strip phone numbers off half the roster and look like a successful
 *    import while doing it.
 *  - `quotedCommaInAddress`: addresses contain commas. A naive split(",") shifts every later
 *    column, so someone's city ends up in their address and their address in nothing.
 *  - `duplicateRowsInOneFile`: a sheet that lists someone twice must not create them twice.
 *
 * Run: npm test
 */

import assert from "node:assert/strict";
import { test, describe } from "node:test";
import { parseCsvLine, parseStudentCsv, planStudentImport, type ExistingStudent } from "../student-import";

const existing: ExistingStudent[] = [
  { id: "s1", email: "ada@example.com", fullName: "Ada Lovelace", phone: "+911111111111", address: "Bengaluru" },
];

describe("csv line parsing", () => {
  test("splits plain fields", () => {
    assert.deepEqual(parseCsvLine("a,b,c"), ["a", "b", "c"]);
  });

  test("a quoted comma stays inside its field", () => {
    // The single most likely real-world row: "12 MG Road, Bengaluru".
    assert.deepEqual(parseCsvLine('Ada,"12 MG Road, Bengaluru",x'), ["Ada", "12 MG Road, Bengaluru", "x"]);
  });

  test("escaped quotes survive", () => {
    assert.deepEqual(parseCsvLine('a,"say ""hi""",b'), ["a", 'say "hi"', "b"]);
  });

  test("empty fields are preserved positionally", () => {
    assert.deepEqual(parseCsvLine("a,,c"), ["a", "", "c"]);
  });
});

describe("csv parsing — headers and validation", () => {
  test("a file with no name column is refused", () => {
    const r = parseStudentCsv("email,phone\na@b.com,123");
    assert.equal(r.ok, false);
  });

  test("an empty file is refused", () => {
    assert.equal(parseStudentCsv("").ok, false);
  });

  test("header aliases are accepted case- and space-insensitively", () => {
    const r = parseStudentCsv("Full Name,Email ID,Mobile\nAda,ADA@Example.com,+91999");
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.rows[0].row.fullName, "Ada");
    assert.equal(r.rows[0].row.email, "ada@example.com", "email must fold to lowercase — it's the match key");
    assert.equal(r.rows[0].row.phone, "+91999");
  });

  test("a bad row is skipped with its line number, not fatal", () => {
    const r = parseStudentCsv("name,email\nAda,ada@example.com\n,orphan@example.com\nBob,not-an-email");
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.rows.length, 1, "only Ada is importable");
    assert.equal(r.skipped.length, 2);
    assert.equal(r.skipped[0].line, 3, "line numbers must point at the real line in the file");
    assert.match(r.skipped[1].reason, /Invalid email/);
  });

  test("unknown columns are ignored rather than rejected", () => {
    const r = parseStudentCsv("name,favourite colour\nAda,blue");
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.rows[0].row.fullName, "Ada");
  });
});

describe("import planning", () => {
  const plan = (csv: string) => {
    const p = parseStudentCsv(csv);
    if (!p.ok) throw new Error(p.error);
    return planStudentImport(p.rows, existing, p.skipped);
  };

  test("a new email creates", () => {
    const r = plan("name,email\nGrace Hopper,grace@example.com");
    assert.equal(r.creates, 1);
    assert.equal(r.updates, 0);
  });

  test("a known email with new data updates, and names the fields", () => {
    const r = plan("name,email,phone\nAda Lovelace,ada@example.com,+919999999999");
    assert.equal(r.updates, 1);
    const p = r.plans.find((x) => x.kind === "update");
    assert.ok(p && p.kind === "update");
    assert.deepEqual(p.changes, ["phone"]);
  });

  test("re-importing the same file reads as unchanged, not as work done", () => {
    const r = plan("name,email,phone,address\nAda Lovelace,ada@example.com,+911111111111,Bengaluru");
    assert.equal(r.unchanged, 1);
    assert.equal(r.updates, 0, "an idempotent re-import must not inflate the change count");
  });

  test("a blank cell does not wipe existing data", () => {
    // Sheet has no phone column at all — Ada's number must survive.
    const r = plan("name,email\nAda Lovelace,ada@example.com");
    assert.equal(r.unchanged, 1);
    assert.equal(r.updates, 0);
  });

  test("email matching is case-insensitive", () => {
    const r = plan("name,email\nAda Lovelace,ADA@EXAMPLE.COM");
    assert.equal(r.creates, 0, "a different case must not create a duplicate person");
    assert.equal(r.unchanged, 1);
  });

  test("a row with no email can only create", () => {
    const r = plan("name,email\nNo Email Person,");
    assert.equal(r.creates, 1);
  });

  test("the same email twice in one file creates once", () => {
    const r = plan("name,email\nGrace,grace@example.com\nGrace Again,grace@example.com");
    assert.equal(r.creates, 1);
    assert.equal(r.skipped, 1);
    const skip = r.plans.find((p) => p.kind === "skip");
    assert.ok(skip && skip.kind === "skip");
    assert.match(skip.reason, /Duplicate/);
  });

  test("plans stay in file order so the preview reads like the sheet", () => {
    const r = plan("name,email\nA,a@x.com\n,bad\nB,b@x.com");
    const lines = r.plans.map((p) => p.line);
    assert.deepEqual(lines, [...lines].sort((x, y) => x - y));
  });

  test("an address containing a comma survives into the plan", () => {
    const r = plan('name,email,address\nGrace,grace@example.com,"12 MG Road, Bengaluru"');
    const p = r.plans.find((x) => x.kind === "create");
    assert.ok(p && p.kind === "create");
    assert.equal(p.row.address, "12 MG Road, Bengaluru");
  });
});

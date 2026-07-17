/**
 * Activity log — the update diff.
 *
 * Pure in, pure out, no DB. The Decimal case is the reason this file exists: a Prisma
 * Decimal JSON-serialises to `{}`, so a naive comparison marks every amount equal to every
 * other amount, and an edited fee logs as "nothing changed" — silently, while looking fine.
 * That's the worst failure this feature could have, so it's pinned here.
 *
 * Run: npm test
 */

import assert from "node:assert/strict";
import { test, describe } from "node:test";
import { diffFields, sanitiseMeta } from "../activity-diff";

/** Stands in for a Prisma Decimal: an object with toFixed/toString, opaque to JSON. */
class FakeDecimal {
  constructor(private readonly v: string) {}
  toFixed(): string { return this.v; }
  toString(): string { return this.v; }
}

describe("diffFields", () => {
  test("reports only the fields that moved", () => {
    const d = diffFields({ name: "Priya", stage: "NEW", owner: "asma" }, { stage: "QUALIFIED" });
    assert.deepEqual(d.changed, ["stage"]);
    assert.deepEqual(d.before, { stage: "NEW" });
    assert.deepEqual(d.after, { stage: "QUALIFIED" });
  });

  test("only keys present in `after` are compared — a form diffs what it touches", () => {
    const d = diffFields({ name: "Priya", stage: "NEW" }, { name: "Priya" });
    assert.deepEqual(d.changed, []);
  });

  test("an update that changed nothing yields no fields, so the call site can skip the log", () => {
    const d = diffFields({ stage: "NEW", owner: "asma" }, { stage: "NEW", owner: "asma" });
    assert.equal(d.changed.length, 0);
  });

  test("DECIMALS: a changed amount is detected, not swallowed", () => {
    const d = diffFields(
      { fee: new FakeDecimal("120000.00") } as Record<string, unknown>,
      { fee: new FakeDecimal("95000.00") },
    );
    assert.deepEqual(d.changed, ["fee"]);
    assert.deepEqual(d.before, { fee: "120000.00" });
    assert.deepEqual(d.after, { fee: "95000.00" });
  });

  test("DECIMALS: an unchanged amount is not reported as a change", () => {
    const d = diffFields(
      { fee: new FakeDecimal("120000.00") } as Record<string, unknown>,
      { fee: new FakeDecimal("120000.00") },
    );
    assert.deepEqual(d.changed, []);
  });

  test("dates compare by instant and serialise readably", () => {
    const d = diffFields(
      { dueAt: new Date("2026-07-17T00:00:00Z") } as Record<string, unknown>,
      { dueAt: new Date("2026-07-18T00:00:00Z") },
    );
    assert.deepEqual(d.changed, ["dueAt"]);
    assert.equal(d.after.dueAt, "2026-07-18T00:00:00.000Z");
  });

  test("an equal date is not a change", () => {
    const d = diffFields(
      { dueAt: new Date("2026-07-17T00:00:00Z") } as Record<string, unknown>,
      { dueAt: new Date("2026-07-17T00:00:00Z") },
    );
    assert.deepEqual(d.changed, []);
  });

  test("null and undefined are the same absence — clearing an already-empty field isn't an edit", () => {
    const d = diffFields({ notes: null } as Record<string, unknown>, { notes: undefined });
    assert.deepEqual(d.changed, []);
  });

  test("setting a value on an empty field IS an edit", () => {
    const d = diffFields({ notes: null } as Record<string, unknown>, { notes: "Called, no answer" });
    assert.deepEqual(d.changed, ["notes"]);
    assert.equal(d.before.notes, null);
  });

  test("booleans and numbers behave", () => {
    const d = diffFields({ active: true, count: 3 }, { active: false, count: 3 });
    assert.deepEqual(d.changed, ["active"]);
  });

  /**
   * Every amount in this app is a BigInt minor unit, and JSON.stringify THROWS on a BigInt.
   * diffFields runs at the call site, outside logActivity's try/catch, so an unhandled throw
   * here would propagate into a real action and roll back the write it was meant to record.
   */
  describe("BigInt money — must never throw", () => {
    test("a changed amount diffs without throwing", () => {
      const d = diffFields(
        { amountInrMinor: BigInt(12000000) } as Record<string, unknown>,
        { amountInrMinor: BigInt(9500000) },
      );
      assert.deepEqual(d.changed, ["amountInrMinor"]);
      assert.deepEqual(d.before, { amountInrMinor: "12000000" });
      assert.deepEqual(d.after, { amountInrMinor: "9500000" });
    });

    test("an unchanged amount is not a change", () => {
      const d = diffFields(
        { amountInrMinor: BigInt(12000000) } as Record<string, unknown>,
        { amountInrMinor: BigInt(12000000) },
      );
      assert.deepEqual(d.changed, []);
    });

    test("the result is JSON-serialisable — it has to survive the Json column", () => {
      const d = diffFields(
        { amountInrMinor: BigInt(1) } as Record<string, unknown>,
        { amountInrMinor: BigInt(2) },
      );
      assert.doesNotThrow(() => JSON.stringify(d));
    });
  });
});

describe("sanitiseMeta", () => {
  test("a bare BigInt becomes a string", () => {
    assert.equal(sanitiseMeta(BigInt(42)), "42");
  });

  test("BigInts nested in objects and arrays are reached", () => {
    const out = sanitiseMeta({ total: BigInt(500), lines: [{ amt: BigInt(250) }, { amt: BigInt(250) }] });
    assert.deepEqual(out, { total: "500", lines: [{ amt: "250" }, { amt: "250" }] });
    assert.doesNotThrow(() => JSON.stringify(out));
  });

  test("a meta full of amounts survives JSON — otherwise the entry is lost silently", () => {
    const meta = { before: { fee: BigInt(1) }, after: { fee: BigInt(2) }, changed: ["fee"] };
    assert.doesNotThrow(() => JSON.stringify(sanitiseMeta(meta)));
  });

  test("dates become ISO strings", () => {
    assert.deepEqual(sanitiseMeta({ at: new Date("2026-07-17T00:00:00Z") }), { at: "2026-07-17T00:00:00.000Z" });
  });

  test("a buffer is summarised, never inlined — a sealed PDF must not land in the log", () => {
    assert.deepEqual(sanitiseMeta({ pdf: Buffer.alloc(2048) }), { pdf: "[2048 bytes]" });
  });

  test("scalars pass through untouched", () => {
    assert.deepEqual(sanitiseMeta({ a: 1, b: "x", c: true, d: null }), { a: 1, b: "x", c: true, d: null });
  });

  test("undefined normalises to null so the Json column takes it", () => {
    assert.deepEqual(sanitiseMeta({ a: undefined }), { a: null });
  });

  test("a cycle terminates instead of hanging", () => {
    const cyclic: Record<string, unknown> = { name: "x" };
    cyclic.self = cyclic;
    assert.doesNotThrow(() => sanitiseMeta(cyclic));
  });
});

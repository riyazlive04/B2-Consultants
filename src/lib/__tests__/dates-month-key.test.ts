import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { istMonthKeyOf } from "../dates";

describe("istMonthKeyOf — bucketing instants into IST months", () => {
  test("a midday instant lands in its own month", () => {
    assert.equal(istMonthKeyOf(new Date("2026-07-15T09:00:00Z")), "2026-07");
  });

  test("the 5.5-hour window after IST midnight belongs to the NEW month, not the old one", () => {
    // 2026-07-01 01:00 IST is 2026-06-30 19:30 UTC. Taking the raw UTC month would file a
    // July lead under June — the exact misbucketing this helper exists to prevent.
    assert.equal(istMonthKeyOf(new Date("2026-06-30T19:30:00Z")), "2026-07");
  });

  test("just before IST midnight still belongs to the old month", () => {
    // 2026-06-30 23:59 IST = 2026-06-30 18:29 UTC
    assert.equal(istMonthKeyOf(new Date("2026-06-30T18:29:00Z")), "2026-06");
  });

  test("the year boundary behaves the same way", () => {
    assert.equal(istMonthKeyOf(new Date("2025-12-31T19:00:00Z")), "2026-01");
    assert.equal(istMonthKeyOf(new Date("2025-12-31T18:00:00Z")), "2025-12");
  });
});

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { entryDateFor, entryTodayYmd, ymdInZone } from "../dates";

const BERLIN = "Europe/Berlin";
const IST = "Asia/Kolkata";

/**
 * FIN-02. The founder records from Germany while the books run on IST. After 20:30 Berlin it is
 * already tomorrow in India, so a form pre-filled with India's date saved an entry on a day that
 * had not happened yet - and at month end, into the next month.
 */
describe("ymdInZone - the calendar date an instant falls on", () => {
  test("23:00 in Berlin is already the next day in India", () => {
    const instant = new Date("2026-07-14T21:00:00Z"); // 23:00 CEST, 02:30 IST
    assert.equal(ymdInZone(instant, BERLIN), "2026-07-14");
    assert.equal(ymdInZone(instant, IST), "2026-07-15");
  });

  test("during the Indian working day both zones agree", () => {
    const instant = new Date("2026-07-14T06:00:00Z"); // 11:30 IST, 08:00 CEST
    assert.equal(ymdInZone(instant, BERLIN), "2026-07-14");
    assert.equal(ymdInZone(instant, IST), "2026-07-14");
  });
});

describe("entryDateFor - the date an entry form pre-fills", () => {
  test("a Berlin evening records the founder's day, not India's next day", () => {
    assert.equal(entryDateFor("2026-07-14", "2026-07-15"), "2026-07-14");
  });

  test("the Indian team, whose clock IS the books' clock, is unaffected", () => {
    assert.equal(entryDateFor("2026-07-15", "2026-07-15"), "2026-07-15");
  });

  test("month end: a payment taken on 30 June is not booked into July", () => {
    assert.equal(entryDateFor("2026-06-30", "2026-07-01"), "2026-06-30");
  });

  test("year end behaves the same way", () => {
    assert.equal(entryDateFor("2025-12-31", "2026-01-01"), "2025-12-31");
  });

  test("a browser EAST of India never posts a future date into the books", () => {
    // 01:00 in Tokyo is 21:30 IST the previous day - the same bug from the other side.
    assert.equal(entryDateFor("2026-07-15", "2026-07-14"), "2026-07-14");
  });
});

describe("entryTodayYmd - entryDateFor as the browser sees it", () => {
  // The local half depends on the machine's zone, so these assert the INVARIANTS that hold in
  // every zone rather than a literal date only a CEST/IST machine would produce.
  const instants = [
    new Date("2026-07-14T21:00:00Z"),
    new Date("2026-07-14T06:00:00Z"),
    new Date("2026-06-30T18:45:00Z"),
    new Date("2025-12-31T23:30:00Z"),
  ];

  test("never runs ahead of the day the books are having", () => {
    for (const at of instants) {
      assert.ok(
        entryTodayYmd(at) <= ymdInZone(at, IST),
        `${entryTodayYmd(at)} is ahead of India's ${ymdInZone(at, IST)}`,
      );
    }
  });

  test("otherwise it is the browser's own calendar day", () => {
    for (const at of instants) {
      const local = ymdInZone(at, Intl.DateTimeFormat().resolvedOptions().timeZone);
      const ist = ymdInZone(at, IST);
      assert.equal(entryTodayYmd(at), local <= ist ? local : ist);
    }
  });
});

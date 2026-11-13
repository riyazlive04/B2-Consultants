import test from "node:test";
import assert from "node:assert/strict";
import {
  DAY_PX, addDays, dayColumns, inMonth, istRangeLabel, istSlot, istTimeLabel,
  minutePx, monthCell, monthDays, placeDay, weekDays,
} from "../calendar-grid";
import type { CalEvent } from "../calendar-event";

/**
 * Feature 2 (build-docs/features/calendar-view.md): the maths the Week/Day/Month views draw from.
 *
 * Every assertion is in IST, because the grid is: the slots are stored as UTC instants, and a
 * 19:00 IST call is 13:30 UTC on the DAY BEFORE for four and a half hours of every day.
 */

const ev = (id: string, startsAt: string, mins: number, ownerId: string | null = "u1"): CalEvent => ({
  id,
  kind: "APPOINTMENT",
  calendar: { key: `disco:${ownerId ?? ""}`, type: "DISCO", name: "Disco", color: "var(--chart-1)" },
  ownerId,
  ownerName: ownerId,
  ownerColor: "var(--chart-1)",
  startsAt,
  endsAt: new Date(new Date(startsAt).getTime() + mins * 60_000).toISOString(),
  title: id,
  contact: { name: id, phone: null, email: null, leadId: null },
  status: "CONFIRMED",
  source: { table: "slot", id },
});

test("calendar-view AC1: an event sits on its IST day at its IST minute, not its UTC one", () => {
  // 18:30 IST on 13 Nov is 13:00 UTC the same day; 00:30 IST on 14 Nov is 19:00 UTC on the 13th.
  assert.deepEqual(istSlot("2026-11-13T13:00:00Z"), { key: "2026-11-13", min: 18 * 60 + 30 });
  assert.deepEqual(istSlot("2026-11-13T19:00:00Z"), { key: "2026-11-14", min: 30 });
  assert.deepEqual(istSlot("2026-11-13T18:30:00Z"), { key: "2026-11-14", min: 0 });
});

test("calendar-view AC1: three bookings in a week land on the right days at the right heights", () => {
  const events = [ev("a", "2026-11-13T13:00:00Z", 20), ev("b", "2026-11-14T04:30:00Z", 45), ev("c", "2026-11-15T13:00:00Z", 20)];
  const friday = placeDay(events, "2026-11-13");
  assert.deepEqual(friday.map((p) => p.event.id), ["a"]);
  // 18:30 IST of 1440 minutes, 20 minutes long.
  assert.equal(friday[0].place.top, ((18 * 60 + 30) / 1440) * 100);
  assert.equal(friday[0].place.height, (20 / 1440) * 100);
  assert.deepEqual(placeDay(events, "2026-11-14").map((p) => p.event.id), ["b"]);
  assert.deepEqual(placeDay(events, "2026-11-16"), []);
});

test("calendar-view AC2: overlapping bookings are placed side by side, none dropped", () => {
  const placed = placeDay(
    [ev("a", "2026-11-13T13:00:00Z", 45), ev("b", "2026-11-13T13:15:00Z", 45), ev("c", "2026-11-13T14:30:00Z", 20)],
    "2026-11-13",
  );
  assert.equal(placed.length, 3);
  const a = placed.find((p) => p.event.id === "a")!;
  const b = placed.find((p) => p.event.id === "b")!;
  const c = placed.find((p) => p.event.id === "c")!;
  assert.deepEqual([a.place.col, b.place.col], [0, 1]);
  assert.deepEqual([a.place.cols, b.place.cols], [2, 2]);
  assert.deepEqual([c.place.col, c.place.cols], [0, 1]); // its own cluster
});

test("calendar-view edge: a call running past IST midnight is clipped to each day it touches", () => {
  const late = ev("late", "2026-11-13T18:15:00Z", 45); // 23:45 - 00:30 IST
  const first = placeDay([late], "2026-11-13");
  const second = placeDay([late], "2026-11-14");
  assert.equal(first[0].place.height, (15 / 1440) * 100);
  assert.equal(second[0].place.top, 0);
  assert.equal(second[0].place.height, (30 / 1440) * 100);
});

test("calendar-view AC3: day view gives one column per owner with something on, unassigned last", () => {
  const team = [{ id: "u1", name: "Ameen" }, { id: "u2", name: "Asma" }, { id: "u3", name: "Idle" }];
  const cols = dayColumns(
    [ev("a", "2026-11-13T13:00:00Z", 20, "u1"), ev("b", "2026-11-13T13:30:00Z", 20, null), ev("c", "2026-11-13T14:00:00Z", 20, "u1")],
    "2026-11-13",
    team,
  );
  assert.deepEqual(cols.map((c) => c.name), ["Ameen", "Unassigned"]);
  assert.deepEqual(cols[0].events.map((e) => e.id), ["a", "c"]);
  assert.deepEqual(cols.map((c) => c.events.length), [2, 1]);
  assert.deepEqual(dayColumns([], "2026-11-13", team), []);
});

test("calendar-view AC4: a month cell shows three events and hides the rest behind +N more", () => {
  const five = Array.from({ length: 5 }, (_, i) => ev(`e${i}`, `2026-11-13T0${i + 4}:00:00Z`, 20));
  const cell = monthCell(five, "2026-11-13");
  assert.equal(cell.shown.length, 3);
  assert.equal(cell.more, 2);
  assert.equal(cell.all.length, 5); // the popover lists all of them
  assert.deepEqual(monthCell(five, "2026-11-12"), { all: [], shown: [], more: 0 });
});

test("calendar-view: weeks start Monday and months cover whole weeks", () => {
  assert.deepEqual(weekDays("2026-11-13")[0], "2026-11-09"); // Fri → that Monday
  assert.deepEqual(weekDays("2026-11-09")[6], "2026-11-15");
  const nov = monthDays("2026-11-13");
  assert.equal(nov.length % 7, 0);
  assert.equal(nov[0], "2026-10-26"); // 1 Nov 2026 is a Sunday, so the grid opens the Monday before
  assert.ok(nov.includes("2026-11-30") && nov.at(-1)! >= "2026-11-30");
  assert.ok(inMonth("2026-11-01", "2026-11-13") && !inMonth("2026-10-26", "2026-11-13"));
});

test("calendar-view: date arithmetic crosses months and years without a zone shifting it", () => {
  assert.equal(addDays("2026-11-30", 1), "2026-12-01");
  assert.equal(addDays("2027-01-01", -1), "2026-12-31");
  assert.equal(addDays("2028-02-28", 1), "2028-02-29"); // leap year
});

test("calendar-view: pixel helpers agree with the 72px hour row", () => {
  assert.equal(DAY_PX, 24 * 72);
  assert.equal(minutePx(8 * 60), 8 * 72);
  assert.equal(minutePx(30), 36);
});

test("calendar-view: times read as IST, and the hover line copies Synamate's format", () => {
  assert.equal(istTimeLabel("2026-11-13T13:00:00Z"), "06:30 PM");
  assert.equal(istRangeLabel(ev("a", "2026-11-13T13:00:00Z", 20)), "06:30 PM - 06:50 PM (IST)");
});

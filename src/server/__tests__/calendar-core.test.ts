import test from "node:test";
import assert from "node:assert/strict";
import { buildCalendarEvents, type ReleaseRow, type SlotRow, type SssRow } from "../calendar-events";
import { layoutDay } from "@/lib/calendar-layout";
import { eventLook } from "@/lib/calendar-event";

/** Feature 1 (build-docs/features/calendar-core.md): one event shape for Discovery + SSS. */

const ameen = { id: "u-ameen", name: "Ameenur Rahaman" };
const asma = { id: "u-asma", name: "Asma Parveen" };
const team = [ameen, asma]; // name-sorted, as the server reads it
const at = (iso: string) => new Date(iso);

const slot = (o: Partial<SlotRow> = {}): SlotRow => ({
  id: "s1", startsAt: at("2026-11-13T13:00:00Z"), durationMins: 20, status: "BOOKED", assignedTo: ameen,
  booking: { id: "b1", name: "Ravi K", email: "r@x.in", phone: "+91900", leadId: "l1", status: "BOOKED", confirmedAt: at("2026-11-12T10:00:00Z") },
  ...o,
});
const build = (p: { slots?: SlotRow[]; releases?: ReleaseRow[]; sss?: SssRow[] }) =>
  buildCalendarEvents({ slots: p.slots ?? [], releases: p.releases ?? [], sss: p.sss ?? [] }, team);

test("calendar-core AC1: booked + confirmed discovery slot → CONFIRMED on disco:<owner>", () => {
  const [ev] = build({ slots: [slot()] });
  assert.equal(ev.status, "CONFIRMED");
  assert.equal(ev.kind, "APPOINTMENT");
  assert.equal(ev.calendar.key, "disco:u-ameen");
  assert.equal(ev.calendar.name, "Personalized Discovery Call with Ameenur");
  assert.equal(ev.title, "Personalized Discovery Call between Ravi K and Ameenur");
  assert.equal(ev.endsAt, "2026-11-13T13:20:00.000Z");
  assert.deepEqual(ev.source, { table: "slot", id: "s1", bookingId: "b1" });
});

test("calendar-core AC1: unconfirmed, completed and rescheduled bookings map to their statuses", () => {
  const st = (status: string, confirmedAt: Date | null) =>
    build({ slots: [slot({ booking: { ...slot().booking!, status, confirmedAt } })] })[0].status;
  assert.equal(st("BOOKED", null), "UNCONFIRMED");
  assert.equal(st("RESCHEDULED", at("2026-11-12T00:00:00Z")), "CONFIRMED");
  assert.equal(st("COMPLETED", null), "SHOWED");
});

const release = (o: Partial<ReleaseRow> = {}): ReleaseRow => ({
  id: "r1", slotStartsAt: at("2026-11-13T13:00:00Z"), durationMins: 20, prospectName: "Meena S", reason: "CANCELLED",
  releasedStatus: "BLOCKED", slotId: "s1", slot: { assignedTo: asma },
  bookingRequest: { id: "b2", email: "m@x.in", phone: "+91800", leadId: null }, ...o,
});

test("calendar-core AC2: a cancelled discovery booking appears once, as CANCELLED, from SlotRelease", () => {
  // The release turned the slot BLOCKED (late cancel); the slot itself must not add a Busy card.
  const evs = build({ releases: [release()], slots: [slot({ status: "BLOCKED", booking: null, assignedTo: asma })] });
  assert.equal(evs.length, 1);
  assert.equal(evs[0].status, "CANCELLED");
  assert.equal(evs[0].calendar.key, "disco:u-asma");
  assert.deepEqual(evs[0].source, { table: "release", id: "r1", bookingId: "b2" });
});

test("calendar-core AC2: no-show ghosts are NO_SHOW, postponed releases are not drawn", () => {
  assert.equal(build({ releases: [release({ reason: "NO_SHOW" })] })[0].status, "NO_SHOW");
  assert.equal(build({ releases: [release({ reason: "POSTPONED" })] }).length, 0);
});

test("calendar-core AC2: a slot blocked on purpose after a release is still drawn as Busy", () => {
  const later = slot({ status: "BLOCKED", booking: null, startsAt: at("2026-11-14T13:00:00Z") });
  const evs = build({ releases: [release({ releasedStatus: "OPEN" })], slots: [slot({ status: "BLOCKED", booking: null })] });
  assert.equal(evs.length, 2);
  assert.equal(build({ releases: [release()], slots: [later] }).length, 2);
});

const sss = (o: Partial<SssRow> = {}): SssRow => ({
  id: "q1", startsAt: at("2026-11-13T14:00:00Z"), durationMins: 45, status: "BOOKED", owner: asma,
  journey: { id: "j1", leadId: "l9", salesCallConfirmed: false, lead: { name: "Kevin Raj", email: null, phone: "+91700" } }, ...o,
});

test("calendar-core AC3: SSS slot with a journey is an APPOINTMENT; a BLOCKED SSS slot is BLOCKED", () => {
  const [a] = build({ sss: [sss()] });
  assert.equal(a.kind, "APPOINTMENT");
  assert.equal(a.status, "UNCONFIRMED");
  assert.equal(a.calendar.key, "sss:u-asma");
  assert.equal(a.calendar.name, "Solution Strategy Session - Asma");
  assert.deepEqual(a.source, { table: "sss", id: "q1", journeyId: "j1" });
  const [b] = build({ sss: [sss({ status: "BLOCKED", journey: null })] });
  assert.equal(b.kind, "BLOCKED");
  assert.equal(b.title, "Busy");
});

test("calendar-core AC4: OPEN slots are not events", () => {
  assert.equal(build({ slots: [slot({ status: "OPEN", booking: null })], sss: [sss({ status: "OPEN", journey: null })] }).length, 0);
});

test("calendar-core edge: unassigned slot gets the unassigned calendar and grey edge", () => {
  const [ev] = build({ slots: [slot({ assignedTo: null })] });
  assert.equal(ev.calendar.key, "disco:");
  assert.equal(ev.calendar.name, "Discovery Call (unassigned)");
  assert.equal(ev.ownerColor, "var(--border-strong)");
  assert.equal(ev.title, "Personalized Discovery Call with Ravi K");
});

test("calendar-core edge: events come back sorted by start; empty input → []", () => {
  const evs = build({ sss: [sss()], slots: [slot()] });
  assert.deepEqual(evs.map((e) => e.source.table), ["slot", "sss"]);
  assert.deepEqual(build({}), []);
});

const item = (id: string, s: number, e: number) => ({ id, startMin: s, endMin: e });
const byId = (xs: ReturnType<typeof layoutDay>) => Object.fromEntries(xs.map((p) => [p.id, p]));

test("calendar-core AC5: three pairwise-overlapping events → three columns", () => {
  const p = byId(layoutDay([item("a", 0, 60), item("b", 10, 60), item("c", 20, 60)]));
  assert.deepEqual([p.a.col, p.b.col, p.c.col], [0, 1, 2]);
  assert.ok([p.a, p.b, p.c].every((x) => x.cols === 3));
});

test("calendar-core AC5: C starts after A ends but while B runs → C reuses column 0", () => {
  const p = byId(layoutDay([item("a", 0, 60), item("b", 30, 90), item("c", 60, 120)]));
  assert.deepEqual([p.a.col, p.b.col, p.c.col], [0, 1, 0]);
  assert.ok([p.a, p.b, p.c].every((x) => x.cols === 2));
});

test("calendar-core AC5: touching events (end == start) do not overlap", () => {
  const p = byId(layoutDay([item("a", 0, 30), item("b", 30, 60)]));
  assert.deepEqual([p.a.col, p.a.cols, p.b.col, p.b.cols], [0, 1, 0, 1]);
});

test("calendar-core AC5: position is a percent of the day; events are clipped to it", () => {
  const p = byId(layoutDay([item("a", 480, 540), item("late", 1400, 1500), item("out", 1500, 1600)], 0, 1440));
  assert.equal(p.a.top, (480 / 1440) * 100);
  assert.equal(p.a.height, (60 / 1440) * 100);
  assert.equal(p.late.height, (40 / 1440) * 100);
  assert.equal(p.out, undefined);
});

const look = (kind: "APPOINTMENT" | "BLOCKED", status: "CONFIRMED" | "UNCONFIRMED" | "CANCELLED" | "NO_SHOW") =>
  eventLook({ kind, status, calendar: { key: "k", type: "DISCO", name: "n", color: "var(--chart-1)" }, ownerColor: "var(--chart-3)" });

test("calendar-core AC6: a live card is a soft tint over --surface with the owner edge", () => {
  const ok = look("APPOINTMENT", "CONFIRMED");
  assert.equal(ok.bg, "color-mix(in srgb, var(--chart-1) 16%, var(--surface))");
  assert.equal(ok.edge, "var(--chart-3)");
  assert.equal(ok.dashed, false);
  assert.equal(look("APPOINTMENT", "UNCONFIRMED").dashed, true);
});

test("calendar-core AC6: cancelled is hollow + struck, no-show hollow, blocked grey", () => {
  assert.deepEqual([look("APPOINTMENT", "CANCELLED").bg, look("APPOINTMENT", "CANCELLED").strike], ["var(--surface)", true]);
  assert.deepEqual([look("APPOINTMENT", "NO_SHOW").bg, look("APPOINTMENT", "NO_SHOW").strike], ["var(--surface)", false]);
  assert.equal(look("BLOCKED", "CONFIRMED").bg, "var(--surface-2)");
});

test("calendar-core AC6: colours are tokens only - no raw hex, text is always an AA-tuned ink token", () => {
  for (const kind of ["APPOINTMENT", "BLOCKED"] as const) {
    for (const status of ["CONFIRMED", "UNCONFIRMED", "CANCELLED", "NO_SHOW"] as const) {
      const l = look(kind, status);
      assert.match(l.text, /^var\(--ink(-2|-3)?\)$/);
      for (const v of [l.bg, l.border, l.edge]) assert.ok(!/#[0-9a-f]{3,8}/i.test(v), `${kind} ${status}: raw hex in ${v}`);
    }
  }
});

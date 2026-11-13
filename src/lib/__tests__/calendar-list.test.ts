import test from "node:test";
import assert from "node:assert/strict";
import { LIST_VIEWS, viewRows } from "../calendar-list";
import type { CalEvent, CalStatus, CalType } from "../calendar-event";

/** Feature 6 (build-docs/features/appointment-list-view.md): the saved lists. */

const NOW = "2026-11-13T12:00:00.000Z";

const ev = (
  id: string,
  startsAt: string,
  o: { status?: CalStatus; type?: CalType; kind?: CalEvent["kind"] } = {},
): CalEvent => ({
  id,
  kind: o.kind ?? "APPOINTMENT",
  calendar: { key: "k", type: o.type ?? "DISCO", name: "Cal", color: "var(--chart-1)" },
  ownerId: "u1", ownerName: "Ameen", ownerColor: "var(--chart-1)",
  startsAt,
  endsAt: new Date(new Date(startsAt).getTime() + 20 * 60_000).toISOString(),
  title: `Call ${id}`,
  contact: { name: `P${id}`, phone: null, email: null, leadId: null },
  status: o.status ?? "CONFIRMED",
  meetingUrl: null,
  source: { table: "slot", id, bookingId: `b${id}` },
});

const past = ev("past", "2026-11-10T09:00:00.000Z");
const soon = ev("soon", "2026-11-13T14:00:00.000Z");
const later = ev("later", "2026-11-20T09:00:00.000Z");
const cancelled = ev("cancelled", "2026-11-18T09:00:00.000Z", { status: "CANCELLED" });
const noShow = ev("noshow", "2026-11-11T09:00:00.000Z", { status: "NO_SHOW" });
const sss = ev("sss", "2026-11-19T09:00:00.000Z", { type: "SSS" });
const busy = ev("busy", "2026-11-14T09:00:00.000Z", { kind: "BLOCKED" });
const ALL = [later, past, soon, cancelled, noShow, sss, busy];

test("appointment-list-view AC1: Upcoming is future, not cancelled, time ascending", () => {
  assert.deepEqual(viewRows(ALL, "upcoming", NOW).map((e) => e.id), ["soon", "sss", "later"]);
});

test("appointment-list-view AC1: blocked time is never an appointment in any list", () => {
  for (const view of LIST_VIEWS.map((v) => v.value)) {
    assert.equal(viewRows(ALL, view, NOW).some((e) => e.kind === "BLOCKED"), false, view);
  }
});

test("appointment-list-view AC2: the two type lists filter without losing the upcoming rule", () => {
  assert.deepEqual(viewRows(ALL, "disco", NOW).map((e) => e.id), ["soon", "later"]);
  assert.deepEqual(viewRows(ALL, "sss", NOW).map((e) => e.id), ["sss"]);
});

test("appointment-list-view: Cancelled holds both cancellations and no-shows, newest first", () => {
  assert.deepEqual(viewRows(ALL, "cancelled", NOW).map((e) => e.id), ["cancelled", "noshow"]);
});

test("appointment-list-view: All keeps the past and the dead, in time order", () => {
  assert.deepEqual(
    viewRows(ALL, "all", NOW).map((e) => e.id),
    ["past", "noshow", "soon", "cancelled", "sss", "later"],
  );
});

test("appointment-list-view edge: a call running right now still counts as upcoming", () => {
  // Starts before NOW, ends after it - "upcoming" must mean "not over", or the call you are
  // about to join drops off the list you are looking at.
  const running = ev("running", "2026-11-13T11:50:00.000Z");
  assert.equal(viewRows([running], "upcoming", NOW)[0]?.id, "running");
  // ...and one that ended on the dot is over.
  const justEnded = ev("ended", "2026-11-13T11:40:00.000Z");
  assert.deepEqual(viewRows([justEnded], "upcoming", NOW), []);
});

import test from "node:test";
import assert from "node:assert/strict";
import { oneSlotPerInstant } from "../slot-pool";

const at = (iso: string) => new Date(iso);
const slot = (id: string, iso: string, assignedToId: string | null = null) => ({
  id,
  startsAt: at(iso),
  assignedToId,
});

test("leaves a pool with no clashes exactly as it was", () => {
  const rows = [slot("a", "2026-11-02T12:30:00Z"), slot("b", "2026-11-02T13:15:00Z")];
  assert.deepEqual(oneSlotPerInstant(rows).map((r) => r.id), ["a", "b"]);
});

test("two coaches free at the same instant become one bookable time", () => {
  const rows = [
    slot("asma-18", "2026-11-02T12:30:00Z", "asma"),
    slot("ameen-18", "2026-11-02T12:30:00Z", "ameen"),
    slot("asma-1845", "2026-11-02T13:15:00Z", "asma"),
  ];
  assert.deepEqual(oneSlotPerInstant(rows).map((r) => r.id), ["asma-18", "asma-1845"]);
});

test("the host the page is about keeps the instant", () => {
  const rows = [
    slot("asma-18", "2026-11-02T12:30:00Z", "asma"),
    slot("ameen-18", "2026-11-02T12:30:00Z", "ameen"),
  ];
  assert.deepEqual(oneSlotPerInstant(rows, "ameen").map((r) => r.id), ["ameen-18"]);
});

test("an assigned slot beats an unassigned one at the same instant", () => {
  const rows = [slot("nobody", "2026-11-02T12:30:00Z", null), slot("asma", "2026-11-02T12:30:00Z", "asma")];
  assert.deepEqual(oneSlotPerInstant(rows).map((r) => r.id), ["asma"]);
});

test("ascending order survives the collapse", () => {
  const rows = [
    slot("x", "2026-11-02T12:30:00Z", "asma"),
    slot("y", "2026-11-02T12:30:00Z", "ameen"),
    slot("z", "2026-11-01T12:30:00Z", "ameen"),
  ];
  assert.deepEqual(
    oneSlotPerInstant(rows).map((r) => r.startsAt.toISOString()),
    ["2026-11-02T12:30:00.000Z", "2026-11-01T12:30:00.000Z"],
  );
});

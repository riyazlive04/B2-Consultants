import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_FILTERS, filterParams, isDefaultFilters, kindsFor, parseFilters, showsNothing,
  toggleCal, toggleUser, userShown,
} from "../calendar-filters";

/** Feature 3 (build-docs/features/calendar-manage-view.md): what the grid is told to show. */

/** A team of five plus the unassigned pile - enough for "shorter way round" to have an answer. */
const ALL = ["u1", "u2", "u3", "u4", "u5", ""];

test("calendar-manage-view: no parameters means everything, and writes nothing to the URL", () => {
  assert.deepEqual(parseFilters({}), DEFAULT_FILTERS);
  assert.deepEqual(filterParams(DEFAULT_FILTERS), { users: null, off: null, cal: null, type: null });
  assert.equal(showsNothing(DEFAULT_FILTERS), false);
  assert.ok(isDefaultFilters(DEFAULT_FILTERS));
  assert.ok(ALL.every((id) => userShown(DEFAULT_FILTERS, id)));
});

test("calendar-manage-view AC1: unticking one person hides only them, and is stored as 'off'", () => {
  const f = toggleUser(DEFAULT_FILTERS, "u2", ALL);
  assert.equal(userShown(f, "u2"), false);
  assert.ok(["u1", "u3", "u4", "u5", ""].every((id) => userShown(f, id)));
  // The short way round: one id in the URL, not the other five.
  assert.deepEqual(filterParams(f), { users: null, off: "u2", cal: null, type: null });
  assert.deepEqual(parseFilters({ off: "u2" }), { ...DEFAULT_FILTERS, usersOff: ["u2"] });
});

test("calendar-manage-view AC1: narrowing to one person is stored as 'users'", () => {
  // Untick everyone but u1: five off, one on - so the include list is the shorter sentence.
  let f = DEFAULT_FILTERS;
  for (const id of ["u2", "u3", "u4", "u5", ""]) f = toggleUser(f, id, ALL);
  assert.deepEqual(f.users, ["u1"]);
  assert.equal(f.usersOff, null);
  assert.deepEqual(filterParams(f), { users: "u1", off: null, cal: null, type: null });
});

test("calendar-manage-view AC1: ticking the last person back restores the default, not a list", () => {
  const off = toggleUser(DEFAULT_FILTERS, "u2", ALL);
  const back = toggleUser(off, "u2", ALL);
  assert.ok(isDefaultFilters(back));
  assert.deepEqual(filterParams(back), { users: null, off: null, cal: null, type: null });
});

test("calendar-manage-view AC1: the unassigned pile travels as a word, not an empty value", () => {
  const f = toggleUser(DEFAULT_FILTERS, "", ALL);
  assert.equal(filterParams(f).off, "none");
  assert.equal(userShown(parseFilters({ off: "none" }), ""), false);
  assert.equal(userShown(parseFilters({ users: "none" }), ""), true);
  assert.deepEqual(parseFilters({ users: "none" }).users, [""]);
});

test("calendar-manage-view AC2: view by type picks the kinds the grid asks for", () => {
  assert.equal(kindsFor("all"), undefined);
  assert.deepEqual(kindsFor("appointments"), ["APPOINTMENT"]);
  assert.deepEqual(kindsFor("blocked"), ["BLOCKED"]);
  assert.equal(parseFilters({ type: "blocked" }).type, "blocked");
  assert.equal(filterParams({ ...DEFAULT_FILTERS, type: "blocked" }).type, "blocked");
});

test("calendar-manage-view AC2: unticking a calendar leaves the other one", () => {
  const f = toggleCal(DEFAULT_FILTERS, "SSS");
  assert.deepEqual(f.cals, ["DISCO"]);
  assert.deepEqual(toggleCal(f, "DISCO").cals, []);
  assert.equal(showsNothing(toggleCal(f, "DISCO")), true);
});

test("calendar-manage-view AC3: Clear all is the default, which drops every parameter", () => {
  const dirty = { users: ["u1"], usersOff: null, cals: ["SSS" as const], type: "blocked" as const };
  assert.equal(isDefaultFilters(dirty), false);
  assert.deepEqual(filterParams(DEFAULT_FILTERS), { users: null, off: null, cal: null, type: null });
});

test("calendar-manage-view edge: nothing ticked stays nothing, and is reported as such", () => {
  assert.deepEqual(parseFilters({ users: "" }).users, []);
  assert.equal(showsNothing(parseFilters({ users: "" })), true);
  assert.equal(showsNothing(parseFilters({ cal: "" })), true);
  assert.equal(showsNothing(parseFilters({ off: "u1" })), false);
});

test("calendar-manage-view edge: junk in the URL is ignored rather than blanking the grid", () => {
  assert.equal(parseFilters({ type: "nonsense" }).type, "all");
  assert.deepEqual(parseFilters({ cal: "SSS,NOPE" }).cals, ["SSS"]);
  assert.deepEqual(parseFilters({ cal: "NOPE" }).cals, []);
  assert.deepEqual(parseFilters({ users: "u1, u1 ,u2" }).users, ["u1", "u2"]);
  // An explicit list wins outright: the two cannot both narrow, or they could contradict.
  assert.deepEqual(parseFilters({ users: "u1", off: "u1" }), { ...DEFAULT_FILTERS, users: ["u1"] });
});

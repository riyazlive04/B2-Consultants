/**
 * The section access rule - and in particular the one exception to "Admin sees everything".
 *
 * Pure and DB-free.
 *
 * Dashboard, My Journey and My Classroom resolve the SIGNED-IN USER to their own `Student`
 * row. There is no student id in the request to swap, so an Admin opening My Classroom was
 * never looking at a student's classroom - they were looking at the absence of their own, and
 * the page said "Your login isn't linked to a student record yet". It read as a bug, and it
 * read as one hardest in the exact situation that produced it: three students listed on My
 * Teaching and an empty My Classroom next to it in the same nav group.
 *
 * So these tests pin the ordering: `personal` is checked BEFORE the Admin bypass, and before
 * the per-user override - because neither can conjure the record the page reads.
 *
 * Run: npm test
 */

import assert from "node:assert/strict";
import { test, describe } from "node:test";
import {
  grantableTo,
  resolveSections,
  roleDefaultKeysFrom,
  sectionAllowed,
  SECTION_CATALOGUE,
  type AppRole,
  type ResolvedSection,
  type SectionKey,
  type SectionOverrides,
} from "../sections";

const SHIPPED = resolveSections(null);
const find = (key: SectionKey): ResolvedSection => {
  const s = SHIPPED.find((x) => x.key === key);
  assert.ok(s, `no such section: ${key}`);
  return s;
};

/** The three self-scoped pages, and one ordinary section to check nothing else moved. */
const PERSONAL: SectionKey[] = ["dashboard", "my-journey", "classroom"];
const NON_STUDENT: AppRole[] = ["ADMIN", "HEAD", "COACH", "TUTOR", "USER"];

describe("personal sections", () => {
  test("the catalogue marks exactly the three self-scoped pages", () => {
    assert.deepEqual(
      SHIPPED.filter((s) => s.personal).map((s) => s.key).sort(),
      [...PERSONAL].sort(),
    );
  });

  test("a student gets all three", () => {
    for (const key of PERSONAL) {
      assert.equal(sectionAllowed(find(key), "STUDENT", null), true, key);
    }
  });

  test("nobody else does - the ADMIN bypass included", () => {
    for (const key of PERSONAL) {
      for (const role of NON_STUDENT) {
        assert.equal(sectionAllowed(find(key), role, null), false, `${key} / ${role}`);
      }
    }
  });

  test("a per-user override cannot grant one", () => {
    for (const key of PERSONAL) {
      for (const role of NON_STUDENT) {
        assert.equal(
          sectionAllowed(find(key), role, { [key]: true }),
          false,
          `${key} / ${role} / override`,
        );
      }
    }
  });

  test("nor can the founder adding a role to its list in Console → Sections", () => {
    const classroom = find("classroom");
    const opened: ResolvedSection = { ...classroom, roles: ["COACH", "HEAD", "STUDENT"] };
    assert.equal(sectionAllowed(opened, "COACH", null), false);
    assert.equal(sectionAllowed(opened, "HEAD", null), false);
    assert.equal(sectionAllowed(opened, "STUDENT", null), true);
  });

  test("switching it off still takes it from the student", () => {
    assert.equal(sectionAllowed({ ...find("classroom"), enabled: false }, "STUDENT", null), false);
  });

  test("role defaults and the access dialog agree with the rule", () => {
    for (const key of PERSONAL) {
      for (const role of NON_STUDENT) {
        assert.equal(grantableTo(find(key), role), false, `${key} / ${role}`);
        assert.ok(!roleDefaultKeysFrom(SHIPPED, role).includes(key), `${key} / ${role} / default`);
      }
      assert.equal(grantableTo(find(key), "STUDENT"), true, key);
      assert.ok(roleDefaultKeysFrom(SHIPPED, "STUDENT").includes(key), `${key} / default`);
    }
  });
});

describe("the rest of the rule is unchanged", () => {
  test("an admin still sees an ordinary switched-on section they are not listed on", () => {
    const coaching = find("coaching");
    assert.equal(coaching.personal, false);
    assert.equal(sectionAllowed(coaching, "ADMIN", null), true);
    // ...and a section whose role list excludes them entirely.
    const myDesk = SHIPPED.find((s) => !s.personal && !s.locked && !s.roles.includes("ADMIN"));
    assert.ok(myDesk, "expected at least one non-admin section in the catalogue");
    assert.equal(sectionAllowed(myDesk, "ADMIN", null), true);
  });

  test("a switched-off section is closed to everyone, admin included", () => {
    assert.equal(sectionAllowed({ ...find("coaching"), enabled: false }, "ADMIN", null), false);
  });

  test("the locked console stays admin-only and on", () => {
    const console_ = find("console");
    assert.equal(console_.locked, true);
    assert.equal(console_.enabled, true);
    assert.equal(sectionAllowed(console_, "ADMIN", null), true);
    assert.equal(sectionAllowed(console_, "HEAD", { console: true }), false);
  });

  test("an override still beats the role default for an ordinary section", () => {
    const coaching = find("coaching");
    assert.equal(sectionAllowed(coaching, "USER", null), false);
    assert.equal(sectionAllowed(coaching, "USER", { coaching: true }), true);
    assert.equal(sectionAllowed(coaching, "COACH", { coaching: false }), false);
  });
});

/**
 * THE CODE-HIDDEN MECHANISM, WITH NOTHING LEFT USING IT.
 *
 * `resolveSections` supports a catalogue entry carrying `hidden: true`: it ships OFF - off the nav
 * AND refused by the route, for every role including ADMIN - and an explicit `enabled: true` saved
 * from Console -> Sections wins over that default. So switching such a feature back on is a
 * toggle, not a deploy.
 *
 * All three sections that used it are now gone: `cv-check` and `automation` were removed on
 * 23/10/2026, and `ledger` with them. So the mechanism is live code with no current users, and the
 * fuller tests it used to have cannot run - they needed a real hidden entry to resolve against.
 *
 * What is kept is therefore two things:
 *
 *   1. the ACCESS half, which needs no catalogue entry - `sectionAllowed` is a pure function over
 *      a `ResolvedSection`, so a switched-off section can be built by hand and asserted on. This
 *      is the half that matters: it is the one that decides whether a route opens.
 *   2. a RATCHET - if anybody adds `hidden: true` to the catalogue again, the last test fails and
 *      says to restore the `resolveSections` coverage with that entry as the fixture.
 *
 * Deleting the block outright was the alternative and would have been wrong: the rule outlives any
 * one section that happened to use it, and a mechanism with no test is how a toggle quietly stops
 * working between the day it is needed and the day it is tried.
 */
describe("a switched-off section", () => {
  /** A resolved section as `resolveSections` would hand one over, built by hand. */
  const off = (enabled: boolean): ResolvedSection => ({
    key: "finance" as SectionKey,
    href: "/finance",
    phase: 1,
    locked: false,
    personal: false,
    offRail: false,
    label: "Finance",
    icon: "wallet",
    group: "Finance",
    order: 10,
    enabled,
    roles: ["ADMIN", "HEAD"] as AppRole[],
  });

  test("nobody reaches a switched-off section - not even ADMIN", () => {
    // `sectionAllowed` asks "has the founder switched this off" FIRST, and the Admin bypass does
    // not skip that question. Off is off the route as well as off the nav.
    for (const role of ["ADMIN", "HEAD", "STUDENT", "USER"] as AppRole[]) {
      assert.equal(sectionAllowed(off(false), role, null), false, role);
    }
  });

  test("switched on, its normal role list applies again", () => {
    const shown = off(true);
    assert.equal(sectionAllowed(shown, "ADMIN", null), true);
    assert.equal(sectionAllowed(shown, "HEAD", null), true);
    // USER is not on this section's role list, so enabling it does not hand it to them.
    assert.equal(sectionAllowed(shown, "USER", null), false);
  });

  test("an override still cannot open a section the founder switched off", () => {
    // The order in `sectionAllowed` matters: `enabled` is checked before any override.
    assert.equal(sectionAllowed(off(false), "USER", { finance: true } as SectionOverrides), false);
  });

  /**
   * THE RATCHET. Nothing carries `hidden` today, so the `resolveSections` default-off path has no
   * fixture. If that changes, restore the tests this block replaced - they are in git history at
   * the commit that removed the Ledger - using the new entry as the fixture.
   */
  test("no catalogue entry uses `hidden` - if one does, restore the resolveSections coverage", () => {
    const hidden = SECTION_CATALOGUE.filter((s) => "hidden" in s && s.hidden === true).map((s) => s.key);
    assert.deepEqual(
      hidden,
      [],
      `a code-hidden section is back (${hidden.join(", ")}) - this block needs its resolveSections tests again`,
    );
  });
});

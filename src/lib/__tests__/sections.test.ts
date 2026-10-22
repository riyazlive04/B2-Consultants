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
  type AppRole,
  type ResolvedSection,
  type SectionKey,
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
 * A CODE-HIDDEN SECTION, AND THE CONSOLE'S OVERRIDE OF IT.
 *
 * This is the rule the CV Studio question turns on. `cv-check` carries `hidden: true` in the
 * catalogue - "since 14/10/2026 at the founder's request" - and the same walkthrough call
 * discussed students using it (@18:47, @39:55). That looked like a conflict needing a code
 * change, and it is not one: a code-hidden section ships OFF, and an explicit `enabled: true`
 * saved from Console -> Sections wins over that default. So the answer is a toggle, not a deploy.
 *
 * That makes `resolveSections`' override behaviour load-bearing for a founder decision, and it
 * was untested. These pin it, in both directions, plus the `offRail` consequence - because an
 * explicit "on" that left the section off the nav rail would be a toggle that appears to do
 * nothing, which is indistinguishable from the bug it was meant to fix.
 */
describe("a code-hidden section", () => {
  const entry = (key: SectionKey, enabled: boolean) => ({
    key,
    label: "CV Studio",
    icon: "file-search" as const,
    group: "Students" as const,
    order: 400,
    enabled,
    roles: ["ADMIN", "HEAD", "STUDENT"] as AppRole[],
  });

  const cv = (config: Parameters<typeof resolveSections>[0]) =>
    resolveSections(config).find((s) => s.key === "cv-check")!;

  test("ships OFF with no saved config at all", () => {
    assert.equal(cv(null).enabled, false);
  });

  test("an explicit Console 'on' overrides the code default", () => {
    // The whole reason the CV Studio question needs no code change.
    assert.equal(cv({ entries: [entry("cv-check", true)] }).enabled, true);
  });

  test("an explicit 'on' also puts it back on the nav rail", () => {
    // Otherwise the founder flips the switch, the route opens, and the link is still missing -
    // a toggle that appears to do nothing.
    assert.equal(cv({ entries: [entry("cv-check", true)] }).offRail, false);
  });

  test("an explicit Console 'off' keeps it off", () => {
    assert.equal(cv({ entries: [entry("cv-check", false)] }).enabled, false);
  });

  test("a saved row for OTHER sections does not switch it on by accident", () => {
    // `s?.enabled ?? !hiddenByCode` - the fallback has to key off THIS section's own row.
    const other = { ...entry("students" as SectionKey, true), key: "students" as SectionKey };
    assert.equal(cv({ entries: [other] }).enabled, false);
  });

  test("while hidden, nobody reaches it - not even ADMIN", () => {
    // `sectionAllowed` asks "has the founder switched this off" first, and the Admin bypass
    // does not skip that question. A hidden section is off the route as well as off the nav.
    const hidden = cv(null);
    for (const role of ["ADMIN", "HEAD", "STUDENT", "USER"] as AppRole[]) {
      assert.equal(sectionAllowed(hidden, role, null), false, role);
    }
  });

  test("once switched on, its normal role list applies again", () => {
    const shown = cv({ entries: [entry("cv-check", true)] });
    assert.equal(sectionAllowed(shown, "STUDENT", null), true);
    assert.equal(sectionAllowed(shown, "HEAD", null), true);
    // USER is not on `cv-check`'s role list, so enabling the section does not hand it to them.
    assert.equal(sectionAllowed(shown, "USER", null), false);
  });
});

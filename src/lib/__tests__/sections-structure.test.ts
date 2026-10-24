import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { APP_ROLES, SECTION_CATALOGUE, resolveSections, sectionAllowed, type AppRole } from "../sections";
import { GUIDES } from "../guide-content";

/**
 * STRUCTURAL INVARIANTS OF THE SECTION CATALOGUE.
 *
 * `sections.test.ts` covers the access RULE - who may open what. This file covers the shape of
 * the catalogue itself: does every door lead somewhere, does any two doors lead to the same
 * place, does any role see a group too big to skim, and is every door documented in the App
 * Guide.
 *
 * Written as the safety net for the flow refactor (docs/refactor/04-refactor-plan.md, step A1),
 * because every one of these is a rule the catalogue's own comments state and nothing enforced:
 *
 *   · "A section exists because a route exists."                        → `href` resolves
 *   · "none holds more than five items for any one role"                → group sizes
 *   · the App Guide "one short, practical how-to per feature"           → guide coverage
 *
 * The guide-coverage test is a RATCHET, not a pass/fail on today's state: it pins the known gap
 * so that adding an entry forces the list to shrink, and the list reaching empty is the
 * definition of done for step F3.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.join(here, "..", "..", "app");

/** Every route the App Router actually serves, as a section `href` would spell it. */
function routeSet(): Set<string> {
  const routes = new Set<string>();
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name === "page.tsx") {
        const route = full
          .slice(appDir.length)
          .split(path.sep)
          .join("/")
          .replace("/page.tsx", "")
          // Route groups are organisational only - they never appear in a URL.
          .replace("/(app)", "");
        routes.add(route === "" ? "/" : route);
      }
    }
  };
  walk(appDir);
  return routes;
}

describe("section catalogue - every door leads somewhere", () => {
  test("every href resolves to a real route", () => {
    const routes = routeSet();
    const broken = SECTION_CATALOGUE.filter((s) => !routes.has(s.href)).map((s) => `${s.key} → ${s.href}`);
    assert.deepEqual(broken, [], `catalogue entries pointing at no page: ${broken.join(", ")}`);
  });

  test("keys are unique", () => {
    const keys = SECTION_CATALOGUE.map((s) => s.key);
    assert.equal(new Set(keys).size, keys.length, "duplicate section key");
  });

  /**
   * `pipeline` and `opportunities` both pointed at /opportunities - the P7 duplicate-door
   * finding - until step E1 sent Pipeline back to /pipeline and renamed the board "Deals". No
   * two sections share an href now, so this list is empty and the test has turned from a
   * ratchet into an invariant: a new overlap has to be added here deliberately.
   */
  test("no two sections lead to the same page", () => {
    const byHref = new Map<string, string[]>();
    for (const s of SECTION_CATALOGUE) {
      byHref.set(s.href, [...(byHref.get(s.href) ?? []), s.key]);
    }
    const shared = [...byHref.entries()]
      .filter(([, keys]) => keys.length > 1)
      .map(([href, keys]) => `${href}: ${keys.sort().join(" + ")}`)
      .sort();
    assert.deepEqual(shared, [], `two doors to one page: ${shared.join(", ")}`);
  });

  test("a locked section is always admin-only and never switchable off", () => {
    for (const s of resolveSections(null).filter((x) => x.locked)) {
      assert.equal(s.enabled, true, `${s.key} is locked but not enabled`);
      assert.deepEqual(s.roles, ["ADMIN"], `${s.key} is locked but not admin-only`);
      assert.equal(s.offRail, false, `${s.key} is locked and should stay on the rail`);
    }
  });
});

describe("section catalogue - no role sees an unreadable group", () => {
  /**
   * The catalogue's own rule, quoted from its header: "none holds more than five items for any
   * one role". It was the reason Classroom was split out of My Work on 22 Oct 2026, and nothing
   * stopped the next addition from breaking it again.
   *
   * Counted on the RAIL - `offRail` sections are reachable but not listed, so they cost the
   * reader nothing.
   */
  test("no group holds more than five rail items for any one role", () => {
    const sections = resolveSections(null);
    const offenders: string[] = [];
    for (const role of APP_ROLES) {
      const counts = new Map<string, number>();
      for (const s of sections) {
        if (s.offRail) continue;
        if (!sectionAllowed(s, role, null)) continue;
        counts.set(s.group, (counts.get(s.group) ?? 0) + 1);
      }
      for (const [group, n] of counts) {
        if (n > 5) offenders.push(`${role}/${group}=${n}`);
      }
    }
    assert.deepEqual(offenders, [], `groups over five items: ${offenders.join(", ")}`);
  });

  test("no role is shown a group with nothing in it", () => {
    const sections = resolveSections(null);
    for (const role of APP_ROLES) {
      const groups = new Set(
        sections.filter((s) => !s.offRail && sectionAllowed(s, role, null)).map((s) => s.group),
      );
      for (const g of groups) {
        const n = sections.filter(
          (s) => s.group === g && !s.offRail && sectionAllowed(s, role, null),
        ).length;
        assert.ok(n > 0, `${role} sees an empty group ${g}`);
      }
    }
  });

  test("every role has at least one section to land on", () => {
    const sections = resolveSections(null);
    for (const role of APP_ROLES) {
      const n = sections.filter((s) => sectionAllowed(s, role, null)).length;
      assert.ok(n > 0, `${role} can open nothing at all`);
    }
  });
});

describe("App Guide coverage - closed, and kept closed", () => {
  /**
   * This was a RATCHET: a hardcoded list of the seventeen sections with no guide entry, pinned so
   * that it could only ever shrink. The gap measured on 23 Oct 2026 was the whole middle of the
   * business - Agreements, Batches, Bookings, Contacts, Outreach, My Desk and Payments were every
   * one of them a step in the lead → class journey, and not one of them was documented.
   *
   * Step F3 emptied it, so the list is gone and the test is now the plain invariant it was always
   * heading for: a section ships with a guide entry, or it does not ship. The catalogue's own
   * header states that rule ("one short, practical how-to per feature") and nothing enforced it
   * until this.
   */
  test("every section has a guide entry", () => {
    const documented = new Set(GUIDES.map((g) => g.section));
    const missing = SECTION_CATALOGUE.map((s) => s.key)
      .filter((k) => !documented.has(k))
      .sort();
    assert.deepEqual(
      missing,
      [],
      `shipped without a how-to: ${missing.join(", ")} - write the entry in lib/guide-content.ts`,
    );
  });

  test("no guide entry points at a section that does not exist", () => {
    const keys = new Set<string>(SECTION_CATALOGUE.map((s) => s.key));
    const orphans = GUIDES.filter((g) => g.section !== "general" && !keys.has(g.section)).map(
      (g) => g.section,
    );
    assert.deepEqual(orphans, [], `guide entries for removed sections: ${orphans.join(", ")}`);
  });

  test("every guide href resolves to a real route", () => {
    const routes = routeSet();
    const broken = GUIDES.filter((g) => !routes.has(g.href)).map((g) => `${g.title} → ${g.href}`);
    assert.deepEqual(broken, [], `guide entries linking nowhere: ${broken.join(", ")}`);
  });

  /**
   * A guide entry whose href disagrees with the catalogue's would send the reader somewhere other
   * than the screen it just described. `general` is exempt: it documents the notification bell,
   * which belongs to no section and points at the home page.
   */
  test("a guide entry and its section agree on where the screen is", () => {
    const hrefOf = new Map(SECTION_CATALOGUE.map((s) => [s.key as string, s.href]));
    const mismatched = GUIDES.filter((g) => g.section !== "general" && hrefOf.get(g.section) !== g.href).map(
      (g) => `${g.section}: guide ${g.href} vs catalogue ${hrefOf.get(g.section)}`,
    );
    assert.deepEqual(mismatched, []);
  });

  /**
   * A guide entry that references a screenshot which is not in `public/guide/` renders a broken
   * image inside the app's own help. The captures are produced by `npm run guide:shots` against a
   * LOCAL stack, so they are committed artefacts and can fall out of step with the entries that
   * name them - a re-capture that drops a shot, or an entry added before its picture is taken.
   */
  test("every screenshot a guide entry names actually exists", () => {
    const publicDir = path.join(here, "..", "..", "..", "public");
    const missing: string[] = [];
    for (const g of GUIDES) {
      for (const shot of g.shots ?? []) {
        const file = path.join(publicDir, shot.src.replace(/^\//, ""));
        if (!fs.existsSync(file)) missing.push(`${g.section} → ${shot.src}`);
      }
    }
    assert.deepEqual(missing, [], `guide entries naming images that are not there: ${missing.join(", ")}`);
  });

  test("every screenshot carries a caption, because an unlabelled one explains nothing", () => {
    for (const g of GUIDES) {
      for (const shot of g.shots ?? []) {
        assert.ok(shot.caption.trim().length > 10, `${g.section}: ${shot.src} has no real caption`);
      }
    }
  });

  /**
   * Hotspots are PERCENTAGES of the image, which is what lets a re-capture at a different window
   * size keep the box on its target. A value outside 0-100, or a box running off the edge, means
   * somebody has pasted pixels in.
   */
  test("a hotspot stays inside its image", () => {
    for (const g of GUIDES) {
      for (const shot of g.shots ?? []) {
        const h = shot.hotspot;
        if (!h) continue;
        for (const [k, v] of Object.entries({ x: h.x, y: h.y, w: h.w, h: h.h })) {
          assert.ok(v >= 0 && v <= 100, `${g.section}: ${shot.src} hotspot ${k}=${v} is not a percentage`);
        }
        assert.ok(h.x + h.w <= 100, `${g.section}: ${shot.src} hotspot runs off the right edge`);
        assert.ok(h.y + h.h <= 100, `${g.section}: ${shot.src} hotspot runs off the bottom`);
        assert.ok(h.label.trim().length > 0, `${g.section}: ${shot.src} hotspot has no label`);
      }
    }
  });

  /** Every entry written from step F1 onward carries its click path. The older ones predate it. */
  test("the click path, where present, starts at something the reader can see", () => {
    for (const g of GUIDES) {
      if (!g.path) continue;
      assert.ok(g.path.length > 0, `${g.title} has an empty path`);
      assert.match(
        g.path[0],
        /^(Sidebar|Home|Your)/,
        `${g.title}'s path starts at "${g.path[0]}" - begin where the reader's eyes are`,
      );
    }
  });
});

describe("roles", () => {
  test("APP_ROLES and the catalogue agree on which roles exist", () => {
    const used = new Set<AppRole>();
    for (const s of SECTION_CATALOGUE) for (const r of s.roles) used.add(r);
    for (const r of used) {
      assert.ok(APP_ROLES.includes(r), `catalogue grants to unknown role ${r}`);
    }
  });
});

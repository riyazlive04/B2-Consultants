import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SECTION_CATALOGUE, type SectionKey } from "../sections";
import { ENGINE_KEYS } from "../engines";
import { MANUALS, rulesMap } from "../guide/manual";
import { CONSOLE_PANELS, type ConsoleArea } from "../guide/manual-types";
import { MANUAL_SHOTS } from "../guide/shots.generated";

/**
 * THE APP MANUAL'S INVARIANTS.
 *
 * `sections-structure.test.ts` holds the thirty-second guide to the catalogue. This holds the deep
 * manual to three harder rules, each of which failed silently before it existed:
 *
 *   · every section has a manual, and no manual describes a section that is gone;
 *   · every "change this rule" link opens something that is really there - a Console panel that
 *     still exists, a tab index the page still has;
 *   · no visible string carries a long dash, which the PDF encoder and the brand voice both ban.
 *
 * A wrong link here is worse than a missing one: it teaches somebody that the setting they need
 * is not where the guide says, which is how a guide stops being read.
 */

/**
 * Where a click path may start.
 *
 * "Sidebar" for all but one: filing an improvement is offered from the TOP BAR on every screen,
 * for every role, so a path that claimed to start at the sidebar would be a lie about the one
 * feature every role can reach. Kept as a short closed list rather than dropped, because the
 * check is what stops a path beginning halfway through ("Money", "Commission").
 */
const PATH_ORIGINS = ["Sidebar", "Top bar"];

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.join(here, "..", "..", "app");
const sectionKeys = new Set<string>(SECTION_CATALOGUE.map((s) => s.key));

/**
 * How many tabs the `urlKey="tab"` strip on a page has.
 *
 * Counted by matching braces from `tabs={[` rather than by grepping for `label:`, because the
 * pages mix one-line entries with multi-line ones and an indentation rule silently under-counts
 * the one-liners - which made this check pass a link to a tab that does not exist.
 */
/** The strip's length depends on who is looking, so an index cannot be checked against it. */
const DYNAMIC = -1;

function countTabs(src: string): number {
  const keyed = src.indexOf('urlKey="tab"');
  if (keyed < 0) return 0;
  const open = src.indexOf("tabs={[", keyed);
  if (open < 0) return 0;

  let depth = 0;
  let tabs = 0;
  // A strip that splices tabs in conditionally (`...(isAdmin ? [...] : [])`) has no fixed length,
  // so there is nothing to count: Students shows five tabs to the founder and two to a telecaller,
  // and both are correct. DYNAMIC says "do not judge the index".
  let dynamic = false;
  // Quoted text and comments are skipped: a label like `Plans (${n})` and a comment mentioning
  // a brace both carry brackets that are not structure, and counting them lost whole tabs.
  const templateStack: number[] = [];
  for (let i = src.indexOf("[", open); i < src.length; i += 1) {
    const ch = src[i];
    const next = src[i + 1];

    if (ch === "/" && next === "/") {
      i = src.indexOf("\n", i);
      if (i < 0) break;
      continue;
    }
    if (ch === "/" && next === "*") {
      const end = src.indexOf("*/", i + 2);
      if (end < 0) break;
      i = end + 1;
      continue;
    }
    if (ch === '"' || ch === "'") {
      for (i += 1; i < src.length; i += 1) {
        if (src[i] === "\\") i += 1;
        else if (src[i] === ch) break;
      }
      continue;
    }
    if (ch === "`") {
      // A template literal ends at the backtick that is not inside a `${…}` of its own.
      for (i += 1; i < src.length; i += 1) {
        if (src[i] === "\\") i += 1;
        else if (src[i] === "$" && src[i + 1] === "{") {
          templateStack.push(depth);
          i += 1;
          break;
        } else if (src[i] === "`") break;
      }
      continue;
    }

    // A spread directly inside the array splices in an unknown number of tabs.
    if (ch === "." && src.slice(i, i + 3) === "..." && depth === 1) dynamic = true;

    if (ch === "[" || ch === "{") depth += 1;
    else if (ch === "]" || ch === "}") {
      // Closing a `${…}` returns to the template literal rather than the array.
      if (ch === "}" && templateStack.length > 0 && depth === templateStack[templateStack.length - 1]) {
        templateStack.pop();
        for (i += 1; i < src.length; i += 1) {
          if (src[i] === "\\") i += 1;
          else if (src[i] === "`") break;
        }
        continue;
      }
      depth -= 1;
      if (depth === 0) break;
      continue;
    }
    // A `{` directly inside the array literal opens one tab object.
    if (ch === "{" && depth === 2 && templateStack.length === 0) tabs += 1;
  }
  return dynamic ? DYNAMIC : tabs;
}

/** Every string a reader actually sees, with a label saying where it came from. */
function visibleStrings(): { at: string; text: string }[] {
  const out: { at: string; text: string }[] = [];
  for (const m of MANUALS) {
    out.push({ at: `${m.section} overview`, text: m.overview });
    for (const q of m.faq ?? []) out.push({ at: `${m.section} faq`, text: `${q.q} ${q.a}` });
    for (const r of m.related ?? []) out.push({ at: `${m.section} related`, text: r.why });
    for (const f of m.features) {
      const at = `${m.section} › ${f.id}`;
      out.push({ at, text: [f.name, f.what, ...f.where, ...f.use, ...f.logic, ...(f.watchOut ?? [])].join(" ") });
      if (f.shot) out.push({ at: `${at} shot`, text: `${f.shot.caption} ${f.shot.highlight?.label ?? ""}` });
      for (const c of f.controls ?? []) {
        out.push({ at: `${at} control`, text: [c.setting, ...c.where, c.default ?? "", c.effect, c.reset ?? ""].join(" ") });
      }
    }
  }
  return out;
}

describe("app manual - one per section, none orphaned", () => {
  test("every section has a manual", () => {
    const documented = new Set(MANUALS.map((m) => m.section));
    const missing = SECTION_CATALOGUE.map((s) => s.key)
      .filter((k) => !documented.has(k))
      .sort();
    assert.deepEqual(missing, [], `no manual for: ${missing.join(", ")} - write it in lib/guide/manual-*.ts`);
  });

  test("no manual describes a section that does not exist", () => {
    const orphans = MANUALS.map((m) => m.section).filter((s) => !sectionKeys.has(s));
    assert.deepEqual(orphans, [], `manuals for removed sections: ${orphans.join(", ")}`);
  });

  test("exactly one manual per section", () => {
    const seen = new Map<string, number>();
    for (const m of MANUALS) seen.set(m.section, (seen.get(m.section) ?? 0) + 1);
    const dupes = [...seen].filter(([, n]) => n > 1).map(([k, n]) => `${k} x${n}`);
    assert.deepEqual(dupes, [], `a section with two manuals cannot be rendered: ${dupes.join(", ")}`);
  });

  test("every manual has features, and every feature says how to use it and why it works", () => {
    for (const m of MANUALS) {
      assert.ok(m.features.length > 0, `${m.section}: a manual with no features is an empty page`);
      assert.ok(m.overview.trim().length > 30, `${m.section}: overview is too thin to orient anybody`);
      for (const f of m.features) {
        assert.ok(f.use.length >= 2, `${m.section} › ${f.id}: fewer than two steps is not a how-to`);
        assert.ok(f.logic.length >= 2, `${m.section} › ${f.id}: fewer than two logic notes explains nothing`);
        assert.ok(f.where.length >= 2, `${m.section} › ${f.id}: no click path`);
        assert.ok(
          PATH_ORIGINS.includes(f.where[0] ?? ""),
          `${m.section} › ${f.id}: a click path starts from ${PATH_ORIGINS.join(" or ")}, not "${f.where[0]}"`,
        );
      }
    }
  });

  /** Feature ids are URL anchors and React keys - a duplicate silently scrolls to the wrong block. */
  test("feature ids are unique within a section and look like anchors", () => {
    for (const m of MANUALS) {
      const ids = m.features.map((f) => f.id);
      assert.deepEqual(ids, [...new Set(ids)], `${m.section}: duplicate feature id`);
      for (const id of ids) {
        assert.match(id, /^[a-z0-9][a-z0-9-]*$/, `${m.section}: "${id}" is not a kebab-case anchor`);
      }
    }
  });

  test("every engine a manual names is a real engine", () => {
    const keys = new Set<string>(ENGINE_KEYS);
    for (const m of MANUALS) {
      for (const e of m.engines ?? []) {
        assert.ok(keys.has(e), `${m.section}: "${e}" is not an engine in lib/engines.ts`);
      }
    }
  });

  test("every related section exists and is not itself", () => {
    for (const m of MANUALS) {
      for (const r of m.related ?? []) {
        assert.ok(sectionKeys.has(r.section), `${m.section}: related section "${r.section}" does not exist`);
        assert.notEqual(r.section, m.section, `${m.section}: related to itself`);
      }
    }
  });
});

describe("app manual - every link opens something that is there", () => {
  /**
   * THE CONSOLE LINK TEST, and the reason `consoleHref` is typed the way it is.
   *
   * A guide that points at `Console → Money → Payment Types` when that panel has been renamed
   * sends the founder hunting for a setting the app no longer spells that way. The ids are shared
   * with the Console page itself, so this checks the written href too - a hand-typed query string
   * would slip past the types.
   */
  test("every console link names a real area and panel", () => {
    const bad: string[] = [];
    for (const m of MANUALS) {
      for (const f of m.features) {
        for (const c of f.controls ?? []) {
          if (!c.href.startsWith("/console")) continue;
          const q = new URLSearchParams(c.href.split("?")[1] ?? "");
          const area = q.get("area") as ConsoleArea | null;
          const panel = q.get("panel");
          const panels: readonly string[] = area && area in CONSOLE_PANELS ? CONSOLE_PANELS[area] : [];
          if (!area || !(area in CONSOLE_PANELS)) bad.push(`${m.section} › ${f.id}: no such console area "${area}"`);
          else if (!panel || !panels.includes(panel)) {
            bad.push(`${m.section} › ${f.id}: "${panel}" is not a panel of ${area}`);
          }
        }
      }
    }
    assert.deepEqual(bad, [], bad.join("\n"));
  });

  /** Every console panel id is wired into the console page, so no link lands on a default tab. */
  test("the console page carries every panel id the guide can link to", () => {
    const page = fs.readFileSync(path.join(appDir, "(app)", "console", "page.tsx"), "utf8");
    for (const [area, panels] of Object.entries(CONSOLE_PANELS)) {
      assert.match(page, new RegExp(`id: "${area}"`), `console page has no tab id for the ${area} area`);
      panels.forEach((_, i) => {
        assert.ok(
          page.includes(`P.${area}[${i}]`),
          `console page does not use P.${area}[${i}] - a guide link to it would open the first panel instead`,
        );
      });
    }
  });

  test("every other link resolves to a real route", () => {
    const routes = new Set<string>();
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name === "page.tsx") {
          const route = full.slice(appDir.length).split(path.sep).join("/").replace("/page.tsx", "").replace("/(app)", "");
          routes.add(route === "" ? "/" : route);
        }
      }
    };
    walk(appDir);
    // A dynamic segment matches any value, and the capture script resolves `[first]` itself.
    const resolves = (href: string) => {
      const p = href.split(/[?#]/)[0];
      if (routes.has(p)) return true;
      return [...routes].some((r) => {
        if (!r.includes("[")) return false;
        const re = new RegExp(`^${r.replace(/\[[^\]]+\]/g, "[^/]+")}$`);
        return re.test(p);
      });
    };
    const bad: string[] = [];
    for (const m of MANUALS) {
      for (const f of m.features) {
        if (f.href && !resolves(f.href)) bad.push(`${m.section} › ${f.id}: ${f.href}`);
        for (const c of f.controls ?? []) {
          if (!resolves(c.href)) bad.push(`${m.section} › ${f.id} control: ${c.href}`);
        }
        if (f.shot && !resolves(f.shot.route)) bad.push(`${m.section} › ${f.id} shot: ${f.shot.route}`);
      }
    }
    assert.deepEqual(bad, [], `manual links pointing at no page:\n${bad.join("\n")}`);
  });

  /**
   * A `?tab=N` deep link is only honoured by a strip that opted into the URL, and only for a tab
   * it actually has. Both halves failed quietly before: a link to an un-keyed strip opens the
   * first tab, and an index past the end opens the first tab too, so the guide would describe
   * Subscriptions while showing Invoices.
   */
  test("every tab deep link points at a tab the page has", () => {
    const bad: string[] = [];
    const sourceFor = (route: string) => {
      const file = path.join(appDir, "(app)", route.split(/[?#]/)[0].replace(/^\//, ""), "page.tsx");
      return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
    };
    for (const m of MANUALS) {
      for (const f of m.features) {
        for (const href of [f.href, f.shot?.route]) {
          if (!href) continue;
          const tab = new URLSearchParams(href.split("?")[1] ?? "").get("tab");
          if (tab === null || href.startsWith("/console")) continue;
          const src = sourceFor(href);
          if (!src) continue;
          if (!src.includes('urlKey="tab"')) {
            bad.push(`${m.section} › ${f.id}: ${href} - that page's tabs are not addressable`);
            continue;
          }
          const n = Number(tab);
          const count = countTabs(src);
          if (Number.isFinite(n) && count > 0 && count !== DYNAMIC && n >= count) {
            bad.push(`${m.section} › ${f.id}: ${href} - the strip has ${count} tabs`);
          }
        }
      }
    }
    assert.deepEqual(bad, [], bad.join("\n"));
  });
});

describe("app manual - the screenshots", () => {
  test("every shot names a file in the manual folder, and a captured one is really there", () => {
    const publicDir = path.join(here, "..", "..", "..", "public");
    const bad: string[] = [];
    for (const m of MANUALS) {
      for (const f of m.features) {
        if (!f.shot) continue;
        assert.match(f.shot.file, /^[a-z0-9][a-z0-9-]*\.png$/, `${m.section} › ${f.id}: odd shot file name`);
        assert.ok(f.shot.caption.trim().length > 10, `${m.section} › ${f.id}: shot has no real caption`);
        const captured = MANUAL_SHOTS[f.shot.file];
        if (captured && !fs.existsSync(path.join(publicDir, captured.src.replace(/^\//, "")))) {
          bad.push(`${m.section} › ${f.id}: manifest lists ${captured.src}, which is not in public/`);
        }
      }
    }
    assert.deepEqual(bad, [], bad.join("\n"));
  });

  test("a captured hotspot is a percentage box inside its image", () => {
    for (const [file, shot] of Object.entries(MANUAL_SHOTS)) {
      const h = shot.hotspot;
      if (!h) continue;
      for (const [k, v] of Object.entries(h)) {
        assert.ok(v >= 0 && v <= 100, `${file}: hotspot ${k}=${v} is not a percentage`);
      }
      assert.ok(h.x + h.w <= 100.5, `${file}: hotspot runs off the right edge`);
      assert.ok(h.y + h.h <= 100.5, `${file}: hotspot runs off the bottom`);
    }
  });

  test("no two features claim the same screenshot file", () => {
    const owner = new Map<string, string>();
    for (const m of MANUALS) {
      for (const f of m.features) {
        if (!f.shot) continue;
        const prev = owner.get(f.shot.file);
        assert.equal(prev, undefined, `${f.shot.file} is claimed by both ${prev} and ${m.section} › ${f.id}`);
        owner.set(f.shot.file, `${m.section} › ${f.id}`);
      }
    }
  });
});

describe("app manual - the rules map", () => {
  test("every control says who can change it and what a change does", () => {
    for (const m of MANUALS) {
      for (const f of m.features) {
        for (const c of f.controls ?? []) {
          assert.ok(c.who.length > 0, `${m.section} › ${f.id}: "${c.setting}" says nobody can change it`);
          assert.ok(c.effect.trim().length > 15, `${m.section} › ${f.id}: "${c.setting}" does not say what a change does`);
          assert.ok(
            PATH_ORIGINS.includes(c.where[0] ?? ""),
            `${m.section} › ${f.id}: "${c.setting}" has no click path`,
          );
        }
      }
    }
  });

  /** The map is derived; if it comes back empty the derivation has broken, not the content. */
  test("the rules map folds the controls without losing any", () => {
    const written = MANUALS.flatMap((m) => m.features.flatMap((f) => f.controls ?? []));
    const map = rulesMap();
    const mapped = map.flatMap((g) => g.rows);
    assert.ok(map.length > 0, "the rules map is empty");
    assert.ok(mapped.length <= written.length, "the map invented rows");
    assert.ok(
      mapped.every((r) => r.usedBy.length > 0),
      "a mapped rule lists no screen that follows it",
    );
    // Nothing is dropped: every setting written somewhere appears somewhere in the map.
    const inMap = new Set(mapped.map((r) => r.setting.trim().toLowerCase()));
    const lost = [...new Set(written.map((c) => c.setting.trim().toLowerCase()))].filter((s) => !inMap.has(s));
    assert.deepEqual(lost, [], `settings missing from the rules map: ${lost.join(", ")}`);
  });
});

/**
 * NO LONG DASHES IN ANYTHING A READER SEES.
 *
 * Two separate reasons, both already learned the hard way in this repo: the PDF writer encodes
 * win-ansi and turns an em dash into a mojibake box, and the house style spells an aside with " - ".
 * The manuals are the largest body of prose in the app, so they are where this would creep back in.
 */
describe("app manual - house style", () => {
  test("no em or en dash in visible text", () => {
    const bad = visibleStrings()
      .filter((s) => /[—–]/.test(s.text))
      .map((s) => s.at);
    assert.deepEqual(bad, [], `long dash in: ${bad.join(", ")} - use " - " instead`);
  });

  test("no file, function or table names leak into the prose", () => {
    const bad = visibleStrings()
      .filter((s) => /\b[\w-]+\.(ts|tsx)\b|\bprisma\.|\brequireAdmin\b/.test(s.text))
      .map((s) => s.at);
    assert.deepEqual(bad, [], `developer detail in reader-facing text: ${bad.join(", ")}`);
  });
});

/** Nothing in the manual may claim a section key that the section catalogue spells differently. */
test("manual section keys are catalogue keys", () => {
  const typed: SectionKey[] = MANUALS.map((m) => m.section);
  assert.equal(typed.length, MANUALS.length);
});

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * THE ENGINE MAP CANNOT DRIFT FROM THE SCREENS.
 *
 * `server/improvement-context.ts` holds `SECTION_ENGINES` so that a report filed on /payments carries
 * the dunning verdict - the single most useful thing in the capture, because most engines in this
 * app ship OFF and "this section does nothing" is usually not a bug.
 *
 * That map RESTATES knowledge the eight feature pages already hold inline, one `enginesOff([...])`
 * call each. A server action cannot read a page's local argument list, so restating it is the only
 * option - and a restated list is worth nothing without something that fails when it goes stale.
 * That is this file.
 *
 * Same device as `cron-stale-thresholds.test.ts`, which keeps the crontab and the staleness table
 * in step by reading both files as text, and for the same reason: the two definitions live in
 * places that cannot import each other.
 *
 * A SOURCE SCAN, deliberately. Importing `improvement-context.ts` would pull in prisma, founder-config
 * and the delivery-health query for a test about two lists of strings.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..", "..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");

/** The `enginesOff(["a", "b"])` calls in a page, as the set of keys they name. */
function enginesNamedBy(source: string): string[] {
  const keys: string[] = [];
  for (const call of source.matchAll(/enginesOff\(\s*\[([^\]]*)\]/g)) {
    for (const quoted of call[1].matchAll(/["']([a-zA-Z]+)["']/g)) keys.push(quoted[1]);
  }
  return keys;
}

/** `SECTION_ENGINES` read out of its own source, as `{ section: keys }`. */
function sectionEnginesMap(): Record<string, string[]> {
  const source = read("server/improvement-context.ts");
  const block = source.match(/SECTION_ENGINES[^=]*=\s*\{([\s\S]*?)\n\};/);
  assert.ok(block, "SECTION_ENGINES is not where this test expects it in server/improvement-context.ts");
  const out: Record<string, string[]> = {};
  for (const row of block[1].matchAll(/^\s*([a-zA-Z]+):\s*\[([^\]]*)\]/gm)) {
    out[row[1]] = [...row[2].matchAll(/["']([a-zA-Z]+)["']/g)].map((m) => m[1]);
  }
  return out;
}

/** Every `(app)` page that asks about an engine, as `{ sectionKey: [engine keys] }`. */
function pagesNamingEngines(): Record<string, string[]> {
  const appDir = path.join(root, "app", "(app)");
  const out: Record<string, string[]> = {};
  for (const entry of fs.readdirSync(appDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith("_")) continue;
    const page = path.join(appDir, entry.name, "page.tsx");
    if (!fs.existsSync(page)) continue;
    const keys = enginesNamedBy(fs.readFileSync(page, "utf8"));
    if (keys.length) out[entry.name] = keys;
  }
  return out;
}

describe("the improvement context knows which engine belongs to which screen", () => {
  test("at least one page is still asking about an engine", () => {
    // Guards the guard: if `enginesOff` is ever renamed, the scan above would silently find
    // nothing and every assertion below would pass over an empty set.
    const pages = pagesNamingEngines();
    assert.ok(
      Object.keys(pages).length >= 5,
      `only found ${Object.keys(pages).length} pages calling enginesOff - has it been renamed?`,
    );
  });

  test("every engine a screen names is in SECTION_ENGINES for that screen", () => {
    const map = sectionEnginesMap();
    const missing: string[] = [];
    for (const [section, keys] of Object.entries(pagesNamingEngines())) {
      for (const key of keys) {
        if (!map[section]?.includes(key)) missing.push(`${section} → ${key}`);
      }
    }
    assert.deepEqual(
      missing,
      [],
      `a report from these screens would not carry the verdict the screen itself shows: ${missing.join(", ")} - add it to SECTION_ENGINES in server/improvement-context.ts`,
    );
  });

  test("SECTION_ENGINES names no screen that asks about nothing", () => {
    const pages = pagesNamingEngines();
    const orphans = Object.keys(sectionEnginesMap()).filter((section) => !pages[section]);
    assert.deepEqual(
      orphans,
      [],
      `these sections hold engines no page asks about, so the map has outlived the screen: ${orphans.join(", ")}`,
    );
  });

  /**
   * The keys have to be real. `enginesOff` is typed, so a page cannot name a non-existent engine -
   * but `SECTION_ENGINES` is keyed by section with a `string` index, so a typo there would compile
   * and then silently report nothing for that screen, for ever.
   */
  test("every engine key in the map is a real engine", () => {
    const engines = read("lib/engines.ts");
    const declared = new Set(
      [...engines.matchAll(/^\s*\|\s*"([a-zA-Z]+)"/gm)].map((m) => m[1]),
    );
    assert.ok(declared.size > 10, "could not read the EngineKey union out of lib/engines.ts");
    const unknown: string[] = [];
    for (const [section, keys] of Object.entries(sectionEnginesMap())) {
      for (const key of keys) if (!declared.has(key)) unknown.push(`${section} → ${key}`);
    }
    assert.deepEqual(unknown, [], `not real engines: ${unknown.join(", ")}`);
  });
});

describe("the improvement context does not re-derive scrubbing", () => {
  /**
   * `recentErrors()` and a channel's `lastError` are exactly the strings that carry a connection
   * string: a Prisma connection failure embeds `postgres://user:password@host/db`, and that is
   * the error most worth reporting. `scrubContext` already strips it, and it is the one copy of
   * that knowledge in the codebase.
   *
   * So this asserts the capture goes through it, and that this module has not grown a second
   * scrubber of its own - the way a second one gets written is by somebody not knowing the first
   * exists.
   */
  test("the captured context is returned through scrubContext", () => {
    const source = read("server/improvement-context.ts");
    assert.match(source, /scrubContext/, "the improvement context is stored without being scrubbed");
    assert.match(
      source,
      /return scrubContext\(context\)/,
      "scrubContext is imported but the context is not returned through it",
    );
  });

  test("it defines no redaction patterns of its own", () => {
    const source = read("server/improvement-context.ts");
    for (const smell of [/postgres\(\?:ql\)\?/, /redacted/i, /DENY_KEY/]) {
      assert.doesNotMatch(
        source,
        smell,
        "this module is re-implementing scrubbing - there is one copy, in lib/observability.ts",
      );
    }
  });
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Every app page must use one of the two shared headers.
 *
 * ── What this stops ─────────────────────────────────────────────────────────────
 * Five pages had hand-rolled their own header strip - each with its own icon chip, its own type
 * scale, its own action slot - which is why the app's screens read like five different products.
 * Converting them is a one-off; this test is what stops the sixth appearing, because nothing
 * about a bespoke `<h1>` fails a build or a review by itself.
 *
 * ── The rule ────────────────────────────────────────────────────────────────────
 *   ListHeader - record-list screens (a count and a filter bar)
 *   PageHeader - everything else
 *
 * If you are adding a page and this test fails, use one of them rather than adding to the
 * exemption list. The exemptions below are pages that genuinely have no header, and each says
 * why - a bare filename there would defeat the point.
 */

const APP_DIR = join(process.cwd(), "src", "app", "(app)");

/** Pages that legitimately render no header, with the reason. */
const EXEMPT: Record<string, string> = {
  "page.tsx": "the dashboard - its own MonthHero IS the header",
};

function pageFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      // `_components` holds the panels a page composes, not pages.
      if (entry.startsWith("_")) continue;
      pageFiles(full, acc);
    } else if (entry === "page.tsx") {
      acc.push(full);
    }
  }
  return acc;
}

test("every app page uses PageHeader or ListHeader", () => {
  const offenders: string[] = [];

  for (const file of pageFiles(APP_DIR)) {
    const rel = file.slice(APP_DIR.length + 1).replaceAll("\\", "/");
    if (EXEMPT[rel]) continue;

    const src = readFileSync(file, "utf8");
    const usesShared = src.includes("<PageHeader") || src.includes("<ListHeader");
    if (usesShared) continue;

    /**
     * A page may also delegate its header to a component it renders (a detail page handing the
     * record to a client component that headers it). Only flag pages that render their OWN
     * `<h1>` - that is the hand-rolled case, and the one that drifts.
     */
    if (src.includes("<h1")) offenders.push(rel);
  }

  assert.deepEqual(
    offenders,
    [],
    `These pages hand-roll a header instead of using PageHeader/ListHeader:\n  ${offenders.join("\n  ")}\n` +
      `Use one of the shared headers, or add the page to EXEMPT with the reason.`,
  );
});

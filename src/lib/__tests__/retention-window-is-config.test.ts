import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_MAINTENANCE_CONFIG,
  coerceMaintenanceConfig,
  maintenanceConfigSchema,
} from "../config-schema";
import { RETENTION_DAYS, retentionCutoff } from "../soft-delete";

/**
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *  THE ARCHIVE WINDOW IS CONFIG, AND IT IS THE DANGEROUS ONE  (1 Nov 2026)
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `maintenanceConfig.retention.archiveDays` decides when an archived record is **destroyed** -
 * leads, invoices, income, expenses, cascades included. It used to live in a bare
 * `AppSetting("retentionDays")` row with its own `parseInt` reader, and **no screen wrote it**:
 * the most destructive number in the app was the only one with no Console field, sitting beside
 * two gentler windows that each had one.
 *
 * What this file guards, in order of how much damage the failure does:
 *
 *   1. THE FLOOR. On the two neighbouring fields 0 means "skip this line" and is safe. Here it
 *      would mean a cutoff of `now` - purging the ENTIRE archive on the next tick. A reader
 *      primed by those fields would expect the opposite, so 0 must be impossible to save. §2.
 *   2. THE DEFAULT. 90 days, the same constant the purge used before this was configurable, so
 *      nothing changed on the day it shipped. §1.
 *   3. THE LITERAL COMING BACK. The purge must read the config, not re-read the retired key. §3.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RETENTION_SRC = path.join(HERE, "..", "..", "server", "retention.ts");
const PANEL_SRC = path.join(
  HERE, "..", "..", "app", "(app)", "console", "_components", "MaintenancePanel.tsx",
);

/** Comments stripped: prose may name the retired key, executable code may not obey it. */
function code(file: string): string {
  return fs
    .readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

/* ───────────────────────────── §1 the default is the old behaviour ───────────────────────── */

describe("the default is the window the purge already used", () => {
  test("it is RETENTION_DAYS, read from the same constant rather than retyped", () => {
    assert.equal(DEFAULT_MAINTENANCE_CONFIG.retention.archiveDays, RETENTION_DAYS);
    assert.equal(RETENTION_DAYS, 90);
  });

  test("the neighbouring windows and the switch are untouched", () => {
    assert.equal(DEFAULT_MAINTENANCE_CONFIG.retention.enabled, false, "pruning still ships OFF");
    assert.equal(DEFAULT_MAINTENANCE_CONFIG.retention.whatsAppMessageDays, 365);
    assert.equal(DEFAULT_MAINTENANCE_CONFIG.retention.expiredInviteDays, 30);
  });

  test("a config stored before this field existed still parses, and gains the default", () => {
    // Without `.default()` the whole stored document would fail to parse, and coercion would
    // reset the founder's two windows AND re-enable nothing - a silent loss of their settings.
    const legacy = coerceMaintenanceConfig({
      fxPrewarm: { enabled: true },
      overdueSweep: { enabled: true },
      retention: { enabled: true, whatsAppMessageDays: 30, expiredInviteDays: 7 },
    });
    assert.equal(legacy.retention.enabled, true, "the stored switch survived");
    assert.equal(legacy.retention.whatsAppMessageDays, 30, "the stored window survived");
    assert.equal(legacy.retention.expiredInviteDays, 7, "the stored window survived");
    assert.equal(legacy.retention.archiveDays, RETENTION_DAYS, "the new field defaulted");
  });

  test("an absent or unreadable config reads as the shipped default", () => {
    for (const bad of [null, undefined, "nonsense", [], 7]) {
      assert.deepEqual(
        coerceMaintenanceConfig(bad),
        DEFAULT_MAINTENANCE_CONFIG,
        `coerce failed on ${String(bad)}`,
      );
    }
  });

  test("the default window still produces a cutoff 90 days back", () => {
    const cutoff = retentionCutoff(DEFAULT_MAINTENANCE_CONFIG.retention.archiveDays);
    const days = (Date.now() - cutoff.getTime()) / 86_400_000;
    assert.ok(Math.abs(days - 90) < 0.01, `cutoff was ${days} days back, expected 90`);
  });
});

/* ───────────────────────────── §2 the floor that stops a wipe ────────────────────────────── */

describe("the schema refuses a window that would destroy the archive", () => {
  const withArchive = (archiveDays: number) =>
    maintenanceConfigSchema.safeParse({
      fxPrewarm: { enabled: true },
      overdueSweep: { enabled: true },
      retention: { enabled: true, whatsAppMessageDays: 365, expiredInviteDays: 30, archiveDays },
    });

  /**
   * THE ASSERTION THIS FILE EXISTS FOR. 0 is accepted on both neighbouring fields and means
   * "skip"; here it would mean "cutoff = now", i.e. purge everything ever archived.
   */
  test("zero is refused, even though it is legal on the fields beside it", () => {
    assert.equal(withArchive(0).success, false, "0 days would purge the entire archive");
  });

  test("a negative window is refused", () => {
    assert.equal(withArchive(-1).success, false);
  });

  test("a fractional window is refused rather than silently floored", () => {
    assert.equal(withArchive(90.5).success, false);
  });

  test("the bounds themselves are accepted", () => {
    assert.equal(withArchive(1).success, true, "one day is legitimate, if reckless");
    assert.equal(withArchive(3650).success, true, "ten years");
  });

  test("past ten years is refused", () => {
    assert.equal(withArchive(3651).success, false);
  });

  test("a document carrying a bad window falls back whole rather than purging on a guess", () => {
    const got = coerceMaintenanceConfig({
      fxPrewarm: { enabled: true },
      overdueSweep: { enabled: true },
      retention: { enabled: true, whatsAppMessageDays: 365, expiredInviteDays: 30, archiveDays: 0 },
    });
    assert.equal(
      got.retention.archiveDays,
      RETENTION_DAYS,
      "an unparseable window must never resolve to something shorter than the default",
    );
    assert.ok(
      got.retention.archiveDays >= RETENTION_DAYS,
      "falling back must never SHORTEN the window - that would delete more, not less",
    );
  });
});

/* ───────────────────────────── §3 the purge reads the config ─────────────────────────────── */

describe("the purge takes its window from the config", () => {
  test("it reads maintenanceConfig, not the retired bare key", () => {
    const src = code(RETENTION_SRC);
    assert.ok(src.includes("cfg.retention.archiveDays"), "the purge no longer reads archiveDays");
    assert.ok(
      !/const\s+days\s*=\s*await\s+retentionDays\(\)/.test(src),
      "the old ad-hoc reader is back in the purge path",
    );
  });

  test("the retired key is read for reporting only, never obeyed", () => {
    const src = code(RETENTION_SRC);
    // It may still be READ - that is how `legacyIgnored` warns about a hand-set value - but the
    // cutoff must not be computed from it, or the new Console field saves a number nothing reads.
    assert.ok(src.includes("legacyArchiveDays"), "the legacy reporter is gone");
    assert.ok(
      !/days\s*=\s*legacy/.test(src),
      "the legacy value is being obeyed again, so the Console field is decorative",
    );
  });

  test("an ignored legacy value is surfaced on the result rather than swallowed", () => {
    const src = code(RETENTION_SRC);
    assert.ok(src.includes("legacyIgnored"), "nothing reports a hand-set value being ignored");
  });

  /**
   * Scoped to `runRetentionPurge`, not to the file. `runRetentionSweep` is a separate job that
   * legitimately reads the same document for its own two windows - one read each is right, and
   * an earlier draft of this test wrongly counted both and failed.
   */
  test("the purge reads the switch and the window from one document, once", () => {
    const src = code(RETENTION_SRC);
    const from = src.indexOf("export async function runRetentionPurge");
    const to = src.indexOf("export async function runRetentionSweep");
    assert.ok(from >= 0 && to > from, "could not locate runRetentionPurge in the source");
    const purge = src.slice(from, to);
    const reads = purge.match(/await\s+getMaintenanceConfig\(\)/g) ?? [];
    assert.equal(
      reads.length,
      1,
      "the purge reads the maintenance config more or less than once - the switch and the window " +
        "must come from the SAME read, or they can disagree mid-run",
    );
  });
});

/* ───────────────────────────── §4 the panel says what it does ────────────────────────────── */

describe("the Console field exists and is honest about the floor", () => {
  test("the panel edits archiveDays", () => {
    const src = code(PANEL_SRC);
    assert.ok(src.includes("archiveDays"), "the Maintenance panel does not edit the archive window");
  });

  test("its minimum is 1, not 0", () => {
    const src = code(PANEL_SRC);
    const field = src.slice(src.indexOf("Archive retention days"));
    assert.match(
      field.slice(0, 400),
      /min=\{1\}/,
      "the archive field offers a 0 the schema will reject - and 0 reads as 'keep forever' on " +
        "the two fields beside it, which is the opposite of what it would do here",
    );
  });
});

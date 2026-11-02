import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_PIPELINE_CONFIG,
  coercePipelineConfig,
  pipelineConfigSchema,
} from "../config-schema";

/**
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *  THE KANBAN CARD CAP IS CONFIG, AND THE BOARD ADMITS WHEN IT IS A SLICE  (1 Nov 2026)
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * The board has always loaded the newest 300 open-stage leads. Nothing said so. A business with
 * 412 open leads was looking at a board it believed was its pipeline, 112 short, with no way to
 * find out - the cap was discoverable only by reading `pipeline-metrics.ts`.
 *
 * Two things changed, and the ORDER of importance is the opposite of what it looks like:
 *   1. the board now reports `total` beside the page, so it can say "showing 300 of 412";
 *   2. the cap is the founder's number.
 *
 * (1) is the fix. (2) is what makes (1) actionable. A test that only checked the number was
 * editable would pass on a board that still lied.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(HERE, "..", "..", "server");
const PIPELINE_UI = path.join(HERE, "..", "..", "app", "(app)", "pipeline", "_components");

/** Source with comments stripped: prose may quote 300, executable code may not. */
function code(file: string): string {
  return fs
    .readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

describe("the default is the behaviour it replaced", () => {
  test("the shipped cap is still 300", () => {
    assert.equal(DEFAULT_PIPELINE_CONFIG.kanbanCardLimit, 300);
  });

  test("the other two pipeline settings are untouched", () => {
    assert.equal(DEFAULT_PIPELINE_CONFIG.mode, "rules");
    assert.equal(DEFAULT_PIPELINE_CONFIG.autoCreateOpportunity, true);
  });

  test("a config stored before the cap existed still parses, and gains the default", () => {
    // Without `.default()` on the new field, every previously stored config would fail to parse
    // and silently reset the founder's mode and auto-filing choice.
    const legacy = coercePipelineConfig({ mode: "drag_drop", autoCreateOpportunity: false });
    assert.equal(legacy.mode, "drag_drop", "the stored mode survived");
    assert.equal(legacy.autoCreateOpportunity, false, "the stored switch survived");
    assert.equal(legacy.kanbanCardLimit, 300, "the new field defaulted");
  });

  test("an absent or unreadable config reads as the shipped default", () => {
    for (const bad of [null, undefined, "nonsense", [], 7]) {
      assert.deepEqual(coercePipelineConfig(bad), DEFAULT_PIPELINE_CONFIG, `coerce failed on ${String(bad)}`);
    }
  });
});

describe("the schema refuses a cap that would break the board", () => {
  const withLimit = (kanbanCardLimit: number) =>
    pipelineConfigSchema.safeParse({ mode: "rules", autoCreateOpportunity: true, kanbanCardLimit });

  test("a board that shows almost nothing is refused", () => {
    assert.equal(withLimit(49).success, false);
    assert.equal(withLimit(0).success, false);
    assert.equal(withLimit(-1).success, false);
  });

  test("a cap past the render budget is refused", () => {
    // Every card renders at once; this is a render limit, not a storage one.
    assert.equal(withLimit(2001).success, false);
  });

  test("the bounds themselves are accepted", () => {
    assert.equal(withLimit(50).success, true);
    assert.equal(withLimit(2000).success, true);
  });

  test("a fractional cap is refused rather than silently floored", () => {
    assert.equal(withLimit(300.5).success, false);
  });
});

describe("no point of use re-introduces the literal", () => {
  test("pipeline-metrics takes the cap from the config, not from a constant", () => {
    const src = code(path.join(SERVER, "pipeline-metrics.ts"));
    assert.ok(
      !src.includes("KANBAN_CARD_LIMIT"),
      "the old constant is back. The cap must come from getPipelineConfig(), or the Console " +
        "saves a number nothing reads.",
    );
    assert.ok(
      src.includes("getPipelineConfig"),
      "pipeline-metrics no longer reads the pipeline config at all",
    );
  });

  /**
   * The honesty half, and the reason this file exists. A future refactor that drops `total` from
   * the return shape would silently restore the original defect - a capped board presented as a
   * complete one - while every other test here still passed.
   */
  test("getKanbanLeads still reports the total, not just the page", () => {
    const src = code(path.join(SERVER, "pipeline-metrics.ts"));
    assert.ok(src.includes("KanbanPage"), "the paged return type is gone");
    assert.match(
      src,
      /total:\s*number/,
      "KanbanPage no longer carries `total`, so the board cannot tell a slice from the whole",
    );
  });

  test("the board renders a truncation notice", () => {
    const src = code(path.join(PIPELINE_UI, "KanbanBoard.tsx"));
    assert.ok(src.includes("truncated"), "the board no longer computes whether it is truncated");
    assert.match(src, /total\s*>\s*rows\.length/, "the truncation test is gone or has changed shape");
  });
});

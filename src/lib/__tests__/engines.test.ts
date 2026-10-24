import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ENGINES, ENGINE_KEYS, type EngineKey } from "../engines";

/**
 * THE ENGINE REGISTRY (refactor step E5).
 *
 * `lib/engines.ts` is the one place the sixteen switchable engines are described. Two things read
 * it: the Console's "not armed" list, and the inline notice a feature screen shows when its own
 * engine is off. Before it existed those two would have been two copies of the same sixteen
 * paragraphs, and the inline one would have been the stale copy within a month.
 *
 * These tests hold the registry to the contract its header states, and - the point of the file -
 * they fail when a new engine is added without being wired into both consumers.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (p: string) => fs.readFileSync(path.join(here, "..", "..", p), "utf8");

describe("engine registry - shape", () => {
  test("the sixteen engines are exactly these, so adding one is a deliberate act", () => {
    assert.deepEqual([...ENGINE_KEYS].sort(), [
      "agreementReminders",
      "autoCreateOpportunity",
      "availability",
      "classReminders",
      "commissionAccrual",
      "confirmLoop",
      "cron",
      "dunning",
      "email",
      "intake",
      "invoicePosting",
      "retention",
      "speedToLead",
      "studentWelcome",
      "tutorFeeAccrual",
      "whatsapp",
    ]);
  });

  test("every engine says what it is called, what breaks, and where to switch it on", () => {
    for (const key of ENGINE_KEYS) {
      const e = ENGINES[key];
      assert.ok(e.name.length > 0, `${key} has no name`);
      assert.ok(e.consequence.length > 20, `${key}'s consequence is too short to be a reason`);
      assert.ok(e.where.length > 0, `${key} does not say where to turn it on`);
    }
  });

  /**
   * The registry's own rule: `consequence` says what is NOT HAPPENING, never what the setting
   * is. "Dunning is disabled" is a status light; "overdue instalments are never chased" is a
   * reason to care. Enforced by banning the words a status light would use - crude, but it
   * catches the exact regression, which is somebody pasting a boolean's name in here.
   */
  test("a consequence reads as a lost outcome, not as a setting", () => {
    const settingWords = /\b(is (dis|en)abled|is off|is on|is set to|flag|boolean|toggle)\b/i;
    for (const key of ENGINE_KEYS) {
      assert.ok(
        !settingWords.test(ENGINES[key].consequence),
        `${key}'s consequence describes the switch rather than what stops happening`,
      );
    }
  });
});

describe("engine registry - both consumers stay wired to it", () => {
  /**
   * `server/not-armed.ts` must take its wording from here rather than carrying its own. It keeps
   * its own `where` for four engines whose answer is computed at runtime (email and WhatsApp
   * depend on env vars, class reminders can be enabled-but-rehearsing, cron reports its last
   * tick), which is why only `name` and `consequence` are asserted.
   */
  test("the Console list reads every engine's name and consequence from the registry", () => {
    const src = read("server/not-armed.ts");
    const missing = ENGINE_KEYS.filter(
      (k) => !src.includes(`name: ENGINES.${k}.name`) || !src.includes(`consequence: ENGINES.${k}.consequence`),
    );
    assert.deepEqual(missing, [], `not-armed.ts has its own copy of the wording for: ${missing.join(", ")}`);
  });

  /**
   * `server/engine-status.ts` answers "is THIS screen's engine on?" for everything except the two
   * that are upstream of the whole app and belong to no one screen. A new engine must either get
   * a check or be named here as deliberately excluded - which is what makes this a ratchet rather
   * than a snapshot.
   */
  const NOT_SCREEN_LEVEL: EngineKey[] = ["cron", "intake"];

  test("every engine has a per-screen check, or is named as upstream-only", () => {
    const src = read("server/engine-status.ts");
    const missing = ENGINE_KEYS.filter(
      (k) => !NOT_SCREEN_LEVEL.includes(k) && !new RegExp(`^\\s{2}${k}:`, "m").test(src),
    );
    assert.deepEqual(missing, [], `engine-status.ts cannot answer for: ${missing.join(", ")}`);
  });

  test("the upstream-only engines really are excluded from the per-screen checks", () => {
    const src = read("server/engine-status.ts");
    for (const k of NOT_SCREEN_LEVEL) {
      assert.ok(
        !new RegExp(`^\\s{2}${k}:`, "m").test(src),
        `${k} now has a per-screen check - decide which screen owns it and drop it from NOT_SCREEN_LEVEL`,
      );
    }
  });
});

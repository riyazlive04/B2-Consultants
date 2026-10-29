import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * THE STALENESS ALARM HAS TO BE QUIET WHEN NOTHING IS WRONG.
 *
 * `server/uptime.ts` decides how long a cron job may go unheard-from before `/api/health` calls
 * it stale, and the schedule it is being judged against lives somewhere else entirely:
 * `docker/cron/entrypoint.sh`. Nothing connected the two, so `agreements` shipped on 26 Oct with
 * a daily schedule (`30 4 * * *`) and no entry in the table - it fell to the 180-minute default
 * and therefore read STALE for roughly 21 hours out of every 24 while working perfectly.
 *
 * That is worse than having no alarm. `cronsStale: ["agreements"]` was permanently true, so the
 * one signal that would reveal a genuinely dead contract-chasing engine carried no information,
 * and a human learns within a week to ignore it.
 *
 * These tests are deliberately STATIC - they read both files as text rather than importing
 * `uptime.ts`, which pulls in Prisma and the observability seam. The invariant is about two
 * files agreeing, and comparing their text is the most direct way to ask.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..", "..", "..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");

/** `STALE_AFTER_MINUTES` as written, so the test sees the shipped numbers and not a re-export. */
function thresholds(): Record<string, number> {
  const src = read("src/server/uptime.ts");
  const body = src.match(/STALE_AFTER_MINUTES:\s*Record<string,\s*number>\s*=\s*\{([\s\S]*?)\n\};/);
  assert.ok(body, "could not find the STALE_AFTER_MINUTES literal in server/uptime.ts");
  const out: Record<string, number> = {};
  // `daily: 180` and `"daily-log": 1500` are both accepted; comments and blank lines are not keys.
  for (const m of body[1].matchAll(/^\s*"?([a-z][a-z0-9-]*)"?\s*:\s*(\d+)\s*,/gim)) {
    out[m[1]] = Number(m[2]);
  }
  return out;
}

function defaultStaleMinutes(): number {
  const m = read("src/server/uptime.ts").match(/DEFAULT_STALE_MINUTES\s*=\s*(\d+)/);
  assert.ok(m, "could not find DEFAULT_STALE_MINUTES in server/uptime.ts");
  return Number(m[1]);
}

/** Job name → how many minutes apart two ticks are, read off the container's own crontab. */
function schedule(): Record<string, number> {
  const sh = read("docker/cron/entrypoint.sh");
  const out: Record<string, number> = {};
  for (const m of sh.matchAll(/^(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+\S*tick\.sh\s+([a-z-]+)\s*$/gm)) {
    const [, min, hour, , , , job] = m;
    // Only the three forms this crontab actually uses, so an unrecognised one fails loudly
    // rather than being silently scored as "every minute".
    if (min === "*" && hour === "*") out[job] = 1;
    else if (/^\*\/(\d+)$/.test(min) && hour === "*") out[job] = Number(min.match(/\d+/)![0]);
    else if (/^\d+$/.test(min) && hour === "*") out[job] = 60;
    else if (/^\d+$/.test(min) && /^\d+$/.test(hour)) out[job] = 24 * 60;
    else assert.fail(`unrecognised cron expression for ${job}: "${min} ${hour} * * *"`);
  }
  return out;
}

describe("cron staleness thresholds", () => {
  test("the crontab and the health probe name the same jobs", () => {
    const jobs = Object.keys(schedule()).sort();
    const dirs = fs
      .readdirSync(path.join(root, "src/app/api/cron"), { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();

    assert.deepEqual(
      jobs,
      dirs,
      "docker/cron/entrypoint.sh ticks a different set of jobs than src/app/api/cron exposes - " +
        "a route with no tick never runs, and a tick with no route 404s every time",
    );
  });

  test("every scheduled job has an explicit threshold - no job rides the default by accident", () => {
    const table = thresholds();
    const missing = Object.keys(schedule()).filter((job) => !(job in table));
    assert.deepEqual(
      missing,
      [],
      `these jobs have no STALE_AFTER_MINUTES entry, so /api/health judges them against the ` +
        `${defaultStaleMinutes()}-minute default: ${missing.join(", ")}. Add one beside the others ` +
        `in server/uptime.ts - this is exactly how 'agreements' came to read stale 21h a day.`,
    );
  });

  test("a threshold is always longer than the gap between two ticks", () => {
    const table = thresholds();
    for (const [job, everyMinutes] of Object.entries(schedule())) {
      const threshold = table[job] ?? defaultStaleMinutes();
      assert.ok(
        threshold > everyMinutes,
        `${job} ticks every ${everyMinutes} min but is called stale after ${threshold} min, so it ` +
          `is stale more often than not`,
      );
    }
  });

  test("a daily job gets more than a day, so one slow or skipped run is not an alarm", () => {
    const table = thresholds();
    for (const [job, everyMinutes] of Object.entries(schedule())) {
      if (everyMinutes < 24 * 60) continue;
      assert.ok(
        (table[job] ?? defaultStaleMinutes()) > 24 * 60,
        `${job} runs once a day; its threshold must exceed 1440 min or the alarm fires between ` +
          `every pair of healthy runs`,
      );
    }
  });

  test("the table names no job the scheduler does not tick", () => {
    const ticked = new Set(Object.keys(schedule()));
    const orphans = Object.keys(thresholds()).filter((j) => !ticked.has(j));
    assert.deepEqual(
      orphans,
      [],
      `server/uptime.ts expects a heartbeat from ${orphans.join(", ")}, which nothing schedules - ` +
        `so /api/health reports it as never-run forever`,
    );
  });
});

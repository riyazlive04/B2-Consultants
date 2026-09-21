import * as fs from "fs";
import { IS_PROD } from "./target";

/**
 * Hand-off state between People specs in ONE run (specs run in file order with workers=1).
 * Stored per RUN-less file because `RUN` is re-generated per worker process; the last writer wins
 * and every entry carries the run tag it was created under.
 */
const FILE = `reports/people-state-${IS_PROD ? "prod" : "local"}.json`;

export type PeopleState = Record<string, { run: string; [k: string]: unknown }>;

export function readState(): PeopleState {
  try {
    return JSON.parse(fs.readFileSync(FILE, "utf8"));
  } catch {
    return {};
  }
}
export function writeState(key: string, value: { run: string; [k: string]: unknown }) {
  const s = readState();
  s[key] = value;
  fs.mkdirSync("reports", { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(s, null, 2));
}

/** Read created-*.jsonl for this area (what the cleanup spec walks). */
export function createdEntries(): Array<Record<string, any>> {
  const f = `reports/created-${IS_PROD ? "prod" : "local"}-people.jsonl`;
  if (!fs.existsSync(f)) return [];
  return fs.readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

import { RUN } from "./app";

/**
 * A run tag that survives Playwright worker restarts within ONE `playwright test` invocation.
 * After a failing test the worker is replaced and module-level `RUN` is regenerated, which would
 * orphan the records earlier tests created. Worker processes share the runner as parent, so
 * process.ppid identifies the invocation.
 */
export function stableRun(key: string): string {
  const s = readState();
  const e = s[`run:${key}`] as { run: string; ppid?: number } | undefined;
  if (e && e.ppid === process.ppid) return e.run;
  writeState(`run:${key}`, { run: RUN, ppid: process.ppid });
  return RUN;
}

/** The stable run tag another spec wrote in THIS invocation, or null. */
export function stableRunIfSame(key: string): string | null {
  const e = readState()[`run:${key}`] as { run: string; ppid?: number } | undefined;
  return e && e.ppid === process.ppid ? e.run : null;
}

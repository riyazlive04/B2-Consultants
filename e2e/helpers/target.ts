import * as fs from "fs";
import { BASE_URL } from "../playwright.config";

/**
 * One suite, two targets.
 *   local (default): http://localhost:3100 on the local Docker DB, outbound blocked by OUTBOUND_ALLOWLIST.
 *   prod:            E2E_TARGET=prod, https://b2app.sirahagents.com, outbound LIVE - fenced to FENCE contacts.
 */
export const IS_PROD = process.env.E2E_TARGET === "prod";

type FencedPerson = { name: string; phone: string; localPhone: string; email: string };

/**
 * The ONLY people a test may put in a phone/email field. Production messages them for real,
 * so they must be people who agreed to receive test WhatsApps and emails. Real personal
 * numbers, so they live in the gitignored fence.local.json (template: fence.example.json).
 */
export const FENCE: { primary: FencedPerson; secondary: FencedPerson } = (() => {
  const f = "fence.local.json";
  if (!fs.existsSync(f)) throw new Error(`e2e: ${f} is missing - copy fence.example.json to it and fill in the test contacts`);
  return JSON.parse(fs.readFileSync(f, "utf8"));
})();

/** For building a RegExp that must match a fenced phone literally ("+" is a regex operator). */
export const reEscape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Guard to call before typing any phone/email into the app. */
export function assertFenced(value: string) {
  const digits = value.replace(/\D/g, "").slice(-10);
  const ok = value.includes("@")
    ? value.toLowerCase() === FENCE.primary.email
    : [FENCE.primary.phone, FENCE.secondary.phone].some((p) => p.replace(/\D/g, "").slice(-10) === digits);
  if (!ok) throw new Error(`Unfenced contact "${value}" - tests may only use FENCE contacts`);
  return value;
}

/** Direct DB access exists only locally. In prod, assert through the UI instead. */
export const HAS_DB = !IS_PROD;

/** Record every entity a test creates so the cleanup spec can void/delete it afterwards. */
export function recordCreated(area: string, entity: { kind: string; id?: string; url?: string; label: string; cleanup: string }) {
  fs.mkdirSync("reports", { recursive: true });
  fs.appendFileSync(`reports/created-${IS_PROD ? "prod" : "local"}-${area}.jsonl`,
    JSON.stringify({ at: new Date().toISOString(), base: BASE_URL, ...entity }) + "\n");
}

import { request } from "@playwright/test";
import * as fs from "fs";
import { ROLES, authFile, RoleKey } from "./roles";
import { BASE_URL } from "../playwright.config";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
import { IS_PROD } from "./target";
const FRESH_MS = 6 * 60 * 60 * 1000;

/**
 * Signs every role in through the API (form login races hydration) and saves its cookies.
 * Sign-in is rate limited (a few per 10s per IP), so reuse fresh sessions, space attempts
 * and back off on 429 instead of silently saving an empty session.
 */
export default async function globalSetup() {
  for (const key of Object.keys(ROLES) as RoleKey[]) {
    if (!ROLES[key]?.email) continue;
    const file = authFile(key);
    if (fs.existsSync(file) && Date.now() - fs.statSync(file).mtimeMs < FRESH_MS
        && fs.readFileSync(file, "utf8").includes("session_token")) continue;
    const { email, password } = ROLES[key];
    const ctx = await request.newContext({ baseURL: BASE_URL, extraHTTPHeaders: { Origin: BASE_URL } });
    let ok = false;
    for (let attempt = 0; attempt < 6 && !ok; attempt++) {
      const res = await ctx.post("/api/auth/sign-in/email", { data: { email, password } });
      if (res.ok()) ok = true;
      else if (res.status() === 429) await sleep(11_000);
      else { console.warn(`[global-setup] sign-in failed for ${key}: ${res.status()} ${await res.text()}`); break; }
    }
    if (ok) await ctx.storageState({ path: file });
    await ctx.dispose();
    await sleep(3_500);
  }
}

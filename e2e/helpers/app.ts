import { APIRequestContext, Page, expect } from "@playwright/test";
import { BASE_URL } from "../playwright.config";

export const CRON_SECRET = "e2e-cron-secret-local-only";

/** Local: fire the cron route now. Prod: the VPS scheduler runs it every minute - never call it. */

/** Fire a cron route on the LOCAL server exactly as the VPS scheduler does. */
import { IS_PROD } from "./target";

export async function runCron(request: APIRequestContext, name: string) {
  if (IS_PROD) throw new Error("runCron is local-only: production cron runs on the VPS scheduler");
  const res = await request.get(`${BASE_URL}/api/cron/${name}`, { headers: { "x-cron-secret": CRON_SECRET } });
  const body = await res.text();
  return { status: res.status(), body };
}

/** A run-unique tag so every row a test creates can be found and told apart from demo data. */
export const RUN = `E2E${Date.now().toString(36).toUpperCase()}`;
export const tag = (s: string) => `${RUN} ${s}`;

/** Collect page errors and 5xx responses so a "passing" click that broke the page still fails. */
export function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("response", (r) => { if (r.status() >= 500) errors.push(`${r.status()} ${r.url()}`); });
  return {
    errors,
    assertClean: () => expect(errors, errors.join("\n")).toEqual([]),
  };
}

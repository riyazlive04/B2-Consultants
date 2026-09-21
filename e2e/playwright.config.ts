import { defineConfig, devices } from "@playwright/test";

export const BASE_URL = process.env.E2E_BASE_URL ?? (process.env.E2E_TARGET === "prod" ? "https://b2app.sirahagents.com" : "http://localhost:3100");
if (!/localhost|127.0.0.1|b2app.sirahagents.com/.test(BASE_URL)) throw new Error(`E2E refuses unknown BASE_URL ${BASE_URL}`);

export default defineConfig({
  testDir: "./tests",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"], ["json", { outputFile: `reports/${process.env.E2E_AREA ?? "run"}-${process.env.E2E_TARGET ?? "local"}.json` }]],
  globalSetup: "./helpers/global-setup.ts",
  use: {
    baseURL: BASE_URL,
    ...devices["Desktop Chrome"],
    channel: undefined,
    headless: true,
    timezoneId: "Asia/Kolkata",
    locale: "en-IN",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    actionTimeout: 20_000,
    navigationTimeout: 60_000,
  },
  outputDir: `test-results/${process.env.E2E_TARGET ?? "local"}-${process.env.E2E_AREA ?? "run"}`,
});

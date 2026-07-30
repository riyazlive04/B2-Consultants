import test from "node:test";
import assert from "node:assert/strict";
import { channelStates } from "../env";

/**
 * The state this pins down is "flag on, credentials missing" — which is what production was in
 * on 23 Jul 2026, and which every screen in the app reported as healthy while agreement OTPs
 * went nowhere. "off" and "misconfigured" must never collapse into the same answer.
 */

const KEYS = [
  "WATI_ENABLED", "WATI_API_ENDPOINT", "WATI_ACCESS_TOKEN",
  "EMAIL_ENABLED", "RESEND_API_KEY",
  "SMS_ENABLED", "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN",
];

function withEnv<T>(vars: Record<string, string | undefined>, fn: () => T): T {
  const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
  for (const [k, v] of Object.entries(vars)) if (v !== undefined) process.env[k] = v;
  try {
    return fn();
  } finally {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k]!;
    }
  }
}

test("an unset flag is 'off', not a problem — opting out is a valid deployment", () => {
  const s = withEnv({}, channelStates);
  assert.equal(s.wati, "off");
  assert.equal(s.email, "off");
  assert.equal(s.sms, "off");
});

test("flag on with credentials is 'armed'", () => {
  const s = withEnv(
    { WATI_ENABLED: "true", WATI_API_ENDPOINT: "https://x.wati.io/1", WATI_ACCESS_TOKEN: "t" },
    channelStates,
  );
  assert.equal(s.wati, "armed");
});

test("flag on with NO credentials is 'misconfigured' — the silent-failure state", () => {
  const s = withEnv({ WATI_ENABLED: "true" }, channelStates);
  assert.equal(s.wati, "misconfigured");
});

test("partial credentials still count as misconfigured", () => {
  const s = withEnv({ WATI_ENABLED: "true", WATI_API_ENDPOINT: "https://x.wati.io/1" }, channelStates);
  assert.equal(s.wati, "misconfigured");
});

test("a blank-string credential is treated as absent, not present", () => {
  const s = withEnv(
    { WATI_ENABLED: "true", WATI_API_ENDPOINT: "  ", WATI_ACCESS_TOKEN: "t" },
    channelStates,
  );
  assert.equal(s.wati, "misconfigured");
});

test("the flag is exact-match 'true' — '1' and 'yes' do not arm a channel", () => {
  assert.equal(withEnv({ EMAIL_ENABLED: "1", RESEND_API_KEY: "k" }, channelStates).email, "off");
  assert.equal(withEnv({ EMAIL_ENABLED: "yes", RESEND_API_KEY: "k" }, channelStates).email, "off");
  assert.equal(withEnv({ EMAIL_ENABLED: "TRUE", RESEND_API_KEY: "k" }, channelStates).email, "armed");
});

test("channels are reported independently", () => {
  const s = withEnv(
    { WATI_ENABLED: "true", EMAIL_ENABLED: "true", RESEND_API_KEY: "k" },
    channelStates,
  );
  assert.equal(s.wati, "misconfigured");
  assert.equal(s.email, "armed");
  assert.equal(s.sms, "off");
});

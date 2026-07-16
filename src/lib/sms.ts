import "server-only";
import { prisma } from "@/lib/prisma";

/**
 * SMS channel — Twilio HTTP client + config. Mirrors the WATI seam:
 *  - SECRETS in env, read inline, fail-closed when unset:
 *      SMS_ENABLED         "true" to arm sending (default off)
 *      TWILIO_ACCOUNT_SID  Twilio account SID
 *      TWILIO_AUTH_TOKEN   Twilio auth token (basic-auth password)
 *  - NON-SECRET config in AppSetting("smsConfig"): paused toggle, from number.
 * Never throws — send() always resolves a result object.
 */

const SETTINGS_KEY = "smsConfig";

export type SmsSettings = { paused: boolean; fromNumber: string };
const DEFAULTS: SmsSettings = { paused: false, fromNumber: "" };

function coerce(raw: unknown): SmsSettings {
  const v = (raw && typeof raw === "object" ? raw : {}) as Partial<SmsSettings>;
  return {
    paused: typeof v.paused === "boolean" ? v.paused : DEFAULTS.paused,
    fromNumber: typeof v.fromNumber === "string" ? v.fromNumber.trim() : DEFAULTS.fromNumber,
  };
}

export async function readSmsSettings(): Promise<SmsSettings> {
  const row = await prisma.appSetting.findUnique({ where: { key: SETTINGS_KEY } });
  return coerce(row?.value);
}

export async function writeSmsSettings(settings: SmsSettings): Promise<void> {
  await prisma.appSetting.upsert({
    where: { key: SETTINGS_KEY },
    create: { key: SETTINGS_KEY, value: settings as object },
    update: { value: settings as object },
  });
}

export type SmsRuntime = {
  enabled: boolean;
  configured: boolean;
  envEnabled: boolean;
  paused: boolean;
  accountSid: string | null;
  authToken: string | null;
  fromNumber: string;
};

export async function getSmsRuntime(): Promise<SmsRuntime> {
  const settings = await readSmsSettings();
  const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim() || null;
  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim() || null;
  const envEnabled = process.env.SMS_ENABLED?.trim().toLowerCase() === "true";
  const configured = Boolean(accountSid && authToken && settings.fromNumber);
  return {
    enabled: envEnabled && !settings.paused && configured,
    configured,
    envEnabled,
    paused: settings.paused,
    accountSid,
    authToken,
    fromNumber: settings.fromNumber,
  };
}

export type SendResult = { ok: boolean; id?: string; error?: string };

/** POST to Twilio Messages API (basic auth). Resolves a result; never throws. */
export async function sendTwilioSms(opts: {
  accountSid: string;
  authToken: string;
  from: string;
  to: string;
  body: string;
}): Promise<SendResult> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 12_000);
  try {
    const auth = Buffer.from(`${opts.accountSid}:${opts.authToken}`).toString("base64");
    const form = new URLSearchParams({ From: opts.from, To: opts.to, Body: opts.body });
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${opts.accountSid}/Messages.json`, {
      method: "POST",
      headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
      signal: ctrl.signal,
    });
    const data = (await res.json().catch(() => ({}))) as { sid?: string; message?: string };
    if (!res.ok) return { ok: false, error: data.message || `Twilio HTTP ${res.status}` };
    return { ok: true, id: data.sid };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "SMS send failed" };
  } finally {
    clearTimeout(t);
  }
}

import "server-only";
import { prisma } from "@/lib/prisma";

/**
 * Email channel — Resend HTTP client + config. Mirrors the WATI seam:
 *  - SECRETS in env, read inline, fail-closed when unset:
 *      EMAIL_ENABLED     "true" to arm sending (default off)
 *      RESEND_API_KEY    Resend API key (Bearer)
 *  - NON-SECRET config in AppSetting("emailConfig"): paused toggle, from name/email.
 * Never throws into a request path — send() always resolves a result object.
 */

const SETTINGS_KEY = "emailConfig";

export type EmailSettings = { paused: boolean; fromName: string; fromEmail: string };

const DEFAULTS: EmailSettings = { paused: false, fromName: "B2 Consultants", fromEmail: "" };

function coerce(raw: unknown): EmailSettings {
  const v = (raw && typeof raw === "object" ? raw : {}) as Partial<EmailSettings>;
  return {
    paused: typeof v.paused === "boolean" ? v.paused : DEFAULTS.paused,
    fromName: typeof v.fromName === "string" && v.fromName.trim() ? v.fromName.trim() : DEFAULTS.fromName,
    fromEmail: typeof v.fromEmail === "string" ? v.fromEmail.trim() : DEFAULTS.fromEmail,
  };
}

export async function readEmailSettings(): Promise<EmailSettings> {
  const row = await prisma.appSetting.findUnique({ where: { key: SETTINGS_KEY } });
  return coerce(row?.value);
}

export async function writeEmailSettings(settings: EmailSettings): Promise<void> {
  await prisma.appSetting.upsert({
    where: { key: SETTINGS_KEY },
    create: { key: SETTINGS_KEY, value: settings as object },
    update: { value: settings as object },
  });
}

export type EmailRuntime = {
  enabled: boolean;
  configured: boolean;
  envEnabled: boolean;
  paused: boolean;
  apiKey: string | null;
  fromEmail: string;
  fromName: string;
};

export async function getEmailRuntime(): Promise<EmailRuntime> {
  const settings = await readEmailSettings();
  const apiKey = process.env.RESEND_API_KEY?.trim() || null;
  const envEnabled = process.env.EMAIL_ENABLED?.trim().toLowerCase() === "true";
  const configured = Boolean(apiKey && settings.fromEmail);
  return {
    enabled: envEnabled && !settings.paused && configured,
    configured,
    envEnabled,
    paused: settings.paused,
    apiKey,
    fromEmail: settings.fromEmail,
    fromName: settings.fromName,
  };
}

export type SendResult = { ok: boolean; id?: string; error?: string };

/** POST to Resend. Resolves a result; never throws. Caller must have checked runtime.enabled. */
export async function sendResendEmail(opts: {
  apiKey: string;
  from: string;
  to: string;
  subject: string;
  html: string;
  /** Resend's raw HTTP API takes base64-encoded content per file (Node SDK's Buffer
   *  support doesn't apply here — this is a plain fetch, not the SDK). */
  attachments?: { filename: string; content: string }[];
}): Promise<SendResult> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 12_000);
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${opts.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: opts.from,
        to: [opts.to],
        subject: opts.subject,
        html: opts.html,
        ...(opts.attachments?.length ? { attachments: opts.attachments } : {}),
      }),
      signal: ctrl.signal,
    });
    const data = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
    if (!res.ok) return { ok: false, error: data.message || `Resend HTTP ${res.status}` };
    return { ok: true, id: data.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Email send failed" };
  } finally {
    clearTimeout(t);
  }
}

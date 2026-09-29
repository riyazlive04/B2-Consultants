import "server-only";
import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

/**
 * The B2 Consultants lead webhook - `/api/leads/b2consultants`.
 *
 * ── What the switch means ───────────────────────────────────────────────────────
 * One founder-owned switch in Console → Sales ops → Lead Webhook decides where OUTSIDE leads may
 * come from:
 *
 *   OFF  the webhook refuses every delivery (503). Leads arrive only through our own pages
 *        (funnel and site forms, /book), which this switch never touches.
 *   ON   pages hosted elsewhere - a FlexiFunnels page on the founder's own domain, say - can post
 *        their opt-ins here and they land in the CRM like any other lead.
 *
 * ── Why the key lives in the database, not env ──────────────────────────────────
 * Every other intake route reads its secret from env, which means switching one on is a VPS
 * redeploy. The whole point of this switch is that the founder can flip it from the Console, so
 * the key is generated here and stored beside the switch. It only authorises writing a lead, the
 * Console that shows it is Admin-only, and it can be regenerated in one click if it ever leaks.
 */

export const LEAD_WEBHOOK_KEY = "leadWebhook";
/** Names the rate-limit bucket and the Console delivery-status row. */
export const LEAD_WEBHOOK_NAME = "b2consultants";
export const LEAD_WEBHOOK_PATH = "/api/leads/b2consultants";

export type LeadWebhookConfig = { enabled: boolean; key: string };

const DEFAULT: LeadWebhookConfig = { enabled: false, key: "" };

function coerce(raw: unknown): LeadWebhookConfig {
  const v = (raw && typeof raw === "object" ? raw : {}) as Partial<LeadWebhookConfig>;
  return {
    enabled: v.enabled === true,
    key: typeof v.key === "string" ? v.key : DEFAULT.key,
  };
}

/**
 * Read fresh on every call, deliberately NOT through the founder-config cache: turning the switch
 * off has to stop leads on the very next delivery, not whenever a cache entry expires.
 */
export async function getLeadWebhookConfig(): Promise<LeadWebhookConfig> {
  const row = await prisma.appSetting.findUnique({ where: { key: LEAD_WEBHOOK_KEY } });
  return coerce(row?.value);
}

export async function writeLeadWebhookConfig(config: LeadWebhookConfig): Promise<void> {
  const value = coerce(config) as unknown as Prisma.InputJsonValue;
  await prisma.appSetting.upsert({
    where: { key: LEAD_WEBHOOK_KEY },
    create: { key: LEAD_WEBHOOK_KEY, value },
    update: { value },
  });
}

/** 48 hex chars - URL-safe, so it can ride in `?key=` for senders that only take a URL. */
export function generateLeadWebhookKey(): string {
  return crypto.randomBytes(24).toString("hex");
}

"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/rbac";
import { logActivity } from "./activity-log";
import {
  generateLeadWebhookKey,
  getLeadWebhookConfig,
  writeLeadWebhookConfig,
  LEAD_WEBHOOK_KEY,
} from "./lead-webhook";
import type { ActionResult } from "./finance-actions";

/** Console → Sales ops → Lead Webhook. Admin-only; the key is always generated server-side. */

export async function setLeadWebhookEnabled(enabled: boolean): Promise<ActionResult> {
  const session = await requireAdmin();
  const current = await getLeadWebhookConfig();
  // First switch-on mints the key, so "on" can never mean "on with no way to authenticate".
  const key = current.key || generateLeadWebhookKey();
  await writeLeadWebhookConfig({ enabled: enabled === true, key });
  await logActivity(session, {
    action: "console.lead-webhook.update",
    section: "console",
    entityType: "AppSetting",
    entityId: LEAD_WEBHOOK_KEY,
    summary: `${enabled ? "Enabled" : "Disabled"} the B2 Consultants lead webhook`,
    meta: { enabled: enabled === true },
  });
  revalidatePath("/console");
  return { ok: true };
}

export async function regenerateLeadWebhookKey(): Promise<ActionResult> {
  const session = await requireAdmin();
  const current = await getLeadWebhookConfig();
  await writeLeadWebhookConfig({ enabled: current.enabled, key: generateLeadWebhookKey() });
  await logActivity(session, {
    action: "console.lead-webhook.regenerate-key",
    section: "console",
    entityType: "AppSetting",
    entityId: LEAD_WEBHOOK_KEY,
    summary: "Regenerated the B2 Consultants lead webhook key",
    meta: { enabled: current.enabled },
  });
  revalidatePath("/console");
  return { ok: true };
}

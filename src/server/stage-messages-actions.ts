"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/rbac";
import { stageMessagesSchema, STAGE_MESSAGES_KEY, type StageMessagesConfig } from "@/lib/stage-messages";
import { logActivity } from "./activity-log";
import { writeStageMessagesConfig } from "./stage-messages";
import type { ActionResult } from "./finance-actions";

export async function saveStageMessages(config: StageMessagesConfig): Promise<ActionResult> {
  const session = await requireAdmin();
  const parsed = stageMessagesSchema.safeParse(config);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid settings" };
  await writeStageMessagesConfig(parsed.data as StageMessagesConfig);
  await logActivity(session, {
    action: "stage-messages.update",
    section: "automation",
    entityType: "AppSetting",
    entityId: STAGE_MESSAGES_KEY,
    summary: `Updated the stage messages (${parsed.data.enabled ? "on" : "off"})`,
  });
  revalidatePath("/automation/stage-messages");
  return { ok: true };
}

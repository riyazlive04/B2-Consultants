"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/rbac";
import {
  maintenanceConfigSchema,
  scheduledReportConfigSchema,
  financePostingConfigSchema,
} from "@/lib/config-schema";
import {
  writeMaintenanceConfig,
  writeScheduledReportConfig,
  writeFinancePostingConfig,
  MAINTENANCE_KEY,
  SCHEDULED_REPORT_KEY,
  FINANCE_POSTING_KEY,
} from "./founder-config";
import { logActivity } from "./activity-log";
import type { ActionResult } from "./finance-actions";

/**
 * Founder Console save actions for the daily-maintenance / scheduled-report / ledger-posting
 * configs (audit §C). Kept out of the (large) console-actions.ts import block; same Admin-guarded,
 * schema-validated, logged shape as saveDailyLogEod there.
 */

function firstError(e: z.ZodError): string {
  return e.issues[0]?.message ?? "Invalid input";
}

export async function saveMaintenanceConfig(input: unknown): Promise<ActionResult> {
  const session = await requireAdmin();
  const parsed = maintenanceConfigSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  await writeMaintenanceConfig(parsed.data);
  await logActivity(session, {
    action: "console.maintenance.update",
    section: "console",
    entityType: "AppSetting",
    entityId: MAINTENANCE_KEY,
    summary: "Updated daily-maintenance settings",
    meta: {
      fxPrewarm: parsed.data.fxPrewarm.enabled,
      overdueSweep: parsed.data.overdueSweep.enabled,
      retention: parsed.data.retention.enabled,
    },
  });
  revalidatePath("/console");
  return { ok: true };
}

export async function saveScheduledReportConfig(input: unknown): Promise<ActionResult> {
  const session = await requireAdmin();
  const parsed = scheduledReportConfigSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  await writeScheduledReportConfig(parsed.data);
  await logActivity(session, {
    action: "console.scheduled-report.update",
    section: "console",
    entityType: "AppSetting",
    entityId: SCHEDULED_REPORT_KEY,
    summary: `${parsed.data.enabled ? "Enabled" : "Disabled"} the ${parsed.data.cadence.toLowerCase()} scheduled report`,
    meta: { enabled: parsed.data.enabled, cadence: parsed.data.cadence, recipients: parsed.data.recipients.length },
  });
  revalidatePath("/console");
  return { ok: true };
}

export async function saveFinancePostingConfig(input: unknown): Promise<ActionResult> {
  const session = await requireAdmin();
  const parsed = financePostingConfigSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  await writeFinancePostingConfig(parsed.data);
  await logActivity(session, {
    action: "console.finance-posting.update",
    section: "console",
    entityType: "AppSetting",
    entityId: FINANCE_POSTING_KEY,
    summary: "Updated ledger auto-posting settings",
    meta: {
      invoiceIssuancePosting: parsed.data.invoiceIssuancePosting.enabled,
      commissionAccrual: parsed.data.commissionAccrual.enabled,
    },
  });
  revalidatePath("/console");
  revalidatePath("/ledger");
  return { ok: true };
}

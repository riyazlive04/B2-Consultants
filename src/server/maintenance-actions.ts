"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/rbac";
import {
  maintenanceConfigSchema,
  scheduledReportConfigSchema,
  financePostingConfigSchema,
  speedToLeadAlertSchema,
  dunningConfigSchema,
  attendanceConfigSchema,
} from "@/lib/config-schema";
import {
  writeMaintenanceConfig,
  writeScheduledReportConfig,
  writeFinancePostingConfig,
  writeSpeedToLeadAlertConfig,
  writeDunningConfig,
  writeAttendanceConfig,
  MAINTENANCE_KEY,
  SCHEDULED_REPORT_KEY,
  FINANCE_POSTING_KEY,
  SPEED_TO_LEAD_ALERT_KEY,
  DUNNING_KEY,
  ATTENDANCE_KEY,
} from "./founder-config";
import { previewDunning } from "./dunning";
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

export async function saveSpeedToLeadAlertConfig(input: unknown): Promise<ActionResult> {
  const session = await requireAdmin();
  const parsed = speedToLeadAlertSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  await writeSpeedToLeadAlertConfig(parsed.data);
  await logActivity(session, {
    action: "console.speed-to-lead.update",
    section: "console",
    entityType: "AppSetting",
    entityId: SPEED_TO_LEAD_ALERT_KEY,
    summary: `${parsed.data.enabled ? "Enabled" : "Disabled"} speed-to-lead alerting`,
    meta: {
      enabled: parsed.data.enabled,
      thresholdMinutes: parsed.data.thresholdMinutes,
      minBreaches: parsed.data.minBreaches,
      recipients: parsed.data.recipients.length,
    },
  });
  revalidatePath("/console");
  return { ok: true };
}

export async function saveDunningConfig(input: unknown): Promise<ActionResult> {
  const session = await requireAdmin();
  const parsed = dunningConfigSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  await writeDunningConfig(parsed.data);
  await logActivity(session, {
    action: "console.dunning.update",
    section: "console",
    entityType: "AppSetting",
    entityId: DUNNING_KEY,
    // Arming this starts emailing paying students, so the summary names the switch explicitly
    // rather than saying "updated settings" - this is the log line someone will look for.
    summary: `${parsed.data.enabled ? "ARMED" : "Disabled"} the payment-chase ladder`,
    meta: {
      enabled: parsed.data.enabled,
      offsets: [
        parsed.data.stages.upcoming.dayOffset,
        parsed.data.stages.missed.dayOffset,
        parsed.data.stages.final.dayOffset,
      ],
      perRunCap: parsed.data.perRunCap,
    },
  });
  revalidatePath("/console");
  return { ok: true };
}

/**
 * Dry run: exactly who the ladder would contact on the next tick, and with which rung.
 *
 * Nobody sensible arms an engine that emails paying students on the strength of a description of
 * what it does. This runs the identical read path as the real job - same query, same `stageFor`
 * verdict - with every side effect removed.
 */
export async function previewDunningLadder(): Promise<
  { ok: true; rows: Awaited<ReturnType<typeof previewDunning>> } | { ok: false; error: string }
> {
  await requireAdmin();
  const rows = await previewDunning();
  return { ok: true, rows };
}

export async function saveAttendanceConfig(input: unknown): Promise<ActionResult> {
  const session = await requireAdmin();
  const parsed = attendanceConfigSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  await writeAttendanceConfig(parsed.data);
  await logActivity(session, {
    action: "console.attendance.update",
    section: "console",
    entityType: "AppSetting",
    entityId: ATTENDANCE_KEY,
    summary: "Updated attendance risk thresholds",
    meta: {
      amberRatePct: parsed.data.amberRatePct,
      redRatePct: parsed.data.redRatePct,
      consecutiveMissedForRed: parsed.data.consecutiveMissedForRed,
    },
  });
  revalidatePath("/console");
  revalidatePath("/german-note");
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

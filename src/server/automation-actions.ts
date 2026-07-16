"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSection, requireAdmin, capabilityCheck } from "@/lib/rbac";
import { runDueWorkflows } from "./automation";
import type { WorkflowAction, TriggerType, TriggerConfig } from "@/lib/automation-types";
import { workflowSettingsSchema, type WorkflowSettings } from "@/lib/config-schema";
import { writeWorkflowSettings } from "./founder-config";
import type { ActionResult } from "./finance-actions";

/** Automation mutations (Synamate "Workflows"). Gated to `automation`; delete needs pipeline.configure. */

const TRIGGER_TYPES: TriggerType[] = [
  "FORM_SUBMITTED", "TAG_ADDED", "STAGE_CHANGED", "CONTACT_CREATED", "INVOICE_PAID", "BOOKING_CREATED",
];

export async function createWorkflow(form: FormData): Promise<ActionResult> {
  const session = await requireSection("automation");
  const name = String(form.get("name") ?? "").trim();
  const triggerType = String(form.get("triggerType") ?? "") as TriggerType;
  // Empty = root ("Home"). The list passes the folder the user is currently looking at, so
  // "New workflow" inside a folder lands in that folder.
  const folderId = String(form.get("folderId") ?? "").trim() || null;
  if (!name) return { ok: false, error: "Workflow name is required" };
  if (!TRIGGER_TYPES.includes(triggerType)) return { ok: false, error: "Pick a trigger" };
  if (folderId && !(await prisma.workflowFolder.findUnique({ where: { id: folderId }, select: { id: true } }))) {
    return { ok: false, error: "That folder no longer exists" };
  }
  await prisma.workflow.create({
    data: {
      name,
      triggerType,
      triggerConfig: {},
      actions: [] as unknown as Prisma.InputJsonValue,
      folderId,
      createdById: session.user.id,
    },
  });
  revalidatePath("/automation");
  return { ok: true };
}

export async function saveWorkflow(
  id: string,
  payload: {
    name: string;
    triggerType: TriggerType;
    triggerConfig: TriggerConfig;
    actions: WorkflowAction[];
    folderId: string | null;
  },
): Promise<ActionResult> {
  await requireSection("automation");
  if (!payload.name.trim()) return { ok: false, error: "Workflow name is required" };
  if (!TRIGGER_TYPES.includes(payload.triggerType)) return { ok: false, error: "Invalid trigger" };
  const current = await prisma.workflow.findUnique({ where: { id }, select: { deletedAt: true } });
  if (!current) return { ok: false, error: "Workflow not found" };
  if (current.deletedAt) return { ok: false, error: "Restore this workflow before editing it" };
  if (payload.folderId && !(await prisma.workflowFolder.findUnique({ where: { id: payload.folderId }, select: { id: true } }))) {
    return { ok: false, error: "That folder no longer exists" };
  }
  await prisma.workflow.update({
    where: { id },
    data: {
      name: payload.name.trim(),
      triggerType: payload.triggerType,
      triggerConfig: payload.triggerConfig as unknown as Prisma.InputJsonValue,
      actions: payload.actions as unknown as Prisma.InputJsonValue,
      folderId: payload.folderId,
    },
  });
  revalidatePath("/automation");
  revalidatePath(`/automation/${id}`);
  return { ok: true };
}

export async function togglePublishWorkflow(id: string): Promise<ActionResult> {
  await requireSection("automation");
  const w = await prisma.workflow.findUnique({ where: { id }, select: { status: true, actions: true, deletedAt: true } });
  if (!w) return { ok: false, error: "Workflow not found" };
  if (w.deletedAt) return { ok: false, error: "Restore this workflow before publishing it" };
  if (w.status === "DRAFT") {
    const actions = (w.actions as WorkflowAction[]) ?? [];
    if (actions.length === 0) return { ok: false, error: "Add at least one action before publishing" };
  }
  await prisma.workflow.update({ where: { id }, data: { status: w.status === "PUBLISHED" ? "DRAFT" : "PUBLISHED" } });
  revalidatePath("/automation");
  revalidatePath(`/automation/${id}`);
  return { ok: true };
}

// ─────────────────────────────── delete / restore ───────────────────────────────

/**
 * Soft delete — moves the workflow to the Deleted tab. It stops triggering immediately
 * (emitTrigger filters `deletedAt: null`) and its in-flight enrollments freeze rather than
 * being destroyed, so `restoreWorkflow` genuinely undoes this. Enrollment history is kept.
 */
export async function deleteWorkflow(id: string): Promise<ActionResult> {
  const { allowed, denied } = await capabilityCheck("pipeline.configure");
  if (!allowed) return denied;
  await prisma.workflow.update({ where: { id }, data: { deletedAt: new Date() } });
  revalidatePath("/automation");
  revalidatePath(`/automation/${id}`);
  return { ok: true };
}

export async function restoreWorkflow(id: string): Promise<ActionResult> {
  const { allowed, denied } = await capabilityCheck("pipeline.configure");
  if (!allowed) return denied;
  await prisma.workflow.update({ where: { id }, data: { deletedAt: null } });
  revalidatePath("/automation");
  revalidatePath(`/automation/${id}`);
  return { ok: true };
}

/**
 * Hard delete — irreversible, and cascades every enrollment row for this workflow. Only
 * reachable from the Deleted tab, so it always takes two deliberate steps.
 */
export async function destroyWorkflow(id: string): Promise<ActionResult> {
  const { allowed, denied } = await capabilityCheck("pipeline.configure");
  if (!allowed) return denied;
  const w = await prisma.workflow.findUnique({ where: { id }, select: { deletedAt: true } });
  if (!w) return { ok: false, error: "Workflow not found" };
  if (!w.deletedAt) return { ok: false, error: "Delete this workflow first" };
  await prisma.workflow.delete({ where: { id } });
  revalidatePath("/automation");
  return { ok: true };
}

// ─────────────────────────────────── folders ────────────────────────────────────

export async function createFolder(form: FormData): Promise<ActionResult> {
  await requireSection("automation");
  const name = String(form.get("name") ?? "").trim();
  if (!name) return { ok: false, error: "Folder name is required" };
  const clash = await prisma.workflowFolder.findUnique({ where: { name }, select: { id: true } });
  if (clash) return { ok: false, error: "A folder with that name already exists" };
  await prisma.workflowFolder.create({ data: { name } });
  revalidatePath("/automation");
  return { ok: true };
}

export async function renameFolder(id: string, name: string): Promise<ActionResult> {
  await requireSection("automation");
  const clean = name.trim();
  if (!clean) return { ok: false, error: "Folder name is required" };
  const clash = await prisma.workflowFolder.findUnique({ where: { name: clean }, select: { id: true } });
  if (clash && clash.id !== id) return { ok: false, error: "A folder with that name already exists" };
  await prisma.workflowFolder.update({ where: { id }, data: { name: clean } });
  revalidatePath("/automation");
  return { ok: true };
}

/**
 * Delete a folder. The workflows inside are NOT deleted — the FK is `onDelete: SetNull`, so
 * they fall back to the root listing. Deleting a folder is never a way to lose a workflow.
 */
export async function deleteFolder(id: string): Promise<ActionResult> {
  const { allowed, denied } = await capabilityCheck("pipeline.configure");
  if (!allowed) return denied;
  await prisma.workflowFolder.delete({ where: { id } });
  revalidatePath("/automation");
  return { ok: true };
}

/** Move workflows into a folder (or to the root when `folderId` is null). */
export async function moveWorkflowsToFolder(ids: string[], folderId: string | null): Promise<ActionResult> {
  await requireSection("automation");
  if (ids.length === 0) return { ok: false, error: "Nothing selected" };
  if (folderId && !(await prisma.workflowFolder.findUnique({ where: { id: folderId }, select: { id: true } }))) {
    return { ok: false, error: "That folder no longer exists" };
  }
  await prisma.workflow.updateMany({ where: { id: { in: ids } }, data: { folderId } });
  revalidatePath("/automation");
  return { ok: true };
}

// ────────────────────────────────── bulk actions ─────────────────────────────────

/** Bulk soft-delete from the list's selection bar. */
export async function bulkDeleteWorkflows(ids: string[]): Promise<ActionResult> {
  const { allowed, denied } = await capabilityCheck("pipeline.configure");
  if (!allowed) return denied;
  if (ids.length === 0) return { ok: false, error: "Nothing selected" };
  await prisma.workflow.updateMany({ where: { id: { in: ids } }, data: { deletedAt: new Date() } });
  revalidatePath("/automation");
  return { ok: true };
}

export async function bulkRestoreWorkflows(ids: string[]): Promise<ActionResult> {
  const { allowed, denied } = await capabilityCheck("pipeline.configure");
  if (!allowed) return denied;
  if (ids.length === 0) return { ok: false, error: "Nothing selected" };
  await prisma.workflow.updateMany({ where: { id: { in: ids } }, data: { deletedAt: null } });
  revalidatePath("/automation");
  return { ok: true };
}

/**
 * Bulk publish/unpublish. Publishing enforces the same "must have an action" rule as the single
 * toggle — actions live in a JSON column so this filters in JS, then writes the survivors in one
 * statement.
 *
 * Partial success is the normal case here (select 5, one has no actions), which ActionResult's
 * ok/error union can't express — hence the counts: the caller reports exactly what happened
 * instead of showing an error for what was mostly a success.
 */
export type BulkPublishResult =
  | { ok: true; changed: number; skipped: number }
  | { ok: false; error: string };

export async function bulkSetPublish(ids: string[], publish: boolean): Promise<BulkPublishResult> {
  await requireSection("automation");
  if (ids.length === 0) return { ok: false, error: "Nothing selected" };
  const rows = await prisma.workflow.findMany({
    where: { id: { in: ids }, deletedAt: null },
    select: { id: true, actions: true },
  });
  const eligible = publish
    ? rows.filter((r) => ((r.actions as WorkflowAction[]) ?? []).length > 0).map((r) => r.id)
    : rows.map((r) => r.id);
  if (eligible.length === 0) {
    return { ok: false, error: publish ? "None of the selected workflows have an action yet" : "Nothing to unpublish" };
  }
  await prisma.workflow.updateMany({
    where: { id: { in: eligible } },
    data: { status: publish ? "PUBLISHED" : "DRAFT" },
  });
  revalidatePath("/automation");
  return { ok: true, changed: eligible.length, skipped: rows.length - eligible.length };
}

// ──────────────────────────── global workflow settings ───────────────────────────

/** Founder-only: the engine reads this on every trigger and every resume. */
export async function saveWorkflowSettings(settings: WorkflowSettings): Promise<ActionResult> {
  await requireAdmin();
  const parsed = workflowSettingsSchema.safeParse(settings);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid settings" };
  await writeWorkflowSettings(parsed.data);
  revalidatePath("/automation");
  revalidatePath("/automation/settings");
  return { ok: true };
}

/** Admin "Run now" — resume every due enrollment immediately (also what the cron calls). */
export async function runWorkflowsNow(): Promise<{ ok: true; processed: number; disabled: boolean }> {
  await requireAdmin();
  const run = await runDueWorkflows();
  revalidatePath("/automation");
  return { ok: true, processed: run.processed, disabled: run.skipped === "engine-disabled" };
}

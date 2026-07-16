import "server-only";

import { prisma } from "@/lib/prisma";
import type { LeadStage } from "@prisma/client";
import { inQuietWindow, quietWindowEndsAt } from "@/lib/automation-quiet-hours";
import { sendEmailMessage, sendSmsMessage } from "./messaging";
import type { WorkflowAction, TriggerType, TriggerConfig } from "@/lib/automation-types";
import { getWorkflowSettings } from "./founder-config";
import { scheduleWaitJob, drainDueWaitJobs } from "./automation-queue";

/**
 * Automation engine (Synamate "Workflows"). A trigger enrolls a contact; the enrollment then runs
 * a list of actions — normally linear, but `IF_TAG` can jump `currentStep` — until a WAIT (which
 * parks it for the cron / BullMQ, see automation-queue.ts) or the end.
 *
 * SAFE BY DESIGN: emitTrigger never throws into its caller's request path; an ACTIVE enrollment is
 * never duplicated for the same (workflow, contact); and action executors talk to Prisma directly
 * (they never call emitTrigger), so a workflow can't cascade-trigger itself into a loop. The step
 * loop below also caps total iterations per call, since `IF_TAG` makes a step→step cycle (e.g. a
 * branch that jumps back to itself) possible for the first time — see `maxSteps` below.
 *
 * Global Workflow Settings (lib/config-schema.ts → `WorkflowSettings`, edited at
 * /automation/settings) gate this engine at four points, all read via `getWorkflowSettings`:
 *   engineEnabled     — kill switch: no new enrollments (emitTrigger), no resumes
 *                       (runDueWorkflows), and in-flight runs freeze in place (advanceEnrollment).
 *   allowReEnrollment — whether a contact may re-enter a workflow they already completed.
 *   quietHours        — outbound sends park until the window closes (advanceEnrollment).
 *   batchSize         — enrollments resumed per tick (runDueWorkflows).
 */

export type TriggerContext = { leadId?: string | null; formId?: string; tag?: string; stage?: string };

export async function emitTrigger(type: TriggerType, ctx: TriggerContext): Promise<void> {
  try {
    if (!ctx.leadId) return;
    const settings = await getWorkflowSettings();
    if (!settings.engineEnabled) return; // global kill switch — no new enrollments

    const workflows = await prisma.workflow.findMany({
      // deletedAt: a soft-deleted workflow is inert — it must not enroll anyone while it
      // sits in the Deleted tab, but restoring it brings it straight back to life.
      where: { status: "PUBLISHED", triggerType: type, deletedAt: null },
    });
    for (const wf of workflows) {
      const cfg = (wf.triggerConfig as TriggerConfig | null) ?? {};
      if (type === "FORM_SUBMITTED" && cfg.formId && cfg.formId !== ctx.formId) continue;
      if (type === "TAG_ADDED" && cfg.tag && cfg.tag.toLowerCase() !== (ctx.tag ?? "").toLowerCase()) continue;
      if (type === "STAGE_CHANGED" && cfg.stage && cfg.stage !== ctx.stage) continue;

      // Default (allowReEnrollment) keeps the original rule — only a currently-running
      // enrollment blocks re-entry, so a contact can go through again after finishing.
      // Turning it off makes enrollment once-per-contact-ever.
      const blocking = await prisma.workflowEnrollment.findFirst({
        where: settings.allowReEnrollment
          ? { workflowId: wf.id, leadId: ctx.leadId, status: "ACTIVE" }
          : { workflowId: wf.id, leadId: ctx.leadId },
        select: { id: true },
      });
      if (blocking) continue;

      const enr = await prisma.workflowEnrollment.create({
        data: { workflowId: wf.id, leadId: ctx.leadId, context: ctx as object },
      });
      await prisma.workflow.update({ where: { id: wf.id }, data: { totalEnrolled: { increment: 1 } } });
      await advanceEnrollment(enr.id);
    }
  } catch (e) {
    console.error("[automation] emitTrigger failed", e);
  }
}

export async function advanceEnrollment(enrollmentId: string): Promise<void> {
  const enr = await prisma.workflowEnrollment.findUnique({ where: { id: enrollmentId }, include: { workflow: true } });
  if (!enr || enr.status !== "ACTIVE") return;
  // The workflow was soft-deleted while this enrollment was in flight: freeze it where it
  // stands (still ACTIVE) so restoring the workflow picks it back up mid-run. runDueWorkflows
  // already filters these out; this also covers the BullMQ drain path, which resumes by id.
  if (enr.workflow.deletedAt) return;
  const settings = await getWorkflowSettings();
  if (!settings.engineEnabled) return; // kill switch — freeze in place, resume when re-enabled
  const actions = (enr.workflow.actions as WorkflowAction[]) ?? [];
  let step = enr.currentStep;
  // IF_TAG lets a workflow jump backwards/sideways, so — unlike the old strictly-linear engine —
  // this loop can now cycle. Cap iterations so a misconfigured branch (e.g. thenStep pointing at
  // itself) fails loudly instead of spinning forever inside one request.
  const maxSteps = Math.max(actions.length * 4, 100);
  let guard = 0;
  try {
    while (step < actions.length) {
      if (++guard > maxSteps) {
        throw new Error(`Workflow exceeded ${maxSteps} steps in one run (check IF_TAG branches for a cycle)`);
      }
      const a = actions[step];
      if (a.type === "WAIT") {
        const mins = Math.max(1, a.waitMinutes ?? 60);
        const delayMs = mins * 60_000;
        await prisma.workflowEnrollment.update({
          where: { id: enr.id },
          data: { currentStep: step + 1, nextRunAt: new Date(Date.now() + delayMs) },
        });
        await scheduleWaitJob(enr.id, step, delayMs);
        return;
      }
      if (a.type === "IF_TAG") {
        const hasTag = a.tag?.trim()
          ? await prisma.lead.findFirst({
              where: { id: enr.leadId, tags: { some: { name: a.tag.trim().toLowerCase() } } },
              select: { id: true },
            })
          : null;
        const target = hasTag ? a.thenStep : a.elseStep;
        step = typeof target === "number" && target >= 0 ? target : step + 1;
        await prisma.workflowEnrollment.update({ where: { id: enr.id }, data: { currentStep: step, nextRunAt: null } });
        continue;
      }
      // Quiet hours: never deliver a message inside the window. Park ON this step (note we do
      // NOT advance `step`) so the send actually happens once the window opens, rather than
      // being skipped. Only outbound sends are gated — tags/stages/tasks are silent to the
      // contact, so holding those overnight would delay the workflow for no benefit.
      if ((a.type === "SEND_EMAIL" || a.type === "SEND_SMS") && settings.quietHours.enabled) {
        const now = new Date();
        if (inQuietWindow(now, settings.quietHours.startHour, settings.quietHours.endHour)) {
          const resumeAt = quietWindowEndsAt(now, settings.quietHours.endHour);
          await prisma.workflowEnrollment.update({
            where: { id: enr.id },
            data: { currentStep: step, nextRunAt: resumeAt },
          });
          await scheduleWaitJob(enr.id, step, resumeAt.getTime() - now.getTime());
          return;
        }
      }
      await executeAction(a, enr.leadId);
      step++;
      await prisma.workflowEnrollment.update({ where: { id: enr.id }, data: { currentStep: step, nextRunAt: null } });
    }
    await prisma.workflowEnrollment.update({ where: { id: enr.id }, data: { status: "COMPLETED", nextRunAt: null } });
  } catch (e) {
    await prisma.workflowEnrollment.update({
      where: { id: enr.id },
      data: { status: "FAILED", lastError: e instanceof Error ? e.message.slice(0, 300) : "error" },
    });
  }
}

async function executeAction(a: WorkflowAction, leadId: string): Promise<void> {
  switch (a.type) {
    case "SEND_EMAIL": {
      let subject = a.subject ?? "";
      let body = a.body ?? "";
      if (a.templateId) {
        const t = await prisma.messageTemplate.findUnique({ where: { id: a.templateId } });
        if (t) { subject = t.subject ?? subject; body = t.body; }
      }
      await sendEmailMessage({ leadId, subject: subject || "Message from B2 Consultants", body });
      break;
    }
    case "SEND_SMS": {
      let body = a.body ?? "";
      if (a.templateId) {
        const t = await prisma.messageTemplate.findUnique({ where: { id: a.templateId } });
        if (t) body = t.body;
      }
      if (body) await sendSmsMessage({ leadId, body });
      break;
    }
    case "ADD_TAG": {
      if (a.tag?.trim()) {
        const name = a.tag.trim().toLowerCase();
        const tag = await prisma.tag.upsert({ where: { name }, update: {}, create: { name } });
        await prisma.lead.update({ where: { id: leadId }, data: { tags: { connect: { id: tag.id } } } });
      }
      break;
    }
    case "REMOVE_TAG": {
      if (a.tag?.trim()) {
        const tag = await prisma.tag.findUnique({ where: { name: a.tag.trim().toLowerCase() } });
        if (tag) await prisma.lead.update({ where: { id: leadId }, data: { tags: { disconnect: { id: tag.id } } } });
      }
      break;
    }
    case "MOVE_STAGE": {
      if (a.stage) {
        const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { stage: true } });
        if (lead && lead.stage !== a.stage) {
          const to = a.stage as LeadStage;
          await prisma.lead.update({ where: { id: leadId }, data: { stage: to } });
          await prisma.leadStageHistory.create({ data: { leadId, fromStage: lead.stage, toStage: to } });
          const stage = await prisma.pipelineStage.findFirst({ where: { legacyStage: to, pipeline: { isDefault: true } } });
          if (stage) await prisma.opportunity.updateMany({ where: { leadId, pipeline: { isDefault: true } }, data: { stageId: stage.id } });
        }
      }
      break;
    }
    case "CREATE_TASK": {
      if (a.taskTitle?.trim()) {
        await prisma.contactTask.create({ data: { leadId, title: a.taskTitle.trim(), assignedToId: a.taskAssigneeId || null } });
      }
      break;
    }
    case "WAIT":
    case "IF_TAG":
      break; // both handled directly in advanceEnrollment's loop, never reach here
  }
}

/**
 * Resume every due enrollment (WAIT elapsed, or freshly created). Hit by /api/cron/workflows and
 * the admin "Run now" action.
 *
 * Two sources are checked, in order:
 *  1. `drainDueWaitJobs` — any BullMQ delayed job whose precise fire time has passed (see
 *     automation-queue.ts for why this is a drain-on-request-hit, not a live worker).
 *  2. The Postgres poll below — every ACTIVE enrollment with `nextRunAt <= now`. This is the
 *     authoritative source; it runs regardless of Redis being configured/reachable, so step 1
 *     failing or being unavailable never loses a scheduled resume. Enrollments already resumed by
 *     step 1 simply won't have a due `nextRunAt` anymore and are skipped here — no double-run.
 */
export async function runDueWorkflows(): Promise<{ processed: number; ranAt: string; skipped?: "engine-disabled" }> {
  const settings = await getWorkflowSettings();
  if (!settings.engineEnabled) {
    return { processed: 0, ranAt: new Date().toISOString(), skipped: "engine-disabled" };
  }

  const drained = await drainDueWaitJobs((id) => advanceEnrollment(id));

  const due = await prisma.workflowEnrollment.findMany({
    where: {
      status: "ACTIVE",
      // Don't spend the batch on enrollments whose workflow is sitting in the Deleted tab —
      // advanceEnrollment would no-op on them anyway, and they'd crowd out live work forever.
      workflow: { deletedAt: null },
      OR: [{ nextRunAt: null }, { nextRunAt: { lte: new Date() } }],
    },
    orderBy: { nextRunAt: "asc" },
    take: settings.batchSize,
    select: { id: true },
  });
  for (const e of due) await advanceEnrollment(e.id);
  return { processed: due.length + drained, ranAt: new Date().toISOString() };
}

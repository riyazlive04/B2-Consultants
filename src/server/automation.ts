import "server-only";

import { prisma } from "@/lib/prisma";
import type { LeadStage } from "@prisma/client";
import { inQuietWindow, quietWindowEndsAt } from "@/lib/automation-quiet-hours";
import { LEAD_STAGE_LABELS } from "@/lib/labels";
import { sendEmailMessage, sendSmsMessage } from "./messaging";
import { logSystemActivity, SYSTEM_ACTORS, type ActivityInput } from "./activity-log";
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

/**
 * The engine's own row on the founder's feed.
 *
 * The actor is the ENGINE, never whoever's request happened to reach `emitTrigger` or press
 * "Run now": the cron resumes these enrollments far more often than a human triggers one, and a
 * feed saying a telecaller emailed forty contacts overnight is a lie nobody could spot.
 *
 * Steps only: the run itself is not an event ("resumed 12 enrollments" is cron noise, and the
 * human's "Run now" click is already logged by its own action). `section` is "automation" for
 * every row — the founder's question here is "what did my workflows do".
 */
async function record(input: Omit<ActivityInput, "section">): Promise<void> {
  await logSystemActivity(SYSTEM_ACTORS.automation, { ...input, section: "automation" });
}

/** The founder reads names, never ids — and only a step that landed pays for the lookup. */
async function leadName(leadId: string): Promise<string> {
  const l = await prisma.lead.findUnique({ where: { id: leadId }, select: { name: true } });
  return l?.name ?? "a contact";
}

async function executeAction(a: WorkflowAction, leadId: string): Promise<void> {
  switch (a.type) {
    case "SEND_EMAIL": {
      let subject = a.subject ?? "";
      let body = a.body ?? "";
      let template: string | null = null;
      if (a.templateId) {
        const t = await prisma.messageTemplate.findUnique({ where: { id: a.templateId } });
        if (t) { subject = t.subject ?? subject; body = t.body; template = t.name; }
      }
      const out = await sendEmailMessage({ leadId, subject: subject || "Message from B2 Consultants", body });
      // SENT only: `ok` is also true for a SKIPPED row (email off), which nobody received.
      if (out.status === "SENT") {
        const who = await leadName(leadId);
        await record({
          action: "email.send",
          entityType: "Lead",
          entityId: leadId,
          summary: template ? `Emailed ${who} the "${template}" template` : `Emailed ${who} a workflow email`,
          meta: { channel: "EMAIL", template },
        });
      }
      break;
    }
    case "SEND_SMS": {
      let body = a.body ?? "";
      let template: string | null = null;
      if (a.templateId) {
        const t = await prisma.messageTemplate.findUnique({ where: { id: a.templateId } });
        if (t) { body = t.body; template = t.name; }
      }
      if (body) {
        const out = await sendSmsMessage({ leadId, body });
        if (out.status === "SENT") {
          const who = await leadName(leadId);
          await record({
            action: "sms.send",
            entityType: "Lead",
            entityId: leadId,
            summary: template ? `Sent ${who} the "${template}" SMS template` : `Sent ${who} a workflow SMS`,
            meta: { channel: "SMS", template },
          });
        }
      }
      break;
    }
    case "ADD_TAG": {
      if (a.tag?.trim()) {
        const name = a.tag.trim().toLowerCase();
        const tag = await prisma.tag.upsert({ where: { name }, update: {}, create: { name } });
        // `connect` is idempotent and reports nothing back, so ask first: re-adding a tag the
        // contact already has changes nothing, and the feed must not claim that it did.
        const had = await prisma.lead.findFirst({ where: { id: leadId, tags: { some: { id: tag.id } } }, select: { id: true } });
        await prisma.lead.update({ where: { id: leadId }, data: { tags: { connect: { id: tag.id } } } });
        if (!had) {
          await record({
            action: "tag.add",
            entityType: "Lead",
            entityId: leadId,
            summary: `Tagged ${await leadName(leadId)} "${name}"`,
            meta: { tag: name },
          });
        }
      }
      break;
    }
    case "REMOVE_TAG": {
      if (a.tag?.trim()) {
        const tag = await prisma.tag.findUnique({ where: { name: a.tag.trim().toLowerCase() } });
        if (tag) {
          // Same as ADD_TAG: a disconnect of a tag the contact never had is a silent no-op.
          const had = await prisma.lead.findFirst({ where: { id: leadId, tags: { some: { id: tag.id } } }, select: { id: true } });
          await prisma.lead.update({ where: { id: leadId }, data: { tags: { disconnect: { id: tag.id } } } });
          if (had) {
            await record({
              action: "tag.remove",
              entityType: "Lead",
              entityId: leadId,
              summary: `Removed the "${tag.name}" tag from ${await leadName(leadId)}`,
              meta: { tag: tag.name },
            });
          }
        }
      }
      break;
    }
    case "MOVE_STAGE": {
      if (a.stage) {
        const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { stage: true, name: true } });
        if (lead && lead.stage !== a.stage) {
          const to = a.stage as LeadStage;
          await prisma.lead.update({ where: { id: leadId }, data: { stage: to } });
          await prisma.leadStageHistory.create({ data: { leadId, fromStage: lead.stage, toStage: to } });
          const stage = await prisma.pipelineStage.findFirst({ where: { legacyStage: to, pipeline: { isDefault: true } } });
          if (stage) await prisma.opportunity.updateMany({ where: { leadId, pipeline: { isDefault: true } }, data: { stageId: stage.id } });
          await record({
            action: "lead.stage.move",
            entityType: "Lead",
            entityId: leadId,
            summary: `Moved ${lead.name} to ${LEAD_STAGE_LABELS[to] ?? to}`,
            meta: { changed: ["stage"], before: { stage: lead.stage }, after: { stage: to } },
          });
        }
      }
      break;
    }
    case "CREATE_TASK": {
      if (a.taskTitle?.trim()) {
        const title = a.taskTitle.trim();
        const task = await prisma.contactTask.create({ data: { leadId, title, assignedToId: a.taskAssigneeId || null } });
        await record({
          action: "task.create",
          entityType: "ContactTask",
          entityId: task.id,
          summary: `Created task "${title}" on ${await leadName(leadId)}`,
          meta: { leadId, assignedToId: a.taskAssigneeId || null },
        });
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

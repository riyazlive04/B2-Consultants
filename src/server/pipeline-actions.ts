"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { capabilityCheck, requireSection } from "@/lib/rbac";
import { parseDateInput } from "@/lib/dates";
import { majorStringToMinor, formatInrMinor, formatMonth } from "@/lib/format";
import { LEAD_STAGE_LABELS, CALL_OUTCOME_LABELS } from "@/lib/labels";
import { invalidateAvgFeeCache } from "./pipeline-metrics";
import { logActivity, diffFields } from "./activity-log";
import type { ActionResult } from "./finance-actions";

/**
 * Pipeline entry is for Asma/Nilofer (USER) + Admin (PRD1 §5.1).
 * Users may edit only leads they entered; delete is Admin-only.
 * Every stage change appends a LeadStageHistory row (immutable, trigger-guarded).
 */

const LEAD_STAGES = [
  "NEW_LEAD", "DISCO_BOOKED", "DISCO_NOT_BOOKED", "DISCO_COMPLETED",
  "SSS_BOOKED", "SSS_COMPLETED", "PROPOSAL_SENT",
  "SENT_TO_WORKSHOP", "WORKSHOP_FOLLOWUP", "OFFER_FOLLOWUP", "DEPOSIT_FOLLOWUP", "DEPOSIT_PAID",
  "WON", "LOST", "NO_SHOW",
] as const;

// Stages where the split/full-pay plan applies (deposit collected onward).
const PAYMENT_PLAN_STAGES = new Set(["DEPOSIT_PAID", "WON"]);

const PROGRAM_LEVELS = [
  "SOLO", "GUIDED", "ELITE", "GN_A1", "GN_A2", "GN_B1", "GN_B2", "GN_BUNDLE", "OTHER",
] as const;

const leadSchema = z.object({
  name: z.string().trim().min(1, "Lead name is required"),
  phone: z.string().trim().min(5, "Phone / WhatsApp with country code is required"),
  leadSource: z.enum([
    "INSTAGRAM", "YOUTUBE", "LINKEDIN", "WHATSAPP", "REFERRAL", "SUMMIT", "WORKSHOP",
    "GHOSTED_BLUEPRINT", "OTHER",
  ]),
  dateIn: z.string().min(10),
  stage: z.enum(LEAD_STAGES),
  wonLevel: z.enum(PROGRAM_LEVELS).optional().or(z.literal("")),
  paymentPlan: z.enum(["SPLIT_PAY", "FULL_PAY"]).optional().or(z.literal("")),
  notes: z.string().trim().optional(),
});

function firstError(e: z.ZodError): string {
  return e.issues[0]?.message ?? "Invalid input";
}

/** Reads the diff back as a sentence the founder can scan: "changed Stage, Payment plan". */
const FIELD_LABELS: Record<string, string> = {
  name: "Name", phone: "Phone", leadSource: "Source", dateIn: "Date in", stage: "Stage",
  wonLevel: "Program level", paymentPlan: "Payment plan", notes: "Notes",
  manualOverride: "Manual override", leadId: "Lead", callDate: "Call date", outcome: "Outcome",
  highlyQualified: "Highly Qualified", bantBudget: "BANT budget", bantAuthority: "BANT authority",
  bantNeed: "BANT need", bantTimeline: "BANT timeline", sssDate: "SSS date",
};

function fieldList(changed: string[]): string {
  return changed.map((k) => FIELD_LABELS[k] ?? k).join(", ");
}

export async function createLead(form: FormData): Promise<ActionResult> {
  const session = await requireSection("pipeline");
  const parsed = leadSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const d = parsed.data;
  if (d.stage === "WON" && !d.wonLevel) {
    return { ok: false, error: "Pick the program level this lead enrolled in (Won)" };
  }

  const created = await prisma.$transaction(async (tx) => {
    const lead = await tx.lead.create({
      data: {
        name: d.name,
        phone: d.phone,
        leadSource: d.leadSource,
        dateIn: parseDateInput(d.dateIn),
        stage: d.stage,
        wonLevel: d.stage === "WON" && d.wonLevel ? d.wonLevel : null,
        paymentPlan: PAYMENT_PLAN_STAGES.has(d.stage) && d.paymentPlan ? d.paymentPlan : null,
        notes: d.notes || null,
        enteredById: session.user.id,
      },
    });
    await tx.leadStageHistory.create({
      data: { leadId: lead.id, fromStage: null, toStage: d.stage, changedById: session.user.id },
    });
    return lead;
  });

  await logActivity(session, {
    action: "lead.create",
    section: "pipeline",
    entityType: "Lead",
    entityId: created.id,
    summary: `Added lead ${created.name} — ${LEAD_STAGE_LABELS[d.stage] ?? d.stage}`,
    meta: { stage: d.stage, leadSource: d.leadSource, wonLevel: created.wonLevel },
  });

  revalidatePath("/pipeline");
  return { ok: true };
}

export async function updateLead(id: string, form: FormData): Promise<ActionResult> {
  const session = await requireSection("pipeline");
  const parsed = leadSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const d = parsed.data;

  const lead = await prisma.lead.findUnique({ where: { id } });
  if (!lead) return { ok: false, error: "Lead not found" };
  if (session.role !== "ADMIN" && lead.enteredById !== session.user.id) {
    return { ok: false, error: "You can only edit leads you entered" };
  }
  if (d.stage === "WON" && !d.wonLevel) {
    return { ok: false, error: "Pick the program level this lead enrolled in (Won)" };
  }

  const data = {
    name: d.name,
    phone: d.phone,
    leadSource: d.leadSource,
    dateIn: parseDateInput(d.dateIn),
    stage: d.stage,
    wonLevel: d.stage === "WON" ? (d.wonLevel as (typeof PROGRAM_LEVELS)[number]) : lead.wonLevel,
    paymentPlan: PAYMENT_PLAN_STAGES.has(d.stage) ? d.paymentPlan || lead.paymentPlan : lead.paymentPlan,
    notes: d.notes || null,
    manualOverride: lead.source !== "MANUAL" ? true : lead.manualOverride,
  };

  await prisma.$transaction(async (tx) => {
    await tx.lead.update({ where: { id }, data });
    if (lead.stage !== d.stage) {
      await tx.leadStageHistory.create({
        data: { leadId: id, fromStage: lead.stage, toStage: d.stage, changedById: session.user.id },
      });
    }
  });

  const diff = diffFields(lead, data);
  if (diff.changed.length) {
    await logActivity(session, {
      action: "lead.update",
      section: "pipeline",
      entityType: "Lead",
      entityId: id,
      summary: `Edited lead ${d.name} — changed ${fieldList(diff.changed)}`,
      meta: diff,
    });
  }

  revalidatePath("/pipeline");
  return { ok: true };
}

export async function deleteLead(id: string): Promise<ActionResult> {
  const { allowed, denied, session } = await capabilityCheck("pipeline.configure");
  if (!allowed) return denied;
  const lead = await prisma.lead.delete({ where: { id } }); // cascades outcomes + history
  await logActivity(session, {
    action: "lead.delete",
    section: "pipeline",
    entityType: "Lead",
    entityId: lead.id,
    summary: `Deleted lead ${lead.name} — ${LEAD_STAGE_LABELS[lead.stage] ?? lead.stage}`,
    meta: { stage: lead.stage, leadSource: lead.leadSource, phone: lead.phone },
  });
  revalidatePath("/pipeline");
  return { ok: true };
}

/**
 * Speed-to-lead (Synamate "Time Contacted" / "Speed Ratio", in-sourced). Stamps the
 * first-contact time; speed = contactedAt − createdAt is derived at read. Idempotent -
 * only the first mark counts. A setter may mark their own or assigned leads; Admin any.
 */
export async function markLeadContacted(id: string): Promise<ActionResult> {
  const session = await requireSection("pipeline");
  const lead = await prisma.lead.findUnique({
    where: { id },
    select: { name: true, contactedAt: true, enteredById: true, assignedToId: true },
  });
  if (!lead) return { ok: false, error: "Lead not found" };
  if (
    session.role !== "ADMIN" &&
    lead.enteredById !== session.user.id &&
    lead.assignedToId !== session.user.id
  ) {
    return { ok: false, error: "You can only update your own or assigned leads" };
  }
  if (!lead.contactedAt) {
    const at = new Date();
    await prisma.lead.update({ where: { id }, data: { contactedAt: at } });
    await logActivity(session, {
      action: "lead.contacted",
      section: "pipeline",
      entityType: "Lead",
      entityId: id,
      summary: `Marked ${lead.name} as first contacted`,
      meta: { contactedAt: at.toISOString() },
    });
  }
  revalidatePath("/pipeline");
  return { ok: true };
}

/** Admin assigns a lead to a setter (Synamate "Who"). Empty userId unassigns. */
export async function assignLead(id: string, userId: string): Promise<ActionResult> {
  const { allowed, denied, session } = await capabilityCheck("pipeline.configure");
  if (!allowed) return denied;
  const lead = await prisma.lead.update({
    where: { id },
    data: { assignedToId: userId || null },
    include: { assignedTo: { select: { name: true } } },
  });
  await logActivity(session, {
    action: "lead.assign",
    section: "pipeline",
    entityType: "Lead",
    entityId: lead.id,
    summary: lead.assignedTo
      ? `Assigned lead ${lead.name} to ${lead.assignedTo.name}`
      : `Unassigned lead ${lead.name}`,
    meta: { assignedToId: lead.assignedToId },
  });
  revalidatePath("/pipeline");
  return { ok: true };
}

const outcomeSchema = z.object({
  leadId: z.string().min(1, "Pick the lead this call belongs to"),
  callDate: z.string().min(10),
  outcome: z.enum([
    "QUALIFIED_FOR_SSS", "NOT_QUALIFIED_FOR_SSS", "FOLLOW_UP_NEEDED", "NO_SHOW", "SENT_TO_WORKSHOP",
  ]),
  highlyQualified: z.string().optional(), // checkbox
  bantBudget: z.string().optional(),
  bantAuthority: z.string().optional(),
  bantNeed: z.string().optional(),
  bantTimeline: z.string().optional(),
  sssDate: z.string().optional(),
  notes: z.string().trim().optional(),
});

/**
 * The Outreach SOP's role boundary (checklist §P: "'Highly Qualified' is writable only by the
 * Discovery Specialist").
 *
 * `requireSection("pipeline")` admits every USER and HEAD — including the outreach specialist,
 * whose own SOP says they may only READ this verdict to decide whether Step 19 runs. So the flag
 * gets its own guard, checked only when someone actually tries to CHANGE it: entering an ordinary
 * discovery outcome stays open to anyone with the pipeline screen, which is the existing
 * behaviour and is not what the SOP restricts.
 *
 * Not cosmetic: `highlyQualified` drives priority scoring, the HQ-rate metric, gamification XP,
 * and now the SSS confirmation ladder.
 */
async function guardHighlyQualified(current: boolean, next: boolean): Promise<ActionResult | null> {
  if (current === next) return null; // not a change — nothing to guard
  const { allowed, denied } = await capabilityCheck("outreach.qualify");
  return allowed ? null : denied;
}

export async function createOutcome(form: FormData): Promise<ActionResult> {
  const session = await requireSection("pipeline");
  const parsed = outcomeSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const d = parsed.data;

  const lead = await prisma.lead.findUnique({ where: { id: d.leadId } });
  if (!lead) return { ok: false, error: "Lead not found" };

  const hq = d.highlyQualified === "on";
  const denied = await guardHighlyQualified(false, hq);
  if (denied) return denied;

  const row = await prisma.discoveryOutcome.create({
    data: {
      leadId: d.leadId,
      callDate: parseDateInput(d.callDate),
      outcome: d.outcome,
      highlyQualified: d.highlyQualified === "on",
      bantBudget: d.bantBudget === "on",
      bantAuthority: d.bantAuthority === "on",
      bantNeed: d.bantNeed === "on",
      bantTimeline: d.bantTimeline === "on",
      sssDate: d.sssDate?.trim() ? parseDateInput(d.sssDate) : null,
      notes: d.notes || null,
      enteredById: session.user.id,
    },
  });

  await logActivity(session, {
    action: "outcome.create",
    section: "pipeline",
    entityType: "DiscoveryOutcome",
    entityId: row.id,
    summary: `Recorded a discovery outcome for ${lead.name} — ${CALL_OUTCOME_LABELS[d.outcome] ?? d.outcome}${hq ? " (Highly Qualified)" : ""}`,
    meta: { outcome: d.outcome, highlyQualified: hq, leadId: d.leadId },
  });

  revalidatePath("/pipeline");
  return { ok: true };
}

export async function updateOutcome(id: string, form: FormData): Promise<ActionResult> {
  const session = await requireSection("pipeline");
  const parsed = outcomeSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const d = parsed.data;

  const existing = await prisma.discoveryOutcome.findUnique({
    where: { id },
    include: { lead: { select: { name: true } } },
  });
  if (!existing) return { ok: false, error: "Outcome not found" };
  if (session.role !== "ADMIN" && existing.enteredById !== session.user.id) {
    return { ok: false, error: "You can only edit outcomes you entered" };
  }

  const denied = await guardHighlyQualified(existing.highlyQualified, d.highlyQualified === "on");
  if (denied) return denied;

  const data = {
    leadId: d.leadId,
    callDate: parseDateInput(d.callDate),
    outcome: d.outcome,
    highlyQualified: d.highlyQualified === "on",
    bantBudget: d.bantBudget === "on",
    bantAuthority: d.bantAuthority === "on",
    bantNeed: d.bantNeed === "on",
    bantTimeline: d.bantTimeline === "on",
    sssDate: d.sssDate?.trim() ? parseDateInput(d.sssDate) : null,
    notes: d.notes || null,
  };

  await prisma.discoveryOutcome.update({ where: { id }, data });

  const diff = diffFields(existing, data);
  if (diff.changed.length) {
    await logActivity(session, {
      action: "outcome.update",
      section: "pipeline",
      entityType: "DiscoveryOutcome",
      entityId: id,
      summary: `Edited the discovery outcome for ${existing.lead.name} — changed ${fieldList(diff.changed)}`,
      meta: diff,
    });
  }

  revalidatePath("/pipeline");
  return { ok: true };
}

export async function deleteOutcome(id: string): Promise<ActionResult> {
  const { allowed, denied, session } = await capabilityCheck("pipeline.configure");
  if (!allowed) return denied;
  const row = await prisma.discoveryOutcome.delete({
    where: { id },
    include: { lead: { select: { name: true } } },
  });
  await logActivity(session, {
    action: "outcome.delete",
    section: "pipeline",
    entityType: "DiscoveryOutcome",
    entityId: row.id,
    summary: `Deleted the discovery outcome for ${row.lead.name} — ${CALL_OUTCOME_LABELS[row.outcome] ?? row.outcome}`,
    meta: { outcome: row.outcome, leadId: row.leadId },
  });
  revalidatePath("/pipeline");
  return { ok: true };
}

/** Admin sets the monthly revenue target for the target bar (default ₹8,00,000). */
export async function setMonthlyTarget(form: FormData): Promise<ActionResult> {
  const { allowed, denied, session } = await capabilityCheck("pipeline.configure");
  if (!allowed) return denied;
  const raw = String(form.get("targetInr") ?? "").trim();
  if (!/^\d{1,12}(\.\d{0,2})?$/.test(raw)) return { ok: false, error: "Enter a plain amount like 800000" };
  const month = String(form.get("month") ?? "");
  if (!/^\d{4}-\d{2}$/.test(month)) return { ok: false, error: "Invalid month" };
  const monthDate = parseDateInput(`${month}-01`);

  const row = await prisma.monthlyTarget.upsert({
    where: { month: monthDate },
    update: { targetInrMinor: majorStringToMinor(raw) },
    create: { month: monthDate, targetInrMinor: majorStringToMinor(raw) },
  });

  await logActivity(session, {
    action: "target.update",
    section: "pipeline",
    entityType: "MonthlyTarget",
    entityId: row.id,
    summary: `Set the ${formatMonth(monthDate)} revenue target to ${formatInrMinor(row.targetInrMinor)}`,
    meta: { month, targetInrMinor: String(row.targetInrMinor) },
  });

  revalidatePath("/pipeline");
  return { ok: true };
}

/**
 * Admin sets the fallback average program fee (PRD1 §5.4). It's used to value the
 * open pipeline only until real income history can define the fee per level.
 * Stored in AppSetting as a plain INR-major string; blank clears it.
 */
export async function setPipelineAvgFee(form: FormData): Promise<ActionResult> {
  const { allowed, denied, session } = await capabilityCheck("pipeline.configure");
  if (!allowed) return denied;
  const raw = String(form.get("avgFeeInr") ?? "").trim();
  if (raw === "") {
    const { count } = await prisma.appSetting.deleteMany({ where: { key: "pipelineAvgFeeInr" } });
    if (count) {
      await logActivity(session, {
        action: "setting.update",
        section: "pipeline",
        entityType: "AppSetting",
        entityId: "pipelineAvgFeeInr",
        summary: "Cleared the fallback average program fee",
        meta: { key: "pipelineAvgFeeInr", value: null },
      });
    }
    invalidateAvgFeeCache();
    revalidatePath("/pipeline");
    return { ok: true };
  }
  if (!/^\d{1,9}$/.test(raw)) return { ok: false, error: "Enter a plain amount like 75000, or leave blank to clear" };
  await prisma.appSetting.upsert({
    where: { key: "pipelineAvgFeeInr" },
    update: { value: raw },
    create: { key: "pipelineAvgFeeInr", value: raw },
  });
  await logActivity(session, {
    action: "setting.update",
    section: "pipeline",
    entityType: "AppSetting",
    entityId: "pipelineAvgFeeInr",
    summary: `Set the fallback average program fee to ${formatInrMinor(majorStringToMinor(raw))}`,
    meta: { key: "pipelineAvgFeeInr", value: raw },
  });
  invalidateAvgFeeCache();
  revalidatePath("/pipeline");
  return { ok: true };
}

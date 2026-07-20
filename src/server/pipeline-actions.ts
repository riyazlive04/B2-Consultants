"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma, type LeadStage } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { capabilityCheck, requireSection } from "@/lib/rbac";
import { parseDateInput } from "@/lib/dates";
import { majorStringToMinor, formatInrMinor, formatMonth } from "@/lib/format";
import { LEAD_STAGE_LABELS, CALL_OUTCOME_LABELS } from "@/lib/labels";
import { optionalRule, rule } from "@/lib/field-rules";
import { statusForLegacyStage } from "@/lib/opportunity-status";
import { invalidateAvgFeeCache } from "./pipeline-metrics";
import { findDuplicateLead } from "./lead-intake";
import { pickFirstCaller } from "./assignment";
import { logActivity, diffFields } from "./activity-log";
import { isKnownLevel } from "./levels";
import type { ActionResult } from "./finance-actions";
import { archiveData, restoreData } from "@/lib/soft-delete";

/**
 * Reverse write-through for issue 1.5: when the Pipeline board changes a lead's stage, move that
 * lead's opportunity ON THE DEFAULT SALES PIPELINE to the column bridged to the new stage (and set
 * its status), so `/pipeline` and `/opportunities` never show the same deal in two places. Mirror
 * of opportunities-actions.moveOpportunity's opp→lead direction, sharing statusForLegacyStage.
 * No-ops when the lead has no opportunity, or when no default-pipeline column is bridged to this
 * stage; custom pipelines are a separate view and are left untouched.
 */
async function syncDefaultOpportunity(
  tx: Prisma.TransactionClient,
  leadId: string,
  newStage: LeadStage,
): Promise<void> {
  const opps = await tx.opportunity.findMany({
    where: { leadId, pipeline: { isDefault: true, deletedAt: null } },
    select: { id: true, stageId: true, wonAt: true },
  });
  if (!opps.length) return;
  const target = await tx.pipelineStage.findFirst({
    where: { pipeline: { isDefault: true, deletedAt: null }, legacyStage: newStage, deletedAt: null },
    select: { id: true },
  });
  if (!target) return;
  const status = statusForLegacyStage(newStage);
  const max = await tx.opportunity.aggregate({ where: { stageId: target.id }, _max: { position: true } });
  let pos = (max._max.position ?? -1) + 1;
  for (const o of opps) {
    if (o.stageId === target.id) continue; // already in the right column
    await tx.opportunity.update({
      where: { id: o.id },
      data: {
        stageId: target.id,
        status,
        wonAt: status === "WON" ? o.wonAt ?? new Date() : null,
        position: pos++,
      },
    });
  }
}

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

const leadSchema = z.object({
  name: rule("name"),
  phone: rule("phone"),
  leadSource: z.enum([
    "INSTAGRAM", "YOUTUBE", "LINKEDIN", "WHATSAPP", "REFERRAL", "SUMMIT", "WORKSHOP",
    "GHOSTED_BLUEPRINT", "OTHER",
  ]),
  dateIn: z.string().min(10),
  stage: z.enum(LEAD_STAGES),
  wonLevel: z.string().trim().optional().or(z.literal("")), // validated vs the live catalogue when set + Won
  paymentPlan: z.enum(["SPLIT_PAY", "FULL_PAY"]).optional().or(z.literal("")),
  notes: optionalRule("text"),
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
  if (d.wonLevel && !(await isKnownLevel(d.wonLevel))) return { ok: false, error: "That program level no longer exists — pick another." };

  // Duplicate check at the point of entry (issue 1.3) — same normalized-phone dedup the capture
  // path uses, so the same person isn't split across two pipeline rows.
  const dup = await findDuplicateLead({ phone: d.phone });
  if (dup) {
    // Re-adding someone who was ARCHIVED: restore them instead of blocking with a confusing
    // "already exists" (the row is hidden from every active view) or splitting them into a
    // duplicate. Respects the existing duplicate-check while handling the archive cleanly.
    if (dup.lead.deletedAt) {
      await prisma.lead.update({ where: { id: dup.lead.id }, data: restoreData });
      await logActivity(session, {
        action: "lead.restore",
        section: "pipeline",
        entityType: "Lead",
        entityId: dup.lead.id,
        summary: `Restored archived lead ${dup.lead.name} on re-entry`,
      });
      revalidatePath("/pipeline");
      revalidatePath("/contacts");
      return { ok: true };
    }
    return {
      ok: false,
      error: `A lead with this phone number already exists — ${dup.lead.name}. Open that lead instead of adding a new one.`,
    };
  }
  // Auto-assign an owner on creation (issues 1.1/1.2) via the configured first-call rotation;
  // a rotation misconfig returns null and must never block entry.
  const assignedToId = await pickFirstCaller().catch(() => null);

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
        assignedToId,
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
  if (d.wonLevel && !(await isKnownLevel(d.wonLevel))) return { ok: false, error: "That program level no longer exists — pick another." };

  const data = {
    name: d.name,
    phone: d.phone,
    leadSource: d.leadSource,
    dateIn: parseDateInput(d.dateIn),
    stage: d.stage,
    wonLevel: d.stage === "WON" ? (d.wonLevel || null) : lead.wonLevel,
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
      await syncDefaultOpportunity(tx, id, d.stage); // keep the opp board in sync (1.5)
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
  revalidatePath("/opportunities"); // a stage change may have moved the linked opp (1.5)
  return { ok: true };
}

/** Delete = ARCHIVE. The lead's history/outcomes/opps survive; restore from the Archived tab. */
export async function deleteLead(id: string): Promise<ActionResult> {
  const { allowed, denied, session } = await capabilityCheck("pipeline.configure");
  if (!allowed) return denied;
  const lead = await prisma.lead.update({ where: { id }, data: archiveData(session.user.id) });
  await logActivity(session, {
    action: "lead.archive",
    section: "pipeline",
    entityType: "Lead",
    entityId: lead.id,
    summary: `Archived lead ${lead.name} — ${LEAD_STAGE_LABELS[lead.stage] ?? lead.stage}`,
    meta: { stage: lead.stage, leadSource: lead.leadSource, phone: lead.phone },
  });
  revalidatePath("/pipeline");
  revalidatePath("/contacts");
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
  notes: optionalRule("text"),
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

/**
 * Move one lead to a stage — the drag-and-drop pipeline's only write (Part 2 §9, §18.6).
 *
 * Narrow on purpose. `updateLead` takes the whole form, so reusing it for a drag would mean
 * the board POSTing every field of a lead it never showed, and a stale card could silently
 * revert a name someone else had just fixed. This touches `stage` and nothing else.
 *
 * Enforces the SAME ownership rule as updateLead — a USER may only move leads they entered —
 * because a board is a different way to look at the pipeline, not a different set of rules.
 * The stage-history row is written in the same transaction, so a move can never happen
 * without its audit trail.
 */
export async function moveLeadStage(id: string, toStage: string): Promise<ActionResult> {
  const session = await requireSection("pipeline");
  if (!(LEAD_STAGES as readonly string[]).includes(toStage)) {
    return { ok: false, error: "Unknown stage" };
  }
  const stage = toStage as (typeof LEAD_STAGES)[number];

  const lead = await prisma.lead.findUnique({
    where: { id },
    select: { id: true, name: true, stage: true, enteredById: true, wonLevel: true },
  });
  if (!lead) return { ok: false, error: "Lead not found" };
  if (session.role !== "ADMIN" && lead.enteredById !== session.user.id) {
    return { ok: false, error: "You can only move leads you entered" };
  }
  if (lead.stage === stage) return { ok: true }; // dropped back where it started

  // WON needs the program level, which a drag can't supply. Refuse rather than write a WON
  // lead with no level — that row feeds revenue and commission, and a half-made one is worse
  // than a card that wouldn't move.
  if (stage === "WON" && !lead.wonLevel) {
    return { ok: false, error: "Open the lead and pick the program level to mark it Won." };
  }

  await prisma.$transaction(async (tx) => {
    await tx.lead.update({ where: { id }, data: { stage } });
    await tx.leadStageHistory.create({
      data: { leadId: id, fromStage: lead.stage, toStage: stage, changedById: session.user.id },
    });
    await syncDefaultOpportunity(tx, id, stage); // keep the opp board in sync (1.5)
  });

  await logActivity(session, {
    action: "lead.stage.move",
    section: "pipeline",
    entityType: "Lead",
    entityId: id,
    summary: `Moved ${lead.name} from ${LEAD_STAGE_LABELS[lead.stage] ?? lead.stage} to ${LEAD_STAGE_LABELS[stage] ?? stage}`,
    meta: { fromStage: lead.stage, toStage: stage, via: "drag_drop" },
  });
  revalidatePath("/pipeline");
  revalidatePath("/opportunities"); // the linked opp may have moved (1.5)
  return { ok: true };
}

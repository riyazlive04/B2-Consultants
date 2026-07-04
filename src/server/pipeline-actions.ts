"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin, requireSection } from "@/lib/rbac";
import { parseDateInput } from "@/lib/dates";
import { majorStringToMinor } from "@/lib/format";
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

export async function createLead(form: FormData): Promise<ActionResult> {
  const session = await requireSection("pipeline");
  const parsed = leadSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const d = parsed.data;
  if (d.stage === "WON" && !d.wonLevel) {
    return { ok: false, error: "Pick the program level this lead enrolled in (Won)" };
  }

  await prisma.$transaction(async (tx) => {
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

  await prisma.$transaction(async (tx) => {
    await tx.lead.update({
      where: { id },
      data: {
        name: d.name,
        phone: d.phone,
        leadSource: d.leadSource,
        dateIn: parseDateInput(d.dateIn),
        stage: d.stage,
        wonLevel: d.stage === "WON" ? (d.wonLevel as (typeof PROGRAM_LEVELS)[number]) : lead.wonLevel,
        paymentPlan: PAYMENT_PLAN_STAGES.has(d.stage) ? d.paymentPlan || lead.paymentPlan : lead.paymentPlan,
        notes: d.notes || null,
        manualOverride: lead.source !== "MANUAL" ? true : lead.manualOverride,
      },
    });
    if (lead.stage !== d.stage) {
      await tx.leadStageHistory.create({
        data: { leadId: id, fromStage: lead.stage, toStage: d.stage, changedById: session.user.id },
      });
    }
  });
  revalidatePath("/pipeline");
  return { ok: true };
}

export async function deleteLead(id: string): Promise<ActionResult> {
  await requireAdmin();
  await prisma.lead.delete({ where: { id } }); // cascades outcomes + history
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
    select: { contactedAt: true, enteredById: true, assignedToId: true },
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
    await prisma.lead.update({ where: { id }, data: { contactedAt: new Date() } });
  }
  revalidatePath("/pipeline");
  return { ok: true };
}

/** Admin assigns a lead to a setter (Synamate "Who"). Empty userId unassigns. */
export async function assignLead(id: string, userId: string): Promise<ActionResult> {
  await requireAdmin();
  await prisma.lead.update({ where: { id }, data: { assignedToId: userId || null } });
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

export async function createOutcome(form: FormData): Promise<ActionResult> {
  const session = await requireSection("pipeline");
  const parsed = outcomeSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const d = parsed.data;

  const lead = await prisma.lead.findUnique({ where: { id: d.leadId } });
  if (!lead) return { ok: false, error: "Lead not found" };

  await prisma.discoveryOutcome.create({
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
  revalidatePath("/pipeline");
  return { ok: true };
}

export async function updateOutcome(id: string, form: FormData): Promise<ActionResult> {
  const session = await requireSection("pipeline");
  const parsed = outcomeSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const d = parsed.data;

  const existing = await prisma.discoveryOutcome.findUnique({ where: { id } });
  if (!existing) return { ok: false, error: "Outcome not found" };
  if (session.role !== "ADMIN" && existing.enteredById !== session.user.id) {
    return { ok: false, error: "You can only edit outcomes you entered" };
  }

  await prisma.discoveryOutcome.update({
    where: { id },
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
    },
  });
  revalidatePath("/pipeline");
  return { ok: true };
}

export async function deleteOutcome(id: string): Promise<ActionResult> {
  await requireAdmin();
  await prisma.discoveryOutcome.delete({ where: { id } });
  revalidatePath("/pipeline");
  return { ok: true };
}

/** Admin sets the monthly revenue target for the target bar (default ₹8,00,000). */
export async function setMonthlyTarget(form: FormData): Promise<ActionResult> {
  await requireAdmin();
  const raw = String(form.get("targetInr") ?? "").trim();
  if (!/^\d{1,12}(\.\d{0,2})?$/.test(raw)) return { ok: false, error: "Enter a plain amount like 800000" };
  const month = String(form.get("month") ?? "");
  if (!/^\d{4}-\d{2}$/.test(month)) return { ok: false, error: "Invalid month" };
  const monthDate = parseDateInput(`${month}-01`);

  await prisma.monthlyTarget.upsert({
    where: { month: monthDate },
    update: { targetInrMinor: majorStringToMinor(raw) },
    create: { month: monthDate, targetInrMinor: majorStringToMinor(raw) },
  });
  revalidatePath("/pipeline");
  return { ok: true };
}

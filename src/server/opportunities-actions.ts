"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { capabilityCheck, requireSection } from "@/lib/rbac";
import { getTodayInrPerEur, inrMinorToEurMinor } from "@/lib/fx";
import { majorStringToMinor } from "@/lib/format";
import { parseMentions } from "@/lib/gn-mentions";
import { optionalRule, rule } from "@/lib/field-rules";
import { statusForLegacyStage } from "@/lib/opportunity-status";
import { LEAD_STAGE_LABELS } from "@/lib/labels";
import { emitTrigger } from "./automation";
import { logActivity, diffFields } from "./activity-log";
import type { OpportunityStatus, LeadStage } from "@prisma/client";
import type { ActionResult } from "./finance-actions";
import { archiveData, restoreData } from "@/lib/soft-delete";

/**
 * Mutations for the Opportunities Kanban (Synamate "Pipelines"). Moving a card into a stage that
 * is MAPPED to a lead-lifecycle stage (`PipelineStage.legacyStage`) write-throughs to Lead.stage +
 * LeadStageHistory, so pipeline-metrics / funnel / WhatsApp reminders stay correct — on ANY
 * pipeline, not just the seeded default. The default Sales pipeline is mapped by the seed; custom
 * pipelines opt in per-stage via the Manage-board picker (`setStageLegacyStage`). Unmapped stages
 * (`legacyStage` null) never touch Lead.stage, so a board that's a separate process stays separate.
 * Pipeline & stage editing requires the `pipeline.configure` capability.
 */

function firstError(e: z.ZodError): string {
  return e.issues[0]?.message ?? "Invalid input";
}

const OPP_SOURCES = [
  "INSTAGRAM", "YOUTUBE", "LINKEDIN", "WHATSAPP", "REFERRAL", "SUMMIT", "WORKSHOP",
  "META_ADS", "LANDING_PAGE", "GHOSTED_BLUEPRINT", "OTHER",
] as const;

// The legacy-stage → OpportunityStatus mapping now lives in lib/opportunity-status.ts so the
// Pipeline board's reverse write-through (issue 1.5) shares exactly one copy of the rule.
const statusForLegacy = statusForLegacyStage;

// ─────────────────────────── Move a card (drag-drop) ───────────────────────────

export async function moveOpportunity(
  oppId: string,
  toStageId: string,
  toIndex: number,
): Promise<ActionResult> {
  const session = await requireSection("opportunities");
  const opp = await prisma.opportunity.findUnique({
    where: { id: oppId },
    include: { pipeline: { select: { id: true, isDefault: true } }, stage: { select: { name: true } } },
  });
  if (!opp) return { ok: false, error: "Opportunity not found" };
  const toStage = await prisma.pipelineStage.findUnique({ where: { id: toStageId } });
  if (!toStage || toStage.pipelineId !== opp.pipelineId) {
    return { ok: false, error: "Invalid target stage" };
  }
  const legacy = toStage.legacyStage;
  // A bridged (default-pipeline) stage dictates the status. A custom pipeline's columns carry no
  // won/lost meaning (legacyStage is null), so a drag there must PRESERVE the card's current status
  // — otherwise dragging a deal you'd marked Won into the next column silently resets it to Open and
  // erases wonAt, losing the win.
  const newStatus: OpportunityStatus = legacy ? statusForLegacy(legacy) : opp.status;
  let stageChangedTo: LeadStage | null = null;

  await prisma.$transaction(async (tx) => {
    const targetIds = (
      await tx.opportunity.findMany({
        where: { stageId: toStageId, id: { not: oppId } },
        orderBy: { position: "asc" },
        select: { id: true },
      })
    ).map((o) => o.id);
    const idx = Math.max(0, Math.min(toIndex, targetIds.length));
    targetIds.splice(idx, 0, oppId);

    await tx.opportunity.update({
      where: { id: oppId },
      data: {
        stageId: toStageId,
        status: newStatus,
        // Clear wonAt only when a bridged stage moves the card OUT of Won; on a custom pipeline
        // (legacy null) the status/date are preserved, so keep whatever was there.
        wonAt: newStatus === "WON" ? opp.wonAt ?? new Date() : legacy ? null : opp.wonAt,
      },
    });
    for (let i = 0; i < targetIds.length; i++) {
      await tx.opportunity.update({ where: { id: targetIds[i] }, data: { position: i } });
    }
    if (opp.stageId !== toStageId) {
      const sourceIds = await tx.opportunity.findMany({
        where: { stageId: opp.stageId },
        orderBy: { position: "asc" },
        select: { id: true },
      });
      for (let i = 0; i < sourceIds.length; i++) {
        await tx.opportunity.update({ where: { id: sourceIds[i].id }, data: { position: i } });
      }
    }
    // Write-through whenever the TARGET stage is mapped to a lifecycle stage — regardless of
    // which pipeline it's on. The old `isDefault` gate meant a card moved on a second pipeline
    // never updated Lead.stage, so the funnel / reminders / dashboard silently undercounted it
    // (schema.prisma PipelineStage.legacyStage). An unmapped stage still has `legacy` null here,
    // so custom boards that carry no lifecycle meaning are unaffected.
    if (legacy) {
      const lead = await tx.lead.findUnique({ where: { id: opp.leadId }, select: { stage: true } });
      if (lead && lead.stage !== legacy) {
        await tx.lead.update({ where: { id: opp.leadId }, data: { stage: legacy } });
        await tx.leadStageHistory.create({
          data: { leadId: opp.leadId, fromStage: lead.stage, toStage: legacy, changedById: session.user.id },
        });
        stageChangedTo = legacy;
      }
    }
  });

  const diff = diffFields(
    { stageId: opp.stageId, status: opp.status },
    { stageId: toStageId, status: newStatus },
  );
  // A drop back into the same column only reshuffles positions — not a feed row.
  if (diff.changed.length) {
    await logActivity(session, {
      action: "opportunity.move",
      section: "opportunities",
      entityType: "Opportunity",
      entityId: oppId,
      summary: `Moved ${opp.name} from ${opp.stage.name} to ${toStage.name}`,
      meta: { changed: diff.changed, before: diff.before, after: diff.after },
    });
  }

  if (stageChangedTo) await emitTrigger("STAGE_CHANGED", { leadId: opp.leadId, stage: stageChangedTo });

  revalidatePath("/opportunities");
  revalidatePath("/pipeline");
  revalidatePath(`/contacts/${opp.leadId}`);
  return { ok: true };
}

// ─────────────────────────── Opportunity CRUD ───────────────────────────

const createOppSchema = z.object({
  leadId: z.string().trim().optional(),
  // The inline "new contact" pair — a real person, unlike the deal name below.
  newName: optionalRule("name"),
  newPhone: optionalRule("phone"),
  pipelineId: z.string().min(1, "Pick a pipeline"),
  stageId: z.string().min(1, "Pick a stage"),
  // Deal name: free text, digits and all ("Level 2 — Q3 renewal").
  name: optionalRule("text"),
  valueInr: optionalRule("money"),
  source: z.enum(OPP_SOURCES).optional().or(z.literal("")),
  assignedToId: z.string().trim().optional(),
});

export async function createOpportunity(form: FormData): Promise<ActionResult> {
  const session = await requireSection("opportunities");
  const parsed = createOppSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const d = parsed.data;

  const stage = await prisma.pipelineStage.findUnique({ where: { id: d.stageId } });
  if (!stage || stage.pipelineId !== d.pipelineId) return { ok: false, error: "Invalid stage" };

  const fx = await getTodayInrPerEur();
  const valueInrMinor = d.valueInr?.trim() ? majorStringToMinor(d.valueInr) : 0n;
  const valueEurMinor = inrMinorToEurMinor(valueInrMinor, fx.rate);

  const result = await prisma.$transaction(async (tx) => {
    // Resolve the contact: existing lead, or create a new one inline.
    let leadId = d.leadId?.trim() || "";
    if (!leadId) {
      if (!d.newName || !d.newPhone) throw new Error("MISSING_CONTACT");
      const lead = await tx.lead.create({
        data: {
          name: d.newName,
          phone: d.newPhone,
          leadSource: (d.source || "OTHER") as (typeof OPP_SOURCES)[number],
          dateIn: new Date(),
          stage: "NEW_LEAD",
          enteredById: session.user.id,
        },
      });
      await tx.leadStageHistory.create({
        data: { leadId: lead.id, fromStage: null, toStage: "NEW_LEAD", changedById: session.user.id },
      });
      leadId = lead.id;
    }
    const lead = await tx.lead.findUnique({ where: { id: leadId }, select: { name: true } });
    if (!lead) throw new Error("NO_LEAD");

    const max = await tx.opportunity.aggregate({
      where: { stageId: d.stageId },
      _max: { position: true },
    });
    const opp = await tx.opportunity.create({
      data: {
        leadId,
        pipelineId: d.pipelineId,
        stageId: d.stageId,
        name: d.name?.trim() || lead.name,
        status: statusForLegacy(stage.legacyStage),
        valueInrMinor,
        valueEurMinor,
        fxRateUsed: fx.rate,
        source: d.source || null,
        assignedToId: d.assignedToId || null,
        position: (max._max.position ?? -1) + 1,
      },
    });
    return { leadId, oppId: opp.id, oppName: opp.name, leadName: lead.name, newContact: !d.leadId?.trim() };
  }).catch((e: Error) => {
    if (e.message === "MISSING_CONTACT") return "MISSING_CONTACT" as const;
    throw e;
  });

  if (result === "MISSING_CONTACT") {
    return { ok: false, error: "Pick an existing contact or enter a new name + phone" };
  }
  await logActivity(session, {
    action: "opportunity.create",
    section: "opportunities",
    entityType: "Opportunity",
    entityId: result.oppId,
    summary: `Created opportunity ${result.oppName} for ${result.leadName} in ${stage.name}`,
    meta: {
      leadId: result.leadId,
      stageId: d.stageId,
      valueInr: valueInrMinor.toString(),
      source: d.source || null,
      newContact: result.newContact,
    },
  });
  revalidatePath("/opportunities");
  revalidatePath(`/contacts/${result.leadId}`);
  return { ok: true };
}

const updateOppSchema = z.object({
  name: rule("text").pipe(z.string().min(1, "Opportunity name is required")),
  valueInr: optionalRule("money"),
  source: z.enum(OPP_SOURCES).optional().or(z.literal("")),
  assignedToId: z.string().trim().optional(),
  status: z.enum(["OPEN", "WON", "LOST", "ABANDONED"]).optional().or(z.literal("")),
  // Lets the edit modal move a card without drag-and-drop — the keyboard/mobile fallback to the
  // native HTML5 DnD board (BUILD_CHECKLIST.md §4). Optional: omitted when the modal's Stage
  // field is unchanged.
  stageId: z.string().trim().optional(),
});

export async function updateOpportunity(id: string, form: FormData): Promise<ActionResult> {
  const session = await requireSection("opportunities");
  const parsed = updateOppSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const d = parsed.data;
  const opp = await prisma.opportunity.findUnique({
    where: { id },
    select: {
      leadId: true, wonAt: true, stageId: true, name: true, valueInrMinor: true,
      source: true, assignedToId: true, status: true, lead: { select: { name: true } },
    },
  });
  if (!opp) return { ok: false, error: "Opportunity not found" };

  const fx = await getTodayInrPerEur();
  // Preserve the current value when the Value box is left blank, rather than zeroing the deal — an
  // untouched/cleared field on the edit modal must not wipe a real amount (to set zero, type 0).
  const valueInrMinor = d.valueInr?.trim() ? majorStringToMinor(d.valueInr) : opp.valueInrMinor;
  const valueEurMinor = inrMinorToEurMinor(valueInrMinor, fx.rate);
  const status = (d.status || "OPEN") as OpportunityStatus;

  await prisma.opportunity.update({
    where: { id },
    data: {
      name: d.name,
      valueInrMinor,
      valueEurMinor,
      fxRateUsed: fx.rate,
      source: d.source || null,
      assignedToId: d.assignedToId || null,
      status,
      wonAt: status === "WON" ? opp.wonAt ?? new Date() : null,
    },
  });

  // Money is BigInt: stringify it before diffing, or JSON.stringify blows up inside diffFields.
  const diff = diffFields(
    {
      name: opp.name,
      valueInrMinor: opp.valueInrMinor.toString(),
      source: opp.source,
      assignedToId: opp.assignedToId,
      status: opp.status,
    },
    {
      name: d.name,
      valueInrMinor: valueInrMinor.toString(),
      source: d.source || null,
      assignedToId: d.assignedToId || null,
      status,
    },
  );
  if (diff.changed.length) {
    await logActivity(session, {
      action: "opportunity.update",
      section: "opportunities",
      entityType: "Opportunity",
      entityId: id,
      summary: `Updated opportunity ${d.name} for ${opp.lead.name} — changed ${diff.changed.join(", ")}`,
      meta: { changed: diff.changed, before: diff.before, after: diff.after },
    });
  }

  // A stage change from the modal reuses the exact same move (reindex + legacy write-through)
  // logic the Kanban drag-and-drop uses, so there is only ever one path that moves a card.
  if (d.stageId && d.stageId !== opp.stageId) {
    const moveResult = await moveOpportunity(id, d.stageId, Number.MAX_SAFE_INTEGER);
    if (!moveResult.ok) return moveResult;
  }

  revalidatePath("/opportunities");
  revalidatePath(`/contacts/${opp.leadId}`);
  return { ok: true };
}

/** Delete = ARCHIVE. Notes stay on the parent lead; restore from the Archived tab. */
export async function deleteOpportunity(id: string): Promise<ActionResult> {
  const session = await requireSection("opportunities");
  const opp = await prisma.opportunity.findUnique({
    where: { id },
    select: { leadId: true, name: true, lead: { select: { name: true } } },
  });
  if (!opp) return { ok: false, error: "Opportunity not found" };
  await prisma.opportunity.update({ where: { id }, data: archiveData(session.user.id) });
  await logActivity(session, {
    action: "opportunity.archive",
    section: "opportunities",
    entityType: "Opportunity",
    entityId: id,
    summary: `Archived opportunity ${opp.name} for ${opp.lead.name}`,
    meta: { leadId: opp.leadId },
  });
  revalidatePath("/opportunities");
  revalidatePath(`/contacts/${opp.leadId}`);
  return { ok: true };
}

/** Restore an archived opportunity. */
export async function restoreOpportunity(id: string): Promise<ActionResult> {
  const session = await requireSection("opportunities");
  const opp = await prisma.opportunity.findUnique({
    where: { id },
    select: { leadId: true, name: true, deletedAt: true, lead: { select: { name: true } } },
  });
  if (!opp) return { ok: false, error: "Opportunity not found" };
  if (!opp.deletedAt) return { ok: false, error: "This opportunity is not archived" };
  await prisma.opportunity.update({ where: { id }, data: restoreData });
  await logActivity(session, {
    action: "opportunity.restore",
    section: "opportunities",
    entityType: "Opportunity",
    entityId: id,
    summary: `Restored opportunity ${opp.name} for ${opp.lead.name}`,
    meta: { leadId: opp.leadId },
  });
  revalidatePath("/opportunities");
  revalidatePath(`/contacts/${opp.leadId}`);
  return { ok: true };
}

/** Permanent delete — only from the Archived tab. Notes detach (SetNull) to the parent lead. */
export async function purgeOpportunity(id: string): Promise<ActionResult> {
  const session = await requireSection("opportunities");
  const opp = await prisma.opportunity.findUnique({
    where: { id },
    select: { leadId: true, name: true, deletedAt: true, lead: { select: { name: true } } },
  });
  if (!opp) return { ok: false, error: "Opportunity not found" };
  if (!opp.deletedAt) return { ok: false, error: "Archive it first" };
  await prisma.opportunity.delete({ where: { id } });
  await logActivity(session, {
    action: "opportunity.purge",
    section: "opportunities",
    entityType: "Opportunity",
    entityId: id,
    summary: `Permanently deleted the archived opportunity ${opp.name}`,
    meta: { leadId: opp.leadId, hard: true },
  });
  revalidatePath("/opportunities");
  revalidatePath(`/contacts/${opp.leadId}`);
  return { ok: true };
}

// ─────────────────────────── Pipeline & stage editing (capability) ───────────────────────────

export async function createPipeline(form: FormData): Promise<ActionResult> {
  const { allowed, denied, session } = await capabilityCheck("pipeline.configure");
  if (!allowed) return denied;
  const name = String(form.get("name") ?? "").trim();
  if (!name) return { ok: false, error: "Pipeline name is required" };
  const max = await prisma.pipeline.aggregate({ _max: { position: true } });
  const pipeline = await prisma.pipeline.create({
    data: { name, position: (max._max.position ?? -1) + 1 },
  });
  // A pipeline needs at least one stage to be usable.
  await prisma.pipelineStage.create({ data: { pipelineId: pipeline.id, name: "New Stage", position: 0 } });
  await logActivity(session, {
    action: "pipeline.create",
    section: "opportunities",
    entityType: "Pipeline",
    entityId: pipeline.id,
    summary: `Created the ${name} pipeline`,
  });
  revalidatePath("/opportunities");
  return { ok: true };
}

export async function renamePipeline(id: string, name: string): Promise<ActionResult> {
  const { allowed, denied, session } = await capabilityCheck("pipeline.configure");
  if (!allowed) return denied;
  if (!name.trim()) return { ok: false, error: "Pipeline name is required" };
  const before = await prisma.pipeline.findUnique({ where: { id }, select: { name: true } });
  await prisma.pipeline.update({ where: { id }, data: { name: name.trim() } });
  if (before) {
    const diff = diffFields(before, { name: name.trim() });
    if (diff.changed.length) {
      await logActivity(session, {
        action: "pipeline.update",
        section: "opportunities",
        entityType: "Pipeline",
        entityId: id,
        summary: `Renamed the ${before.name} pipeline to ${name.trim()}`,
        meta: { changed: diff.changed, before: diff.before, after: diff.after },
      });
    }
  }
  revalidatePath("/opportunities");
  return { ok: true };
}

export async function deletePipeline(id: string): Promise<ActionResult> {
  const { allowed, denied, session } = await capabilityCheck("pipeline.configure");
  if (!allowed) return denied;
  const p = await prisma.pipeline.findUnique({ where: { id }, select: { isDefault: true, name: true } });
  if (!p) return { ok: false, error: "Pipeline not found" };
  if (p.isDefault) return { ok: false, error: "The default Sales pipeline can't be deleted" };
  // Soft delete: the pipeline (and, since getBoard only ever loads stages for an undeleted
  // pipeline, its stages and opportunities too) drops out of the switcher immediately but stays
  // recoverable — a confirm dialog is not undo. BUILD_CHECKLIST.md §4.
  await prisma.pipeline.update({ where: { id }, data: { deletedAt: new Date() } });
  await logActivity(session, {
    action: "pipeline.delete",
    section: "opportunities",
    entityType: "Pipeline",
    entityId: id,
    summary: `Deleted the ${p.name} pipeline`,
    meta: { soft: true },
  });
  revalidatePath("/opportunities");
  return { ok: true };
}

export async function addStage(pipelineId: string, name: string): Promise<ActionResult> {
  const { allowed, denied, session } = await capabilityCheck("pipeline.configure");
  if (!allowed) return denied;
  if (!name.trim()) return { ok: false, error: "Stage name is required" };
  const max = await prisma.pipelineStage.aggregate({ where: { pipelineId }, _max: { position: true } });
  const stage = await prisma.pipelineStage.create({
    data: { pipelineId, name: name.trim(), position: (max._max.position ?? -1) + 1 },
    include: { pipeline: { select: { name: true } } },
  });
  await logActivity(session, {
    action: "stage.create",
    section: "opportunities",
    entityType: "PipelineStage",
    entityId: stage.id,
    summary: `Added the ${name.trim()} stage to the ${stage.pipeline.name} pipeline`,
    meta: { pipelineId },
  });
  revalidatePath("/opportunities");
  return { ok: true };
}

export async function renameStage(id: string, name: string): Promise<ActionResult> {
  const { allowed, denied, session } = await capabilityCheck("pipeline.configure");
  if (!allowed) return denied;
  if (!name.trim()) return { ok: false, error: "Stage name is required" };
  const before = await prisma.pipelineStage.findUnique({ where: { id }, select: { name: true } });
  await prisma.pipelineStage.update({ where: { id }, data: { name: name.trim() } });
  if (before) {
    const diff = diffFields(before, { name: name.trim() });
    if (diff.changed.length) {
      await logActivity(session, {
        action: "stage.update",
        section: "opportunities",
        entityType: "PipelineStage",
        entityId: id,
        summary: `Renamed the ${before.name} stage to ${name.trim()}`,
        meta: { changed: diff.changed, before: diff.before, after: diff.after },
      });
    }
  }
  revalidatePath("/opportunities");
  return { ok: true };
}

/**
 * Map a CUSTOM pipeline's stage to a lead-lifecycle stage (or clear the mapping with null/"").
 * This is how a second pipeline opts into the Lead.stage bridge: once a stage is mapped, moving a
 * card into it write-throughs to Lead.stage exactly like the default Sales board (moveOpportunity).
 * The default pipeline's mapping is seed-managed and load-bearing, so it can't be re-pointed here.
 */
export async function setStageLegacyStage(stageId: string, legacy: string | null): Promise<ActionResult> {
  const { allowed, denied, session } = await capabilityCheck("pipeline.configure");
  if (!allowed) return denied;
  const value = legacy && legacy.trim() ? legacy.trim() : null;
  if (value !== null && !(value in LEAD_STAGE_LABELS)) return { ok: false, error: "Unknown lifecycle stage" };
  const stage = await prisma.pipelineStage.findUnique({
    where: { id: stageId },
    select: { name: true, legacyStage: true, pipeline: { select: { isDefault: true } } },
  });
  if (!stage) return { ok: false, error: "Stage not found" };
  if (stage.pipeline.isDefault) {
    return { ok: false, error: "The default Sales pipeline's stage mapping is managed by the system" };
  }
  if (stage.legacyStage === value) return { ok: true };
  await prisma.pipelineStage.update({ where: { id: stageId }, data: { legacyStage: value as LeadStage | null } });
  await logActivity(session, {
    action: "stage.update",
    section: "opportunities",
    entityType: "PipelineStage",
    entityId: stageId,
    summary: value
      ? `Mapped the ${stage.name} stage to lead stage "${LEAD_STAGE_LABELS[value]}"`
      : `Cleared the lifecycle mapping on the ${stage.name} stage`,
    meta: { legacyStage: value },
  });
  revalidatePath("/opportunities");
  revalidatePath("/pipeline");
  return { ok: true };
}

export async function deleteStage(id: string): Promise<ActionResult> {
  const { allowed, denied, session } = await capabilityCheck("pipeline.configure");
  if (!allowed) return denied;
  const stage = await prisma.pipelineStage.findUnique({
    where: { id },
    select: { legacyStage: true, name: true, _count: { select: { opps: true } } },
  });
  if (!stage) return { ok: false, error: "Stage not found" };
  if (stage.legacyStage) {
    return { ok: false, error: "This stage is bridged to the sales workflow and can't be deleted" };
  }
  if (stage._count.opps > 0) {
    return { ok: false, error: "Move the opportunities out of this stage before deleting it" };
  }
  // Soft delete (BUILD_CHECKLIST.md §4/§5) — recoverable, matches deletePipeline above.
  await prisma.pipelineStage.update({ where: { id }, data: { deletedAt: new Date() } });
  await logActivity(session, {
    action: "stage.delete",
    section: "opportunities",
    entityType: "PipelineStage",
    entityId: id,
    summary: `Deleted the ${stage.name} stage`,
    meta: { soft: true },
  });
  revalidatePath("/opportunities");
  return { ok: true };
}

export async function reorderStages(pipelineId: string, orderedIds: string[]): Promise<ActionResult> {
  const { allowed, denied, session } = await capabilityCheck("pipeline.configure");
  if (!allowed) return denied;
  await prisma.$transaction(
    orderedIds.map((id, i) =>
      prisma.pipelineStage.update({ where: { id }, data: { position: i } }),
    ),
  );
  const pipeline = await prisma.pipeline.findUnique({ where: { id: pipelineId }, select: { name: true } });
  await logActivity(session, {
    action: "stage.move",
    section: "opportunities",
    entityType: "Pipeline",
    entityId: pipelineId,
    summary: `Reordered the stages in the ${pipeline?.name ?? "pipeline"} pipeline`,
    meta: { orderedIds },
  });
  revalidatePath("/opportunities");
  return { ok: true };
}

// ─────────────────────────── Opportunity notes (BUILD_CHECKLIST.md §3) ───────────────────────────
//
// `ContactNote.opportunityId` + `Opportunity.notes` (Phase 0 schema) let a deal have its own
// conversation instead of everything living on the parent Lead. Mirrors the ContactNote CRUD in
// contacts-actions.ts (createNote/deleteNote/toggleNotePin, scoped by leadId) but scoped by
// opportunityId and gated by the "opportunities" section — these are reached from the
// Opportunities board, not Contacts, so they use the same requireSection key every other mutation
// in this file uses. `leadId` is still required on ContactNote (not nullable), so every
// opportunity note is stamped with the deal's underlying contact too.

const oppNoteSchema = z.object({
  body: rule("text").pipe(z.string().min(1, "Note can't be empty")),
});

export type OpportunityNote = {
  id: string;
  body: string;
  pinned: boolean;
  authorName: string | null;
  createdAt: Date;
};

export async function getOpportunityNotes(opportunityId: string): Promise<OpportunityNote[]> {
  await requireSection("opportunities");
  const notes = await prisma.contactNote.findMany({
    where: { opportunityId },
    include: { createdBy: { select: { name: true } } },
    orderBy: [{ pinned: "desc" }, { createdAt: "desc" }],
  });
  return notes.map((n) => ({
    id: n.id,
    body: n.body,
    pinned: n.pinned,
    authorName: n.createdBy?.name ?? null,
    createdAt: n.createdAt,
  }));
}

export async function createOpportunityNote(
  opportunityId: string,
  form: FormData,
): Promise<ActionResult & { mentionedCount?: number }> {
  const session = await requireSection("opportunities");
  const parsed = oppNoteSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const opp = await prisma.opportunity.findUnique({
    where: { id: opportunityId },
    select: { leadId: true, name: true },
  });
  if (!opp) return { ok: false, error: "Opportunity not found" };

  // Same @mention parse as ContactNote (contacts-actions.ts) — see the comment there for why
  // this can't persist to a mentionedUserIds column and is instead re-derived at notification
  // read time by contactNoteMentionNotifications() in notifications.ts.
  const candidates = await prisma.user.findMany({ where: { status: "ACTIVE" }, select: { id: true, name: true } });
  const mentionedUserIds = parseMentions(parsed.data.body, candidates);

  const note = await prisma.contactNote.create({
    data: { leadId: opp.leadId, opportunityId, body: parsed.data.body, createdById: session.user.id },
  });
  await logActivity(session, {
    action: "opportunity.note.create",
    section: "opportunities",
    entityType: "ContactNote",
    entityId: note.id,
    summary: `Added a note on opportunity ${opp.name}`,
    meta: {
      opportunityId,
      leadId: opp.leadId,
      mentioned: mentionedUserIds.length,
      body: parsed.data.body.slice(0, 200),
    },
  });
  revalidatePath("/opportunities");
  revalidatePath(`/contacts/${opp.leadId}`);
  return { ok: true, mentionedCount: mentionedUserIds.length };
}

export async function toggleOpportunityNotePin(id: string): Promise<ActionResult> {
  const session = await requireSection("opportunities");
  const note = await prisma.contactNote.findUnique({
    where: { id },
    select: { pinned: true, opportunityId: true, opportunity: { select: { name: true } } },
  });
  if (!note) return { ok: false, error: "Note not found" };
  await prisma.contactNote.update({ where: { id }, data: { pinned: !note.pinned } });
  const diff = diffFields({ pinned: note.pinned }, { pinned: !note.pinned });
  await logActivity(session, {
    action: "opportunity.note.update",
    section: "opportunities",
    entityType: "ContactNote",
    entityId: id,
    summary: `${note.pinned ? "Unpinned" : "Pinned"} a note on opportunity ${note.opportunity?.name ?? "—"}`,
    meta: { changed: diff.changed, before: diff.before, after: diff.after, opportunityId: note.opportunityId },
  });
  if (note.opportunityId) revalidatePath("/opportunities");
  return { ok: true };
}

export async function deleteOpportunityNote(id: string): Promise<ActionResult> {
  const session = await requireSection("opportunities");
  const note = await prisma.contactNote.findUnique({
    where: { id },
    select: { opportunityId: true, leadId: true, opportunity: { select: { name: true } } },
  });
  if (!note) return { ok: false, error: "Note not found" };
  await prisma.contactNote.delete({ where: { id } });
  await logActivity(session, {
    action: "opportunity.note.delete",
    section: "opportunities",
    entityType: "ContactNote",
    entityId: id,
    summary: `Deleted a note on opportunity ${note.opportunity?.name ?? "—"}`,
    meta: { opportunityId: note.opportunityId, leadId: note.leadId },
  });
  if (note.opportunityId) revalidatePath("/opportunities");
  revalidatePath(`/contacts/${note.leadId}`);
  return { ok: true };
}

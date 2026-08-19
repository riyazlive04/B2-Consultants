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
import { LEAD_STAGE_LABELS, PAYMENT_PLAN_LABELS } from "@/lib/labels";
import { emitTrigger } from "./automation";
import { logActivity, diffFields } from "./activity-log";
import { applySynamateStages } from "./pipeline-reshape";
import type { OpportunityStatus, LeadStage, PaymentPlan } from "@prisma/client";
import type { ActionResult } from "./finance-actions";
import { archiveData, restoreData } from "@/lib/soft-delete";

/**
 * Mutations for the Opportunities Kanban (Synamate "Pipelines"). Moving a card into a stage that
 * is MAPPED to a lead-lifecycle stage (`PipelineStage.legacyStage`) write-throughs to Lead.stage +
 * LeadStageHistory, so pipeline-metrics / funnel / WhatsApp reminders stay correct - on ANY
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
  // - otherwise dragging a deal you'd marked Won into the next column silently resets it to Open and
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
    // Write-through whenever the TARGET stage is mapped to a lifecycle stage - regardless of
    // which pipeline it's on. The old `isDefault` gate meant a card moved on a second pipeline
    // never updated Lead.stage, so the funnel / reminders / dashboard silently undercounted it
    // (schema.prisma PipelineStage.legacyStage). An unmapped stage still has `legacy` null here,
    // so custom boards that carry no lifecycle meaning are unaffected.
    if (legacy) {
      const lead = await tx.lead.findUnique({
        where: { id: opp.leadId },
        select: { stage: true, paymentPlan: true },
      });
      if (lead) {
        const moved = lead.stage !== legacy;
        // Synamate ends in two won columns, "Split Pay" and "Full pay", where this schema has one
        // WON stage plus `Lead.paymentPlan` (schema.prisma PipelineStage.paymentPlan). Dropping a
        // card in one of them IS the statement of how the deal pays, so record it - otherwise the
        // two columns would be indistinguishable to everything downstream (commission, Finance),
        // and the plan would still have to be typed in by hand on the lead form.
        const plan = toStage.paymentPlan && toStage.paymentPlan !== lead.paymentPlan ? toStage.paymentPlan : null;
        if (moved || plan) {
          await tx.lead.update({
            where: { id: opp.leadId },
            data: { ...(moved ? { stage: legacy } : {}), ...(plan ? { paymentPlan: plan } : {}) },
          });
        }
        if (moved) {
          await tx.leadStageHistory.create({
            data: { leadId: opp.leadId, fromStage: lead.stage, toStage: legacy, changedById: session.user.id },
          });
          stageChangedTo = legacy;
        }
      }
    }
  });

  const diff = diffFields(
    { stageId: opp.stageId, status: opp.status },
    { stageId: toStageId, status: newStatus },
  );
  // A drop back into the same column only reshuffles positions - not a feed row.
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
  // The inline "new contact" pair - a real person, unlike the deal name below.
  newName: optionalRule("name"),
  newPhone: optionalRule("phone"),
  pipelineId: z.string().min(1, "Pick a pipeline"),
  stageId: z.string().min(1, "Pick a stage"),
  // Deal name: free text, digits and all ("Level 2 - Q3 renewal").
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
  // Lets the edit modal move a card without drag-and-drop - the keyboard/mobile fallback to the
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
  // Preserve the current value when the Value box is left blank, rather than zeroing the deal - an
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
      summary: `Updated opportunity ${d.name} for ${opp.lead.name} - changed ${diff.changed.join(", ")}`,
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

/**
 * Delete = ARCHIVE. Notes stay on the parent lead; restore from the Archived tab.
 *
 * Deleting the card ALSO archives the LEAD, once the card was the last live one that lead had.
 *
 * ── The bug this closes ─────────────────────────────────────────────────────────
 * The board is what everyone calls "the pipeline", so deleting a card there is understood to
 * mean the person is out. But `Opportunity` and `Lead` are separate rows, and this only ever
 * archived the card: the lead stayed active, stayed assigned, and kept appearing on its owner's
 * My Desk queue - every desk read is `Lead` filtered on `deletedAt` (`l1-desk-metrics`,
 * `l2-desk-metrics`, `telecaller-desk-metrics`), and the lead's `deletedAt` was still null. The
 * symptom reported on 7 Aug 2026: a lead deleted from the board at 06:55 was still on Asma's
 * desk, because nothing had ever archived the lead.
 *
 * ── Why the "last live card" guard ──────────────────────────────────────────────
 * A lead may hold cards on more than one pipeline - the default Sales board plus any custom
 * board an Admin built. Clearing someone off ONE process is not the same as dropping the person,
 * and archiving unconditionally would leave an archived lead with a live card still sitting on
 * someone else's board. So the lead is archived only when no live card is left for it anywhere.
 * In the ordinary case that guard is a no-op: `ensureDefaultOpportunity` gives a lead exactly one.
 *
 * Both rows are stamped with the SAME `deletedAt` instant, which is what lets `restoreOpportunity`
 * put the pair back together, and the retention sweep age them out together.
 */
export async function deleteOpportunity(id: string): Promise<ActionResult> {
  const session = await requireSection("opportunities");
  const opp = await prisma.opportunity.findUnique({
    where: { id },
    select: {
      leadId: true, name: true,
      lead: { select: { name: true, stage: true, deletedAt: true } },
    },
  });
  if (!opp) return { ok: false, error: "Opportunity not found" };

  // One payload for both rows - `archiveData()` stamps `new Date()` per call, and two instants
  // a few milliseconds apart is exactly the pairing `restoreOpportunity` needs to recognise.
  const archived = archiveData(session.user.id);

  const leadArchived = await prisma.$transaction(async (tx) => {
    await tx.opportunity.update({ where: { id }, data: archived });
    if (opp.lead.deletedAt) return false; // already archived from the Pipeline side
    const liveElsewhere = await tx.opportunity.count({
      where: { leadId: opp.leadId, id: { not: id }, deletedAt: null },
    });
    if (liveElsewhere > 0) return false;
    await tx.lead.update({ where: { id: opp.leadId }, data: archived });
    return true;
  });

  await logActivity(session, {
    action: "opportunity.archive",
    section: "opportunities",
    entityType: "Opportunity",
    entityId: id,
    summary: `Archived opportunity ${opp.name} for ${opp.lead.name}`,
    meta: { leadId: opp.leadId, leadArchived },
  });
  // A SECOND entry against the Lead, not just a flag on the one above: the lead's own activity
  // trail is what someone reads when asking "why did this contact disappear", and it is the
  // Pipeline/Contacts screens that surface it.
  if (leadArchived) {
    await logActivity(session, {
      action: "lead.archive",
      section: "pipeline",
      entityType: "Lead",
      entityId: opp.leadId,
      summary: `Archived lead ${opp.lead.name} - its last board card was deleted`,
      meta: { stage: opp.lead.stage, viaOpportunityId: id },
    });
  }

  revalidatePath("/opportunities");
  revalidatePath(`/contacts/${opp.leadId}`);
  // The lead just left every lead-backed screen; without these they keep serving it from cache.
  if (leadArchived) {
    revalidatePath("/pipeline");
    revalidatePath("/contacts");
    revalidatePath("/my-desk");
  }
  return { ok: true };
}

/**
 * Restore an archived opportunity - and the lead with it, if the two were archived together.
 *
 * The pairing test is the shared `deletedAt` instant that `deleteOpportunity` stamps on both
 * rows. Restoring on that basis and no other is what keeps this from over-reaching: a lead
 * archived separately from the Pipeline screen, that happens to own an archived card, stays
 * archived - undoing a board delete must not quietly undo a decision taken somewhere else.
 *
 * Without this the delete would be one-way in practice. The card would come back to the board
 * while the lead behind it stayed archived, which is the mirror image of the bug being fixed:
 * a live card pointing at a contact that no lead-backed screen will show.
 */
export async function restoreOpportunity(id: string): Promise<ActionResult> {
  const session = await requireSection("opportunities");
  const opp = await prisma.opportunity.findUnique({
    where: { id },
    select: {
      leadId: true, name: true, deletedAt: true,
      lead: { select: { name: true, deletedAt: true } },
    },
  });
  if (!opp) return { ok: false, error: "Opportunity not found" };
  if (!opp.deletedAt) return { ok: false, error: "This opportunity is not archived" };

  const archivedTogether =
    !!opp.lead.deletedAt && opp.lead.deletedAt.getTime() === opp.deletedAt.getTime();

  await prisma.$transaction(async (tx) => {
    await tx.opportunity.update({ where: { id }, data: restoreData });
    if (archivedTogether) await tx.lead.update({ where: { id: opp.leadId }, data: restoreData });
  });

  await logActivity(session, {
    action: "opportunity.restore",
    section: "opportunities",
    entityType: "Opportunity",
    entityId: id,
    summary: `Restored opportunity ${opp.name} for ${opp.lead.name}`,
    meta: { leadId: opp.leadId, leadRestored: archivedTogether },
  });
  if (archivedTogether) {
    await logActivity(session, {
      action: "lead.restore",
      section: "pipeline",
      entityType: "Lead",
      entityId: opp.leadId,
      summary: `Restored lead ${opp.lead.name} - its board card was restored`,
      meta: { viaOpportunityId: id },
    });
  }

  revalidatePath("/opportunities");
  revalidatePath(`/contacts/${opp.leadId}`);
  if (archivedTogether) {
    revalidatePath("/pipeline");
    revalidatePath("/contacts");
    revalidatePath("/my-desk");
  }
  return { ok: true };
}

/** Permanent delete - only from the Archived tab. Notes detach (SetNull) to the parent lead. */
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
  revalidatePath("/opportunities/pipelines");
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
  revalidatePath("/opportunities/pipelines");
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
  // recoverable - a confirm dialog is not undo. BUILD_CHECKLIST.md §4.
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
  revalidatePath("/opportunities/pipelines");
  return { ok: true };
}

/**
 * Reorder the pipelines themselves - the Pipelines screen's drag handle.
 *
 * The board's switcher orders by `[isDefault desc, position asc, name asc]`, so this decides the
 * order everywhere pipelines are listed, not just on that screen. The default Sales pipeline still
 * sorts first regardless of the position stored here; that is deliberate and not something a drag
 * should be able to change.
 */
export async function reorderPipelines(orderedIds: string[]): Promise<ActionResult> {
  const { allowed, denied, session } = await capabilityCheck("pipeline.configure");
  if (!allowed) return denied;
  // Ignore ids the caller has no business moving - this arrives from a browser, and a soft-deleted
  // or non-existent id would otherwise throw mid-transaction and roll back every other move.
  const live = await prisma.pipeline.findMany({
    where: { id: { in: orderedIds }, deletedAt: null },
    select: { id: true },
  });
  const liveIds = new Set(live.map((p) => p.id));
  const ids = orderedIds.filter((id) => liveIds.has(id));
  if (!ids.length) return { ok: false, error: "Nothing to reorder" };

  await prisma.$transaction(
    ids.map((id, i) => prisma.pipeline.update({ where: { id }, data: { position: i } })),
  );
  await logActivity(session, {
    action: "pipeline.move",
    section: "opportunities",
    entityType: "Pipeline",
    entityId: ids[0]!,
    summary: `Reordered the pipelines`,
    meta: { orderedIds: ids },
  });
  revalidatePath("/opportunities");
  revalidatePath("/opportunities/pipelines");
  return { ok: true };
}

export async function addStage(
  pipelineId: string,
  name: string,
  legacyStage?: string | null,
  paymentPlan?: string | null,
): Promise<ActionResult> {
  const { allowed, denied, session } = await capabilityCheck("pipeline.configure");
  if (!allowed) return denied;
  if (!name.trim()) return { ok: false, error: "Stage name is required" };

  /**
   * THE DEFAULT PIPELINE TAKES NO *UNMAPPED* COLUMNS.
   *
   * This used to refuse a new column on the default board outright, because a stage created here
   * got `legacyStage: null` and `setStageLegacyStage` then refused to map it - leaving a column
   * that is a data trap, not just an oddity: a card dragged into it silently stops writing
   * through to `Lead.stage`, and `syncDefaultOpportunity` can never move it back out, because it
   * only targets bridged columns. Production had exactly this: columns named "loser" and "Aakash",
   * both unmapped, both able to swallow a deal.
   *
   * The trap was the missing mapping, though - not the column. Admin needs to be able to shape
   * this board by hand (Synamate's own pipeline is edited from its UI), so a default-board column
   * is now allowed on one condition: it must name the lifecycle stage it means, here and forever
   * after (`setStageLegacyStage` will not clear it). "Restore the Synamate columns" puts the
   * standard twelve back if an experiment goes wrong.
   */
  const target = await prisma.pipeline.findUnique({
    where: { id: pipelineId },
    select: { isDefault: true, name: true },
  });
  if (!target) return { ok: false, error: "Pipeline not found" };

  const legacy = legacyStage && legacyStage.trim() ? legacyStage.trim() : null;
  if (legacy !== null && !(legacy in LEAD_STAGE_LABELS)) return { ok: false, error: "Unknown lifecycle stage" };
  if (target.isDefault && !legacy) {
    return {
      ok: false,
      error:
        "A column on the default Sales board has to say which lead stage it means - a card dropped in an unmapped column stops syncing to the contact. Pick a lifecycle stage and add it again.",
    };
  }
  const plan = planFor(legacy, paymentPlan);

  const max = await prisma.pipelineStage.aggregate({ where: { pipelineId }, _max: { position: true } });
  const stage = await prisma.pipelineStage.create({
    data: {
      pipelineId,
      name: name.trim(),
      position: (max._max.position ?? -1) + 1,
      legacyStage: legacy as LeadStage | null,
      paymentPlan: plan,
    },
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
 * The payment plan a column means, validated against the stage it is mapped to.
 *
 * Only WON columns carry one - it is what tells Synamate's "Split Pay" and "Full pay" apart
 * (schema.prisma PipelineStage.paymentPlan). Anywhere else it is silently dropped rather than
 * rejected: a plan on a "No Show" column is meaningless, not an error worth stopping an admin for.
 */
function planFor(legacy: string | null, paymentPlan: string | null | undefined): PaymentPlan | null {
  if (legacy !== "WON") return null;
  const v = paymentPlan?.trim();
  return v === "SPLIT_PAY" || v === "FULL_PAY" ? v : null;
}

/**
 * Map a stage to a lead-lifecycle stage - the Lead.stage bridge. Once a stage is mapped, moving a
 * card into it write-throughs to Lead.stage (moveOpportunity), and leads reaching that stage are
 * filed into it (opportunity-sync).
 *
 * Editable on the DEFAULT board too, so Admin can shape it by hand. The one thing refused there is
 * CLEARING the mapping: an unmapped column on the board that drives the lead lifecycle silently
 * swallows deals (see `addStage`). On a custom pipeline, unmapped is the normal "this board is its
 * own process" case and clearing stays allowed.
 */
export async function setStageLegacyStage(
  stageId: string,
  legacy: string | null,
  paymentPlan?: string | null,
): Promise<ActionResult> {
  const { allowed, denied, session } = await capabilityCheck("pipeline.configure");
  if (!allowed) return denied;
  const value = legacy && legacy.trim() ? legacy.trim() : null;
  if (value !== null && !(value in LEAD_STAGE_LABELS)) return { ok: false, error: "Unknown lifecycle stage" };
  const stage = await prisma.pipelineStage.findUnique({
    where: { id: stageId },
    select: { name: true, legacyStage: true, paymentPlan: true, pipeline: { select: { isDefault: true } } },
  });
  if (!stage) return { ok: false, error: "Stage not found" };
  if (stage.pipeline.isDefault && value === null) {
    return {
      ok: false,
      error:
        "A column on the default Sales board has to stay mapped to a lead stage - cards in an unmapped column stop syncing to the contact. Point it at a different stage instead, or delete the column.",
    };
  }
  const plan = planFor(value, paymentPlan);
  if (stage.legacyStage === value && stage.paymentPlan === plan) return { ok: true };
  await prisma.pipelineStage.update({
    where: { id: stageId },
    data: { legacyStage: value as LeadStage | null, paymentPlan: plan },
  });
  await logActivity(session, {
    action: "stage.update",
    section: "opportunities",
    entityType: "PipelineStage",
    entityId: stageId,
    summary: value
      ? `Mapped the ${stage.name} stage to lead stage "${LEAD_STAGE_LABELS[value]}"${plan ? ` (${PAYMENT_PLAN_LABELS[plan] ?? plan})` : ""}`
      : `Cleared the lifecycle mapping on the ${stage.name} stage`,
    meta: { legacyStage: value, paymentPlan: plan },
  });
  revalidatePath("/opportunities");
  revalidatePath("/pipeline");
  return { ok: true };
}

/**
 * Put the default board back to the twelve live Synamate columns.
 *
 * The safety net that makes hand-editing the board sane to offer: rename, re-map, add and remove
 * columns freely, and this restores the standard shape - renaming columns back rather than
 * duplicating them, and re-filing every card into the column its lead's stage belongs to. Nothing
 * is deleted while it still holds cards (`server/pipeline-reshape.ts`).
 *
 * Default board only. A custom pipeline is somebody's own process and is none of this action's
 * business.
 */
export async function restoreSynamateStages(pipelineId: string): Promise<ActionResult> {
  const { allowed, denied, session } = await capabilityCheck("pipeline.configure");
  if (!allowed) return denied;
  const pipeline = await prisma.pipeline.findUnique({
    where: { id: pipelineId },
    select: { isDefault: true, name: true },
  });
  if (!pipeline) return { ok: false, error: "Pipeline not found" };
  if (!pipeline.isDefault) {
    return { ok: false, error: "Only the default Sales board mirrors Synamate - a custom pipeline is its own process." };
  }

  let report;
  try {
    report = await applySynamateStages(prisma, pipelineId);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not restore the Synamate columns" };
  }

  await logActivity(session, {
    action: "pipeline.update",
    section: "opportunities",
    entityType: "Pipeline",
    entityId: pipelineId,
    summary: `Restored the Synamate columns on the ${pipeline.name} board`,
    meta: {
      renamed: report.renamed.length,
      created: report.created.length,
      removed: report.removed.length,
      refiled: report.refiled,
    },
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
  // A bridged column used to be undeletable outright - which, now that EVERY default-board column
  // is bridged, would mean the board could be added to but never tidied up. The card guard below
  // is the one that actually matters: an empty column can go, and leads whose stage no longer has
  // a column simply stop being filed onto the board until one exists again (opportunity-sync
  // no-ops rather than throwing). "Restore the Synamate columns" brings it back.
  if (stage._count.opps > 0) {
    return { ok: false, error: "Move the opportunities out of this stage before deleting it" };
  }
  // Soft delete (BUILD_CHECKLIST.md §4/§5) - recoverable, matches deletePipeline above.
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
// opportunityId and gated by the "opportunities" section - these are reached from the
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

  // Same @mention parse as ContactNote (contacts-actions.ts) - see the comment there for why
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
    summary: `${note.pinned ? "Unpinned" : "Pinned"} a note on opportunity ${note.opportunity?.name ?? "-"}`,
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
    summary: `Deleted a note on opportunity ${note.opportunity?.name ?? "-"}`,
    meta: { opportunityId: note.opportunityId, leadId: note.leadId },
  });
  if (note.opportunityId) revalidatePath("/opportunities");
  revalidatePath(`/contacts/${note.leadId}`);
  return { ok: true };
}

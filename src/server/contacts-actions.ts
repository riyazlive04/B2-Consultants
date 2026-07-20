"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { capabilityCheck, requireSection } from "@/lib/rbac";
import { parseMentions } from "@/lib/gn-mentions";
import { optionalRule, rule } from "@/lib/field-rules";
import { emitTrigger } from "./automation";
import { findDuplicateLead } from "./lead-intake";
import { pickFirstCaller } from "./assignment";
import { logActivity, diffFields } from "./activity-log";
import type { ActionResult } from "./finance-actions";
import { archiveData, restoreData } from "@/lib/soft-delete";

/**
 * Mutations for the Synamate-parity Contacts CRM (SYNAMATE_CLONE_SPEC §5): contact records,
 * tags, notes, tasks, companies, and user-defined custom fields. Normal CRUD is gated to the
 * `contacts` section; destructive/config actions require the `pipeline.configure` capability.
 */

function firstError(e: z.ZodError): string {
  return e.issues[0]?.message ?? "Invalid input";
}

const CONTACT_SOURCES = [
  "INSTAGRAM", "YOUTUBE", "LINKEDIN", "WHATSAPP", "REFERRAL", "SUMMIT", "WORKSHOP",
  "GHOSTED_BLUEPRINT", "OTHER",
] as const;

function reval(leadId?: string) {
  revalidatePath("/contacts");
  if (leadId) revalidatePath(`/contacts/${leadId}`);
}

// ─────────────────────────── Contacts ───────────────────────────

const contactSchema = z.object({
  name: rule("name"),
  phone: rule("phone"),
  email: optionalRule("email"),
  city: optionalRule("city"),
  // Free text: an industry legitimately carries digits ("3D Printing", "B2B SaaS").
  industry: z.string().trim().optional(),
  leadSource: z.enum(CONTACT_SOURCES),
  companyId: z.string().trim().optional(),
});

export async function createContact(form: FormData): Promise<ActionResult> {
  const session = await requireSection("contacts");
  const parsed = contactSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const d = parsed.data;

  // Duplicate check at the point of entry (issue 1.3): the capture path dedupes, but typing the
  // same person in here twice used to silently create a second row. Block it and point the rep at
  // the existing record rather than fragmenting the person across two leads.
  const dup = await findDuplicateLead({ phone: d.phone, email: d.email });
  if (dup) {
    // Re-adding an ARCHIVED contact: restore it instead of erroring (it's hidden everywhere) or
    // creating a duplicate. Keeps the duplicate-check intact while handling the archive cleanly.
    if (dup.lead.deletedAt) {
      await prisma.lead.update({ where: { id: dup.lead.id }, data: restoreData });
      await logActivity(session, {
        action: "contact.restore",
        section: "contacts",
        entityType: "Lead",
        entityId: dup.lead.id,
        summary: `Restored archived contact ${dup.lead.name} on re-entry`,
      });
      reval();
      revalidatePath("/pipeline");
      return { ok: true };
    }
    return {
      ok: false,
      error: `A contact with this ${dup.on === "phone" ? "phone number" : "email"} already exists — ${dup.lead.name}. Open that contact instead of adding a new one.`,
    };
  }
  // Auto-assign an owner on creation (issue 1.1) via the same first-call rotation the webhooks use,
  // so a back-office lead no longer lands unassigned (which is why the owner column read
  // "Unassigned" — issue 1.2). A rotation misconfig returns null and must never block entry.
  const assignedToId = await pickFirstCaller().catch(() => null);

  const newLeadId = await prisma.$transaction(async (tx) => {
    const lead = await tx.lead.create({
      data: {
        name: d.name,
        phone: d.phone,
        email: d.email || null,
        city: d.city || null,
        industry: d.industry || null,
        leadSource: d.leadSource,
        companyId: d.companyId || null,
        dateIn: new Date(),
        stage: "NEW_LEAD",
        enteredById: session.user.id,
        assignedToId,
      },
    });
    await tx.leadStageHistory.create({
      data: { leadId: lead.id, fromStage: null, toStage: "NEW_LEAD", changedById: session.user.id },
    });
    return lead.id;
  });
  await logActivity(session, {
    action: "contact.create",
    section: "contacts",
    entityType: "Lead",
    entityId: newLeadId,
    summary: `Added contact ${d.name}`,
    meta: { phone: d.phone, leadSource: d.leadSource },
  });
  await emitTrigger("CONTACT_CREATED", { leadId: newLeadId });
  reval();
  return { ok: true };
}

export async function updateContact(id: string, form: FormData): Promise<ActionResult> {
  const session = await requireSection("contacts");
  const parsed = contactSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const d = parsed.data;
  const lead = await prisma.lead.findUnique({
    where: { id },
    select: {
      id: true, name: true, phone: true, email: true, city: true, industry: true,
      leadSource: true, companyId: true,
    },
  });
  if (!lead) return { ok: false, error: "Contact not found" };

  const data = {
    name: d.name,
    phone: d.phone,
    email: d.email || null,
    city: d.city || null,
    industry: d.industry || null,
    leadSource: d.leadSource,
    companyId: d.companyId || null,
  };
  await prisma.lead.update({ where: { id }, data });
  const diff = diffFields(lead, data);
  if (diff.changed.length) {
    await logActivity(session, {
      action: "contact.update",
      section: "contacts",
      entityType: "Lead",
      entityId: id,
      summary: `Updated contact ${d.name} — changed ${diff.changed.join(", ")}`,
      meta: { changed: diff.changed, before: diff.before, after: diff.after },
    });
  }
  reval(id);
  return { ok: true };
}

/**
 * Delete = ARCHIVE. Sets `deletedAt` and hides the contact everywhere; its notes/tasks/opps
 * survive (nothing cascades) and its opportunities drop off active boards via the parent
 * filter (see opportunities-metrics `getBoard`). Restorable from the Archived tab.
 */
export async function deleteContact(id: string): Promise<ActionResult> {
  const { allowed, denied, session } = await capabilityCheck("pipeline.configure");
  if (!allowed) return denied;
  const lead = await prisma.lead.findUnique({ where: { id }, select: { name: true } });
  await prisma.lead.update({ where: { id }, data: archiveData(session.user.id) });
  if (lead) {
    await logActivity(session, {
      action: "contact.archive",
      section: "contacts",
      entityType: "Lead",
      entityId: id,
      summary: `Archived contact ${lead.name}`,
    });
  }
  reval();
  revalidatePath("/pipeline");
  return { ok: true };
}

/** Restore an archived contact (Lead) to active. */
export async function restoreLead(id: string): Promise<ActionResult> {
  const { allowed, denied, session } = await capabilityCheck("pipeline.configure");
  if (!allowed) return denied;
  const lead = await prisma.lead.findUnique({ where: { id }, select: { name: true, deletedAt: true } });
  if (!lead) return { ok: false, error: "Contact not found" };
  if (!lead.deletedAt) return { ok: false, error: "This contact is not archived" };
  await prisma.lead.update({ where: { id }, data: restoreData });
  await logActivity(session, {
    action: "contact.restore",
    section: "contacts",
    entityType: "Lead",
    entityId: id,
    summary: `Restored contact ${lead.name}`,
  });
  reval();
  revalidatePath("/pipeline");
  return { ok: true };
}

/** Permanent delete — only from the Archived tab. Cascades notes/tasks/opps/history. */
export async function purgeLead(id: string): Promise<ActionResult> {
  const { allowed, denied, session } = await capabilityCheck("pipeline.configure");
  if (!allowed) return denied;
  const lead = await prisma.lead.findUnique({ where: { id }, select: { name: true, deletedAt: true } });
  if (!lead) return { ok: false, error: "Contact not found" };
  if (!lead.deletedAt) return { ok: false, error: "Archive it first" };
  await prisma.lead.delete({ where: { id } }); // cascades notes/tasks/opps/history
  await logActivity(session, {
    action: "contact.purge",
    section: "contacts",
    entityType: "Lead",
    entityId: id,
    summary: `Permanently deleted the archived contact ${lead.name} and its history`,
    meta: { hard: true },
  });
  reval();
  revalidatePath("/pipeline");
  return { ok: true };
}

export async function setContactOwner(id: string, userId: string): Promise<ActionResult> {
  const session = await requireSection("contacts");
  const before = await prisma.lead.findUnique({ where: { id }, select: { assignedToId: true } });
  const lead = await prisma.lead.update({ where: { id }, data: { assignedToId: userId || null } });
  const diff = diffFields({ assignedToId: before?.assignedToId ?? null }, { assignedToId: userId || null });
  if (diff.changed.length) {
    const owner = userId
      ? await prisma.user.findUnique({ where: { id: userId }, select: { name: true } })
      : null;
    await logActivity(session, {
      action: "contact.assign",
      section: "contacts",
      entityType: "Lead",
      entityId: id,
      summary: owner ? `Assigned ${lead.name} to ${owner.name}` : `Removed the owner from ${lead.name}`,
      meta: { changed: diff.changed, before: diff.before, after: diff.after },
    });
  }
  reval(id);
  return { ok: true };
}

// ─────────────────────────── Tags ───────────────────────────

function normTag(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

async function upsertTag(name: string) {
  const clean = normTag(name);
  return prisma.tag.upsert({ where: { name: clean }, update: {}, create: { name: clean } });
}

export async function addContactTag(leadId: string, name: string): Promise<ActionResult> {
  const session = await requireSection("contacts");
  const clean = normTag(name);
  if (!clean) return { ok: false, error: "Tag name is required" };
  const tag = await upsertTag(clean);
  const lead = await prisma.lead.update({
    where: { id: leadId },
    data: { tags: { connect: { id: tag.id } } },
  });
  await logActivity(session, {
    action: "contact.tag.create",
    section: "contacts",
    entityType: "Lead",
    entityId: leadId,
    summary: `Tagged ${lead.name} "${clean}"`,
    meta: { tag: clean, tagId: tag.id },
  });
  await emitTrigger("TAG_ADDED", { leadId, tag: clean });
  reval(leadId);
  return { ok: true };
}

export async function removeContactTag(leadId: string, tagId: string): Promise<ActionResult> {
  const session = await requireSection("contacts");
  const tag = await prisma.tag.findUnique({ where: { id: tagId }, select: { name: true } });
  const lead = await prisma.lead.update({
    where: { id: leadId },
    data: { tags: { disconnect: { id: tagId } } },
  });
  await logActivity(session, {
    action: "contact.tag.delete",
    section: "contacts",
    entityType: "Lead",
    entityId: leadId,
    summary: `Removed the "${tag?.name ?? "unknown"}" tag from ${lead.name}`,
    meta: { tag: tag?.name ?? null, tagId },
  });
  reval(leadId);
  return { ok: true };
}

export async function bulkAddTag(leadIds: string[], name: string): Promise<ActionResult> {
  const session = await requireSection("contacts");
  const clean = normTag(name);
  if (!clean) return { ok: false, error: "Tag name is required" };
  if (leadIds.length === 0) return { ok: false, error: "Select at least one contact" };
  const tag = await upsertTag(clean);
  await prisma.$transaction(
    leadIds.map((id) =>
      prisma.lead.update({ where: { id }, data: { tags: { connect: { id: tag.id } } } }),
    ),
  );
  await logActivity(session, {
    action: "contact.tag.create",
    section: "contacts",
    entityType: "Tag",
    entityId: tag.id,
    summary: `Tagged ${leadIds.length} contact${leadIds.length === 1 ? "" : "s"} "${clean}"`,
    meta: { tag: clean, leadIds },
  });
  for (const id of leadIds) await emitTrigger("TAG_ADDED", { leadId: id, tag: clean });
  reval();
  return { ok: true };
}

export async function bulkRemoveTag(leadIds: string[], tagId: string): Promise<ActionResult> {
  const session = await requireSection("contacts");
  if (leadIds.length === 0) return { ok: false, error: "Select at least one contact" };
  const tag = await prisma.tag.findUnique({ where: { id: tagId }, select: { name: true } });
  await prisma.$transaction(
    leadIds.map((id) =>
      prisma.lead.update({ where: { id }, data: { tags: { disconnect: { id: tagId } } } }),
    ),
  );
  await logActivity(session, {
    action: "contact.tag.delete",
    section: "contacts",
    entityType: "Tag",
    entityId: tagId,
    summary: `Removed the "${tag?.name ?? "unknown"}" tag from ${leadIds.length} contact${leadIds.length === 1 ? "" : "s"}`,
    meta: { tag: tag?.name ?? null, leadIds },
  });
  reval();
  return { ok: true };
}

// ─────────────────────────── Custom field values ───────────────────────────

export async function setContactCustomField(
  leadId: string,
  key: string,
  value: string,
): Promise<ActionResult> {
  const session = await requireSection("contacts");
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: { name: true, customFields: true },
  });
  if (!lead) return { ok: false, error: "Contact not found" };
  const current = (lead.customFields as Record<string, string> | null) ?? {};
  const next: Record<string, string> = { ...current };
  if (value.trim() === "") delete next[key];
  else next[key] = value;
  await prisma.lead.update({
    where: { id: leadId },
    data: { customFields: next as Prisma.InputJsonObject },
  });
  const diff = diffFields({ [key]: current[key] ?? null }, { [key]: next[key] ?? null });
  if (diff.changed.length) {
    await logActivity(session, {
      action: "contact.field.update",
      section: "contacts",
      entityType: "Lead",
      entityId: leadId,
      summary: `Updated the ${key} field on ${lead.name}`,
      meta: { changed: diff.changed, before: diff.before, after: diff.after },
    });
  }
  reval(leadId);
  return { ok: true };
}

// ─────────────────────────── Notes ───────────────────────────

const noteSchema = z.object({ body: z.string().trim().min(1, "Note can't be empty") });

/**
 * @mention support, ported from the German Note community's mentionedUserIds pattern
 * (`src/lib/gn-mentions.ts`, used by `german-note-actions.ts`'s createGnPost/createGnComment).
 * ContactNote has no mentionedUserIds column and the schema is frozen this round (BUILD_CHECKLIST
 * §3), so unlike GnPost/GnComment there's nowhere to persist the parsed ids. Parsed here anyway,
 * at write time, against every active user's name — the codebase's GN mention→notification
 * delivery turns out to have no separate "notification creation" function to call: it's a
 * read-time derived query (`gnEngagementNotifications` in notifications.ts counts recent rows
 * where `mentionedUserIds` has the viewer). `contactNoteMentionNotifications` in notifications.ts
 * mirrors that exact shape for ContactNote by re-parsing recent note bodies the same way, since
 * there's no column to filter on in SQL. Returning the count here just gives the note's author
 * immediate feedback ("mentioned 2 people") — the actual in-app delivery to the MENTIONED user
 * happens on their own next bell load/poll, same as German Note.
 */
async function loadActiveUserCandidates() {
  return prisma.user.findMany({ where: { status: "ACTIVE" }, select: { id: true, name: true } });
}

export async function createNote(leadId: string, form: FormData): Promise<ActionResult & { mentionedCount?: number }> {
  const session = await requireSection("contacts");
  const parsed = noteSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const candidates = await loadActiveUserCandidates();
  const mentionedUserIds = parseMentions(parsed.data.body, candidates);
  const note = await prisma.contactNote.create({
    data: { leadId, body: parsed.data.body, createdById: session.user.id },
    include: { lead: { select: { name: true } } },
  });
  await logActivity(session, {
    action: "contact.note.create",
    section: "contacts",
    entityType: "ContactNote",
    entityId: note.id,
    summary: `Added a note on ${note.lead.name}`,
    meta: { leadId, mentioned: mentionedUserIds.length, body: parsed.data.body.slice(0, 200) },
  });
  reval(leadId);
  return { ok: true, mentionedCount: mentionedUserIds.length };
}

export async function deleteNote(id: string): Promise<ActionResult> {
  const session = await requireSection("contacts");
  const note = await prisma.contactNote.findUnique({
    where: { id },
    select: { leadId: true, lead: { select: { name: true } } },
  });
  if (!note) return { ok: false, error: "Note not found" };
  await prisma.contactNote.delete({ where: { id } });
  await logActivity(session, {
    action: "contact.note.delete",
    section: "contacts",
    entityType: "ContactNote",
    entityId: id,
    summary: `Deleted a note on ${note.lead.name}`,
    meta: { leadId: note.leadId },
  });
  reval(note.leadId);
  return { ok: true };
}

export async function toggleNotePin(id: string): Promise<ActionResult> {
  const session = await requireSection("contacts");
  const note = await prisma.contactNote.findUnique({
    where: { id },
    select: { leadId: true, pinned: true, lead: { select: { name: true } } },
  });
  if (!note) return { ok: false, error: "Note not found" };
  await prisma.contactNote.update({ where: { id }, data: { pinned: !note.pinned } });
  const diff = diffFields({ pinned: note.pinned }, { pinned: !note.pinned });
  await logActivity(session, {
    action: "contact.note.update",
    section: "contacts",
    entityType: "ContactNote",
    entityId: id,
    summary: `${note.pinned ? "Unpinned" : "Pinned"} a note on ${note.lead.name}`,
    meta: { changed: diff.changed, before: diff.before, after: diff.after },
  });
  reval(note.leadId);
  return { ok: true };
}

// ─────────────────────────── Tasks ───────────────────────────

const taskSchema = z.object({
  // A task title is a label, not a person — "Chase 2nd instalment" is valid.
  title: z.string().trim().min(1, "Task title is required"),
  body: optionalRule("text"),
  dueAt: z.string().trim().optional(),
  assignedToId: z.string().trim().optional(),
  leadId: z.string().trim().optional(),
});

export async function createTask(form: FormData): Promise<ActionResult> {
  const session = await requireSection("contacts");
  const parsed = taskSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const d = parsed.data;
  const due = d.dueAt?.trim() ? new Date(d.dueAt) : null;
  if (due && isNaN(due.getTime())) return { ok: false, error: "Invalid due date" };
  const task = await prisma.contactTask.create({
    data: {
      title: d.title,
      body: d.body || null,
      dueAt: due,
      assignedToId: d.assignedToId || null,
      leadId: d.leadId || null,
      createdById: session.user.id,
    },
    include: { assignedTo: { select: { name: true } }, lead: { select: { name: true } } },
  });
  await logActivity(session, {
    action: "task.create",
    section: "contacts",
    entityType: "ContactTask",
    entityId: task.id,
    summary: [
      `Created task "${d.title}"`,
      task.assignedTo ? ` for ${task.assignedTo.name}` : "",
      task.lead ? ` on ${task.lead.name}` : "",
    ].join(""),
    meta: { leadId: d.leadId || null, assignedToId: d.assignedToId || null, dueAt: due },
  });
  reval(d.leadId);
  return { ok: true };
}

export async function toggleTask(id: string): Promise<ActionResult> {
  const session = await requireSection("contacts");
  const task = await prisma.contactTask.findUnique({
    where: { id },
    select: { status: true, leadId: true, title: true },
  });
  if (!task) return { ok: false, error: "Task not found" };
  const nowOpen = task.status === "COMPLETED";
  await prisma.contactTask.update({
    where: { id },
    data: { status: nowOpen ? "OPEN" : "COMPLETED", completedAt: nowOpen ? null : new Date() },
  });
  const diff = diffFields({ status: task.status }, { status: nowOpen ? "OPEN" : "COMPLETED" });
  await logActivity(session, {
    action: "task.update",
    section: "contacts",
    entityType: "ContactTask",
    entityId: id,
    summary: `${nowOpen ? "Reopened" : "Completed"} task "${task.title}"`,
    meta: { changed: diff.changed, before: diff.before, after: diff.after },
  });
  reval(task.leadId ?? undefined);
  return { ok: true };
}

/** Delete = ARCHIVE. */
export async function deleteTask(id: string): Promise<ActionResult> {
  const session = await requireSection("contacts");
  const task = await prisma.contactTask.findUnique({
    where: { id },
    select: { leadId: true, title: true },
  });
  if (!task) return { ok: false, error: "Task not found" };
  await prisma.contactTask.update({ where: { id }, data: archiveData(session.user.id) });
  await logActivity(session, {
    action: "task.archive",
    section: "contacts",
    entityType: "ContactTask",
    entityId: id,
    summary: `Archived task "${task.title}"`,
    meta: { leadId: task.leadId },
  });
  reval(task.leadId ?? undefined);
  return { ok: true };
}

/** Restore an archived task. */
export async function restoreTask(id: string): Promise<ActionResult> {
  const session = await requireSection("contacts");
  const task = await prisma.contactTask.findUnique({
    where: { id },
    select: { leadId: true, title: true, deletedAt: true },
  });
  if (!task) return { ok: false, error: "Task not found" };
  if (!task.deletedAt) return { ok: false, error: "This task is not archived" };
  await prisma.contactTask.update({ where: { id }, data: restoreData });
  await logActivity(session, {
    action: "task.restore",
    section: "contacts",
    entityType: "ContactTask",
    entityId: id,
    summary: `Restored task "${task.title}"`,
    meta: { leadId: task.leadId },
  });
  reval(task.leadId ?? undefined);
  return { ok: true };
}

/** Permanent delete — only from the Archived tab. */
export async function purgeTask(id: string): Promise<ActionResult> {
  const session = await requireSection("contacts");
  const task = await prisma.contactTask.findUnique({
    where: { id },
    select: { leadId: true, title: true, deletedAt: true },
  });
  if (!task) return { ok: false, error: "Task not found" };
  if (!task.deletedAt) return { ok: false, error: "Archive it first" };
  await prisma.contactTask.delete({ where: { id } });
  await logActivity(session, {
    action: "task.purge",
    section: "contacts",
    entityType: "ContactTask",
    entityId: id,
    summary: `Permanently deleted the archived task "${task.title}"`,
    meta: { leadId: task.leadId, hard: true },
  });
  reval(task.leadId ?? undefined);
  return { ok: true };
}

// ─────────────────────────── Companies ───────────────────────────

const companySchema = z.object({
  // NOT `name`: a company name is an entity label and legitimately carries digits
  // ("BMW 3 GmbH", "3M"). Same for `domain`, which is stored bare, not as a URL.
  name: z.string().trim().min(1, "Company name is required"),
  domain: z.string().trim().optional(),
  phone: optionalRule("phone"),
  email: optionalRule("email"),
  city: optionalRule("city"),
  country: z.string().trim().optional(),
  ownerId: z.string().trim().optional(),
});

export async function createCompany(form: FormData): Promise<ActionResult> {
  const session = await requireSection("contacts");
  const parsed = companySchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const d = parsed.data;
  const company = await prisma.company.create({
    data: {
      name: d.name,
      domain: d.domain || null,
      phone: d.phone || null,
      email: d.email || null,
      city: d.city || null,
      country: d.country || null,
      ownerId: d.ownerId || null,
    },
  });
  await logActivity(session, {
    action: "company.create",
    section: "contacts",
    entityType: "Company",
    entityId: company.id,
    summary: `Added company ${d.name}`,
    meta: { domain: d.domain || null, city: d.city || null },
  });
  revalidatePath("/contacts");
  return { ok: true };
}

export async function updateCompany(id: string, form: FormData): Promise<ActionResult> {
  const session = await requireSection("contacts");
  const parsed = companySchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const d = parsed.data;
  const before = await prisma.company.findUnique({
    where: { id },
    select: { name: true, domain: true, phone: true, email: true, city: true, country: true, ownerId: true },
  });
  const data = {
    name: d.name,
    domain: d.domain || null,
    phone: d.phone || null,
    email: d.email || null,
    city: d.city || null,
    country: d.country || null,
    ownerId: d.ownerId || null,
  };
  await prisma.company.update({ where: { id }, data });
  if (before) {
    const diff = diffFields(before, data);
    if (diff.changed.length) {
      await logActivity(session, {
        action: "company.update",
        section: "contacts",
        entityType: "Company",
        entityId: id,
        summary: `Updated company ${d.name} — changed ${diff.changed.join(", ")}`,
        meta: { changed: diff.changed, before: diff.before, after: diff.after },
      });
    }
  }
  revalidatePath("/contacts");
  return { ok: true };
}

/** Delete = ARCHIVE. Its leads keep their `companyId` (still resolvable) and stay active. */
export async function deleteCompany(id: string): Promise<ActionResult> {
  const { allowed, denied, session } = await capabilityCheck("pipeline.configure");
  if (!allowed) return denied;
  const company = await prisma.company.findUnique({ where: { id }, select: { name: true } });
  await prisma.company.update({ where: { id }, data: archiveData(session.user.id) });
  if (company) {
    await logActivity(session, {
      action: "company.archive",
      section: "contacts",
      entityType: "Company",
      entityId: id,
      summary: `Archived company ${company.name}`,
    });
  }
  revalidatePath("/contacts");
  return { ok: true };
}

/** Restore an archived company. */
export async function restoreCompany(id: string): Promise<ActionResult> {
  const { allowed, denied, session } = await capabilityCheck("pipeline.configure");
  if (!allowed) return denied;
  const company = await prisma.company.findUnique({ where: { id }, select: { name: true, deletedAt: true } });
  if (!company) return { ok: false, error: "Company not found" };
  if (!company.deletedAt) return { ok: false, error: "This company is not archived" };
  await prisma.company.update({ where: { id }, data: restoreData });
  await logActivity(session, {
    action: "company.restore",
    section: "contacts",
    entityType: "Company",
    entityId: id,
    summary: `Restored company ${company.name}`,
  });
  revalidatePath("/contacts");
  return { ok: true };
}

/** Permanent delete — only from the Archived tab. Lead.companyId → null (SetNull). */
export async function purgeCompany(id: string): Promise<ActionResult> {
  const { allowed, denied, session } = await capabilityCheck("pipeline.configure");
  if (!allowed) return denied;
  const company = await prisma.company.findUnique({ where: { id }, select: { name: true, deletedAt: true } });
  if (!company) return { ok: false, error: "Company not found" };
  if (!company.deletedAt) return { ok: false, error: "Archive it first" };
  await prisma.company.delete({ where: { id } }); // Lead.companyId → null (SetNull)
  await logActivity(session, {
    action: "company.purge",
    section: "contacts",
    entityType: "Company",
    entityId: id,
    summary: `Permanently deleted the archived company ${company.name}`,
    meta: { hard: true },
  });
  revalidatePath("/contacts");
  return { ok: true };
}

// ─────────────────────────── Custom field definitions ───────────────────────────

const CUSTOM_FIELD_TYPES = [
  "TEXT", "LONG_TEXT", "NUMBER", "DATE", "DROPDOWN", "MULTI_SELECT", "CHECKBOX",
  "PHONE", "EMAIL", "URL", "MONETARY",
] as const;

const customFieldSchema = z.object({
  // A custom-field name is a label ("Budget 2026"), never a person — leave it free text.
  name: z.string().trim().min(1, "Field name is required"),
  fieldType: z.enum(CUSTOM_FIELD_TYPES),
  options: z.string().trim().optional(), // comma-separated for DROPDOWN/MULTI_SELECT
});

function slugify(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

export async function createCustomField(form: FormData): Promise<ActionResult> {
  const { allowed, denied, session } = await capabilityCheck("pipeline.configure");
  if (!allowed) return denied;
  const parsed = customFieldSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const d = parsed.data;
  const key = slugify(d.name);
  if (!key) return { ok: false, error: "Field name must contain letters or numbers" };
  const exists = await prisma.customFieldDefinition.findUnique({
    where: { object_key: { object: "CONTACT", key } },
  });
  if (exists) return { ok: false, error: "A field with that name already exists" };
  const options =
    d.fieldType === "DROPDOWN" || d.fieldType === "MULTI_SELECT"
      ? d.options?.split(",").map((s) => s.trim()).filter(Boolean) ?? []
      : undefined;
  const max = await prisma.customFieldDefinition.aggregate({
    where: { object: "CONTACT" },
    _max: { position: true },
  });
  const field = await prisma.customFieldDefinition.create({
    data: {
      object: "CONTACT",
      name: d.name,
      key,
      fieldType: d.fieldType,
      options: options && options.length ? options : undefined,
      position: (max._max.position ?? -1) + 1,
    },
  });
  await logActivity(session, {
    action: "contact.field.create",
    section: "contacts",
    entityType: "CustomFieldDefinition",
    entityId: field.id,
    summary: `Created the "${d.name}" contact field`,
    meta: { key, fieldType: d.fieldType, options: options ?? null },
  });
  revalidatePath("/contacts");
  return { ok: true };
}

export async function deleteCustomField(id: string): Promise<ActionResult> {
  const { allowed, denied, session } = await capabilityCheck("pipeline.configure");
  if (!allowed) return denied;
  const field = await prisma.customFieldDefinition.findUnique({
    where: { id },
    select: { name: true, key: true },
  });
  await prisma.customFieldDefinition.delete({ where: { id } });
  if (field) {
    await logActivity(session, {
      action: "contact.field.delete",
      section: "contacts",
      entityType: "CustomFieldDefinition",
      entityId: id,
      summary: `Deleted the "${field.name}" contact field`,
      meta: { key: field.key },
    });
  }
  revalidatePath("/contacts");
  return { ok: true };
}

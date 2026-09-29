"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/rbac";
import { logActivity } from "./activity-log";
import { upsertIntakeLead } from "./lead-intake";
import type { ActionResult } from "./finance-actions";

/**
 * Workshop registrations (ER v2 Track G).
 *
 * ── Why this exists ──────────────────────────────────────────────────────────────
 * Attendance was an INTEGER typed onto an ad set, and only people who CONVERTED got a row -
 * with no link to a Lead. "Who attended and didn't buy, and can we re-target them" was
 * therefore unanswerable, despite the pipeline carrying SENT_TO_WORKSHOP and
 * WORKSHOP_FOLLOWUP stages built for exactly that motion.
 *
 * Registrations go through `upsertIntakeLead` - the SAME idempotent path the Meta and
 * FlexiFunnels webhooks use - rather than a second bespoke intake. That is what keeps one
 * human as one Lead when they register for a workshop having already opted in elsewhere.
 */

function firstError(e: z.ZodError): string {
  return e.issues[0]?.message ?? "Invalid input";
}

const registrationSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(160),
  email: z.string().trim().max(254).optional(),
  phone: z.string().trim().max(32).optional(),
  notes: z.string().trim().max(2000).optional(),
});

/**
 * Register one person for a workshop.
 *
 * Idempotent per (workshop, lead) by DB constraint, so a replayed webhook or a double-tapped
 * form updates rather than duplicating. A registration with no contact details at all is
 * refused: without a phone or an email it cannot be re-targeted, which is the entire reason
 * this table exists.
 */
export async function registerForWorkshop(workshopId: string, form: FormData): Promise<ActionResult> {
  const session = await requireAdmin();
  const parsed = registrationSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const d = parsed.data;

  if (!d.email && !d.phone) {
    return { ok: false, error: "A registration needs a phone or an email - otherwise they can never be followed up" };
  }

  const workshop = await prisma.workshop.findUnique({
    where: { id: workshopId },
    select: { id: true, name: true, line: true },
  });
  if (!workshop) return { ok: false, error: "Workshop not found" };

  const { lead } = await upsertIntakeLead({
    name: d.name,
    email: d.email || null,
    phone: d.phone || null,
    source: "NATIVE_FORM",
    leadSource: "WORKSHOP",
    externalRef: `workshop:${workshopId}:${(d.email || d.phone || "").toLowerCase()}`,
  });

  const registration = await prisma.workshopRegistration.upsert({
    where: { workshopId_leadId: { workshopId, leadId: lead.id } },
    create: {
      workshopId,
      leadId: lead.id,
      name: d.name,
      email: d.email || null,
      phone: d.phone || null,
      notes: d.notes || null,
    },
    // Fill-blanks on redelivery, like upsertIntakeLead: a correction made in the app must
    // survive a replayed registration.
    update: { notes: d.notes || undefined },
  });

  await logActivity(session, {
    action: "workshop.register",
    section: "german-note",
    entityType: "WorkshopRegistration",
    entityId: registration.id,
    summary: `Registered ${d.name} for the workshop "${workshop.name}"`,
    meta: { workshopId, leadId: lead.id },
  });

  revalidatePath(`/german-note/workshops/${workshopId}`);
  return { ok: true };
}

/**
 * Mark attendance, one person or many.
 *
 * Bulk by design: the founders mark a whole taster's attendance in one sitting off a Zoom
 * export, and a per-row action would turn that into forty round trips.
 */
export async function setWorkshopAttendance(
  registrationIds: string[],
  attended: boolean,
): Promise<ActionResult> {
  const session = await requireAdmin();
  if (registrationIds.length === 0) return { ok: false, error: "Nobody selected" };

  const first = await prisma.workshopRegistration.findUnique({
    where: { id: registrationIds[0] },
    select: { workshopId: true, workshop: { select: { name: true } } },
  });
  if (!first) return { ok: false, error: "Registration not found" };

  const result = await prisma.workshopRegistration.updateMany({
    where: { id: { in: registrationIds } },
    data: { attended, attendedAt: attended ? new Date() : null },
  });

  await logActivity(session, {
    action: "workshop.attendance",
    section: "german-note",
    entityType: "Workshop",
    entityId: first.workshopId,
    summary: `Marked ${result.count} ${result.count === 1 ? "person" : "people"} ${attended ? "attended" : "absent"} for "${first.workshop.name}"`,
    meta: { count: result.count, attended },
  });

  revalidatePath(`/german-note/workshops/${first.workshopId}`);
  return { ok: true };
}

/**
 * Link a conversion row to the registration it came from.
 *
 * Historical conversions were typed straight from the workbook with no registration behind
 * them, which is why `registrationId` is nullable. Linking is manual and one-way here - the
 * founders know who is who; a fuzzy name match on money would be a guess recorded as a fact.
 */
export async function linkConversionToRegistration(
  conversionId: string,
  registrationId: string | null,
): Promise<ActionResult> {
  const session = await requireAdmin();
  const conversion = await prisma.gnWorkshopConversion.findUnique({
    where: { id: conversionId },
    select: { fullName: true, workshopId: true },
  });
  if (!conversion) return { ok: false, error: "Conversion not found" };

  if (registrationId) {
    const reg = await prisma.workshopRegistration.findUnique({
      where: { id: registrationId },
      select: { workshopId: true, conversion: { select: { id: true } } },
    });
    if (!reg) return { ok: false, error: "Registration not found" };
    if (reg.workshopId !== conversion.workshopId) {
      return { ok: false, error: "That registration belongs to a different workshop" };
    }
    if (reg.conversion && reg.conversion.id !== conversionId) {
      return { ok: false, error: "That registration is already linked to another conversion" };
    }
  }

  await prisma.gnWorkshopConversion.update({
    where: { id: conversionId },
    data: { registrationId },
  });

  await logActivity(session, {
    action: "workshop.link_conversion",
    section: "german-note",
    entityType: "GnWorkshopConversion",
    entityId: conversionId,
    summary: registrationId
      ? `Linked ${conversion.fullName}'s sale to their workshop registration`
      : `Unlinked ${conversion.fullName}'s sale from its registration`,
    meta: { registrationId },
  });

  revalidatePath(`/german-note/workshops/${conversion.workshopId}`);
  return { ok: true };
}

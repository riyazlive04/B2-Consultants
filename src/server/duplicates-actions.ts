"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/rbac";
import { archiveData } from "@/lib/soft-delete";
import { logActivity } from "./activity-log";
import type { ActionResult } from "./finance-actions";

/**
 * Merging two lead records into one.
 *
 * ── The rule ────────────────────────────────────────────────────────────────────
 * NOTHING IS DELETED. Every child row — calls, bookings, journey, stage history, answers,
 * opportunities, notes, tasks, WhatsApp messages — is RE-POINTED at the surviving lead, and the
 * loser is soft-archived. A merge that dropped history would be worse than the duplicate it
 * fixes: the duplicate splits the record, a bad merge destroys half of it.
 *
 * ── Which row survives ──────────────────────────────────────────────────────────
 * The caller chooses, explicitly, from a screen that shows each candidate's call/booking/deal
 * counts. There is no "merge automatically" — picking the wrong direction is exactly the mistake
 * that cannot be undone by re-running anything, and the counts are the evidence a human needs.
 *
 * Blank fields on the survivor are filled from the loser (fill-blanks-only, the same contract
 * the webhook redelivery path uses) so a merge never loses a phone number or an email that only
 * one of the two rows had.
 *
 * ADMIN ONLY, transactional, and audited.
 */

/**
 * Every model with a `leadId` column, as of this commit.
 *
 * IF YOU ADD A RELATION TO `Lead`, ADD IT HERE. A table left out of this list keeps pointing at
 * the archived row after a merge: the data is not destroyed, but it becomes invisible to every
 * screen that reads through the surviving lead — which is the failure a merge exists to prevent.
 *
 * `OutreachJourney` is deliberately ABSENT: it is `@unique` on `leadId` and cannot be blindly
 * re-pointed. `mergeJourney` below handles it.
 *
 * Typed as `keyof PrismaClient` so a renamed or removed model breaks the build here rather than
 * at runtime, mid-merge.
 */
const LEAD_CHILD_TABLES = [
  "callLog",
  "discoveryOutcome",
  "leadStageHistory",
  "bookingRequest",
  "opportunity",
  "leadAnswer",
  "contactNote",
  "contactTask",
  "whatsAppMessage",
  "formSubmission",
  "agreement",
  "consentRecord",
  "workshopRegistration",
  "enrollment",
  "resume",
  "invoice",
  "subscription",
] as const satisfies readonly (keyof typeof prisma)[];

/**
 * `OutreachJourney` is `@unique` on `leadId`, so it cannot simply be re-pointed — the survivor
 * may already have one. The survivor's own journey wins (it is the record being kept) and the
 * loser's is deleted; its `optInAt` is preserved onto the survivor when the loser's is EARLIER,
 * because the earliest opt-in is the true start of the relationship and speed-to-lead is
 * measured from it.
 */
async function mergeJourney(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  keepId: string,
  loseId: string,
): Promise<void> {
  const [keep, lose] = await Promise.all([
    tx.outreachJourney.findUnique({ where: { leadId: keepId } }),
    tx.outreachJourney.findUnique({ where: { leadId: loseId } }),
  ]);
  if (!lose) return;

  if (!keep) {
    await tx.outreachJourney.update({ where: { leadId: loseId }, data: { leadId: keepId } });
    return;
  }
  if (lose.optInAt < keep.optInAt) {
    await tx.outreachJourney.update({ where: { leadId: keepId }, data: { optInAt: lose.optInAt } });
  }
  await tx.outreachJourney.delete({ where: { leadId: loseId } });
}

export async function mergeLeads(keepId: string, loseId: string): Promise<ActionResult> {
  const session = await requireAdmin();
  if (keepId === loseId) return { ok: false, error: "Pick two different records to merge." };

  const [keep, lose] = await Promise.all([
    prisma.lead.findUnique({ where: { id: keepId } }),
    prisma.lead.findUnique({ where: { id: loseId } }),
  ]);
  if (!keep || !lose) return { ok: false, error: "One of those records no longer exists." };
  if (lose.deletedAt) return { ok: false, error: `${lose.name} is already archived.` };

  await prisma.$transaction(async (tx) => {
    /**
     * Re-point EVERY child table that carries a `leadId`.
     *
     * The list is exhaustive against the schema as of this commit — see `LEAD_CHILD_TABLES`,
     * which is typed so that a table name that stops existing fails the build. A relation ADDED
     * later will not fail the build, so the constant carries the instruction to update it; the
     * cost of missing one is orphaned history on an archived row, which is silent.
     *
     * Sequential rather than `Promise.all`: this is inside one transaction on a single pooled
     * connection, so firing sixteen statements concurrently buys nothing and makes the failure
     * order non-deterministic.
     */
    // One narrow cast, at the boundary: the delegates are structurally identical for this call
    // but have no common supertype Prisma exposes, so indexing needs a shape assertion. The list
    // itself is type-checked against the client above, which is where a wrong name is caught.
    const delegates = tx as unknown as Record<
      (typeof LEAD_CHILD_TABLES)[number],
      { updateMany(args: { where: { leadId: string }; data: { leadId: string } }): Promise<unknown> }
    >;
    for (const table of LEAD_CHILD_TABLES) {
      await delegates[table].updateMany({ where: { leadId: loseId }, data: { leadId: keepId } });
    }

    await mergeJourney(tx, keepId, loseId);

    /**
     * Fill the survivor's BLANKS from the loser — never overwrite.
     *
     * The whole point of a merge is that between them the two rows hold one complete person: one
     * has the phone, the other has the email. Overwriting a populated field would discard a
     * human's verified value in favour of an older import's.
     *
     * `createdAt` is pulled back to the EARLIER of the two: that is when this person first
     * reached us, and every ageing and speed-to-lead figure reads it.
     */
    await tx.lead.update({
      where: { id: keepId },
      data: {
        phone: keep.phone ?? lose.phone,
        email: keep.email ?? lose.email,
        city: keep.city ?? lose.city,
        industry: keep.industry ?? lose.industry,
        notes: [keep.notes, lose.notes].filter(Boolean).join("\n---\n") || null,
        assignedToId: keep.assignedToId ?? lose.assignedToId,
        contactedAt:
          keep.contactedAt && lose.contactedAt
            ? keep.contactedAt < lose.contactedAt ? keep.contactedAt : lose.contactedAt
            : keep.contactedAt ?? lose.contactedAt,
        createdAt: keep.createdAt < lose.createdAt ? keep.createdAt : lose.createdAt,
      },
    });

    // Archived, not deleted. The row stays readable under Contacts → Archived, so a merge that
    // turns out to have been wrong is still auditable — and `restoreLead` can bring it back.
    await tx.lead.update({
      where: { id: loseId },
      data: {
        ...archiveData(session.user.id),
        notes: `${lose.notes ? `${lose.notes}\n` : ""}[Merged into ${keep.name} (${keepId})]`,
      },
    });
  });

  await logActivity(session, {
    action: "lead.merge",
    section: "contacts",
    entityType: "Lead",
    entityId: keepId,
    summary: `Merged duplicate ${lose.name} into ${keep.name}`,
    meta: { keptId: keepId, archivedId: loseId, archivedName: lose.name },
  });

  revalidatePath("/contacts");
  revalidatePath("/pipeline");
  revalidatePath("/people");
  return { ok: true };
}

import "server-only";
import { Prisma, type LeadSource, type Source, type Lead } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { istToday } from "@/lib/dates";
import { pickFirstCaller } from "./assignment";

/**
 * Single entry point for every non-manual lead that lands in the system - the two
 * capture webhooks (Meta Lead Ads, FlexiFunnels) and the public booking form all funnel
 * through here. Replaces Synamate's lead inbox.
 *
 * Idempotency, in order:
 *   1. (source, externalRef) - the schema's @@unique. A webhook redelivery updates the
 *      existing row (filling blanks only; never clobbering a human's manual edits).
 *   2. phone - the same person arriving from a second channel is linked, not duplicated.
 *   3. otherwise create, and append the NEW_LEAD stage-history row so the Phase-1
 *      pipeline metrics ("leads in this month", etc.) count it immediately.
 *
 * createdAt (set by the DB) is the speed-to-lead baseline; contactedAt is stamped later
 * when a setter marks the lead contacted (pipeline-actions.markLeadContacted).
 */

export type IntakeLead = {
  name: string;
  phone: string;
  email?: string | null;
  city?: string | null;
  industry?: string | null;
  leadSource: LeadSource;
  source: Source;
  externalRef?: string | null;
  utm?: Record<string, string> | null;
  notes?: string | null;
};

export type IntakeResult = { lead: Lead; created: boolean; deduped: "externalRef" | "phone" | null };

export async function upsertIntakeLead(input: IntakeLead): Promise<IntakeResult> {
  const utm = input.utm && Object.keys(input.utm).length ? (input.utm as Prisma.InputJsonValue) : undefined;

  // 1. exact redelivery of the same external record
  if (input.externalRef) {
    const existing = await prisma.lead.findUnique({
      where: { source_externalRef: { source: input.source, externalRef: input.externalRef } },
    });
    if (existing) {
      const updated = await prisma.lead.update({
        where: { id: existing.id },
        data: {
          // fill-blanks only - a manual override on this row must survive redelivery
          email: existing.email ?? input.email ?? null,
          city: existing.city ?? input.city ?? null,
          industry: existing.industry ?? input.industry ?? null,
          utm: existing.utm === null && utm !== undefined ? utm : undefined,
        },
      });
      return { lead: updated, created: false, deduped: "externalRef" };
    }
  }

  // 2. same human from another channel - link, don't duplicate
  const byPhone = await prisma.lead.findFirst({ where: { phone: input.phone } });
  if (byPhone) return { lead: byPhone, created: false, deduped: "phone" };

  // 3. brand-new lead. Auto-assign the first caller per the configured rotation
  // (80/20 split, Saturday rule) - a failure here must never block lead capture.
  const assignedToId = await pickFirstCaller().catch(() => null);
  const lead = await prisma.$transaction(async (tx) => {
    const created = await tx.lead.create({
      data: {
        name: input.name,
        phone: input.phone,
        email: input.email ?? null,
        city: input.city ?? null,
        industry: input.industry ?? null,
        leadSource: input.leadSource,
        source: input.source,
        externalRef: input.externalRef ?? null,
        utm,
        dateIn: istToday(),
        stage: "NEW_LEAD",
        notes: input.notes ?? null,
        assignedToId,
      },
    });
    await tx.leadStageHistory.create({
      data: { leadId: created.id, fromStage: null, toStage: "NEW_LEAD" },
    });
    return created;
  });

  return { lead, created: true, deduped: null };
}

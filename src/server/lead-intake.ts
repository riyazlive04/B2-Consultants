import "server-only";
import { Prisma, type LeadSource, type Source, type Lead } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { istToday } from "@/lib/dates";
import { normalizeWhatsappNumber } from "@/lib/phone";
import { pickFirstCaller } from "./assignment";
import { notifyNewOptIn } from "./outreach-notify";

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

/** Defence-in-depth: every caller is external-facing (webhooks, public form), so
 *  hard-cap the field sizes here too - the columns are unbounded Postgres text. */
function bound(input: IntakeLead): IntakeLead {
  const cut = (v: string | null | undefined, max: number) => (v == null ? v : v.slice(0, max));
  return {
    ...input,
    name: input.name.slice(0, 160),
    phone: input.phone.slice(0, 32),
    email: cut(input.email, 254),
    city: cut(input.city, 120),
    industry: cut(input.industry, 160),
    externalRef: cut(input.externalRef, 300),
    notes: cut(input.notes, 2000),
  };
}

/**
 * Find an existing lead whose phone is the SAME NUMBER, however it happens to be punctuated.
 *
 * Two passes, cheapest first:
 *   1. Exact string on the indexed column — the overwhelmingly common case (same channel, same
 *      formatting), and it costs one index lookup.
 *   2. Digits-only comparison. Postgres can't run libphonenumber, so we narrow with a
 *      digits-only LIKE on the last 9 significant digits (selective enough to return a handful of
 *      rows, short enough to survive any country-code/trunk-prefix variation), then confirm each
 *      candidate on the fully normalized E.164 form in JS. The LIKE can't use the btree index, but
 *      it only runs when the exact match missed, and the lead table is small.
 */
async function findLeadByNormalizedPhone(normalized: string, raw: string): Promise<Lead | null> {
  const exact = await prisma.lead.findFirst({ where: { phone: raw } });
  if (exact) return exact;

  const tail = normalized.slice(-9);
  if (tail.length < 9) return null; // too short to be selective — don't risk a false positive

  // '[^0-9]' rather than '\D' ON PURPOSE: this is a template literal, so `\D` would be cooked to
  // a bare `D` before Postgres ever sees it — the query would then strip literal "D" characters
  // instead of non-digits, match nothing, and silently duplicate the lead. A character class
  // needs no backslash and cannot be mangled by the JS lexer.
  const hits = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id FROM "lead"
    WHERE regexp_replace(phone, '[^0-9]', '', 'g') LIKE ${`%${tail}`}
    ORDER BY "createdAt" ASC
    LIMIT 50
  `;
  if (!hits.length) return null;

  const candidates = await prisma.lead.findMany({ where: { id: { in: hits.map((h) => h.id) } } });
  // Confirm on the full normalized form: matching tails is a prefilter, not a decision. Two real
  // numbers can share 9 trailing digits across countries.
  return candidates.find((c) => normalizeWhatsappNumber(c.phone) === normalized) ?? null;
}

export type DuplicateMatch = { lead: Lead; on: "phone" | "email" };

/**
 * Detect an existing lead that a MANUAL entry would duplicate. The two interactive back-office
 * creation paths (Contacts "Add contact", Pipeline "New lead") don't go through upsertIntakeLead,
 * so without this a rep who types the same person twice silently gets two Lead rows — which then
 * splits that person's calls, bookings, owner and commission across both records (the exact
 * failure upsertIntakeLead's phone-dedup exists to prevent, just on the capture side).
 *
 * Phone is matched on the NORMALIZED E.164 form, so "+91 98765 43210", "+919876543210" and
 * "09876543210" all resolve to one person; email is matched case-insensitively (the same key
 * booking-actions.ts / field-rules email folding use). Phone takes precedence in the report.
 */
export async function findDuplicateLead(input: {
  phone?: string | null;
  email?: string | null;
}): Promise<DuplicateMatch | null> {
  const phone = input.phone?.trim();
  if (phone) {
    const normalized = normalizeWhatsappNumber(phone);
    const byPhone = normalized
      ? await findLeadByNormalizedPhone(normalized, phone)
      : await prisma.lead.findFirst({ where: { phone } });
    if (byPhone) return { lead: byPhone, on: "phone" };
  }
  const email = input.email?.trim();
  if (email) {
    const byEmail = await prisma.lead.findFirst({
      where: { email: { equals: email, mode: "insensitive" } },
    });
    if (byEmail) return { lead: byEmail, on: "email" };
  }
  return null;
}

export async function upsertIntakeLead(rawInput: IntakeLead): Promise<IntakeResult> {
  const input = bound(rawInput);
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

  // 2. same human from another channel - link, don't duplicate.
  //
  // Matched on the NORMALIZED number, not the raw string. An exact compare treats
  // "+91 98765 43210", "+919876543210" and "09876543210" as three different people, which is how
  // one human ends up as three Lead rows — and then the SOP's Step 10 booking cross-check reports
  // "not booked" for a prospect who has booked, because the booking hangs off a different row.
  // libphonenumber is already a dependency and already fails closed (null on anything it can't
  // prove valid), so an unparseable number falls back to the exact compare rather than guessing.
  const normalized = normalizeWhatsappNumber(input.phone);
  const byPhone = normalized
    ? await findLeadByNormalizedPhone(normalized, input.phone)
    : await prisma.lead.findFirst({ where: { phone: input.phone } });
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
    // SOP Step 1 → the outreach journey starts here. Inside the transaction so a lead can never
    // exist without one: a journey-less lead is invisible to the SOP queue, which is exactly the
    // failure mode ("we never called them") the 5-minute SLA exists to prevent.
    await tx.outreachJourney.create({
      data: { leadId: created.id, optInAt: created.createdAt },
    });
    return created;
  });

  // SOP Step 1 → "the outreach specialist will be getting the required information also via
  // E-Mail". Deliberately NOT awaited: capture is done and committed, and a slow or failing
  // Resend call must never delay (or fail) the webhook response. notifyNewOptIn swallows its own
  // errors, so this cannot produce an unhandled rejection.
  void notifyNewOptIn(lead.id);

  return { lead, created: true, deduped: null };
}

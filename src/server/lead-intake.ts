import "server-only";
import { Prisma, type LeadSource, type Source, type Lead } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { istToday } from "@/lib/dates";
import { normalizeWhatsappNumber } from "@/lib/phone";
import { pickFirstCaller } from "./assignment";
import { notifyNewOptIn } from "./outreach-notify";
import { scoreLeadAtOptIn } from "./lead-qualification";
import { sendIntroNow } from "./outreach-instant";
import { planReturningOptIn } from "@/lib/returning-opt-in";
import { ensureDefaultOpportunity } from "./opportunity-sync";
import { getPipelineConfig } from "./founder-config";

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
  /**
   * Nullable since ER v2 Track G: a workshop registration may arrive with an email and no
   * phone. Every other caller (the Meta / FlexiFunnels / Pabbly webhooks, the booking form)
   * still refuses a lead without one, so this widens the type without loosening them.
   *
   * A BLANK phone must never reach the dedup below - see the comment there.
   */
  phone: string | null;
  email?: string | null;
  city?: string | null;
  industry?: string | null;
  leadSource: LeadSource;
  source: Source;
  externalRef?: string | null;
  utm?: Record<string, string> | null;
  /**
   * The hostname this person actually arrived through, taken from the request that created them.
   *
   * OBSERVED ONLY - never inferred from a funnel slug or a UTM code. The WhatsApp domain gate
   * treats a recorded value as grounds to BLOCK a message, so a guess written here would silence
   * a real prospect on the strength of something nobody checked. Omit it and the lead keeps a
   * NULL origin, which the gate reads as "unknown" and always lets through.
   */
  originDomain?: string | null;
  notes?: string | null;
  /**
   * The sender's RAW payload, when it may carry qualification answers.
   *
   * Application Logic §4.3 stage 1: the landing page asks the band-score questions, so the score
   * has to be taken here - at opt-in - not only when someone later books. Passed as the whole
   * payload rather than pre-parsed answers because the mapping from a sender's field names onto
   * our catalogue is founder-configurable, and that mapping lives behind this boundary
   * (`server/lead-qualification.ts`), not in each webhook route.
   *
   * Omit it and nothing changes: scoring is skipped entirely.
   */
  intakePayload?: Record<string, unknown> | null;
};

export type IntakeResult = {
  lead: Lead;
  created: boolean;
  /**
   * WHICH identity matched, when this was not a new row.
   *
   * "email" is its own value. The email branch below used to report `"phone"`, so every webhook
   * response, log line and future dedupe metric attributed an email match to a phone match -
   * which matters precisely when someone is trying to work out why a lead was or was not merged.
   */
  deduped: "externalRef" | "phone" | "email" | null;
  /**
   * A dedupe matched a DORMANT lead and this opt-in put it back in front of a caller - stage
   * re-opened, owner assigned, and/or the journey clock restarted. Always false on `created`
   * (a brand-new lead was never dormant) and false when the match was already live and owned.
   */
  reopened: boolean;
};

/** Defence-in-depth: every caller is external-facing (webhooks, public form), so
 *  hard-cap the field sizes here too - the columns are unbounded Postgres text. */
function bound(input: IntakeLead): IntakeLead {
  const cut = (v: string | null | undefined, max: number) => (v == null ? v : v.slice(0, max));
  return {
    ...input,
    name: input.name.slice(0, 160),
    phone: cut(input.phone, 32) ?? null,
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
 *   1. Exact string on the indexed column - the overwhelmingly common case (same channel, same
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
  if (tail.length < 9) return null; // too short to be selective - don't risk a false positive

  // '[^0-9]' rather than '\D' ON PURPOSE: this is a template literal, so `\D` would be cooked to
  // a bare `D` before Postgres ever sees it - the query would then strip literal "D" characters
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
 * so without this a rep who types the same person twice silently gets two Lead rows - which then
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

/**
 * Capture the lead, then score it from the same payload.
 *
 * Split from `resolveIntakeLead` below so scoring happens at ONE place instead of at each of its
 * four exits - and, more to the point, so it applies to a DEDUPED lead too. A prospect who opted
 * in months ago with no answers and has now filled in the qualification form is the same Lead
 * row; scoring only the freshly-created ones would leave exactly the returning, most-engaged
 * prospects unscored.
 *
 * The score is AWAITED, unlike `notifyNewOptIn`. That one is an email nobody is blocked on; this
 * one decides who the SOP puts in front of a caller, and a route handler's response can end the
 * execution context - a fire-and-forget write would be lost precisely when traffic is heaviest.
 */
export async function upsertIntakeLead(rawInput: IntakeLead): Promise<IntakeResult> {
  const result = await resolveIntakeLead(rawInput);
  if (rawInput.intakePayload) {
    await scoreLeadAtOptIn(result.lead.id, rawInput.intakePayload);
  }

  /**
   * SOP Step 3, sent the moment they opt in - the founder's "don't wait for a telecaller".
   *
   * ONLY on `created`. A deduped lead is someone we have already met: they may be mid-chase, or
   * booked, or have asked us to stop months ago, and re-inviting them to book is at best noise.
   * The dedupe branches return early precisely because that person already has a journey - this
   * is the one place where "new row" and "new human" mean the same thing.
   *
   * AWAITED, unlike `notifyNewOptIn`. A webhook's response can end the execution context, and a
   * send lost to that would be invisible - no row, no error, just a prospect nobody contacted. It
   * costs the webhook a second and it never throws (see `sendIntroNow`'s contract), so the caller
   * cannot be broken by it. Scoring above is awaited for the same reason.
   *
   * The source gate lives inside `sendIntroNow` so the whitelist is stated once, next to the
   * reasoning for it.
   */
  if (result.created) {
    await sendIntroNow(result.lead.id, result.lead.source);
  }

  return result;
}

/**
 * A person we already have has just opted in again.
 *
 * Keeping the single row is right - see the dedup comments below. What was missing is everything
 * else: the old code returned the matched row untouched, so a lead that went LOST in June and
 * re-applied today gained no owner, no queue entry, no notification, and not even a bumped
 * `updatedAt`. There was no trace they came back, because assignment and the journey only ever ran
 * on the create path.
 *
 * `planReturningOptIn` (pure, tested) decides; this applies. Blank contact fields are filled
 * either way, on the same fill-blanks-only contract as the redelivery branch - a human's manual
 * correction must survive a webhook.
 */
async function acceptReturningOptIn(
  existing: Lead,
  input: IntakeLead,
  utm: Prisma.InputJsonValue | undefined,
): Promise<{ lead: Lead; reopened: boolean }> {
  const journey = await prisma.outreachJourney.findUnique({
    where: { leadId: existing.id },
    select: { phase: true, bookingId: true },
  });
  const plan = planReturningOptIn({
    stage: existing.stage,
    assignedToId: existing.assignedToId,
    deletedAt: existing.deletedAt,
    journey,
  });

  const fillBlanks = {
    email: existing.email ?? input.email ?? null,
    city: existing.city ?? input.city ?? null,
    industry: existing.industry ?? input.industry ?? null,
    utm: existing.utm === null && utm !== undefined ? utm : undefined,
    // Same fill-blanks-only contract: the FIRST domain someone was seen on is the one that
    // sticks. Overwriting it on a later opt-in would rewrite history every time they came back
    // through a different page, and the gate would start judging them by their most recent visit.
    originDomain: existing.originDomain ?? input.originDomain ?? null,
  };

  if (!plan.reopened) {
    const lead = await prisma.lead.update({ where: { id: existing.id }, data: fillBlanks });
    return { lead, reopened: false };
  }

  // Same rotation the create path uses, and failing it must never break capture.
  const assignedToId = plan.needsOwner ? await pickFirstCaller().catch(() => null) : null;
  const optInAt = new Date();

  const lead = await prisma.$transaction(async (tx) => {
    const updated = await tx.lead.update({
      where: { id: existing.id },
      data: {
        ...fillBlanks,
        // Un-archive FIRST: every other write below assumes a live lead, and a restored row
        // with a stale `deletedById` would claim someone archived it after it came back.
        ...(plan.restore ? { deletedAt: null, deletedById: null } : {}),
        ...(plan.reopenStage ? { stage: "NEW_LEAD" as const } : {}),
        ...(assignedToId ? { assignedToId } : {}),
      },
    });
    // The pipeline's stage metrics read history, not just the current column, so a re-open that
    // wrote no history row would move the lead without ever showing where it came from.
    if (plan.reopenStage) {
      await tx.leadStageHistory.create({
        data: { leadId: existing.id, fromStage: existing.stage, toStage: "NEW_LEAD" },
      });
    }
    // `upsert`, because the pre-SOP rows (the Synamate import) have no journey at all - and a
    // journey-less lead is invisible to both the SOP queue and the L1 desk's SLA buckets.
    //
    // contactedAt is cleared with the clock ON PURPOSE. It is the Step-2 "time contacted" for the
    // chase that optInAt starts; leaving a stamp from the previous cycle behind a NEWER optInAt
    // would make speed-to-lead compute a negative response time.
    if (plan.restartJourney) {
      await tx.outreachJourney.upsert({
        where: { leadId: existing.id },
        create: { leadId: existing.id, optInAt },
        update: { optInAt, phase: "OPT_IN", contactedAt: null },
      });
    }
    /**
     * A re-opened lead goes back on the board too.
     *
     * `ensureDefaultOpportunity` is idempotent, so a returning prospect who still has their old
     * card keeps it exactly where it is; one whose card never existed (every pre-fix lead, and
     * the entire Synamate import) gets one now. Without this, the returning-opt-in path would
     * reproduce the original bug for precisely the most engaged prospects.
     */
    await ensureDefaultOpportunity(tx, existing.id);
    return updated;
  });

  // Same treatment as a new opt-in: not awaited, swallows its own errors. Telling someone a cold
  // lead came back is the entire point of this branch.
  void notifyNewOptIn(lead.id);

  return { lead, reopened: true };
}

async function resolveIntakeLead(rawInput: IntakeLead): Promise<IntakeResult> {
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
      // NOT a returning opt-in: same source AND same record id is the sender redelivering one
      // submission, not the person coming back. Re-opening on a retry would let a flaky webhook
      // resurrect leads nobody re-applied to.
      return { lead: updated, created: false, deduped: "externalRef", reopened: false };
    }
  }

  // 2. same human from another channel - link, don't duplicate.
  //
  // Matched on the NORMALIZED number, not the raw string. An exact compare treats
  // "+91 98765 43210", "+919876543210" and "09876543210" as three different people, which is how
  // one human ends up as three Lead rows - and then the SOP's Step 10 booking cross-check reports
  // "not booked" for a prospect who has booked, because the booking hangs off a different row.
  // libphonenumber is already a dependency and already fails closed (null on anything it can't
  // prove valid), so an unparseable number falls back to the exact compare rather than guessing.
  //
  // A BLANK phone is skipped entirely rather than compared. The exact-compare fallback below
  // would otherwise match every other phoneless lead to each other: the first email-only
  // registration creates a lead with phone "", and the second one silently merges into it -
  // two different people, one record. Absence of a number is not evidence of sameness.
  const phone = input.phone?.trim() || null;
  if (phone) {
    const normalized = normalizeWhatsappNumber(phone);
    const byPhone = normalized
      ? await findLeadByNormalizedPhone(normalized, phone)
      : await prisma.lead.findFirst({ where: { phone } });
    if (byPhone) {
      return { ...(await acceptReturningOptIn(byPhone, input, utm)), created: false, deduped: "phone" };
    }
  }

  /**
   * Email as a SECOND identity, not a fallback.
   *
   * This used to be gated on `!phone` - email was only consulted when there was no number at
   * all. That left the commonest real duplicate uncaught: the same person opting in again from
   * a different number (a new SIM, a work phone, a typo the first time). Their email matches,
   * their phone does not, and the `!phone` guard meant we never looked - so they became a second
   * Lead row, splitting their calls, owner, journey and commission exactly as the phone dedupe
   * exists to prevent.
   *
   * Live scale when this was written: 5,889 leads carry no phone at all, so email is the ONLY
   * identity a quarter of the table has.
   *
   * Running it unconditionally is safe because a blank email is skipped the same way a blank
   * phone is - absence is not evidence of sameness, and `""` would otherwise match every other
   * email-less lead to each other.
   */
  const email = input.email?.trim();
  if (email) {
    const byEmail = await prisma.lead.findFirst({
      // Case-insensitive, the same folding findDuplicateLead and the booking form use.
      where: { email: { equals: email, mode: "insensitive" } },
    });
    if (byEmail) {
      return { ...(await acceptReturningOptIn(byEmail, input, utm)), created: false, deduped: "email" };
    }
  }

  // 3. brand-new lead. Auto-assign the first caller per the configured rotation
  // (80/20 split, Saturday rule) - a failure here must never block lead capture.
  const assignedToId = await pickFirstCaller().catch(() => null);
  // Read OUTSIDE the transaction - it is a cached config read, and holding a transaction open
  // across it buys nothing. Defaults to true; a config read that fails must not block capture.
  const autoCreateOpportunity = await getPipelineConfig()
    .then((c) => c.autoCreateOpportunity)
    .catch(() => true);
  const lead = await prisma.$transaction(async (tx) => {
    const created = await tx.lead.create({
      data: {
        name: input.name,
        // Blank normalises to null: `Lead.phone` is nullable, and an empty string there would
        // be a third state ("we have a phone, and it is nothing") that every send path would
        // have to special-case on top of the null check it already does.
        phone: input.phone?.trim() || null,
        email: input.email ?? null,
        city: input.city ?? null,
        industry: input.industry ?? null,
        leadSource: input.leadSource,
        source: input.source,
        externalRef: input.externalRef ?? null,
        utm,
        originDomain: input.originDomain ?? null,
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
    /**
     * …and onto the Opportunity board, in the SAME transaction.
     *
     * This is what was missing. Nothing in the capture path ever created an opportunity, so
     * every webhook lead landed in the Lead table and was invisible on the board - 23,545 leads,
     * one card. Inside the transaction for the same reason the journey is: a lead that exists
     * without a card is a lead nobody working the board will ever see.
     *
     * It cannot fail the capture: `ensureDefaultOpportunity` no-ops when the board is
     * misconfigured rather than throwing.
     */
    if (autoCreateOpportunity) await ensureDefaultOpportunity(tx, created.id);
    return created;
  });

  // SOP Step 1 → "the outreach specialist will be getting the required information also via
  // E-Mail". Deliberately NOT awaited: capture is done and committed, and a slow or failing
  // Resend call must never delay (or fail) the webhook response. notifyNewOptIn swallows its own
  // errors, so this cannot produce an unhandled rejection.
  void notifyNewOptIn(lead.id);

  return { lead, created: true, deduped: null, reopened: false };
}

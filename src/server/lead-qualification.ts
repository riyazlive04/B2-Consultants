import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { computeBant, type BantInput, type BantResult } from "@/lib/booking-intake";
import { scoreFromAnswers } from "@/lib/qualification";
import { mapInboundAnswers, type InboundMapping } from "@/lib/qualification-inbound";
import { getQualificationQuestions } from "./qualification";

/**
 * Scoring a lead AT OPT-IN - Application Logic §4.3 stage 1.
 *
 * The landing page asks the band-score questions; Pabbly relays the submission. This turns that
 * payload into a stored score on the Lead, so the answers reach the person running the discovery
 * call instead of dying in the webhook body.
 *
 * ── Which scorer runs ────────────────────────────────────────────────────────────
 * The catalogue (`scoreFromAnswers`), not the column-based `computeBant`. That is a deliberate
 * departure from the booking form, which is still in Track D's shadow phase: there, the
 * hardcoded columns are the shipped behaviour and the catalogue is only measured alongside them.
 * Here there is no shipped behaviour to preserve - this path has never scored anything - and an
 * inbound answer can only be READ through the catalogue in the first place, because that is
 * where the founder-editable field names and answer aliases live. Scoring the mapped result any
 * other way would mean honouring a founder's mapping and then ignoring their weights.
 *
 * `computeBant` remains the fallback for the case where the catalogue is empty (an unseeded
 * install), so a lead is never left unscored merely because nobody has opened Console yet.
 *
 * ── What is deliberately NOT done here ───────────────────────────────────────────
 * No auto-disqualify, no message, no stage change. The booking form's `autoDisqualify` rule is
 * gated on a config flag and cancels a SLOT; there is no slot at opt-in, and silently closing a
 * lead the moment a landing-page form says "just exploring" is a decision the founders have not
 * asked for. The score is a recommendation; who gets called stays the SOP's call.
 */

/** What a caller needs to know about a scoring attempt, for logs and the Console report. */
export type OptInScoreResult = {
  scored: boolean;
  /** Why nothing was written, when `scored` is false. */
  skipped: "no-answers" | "manual-score-exists" | "no-catalogue" | null;
  bant: BantResult | null;
  mapping: InboundMapping | null;
};

const EMPTY: OptInScoreResult = { scored: false, skipped: "no-answers", bant: null, mapping: null };

/**
 * Score a lead from a raw inbound payload and persist the result.
 *
 * Idempotent by construction: the lead's answers are replaced wholesale, so a webhook redelivery
 * converges rather than accumulating duplicate `LeadAnswer` rows.
 *
 * NEVER THROWS. Every caller is a lead-capture webhook, and a lead that arrives unscored is a
 * far better outcome than a lead that does not arrive - the scoring is an enrichment, not the
 * point of the request. Failures are logged and swallowed.
 */
export async function scoreLeadAtOptIn(
  leadId: string,
  payload: Record<string, unknown>,
): Promise<OptInScoreResult> {
  try {
    const questions = await getQualificationQuestions();
    const mapping = mapInboundAnswers(payload, questions);

    /**
     * NOTHING in the payload matched a question.
     *
     * This used to `return EMPTY` without writing a row, on the reasoning that a bare opt-in form
     * collecting only a name and a number is the common case and not a problem. That reasoning is
     * right about the common case and catastrophic about the other one: it is ALSO what happens
     * when the landing page renames its fields, and the two are indistinguishable from the
     * outside. On 4 Aug 2026 production had 23,545 leads, 111 of them from Pabbly with the
     * qualification form live and 13 questions configured, and NOT ONE scored row - with no
     * evidence anywhere of what the sender had actually posted.
     *
     * The evidence is now always recorded. `intakeAnswers.unrecognisedKeys` is what Console →
     * Qualification's inbound report reads, so a mapping that matches nothing becomes a screen
     * that says "here are the field names Pabbly is sending you" instead of a blank panel. That
     * is the whole difference between a silent failure and a fixable one.
     *
     * Still skipped when the payload carries no readable field at all (a truly empty body): there
     * is no evidence to keep, and writing an empty blob would only dilute the report.
     */
    if (mapping.mapped.length === 0) {
      if (mapping.unrecognisedKeys.length === 0) return EMPTY;
      await persistEvidence(leadId, payload, mapping);
      console.warn(
        `[lead-qualification] lead ${leadId}: NOTHING matched the question catalogue - ` +
          `${mapping.unrecognisedKeys.length} unrecognised field(s): ` +
          mapping.unrecognisedKeys.slice(0, 12).map((k) => JSON.stringify(k)).join(", ") +
          " - map these at Console → Qualification (Inbound field names).",
      );
      return { scored: false, skipped: "no-answers", bant: null, mapping };
    }

    if (!mapping.scorable) {
      // Fields matched but no SCORED dimension resolved. Worth recording the evidence - the
      // Console report reads `intakeAnswers` to show which answers arrived unrecognised - but
      // there is no score to compute, and writing 0 would assert something we do not know.
      await persistEvidence(leadId, payload, mapping);
      return { scored: false, skipped: "no-answers", bant: null, mapping };
    }

    // A specialist's own judgement outranks a form. Checked here rather than in the update's
    // WHERE so the evidence above is still recorded - the answers are worth keeping even when
    // they do not move the score.
    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      select: { bantSource: true },
    });
    if (lead?.bantSource === "MANUAL") {
      await persistEvidence(leadId, payload, mapping);
      return { scored: false, skipped: "manual-score-exists", bant: null, mapping };
    }

    const bant = questions.length > 0
      ? scoreFromAnswers(mapping.answers, questions)
      : computeBant(mapping.answers as BantInput);

    await writeScore(leadId, payload, mapping, bant, questions.length > 0);
    return { scored: true, skipped: null, bant, mapping };
  } catch (err) {
    // Deliberately not rethrown - see the contract above.
    console.error(`[lead-qualification] scoring lead ${leadId} failed:`, err);
    return { scored: false, skipped: null, bant: null, mapping: null };
  }
}

/** Store the verbatim payload without touching the score. */
async function persistEvidence(
  leadId: string,
  payload: Record<string, unknown>,
  mapping: InboundMapping,
): Promise<void> {
  await prisma.lead.update({
    where: { id: leadId },
    data: { intakeAnswers: evidenceFor(payload, mapping) },
  });
}

/**
 * The Json blob stored on `Lead.intakeAnswers`.
 *
 * Holds the raw payload AND what we made of it. Storing only the raw payload would leave Console
 * re-deriving the mapping to show what failed - and re-deriving it against TODAY's catalogue,
 * which is not the one the lead was scored under. Storing the outcome alongside makes the report
 * a read.
 */
function evidenceFor(payload: Record<string, unknown>, mapping: InboundMapping): Prisma.InputJsonValue {
  return {
    receivedAt: new Date().toISOString(),
    // Capped and flattened: this is an unbounded field from an EXTERNAL sender, stored on a row
    // we keep forever. Values are reduced to readable scalars rather than passed through - the
    // report that reads this only ever displays them, and a nested object of unknown depth is
    // both a storage risk and, in Prisma's Json input type, not expressible as `unknown`.
    raw: Object.fromEntries(
      Object.entries(payload)
        .slice(0, 60)
        .map(([k, v]) => [k.slice(0, 120), scalar(v)]),
    ),
    mapped: mapping.mapped.map((m) => ({
      key: m.key,
      inboundKey: m.inboundKey,
      rawValue: m.rawValue.slice(0, 500),
      value: m.value,
      score: m.score,
    })),
    unresolved: mapping.unresolved.map((m) => ({ key: m.key, rawValue: m.rawValue.slice(0, 500) })),
    unrecognisedKeys: mapping.unrecognisedKeys.slice(0, 40),
  } satisfies Prisma.InputJsonValue;
}

/** One payload value as a stored scalar. Anything structured is JSON-stringified, then capped. */
function scalar(v: unknown): string | number | boolean | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") return v.slice(0, 500);
  if (typeof v === "number" || typeof v === "boolean") return v;
  try {
    return JSON.stringify(v).slice(0, 500);
  } catch {
    return null; // circular or otherwise unserialisable - the field is not worth failing over
  }
}

/**
 * Persist score + answers + evidence in one transaction.
 *
 * The `LeadAnswer` rows are the point of ER v2 Track D and, until now, nothing in the app wrote
 * one. They pin WHICH VERSION of each question was answered, so a later re-tune cannot rewrite
 * the reason this lead was called.
 */
async function writeScore(
  leadId: string,
  payload: Record<string, unknown>,
  mapping: InboundMapping,
  bant: BantResult,
  fromCatalogue: boolean,
): Promise<void> {
  // Resolve the answered questions to their row ids up front - outside the transaction, since
  // it is a read and holding a transaction open across it buys nothing.
  const answered = mapping.mapped.filter((m) => m.value !== null);
  const rows = answered.length
    ? await prisma.qualificationQuestion.findMany({
        where: { OR: answered.map((a) => ({ key: a.key, version: a.version })) },
        select: { id: true, key: true, version: true },
      })
    : [];
  const idFor = new Map(rows.map((r) => [`${r.key}@${r.version}`, r.id]));

  await prisma.$transaction(async (tx) => {
    await tx.lead.update({
      where: { id: leadId },
      data: {
        bantBudget: bant.bantBudget,
        bantAuthority: bant.bantAuthority,
        bantNeed: bant.bantNeed,
        bantTimeline: bant.bantTimeline,
        bantScore: bant.bantScore,
        bantAvg: bant.bantAvg,
        bantVerdict: bant.bantVerdict,
        bantScoredAt: new Date(),
        bantSource: "OPT_IN",
        intakeAnswers: evidenceFor(payload, mapping),
      },
    });

    // Replace, don't append. `LeadAnswer`'s @@unique is ([bookingRequestId, questionId]), and
    // Postgres treats NULLs as distinct - so for a lead-level answer (no booking) that unique
    // enforces nothing, and a redelivered webhook would stack a second copy of every answer.
    // Scoped to bookingRequestId: null so a booking form's answers are never disturbed.
    await tx.leadAnswer.deleteMany({ where: { leadId, bookingRequestId: null } });

    const data = answered
      .map((a) => {
        const questionId = idFor.get(`${a.key}@${a.version}`);
        return questionId
          ? { leadId, questionId, answerRaw: a.rawValue.slice(0, 2000), score: roundScore(a.score) }
          : null;
      })
      .filter((d): d is NonNullable<typeof d> => d !== null);

    if (data.length) await tx.leadAnswer.createMany({ data });
  });

  if (mapping.unresolved.length > 0) {
    // Loud on purpose. This is the "a label was reworded and scores quietly dropped" case, and
    // it is invisible in the data - the lead simply scores lower on that dimension.
    console.warn(
      `[lead-qualification] lead ${leadId}: ${mapping.unresolved.length} answer(s) matched no option - ` +
        mapping.unresolved.map((u) => `${u.key}="${u.rawValue.slice(0, 40)}"`).join(", ") +
        " - add these as aliases at Console → Qualification.",
    );
  }
  if (!fromCatalogue) {
    console.warn(`[lead-qualification] lead ${leadId} scored by the fallback scorer - the question catalogue is empty.`);
  }
}

/**
 * `LeadAnswer.score` is an Int, but option scores are 0–5 with halves (`unsure: 1.5`).
 * Rounded rather than truncated so 1.5 → 2 not 1, and never below zero.
 */
function roundScore(score: number | null): number | null {
  return score === null ? null : Math.max(0, Math.round(score));
}

/**
 * Mirror a BOOKING's score onto its lead - Application Logic §4.3 stage 2.
 *
 * The booking form asks more, and asks it later, so its verdict supersedes whatever the landing
 * page produced. A MANUAL score still wins over both: a specialist who has spoken to the person
 * knows more than either form.
 *
 * Fire-and-forget from the booking action: this is a mirror of a value already safely stored on
 * `BookingRequest`, so failing here must not fail a prospect's booking.
 */
export async function mirrorBookingScoreToLead(
  leadId: string,
  bant: BantResult,
): Promise<void> {
  try {
    await prisma.lead.updateMany({
      // updateMany + a WHERE, not update: this is the whole precedence rule expressed as a
      // predicate, so there is no read-then-write window in which a specialist's manual score
      // could be overwritten by a booking that was already in flight.
      where: { id: leadId, OR: [{ bantSource: null }, { bantSource: { in: ["OPT_IN", "BOOKING"] } }] },
      data: {
        bantBudget: bant.bantBudget,
        bantAuthority: bant.bantAuthority,
        bantNeed: bant.bantNeed,
        bantTimeline: bant.bantTimeline,
        bantScore: bant.bantScore,
        bantAvg: bant.bantAvg,
        bantVerdict: bant.bantVerdict,
        bantScoredAt: new Date(),
        bantSource: "BOOKING",
      },
    });
  } catch (err) {
    console.error(`[lead-qualification] mirroring booking score to lead ${leadId} failed:`, err);
  }
}

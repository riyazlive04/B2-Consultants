import "server-only";
import { cache } from "react";
import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/prisma";
import {
  scoreFromAnswers,
  bantResultsAgree,
  type QuestionSpec,
  type QuestionOption,
  type AnswerMap,
} from "@/lib/qualification";
import { computeBant, type BantInput } from "@/lib/booking-intake";

/**
 * Qualification catalogue reads (ER v2 Track D). Admin CRUD is in
 * `qualification-actions.ts`; the pure scoring is in `lib/qualification.ts`.
 *
 * ── Where this sits in the cutover ───────────────────────────────────────────────
 * The catalogue is in SHADOW. `shadowScore()` runs the catalogue scorer alongside the shipped
 * column-based `computeBant()` on every submission and records the result, WITHOUT any
 * decision reading it. The flip to the catalogue is gated on a full historical replay showing
 * zero disagreements (prisma/replay-bant.ts). Until then the live verdict comes from the
 * columns, exactly as it did before this table existed.
 */

export const QUALIFICATION_CACHE_TAG = "qualification-questions";

/**
 * Fold the separately-stored `answerAliases` back onto each option.
 *
 * They are stored apart because `options` is frozen once answered (the DB's version guard), and
 * an inbound alias is a parsing rule rather than evidence — see the schema comment. Every reader
 * downstream wants them as one object, so the join happens here, once, rather than in the mapper
 * and again in the admin panel.
 */
export function withAliases(
  options: QuestionOption[],
  answerAliases: unknown,
): QuestionOption[] {
  const map =
    answerAliases && typeof answerAliases === "object" && !Array.isArray(answerAliases)
      ? (answerAliases as Record<string, unknown>)
      : {};
  return options.map((o) => {
    const raw = map[o.value];
    const aliases = Array.isArray(raw) ? raw.filter((a): a is string => typeof a === "string") : [];
    return aliases.length ? { ...o, aliases } : o;
  });
}

const readActive = async (): Promise<QuestionSpec[]> => {
  const rows = await prisma.qualificationQuestion.findMany({
    where: { active: true },
    orderBy: [{ orderIndex: "asc" }, { key: "asc" }],
  });
  return rows.map((r) => ({
    key: r.key,
    version: r.version,
    text: r.text,
    helpText: r.helpText,
    kind: r.kind,
    options: withAliases((r.options as QuestionOption[] | null) ?? [], r.answerAliases),
    inboundKeys: r.inboundKeys,
    dimension: r.dimension,
    weight: r.weight,
    required: r.required,
    orderIndex: r.orderIndex,
  }));
};

/**
 * The live catalogue.
 *
 * Two cache layers, mirroring `server/levels.ts`: `unstable_cache` keeps it across requests
 * (it changes only when an admin edits a question, and the PUBLIC booking form reads it on
 * every render — a per-request round trip there is paid by prospects), busted on any
 * mutation and revalidated after 5 minutes as a backstop.
 */
export const getQualificationQuestions = cache(
  unstable_cache(readActive, ["qualification-catalogue"], {
    revalidate: 300,
    tags: [QUALIFICATION_CACHE_TAG],
  }),
);

/** Every version, active or not — the admin panel needs the history to show what was asked. */
export const getAllQualificationQuestions = cache(async () => {
  const rows = await prisma.qualificationQuestion.findMany({
    orderBy: [{ orderIndex: "asc" }, { key: "asc" }, { version: "desc" }],
    include: { _count: { select: { answers: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    key: r.key,
    version: r.version,
    text: r.text,
    helpText: r.helpText,
    kind: r.kind,
    options: withAliases((r.options as QuestionOption[] | null) ?? [], r.answerAliases),
    inboundKeys: r.inboundKeys,
    dimension: r.dimension,
    weight: r.weight,
    required: r.required,
    orderIndex: r.orderIndex,
    active: r.active,
    /** Answered questions are frozen — an edit must create a new version (D5). */
    answerCount: r._count.answers,
  }));
});

export type ShadowScore = {
  /** What the catalogue would have said. Recorded, never acted on, during the shadow phase. */
  shadowAvg: number | null;
  /** Highest question version in the catalogue that produced it. */
  configVersion: number | null;
  agrees: boolean | null;
};

/**
 * Score a submission through the catalogue and compare with the shipped scorer.
 *
 * Returns nulls — and NEVER throws — when the catalogue is empty or unreadable. This runs
 * inside the public booking submit: a shadow measurement that could break a prospect's
 * booking would be a strictly worse outcome than not measuring.
 */
export async function shadowScore(input: BantInput & AnswerMap): Promise<ShadowScore> {
  try {
    const questions = await getQualificationQuestions();
    if (questions.length === 0) return { shadowAvg: null, configVersion: null, agrees: null };

    const catalogue = scoreFromAnswers(input, questions);
    const legacy = computeBant(input);
    return {
      shadowAvg: catalogue.bantAvg,
      configVersion: Math.max(...questions.map((q) => q.version)),
      agrees: bantResultsAgree(legacy, catalogue),
    };
  } catch {
    return { shadowAvg: null, configVersion: null, agrees: null };
  }
}

/**
 * How the shadow is doing — the number that decides whether Track D can flip.
 *
 * `disagreements` must be ZERO before the public form is switched to the catalogue. A
 * non-zero count is a seeding bug, not a rounding artefact: `catalogueFromIntake()` derives
 * the scores from the same tables `computeBant` reads, so they cannot legitimately differ.
 */
export const shadowAgreement = cache(async () => {
  const [total, scored, disagreements] = await Promise.all([
    prisma.bookingRequest.count(),
    prisma.bookingRequest.count({ where: { bantShadowAvg: { not: null } } }),
    prisma.bookingRequest.count({
      where: {
        bantShadowAvg: { not: null },
        bantAvg: { not: null },
        NOT: { bantShadowAvg: { equals: prisma.bookingRequest.fields.bantAvg } },
      },
    }),
  ]);
  return {
    total,
    scored,
    disagreements,
    readyToFlip: scored > 0 && disagreements === 0,
  };
});

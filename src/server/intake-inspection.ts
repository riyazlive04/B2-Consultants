import "server-only";
import { cache } from "react";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ACTIVE } from "@/lib/soft-delete";

/**
 * "What did the landing page actually send us?" - the Console report behind the inbound mapping.
 *
 * ── Why a report and not a log line ──────────────────────────────────────────────
 * The webhook routes could already print raw payloads (`LEAD_WEBHOOK_DEBUG`), which is fine for
 * a developer tailing a terminal and useless for the person who has to maintain the mapping. It
 * also prints lead PII into a log with no retention policy, and it has to be deliberately turned
 * on - so by the time anyone notices scores are missing, the deliveries that would have
 * explained it are gone.
 *
 * This reads what was already stored on each Lead at capture time, so the evidence is there
 * whether or not anyone was watching. Founder-visible, inside the app's existing RBAC, and
 * bounded to recent leads.
 */

export type UnmappedField = {
  /** The field name exactly as the sender posted it. */
  key: string;
  /** How many recent leads arrived carrying it. */
  count: number;
  /** A couple of real values, so it is obvious what the field is. */
  samples: string[];
};

export type UnresolvedAnswer = {
  /** Our question key - this one WAS matched, but its answer text was not recognised. */
  questionKey: string;
  count: number;
  /** The unrecognised answer texts. These are what to paste into the alias box. */
  values: string[];
};

export type IntakeMappingReport = {
  /** Leads captured with a payload we inspected. */
  inspected: number;
  /** ...of which produced a band score. */
  scored: number;
  /** Fields the sender posted that match no question at all. */
  unmapped: UnmappedField[];
  /**
   * The expensive failure: the question matched, the ANSWER did not. These leads have a score,
   * and it is too low - the dimension scored 0 for want of an alias. Listed first in the UI.
   */
  unresolved: UnresolvedAnswer[];
  /** When the most recent inspected capture arrived, so a stale report is obvious. */
  lastCaptureAt: string | null;
  /**
   * Scoring COVERAGE over the last 7 days - every lead captured, not just the ones that left
   * evidence behind.
   *
   * The rest of this report can only describe captures it has evidence for, which means the total
   * failure - a landing page whose fields match nothing and which therefore produces no mapped
   * answers at all - used to look identical to "no leads arrived". These two counts are read
   * straight off the Lead table, so they are true even when `inspected` is 0. When `captured` is
   * healthy and `scored` is 0, the mapping is broken, and the panel says so.
   */
  coverage7d: { captured: number; scored: number };
};

const SAMPLE_WINDOW = 200;

type Evidence = {
  mapped?: { key: string; inboundKey: string; rawValue: string; value: string | null }[];
  unresolved?: { key: string; rawValue: string }[];
  unrecognisedKeys?: string[];
  raw?: Record<string, unknown>;
};

/**
 * Aggregate the stored intake evidence across recent captures.
 *
 * Bounded to the last `SAMPLE_WINDOW` leads that carried a payload: this is a "is the mapping
 * currently right" question, and a mapping fixed three months ago should not keep being reported
 * as broken by the deliveries that prompted the fix.
 */
export const getIntakeMappingReport = cache(async (): Promise<IntakeMappingReport> => {
  const since7d = new Date(Date.now() - 7 * 86_400_000);

  const [rows, captured7d, scored7d] = await Promise.all([
    prisma.lead.findMany({
      // `Prisma.DbNull`, not `null`: on a Json column `{ not: null }` means "not the JSON value
      // null", which is a different question from "the column is set" and would miss rows.
      where: { ...ACTIVE, intakeAnswers: { not: Prisma.DbNull } },
      select: { intakeAnswers: true, bantAvg: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: SAMPLE_WINDOW,
    }),
    // Only the sources that can CARRY answers. A manually-typed lead has no landing-page payload,
    // so counting it as an unscored capture would report a permanent, unfixable shortfall.
    prisma.lead.count({
      where: { ...ACTIVE, createdAt: { gte: since7d }, source: { in: ["PABBLY", "META_LEAD_AD", "FLEXIFUNNELS", "NATIVE_FORM"] } },
    }),
    prisma.lead.count({
      where: {
        ...ACTIVE,
        createdAt: { gte: since7d },
        source: { in: ["PABBLY", "META_LEAD_AD", "FLEXIFUNNELS", "NATIVE_FORM"] },
        bantScoredAt: { not: null },
      },
    }),
  ]);

  const unmapped = new Map<string, { count: number; samples: string[] }>();
  const unresolved = new Map<string, { count: number; values: Set<string> }>();
  let scored = 0;

  for (const row of rows) {
    if (row.bantAvg != null) scored++;
    const ev = (row.intakeAnswers ?? {}) as Evidence;

    for (const key of ev.unrecognisedKeys ?? []) {
      const entry = unmapped.get(key) ?? { count: 0, samples: [] };
      entry.count++;
      const sample = ev.raw?.[key];
      // Two samples is enough to recognise a field; more turns the report into a data dump.
      if (typeof sample === "string" && sample && entry.samples.length < 2 && !entry.samples.includes(sample)) {
        entry.samples.push(sample.slice(0, 80));
      }
      unmapped.set(key, entry);
    }

    for (const u of ev.unresolved ?? []) {
      const entry = unresolved.get(u.key) ?? { count: 0, values: new Set<string>() };
      entry.count++;
      if (entry.values.size < 8) entry.values.add(u.rawValue.slice(0, 120));
      unresolved.set(u.key, entry);
    }
  }

  return {
    inspected: rows.length,
    scored,
    unmapped: [...unmapped.entries()]
      .map(([key, v]) => ({ key, count: v.count, samples: v.samples }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 25),
    unresolved: [...unresolved.entries()]
      .map(([questionKey, v]) => ({ questionKey, count: v.count, values: [...v.values] }))
      .sort((a, b) => b.count - a.count),
    lastCaptureAt: rows[0]?.createdAt.toISOString() ?? null,
    coverage7d: { captured: captured7d, scored: scored7d },
  };
});

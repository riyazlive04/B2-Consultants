import "server-only";
import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { ACTIVE } from "@/lib/soft-delete";
import { aggEurMinor, aggInrMinor } from "@/lib/money";
import {
  recogniseAll,
  endDateForDuration,
  type RecognisableAmount,
} from "@/lib/revenue-recognition";

/**
 * Revenue recognition - the query half.
 *
 * All arithmetic lives in lib/revenue-recognition.ts (pure, unit-tested). This file's only job is
 * deciding, for each income row, WHAT SERVICE PERIOD it bought - which is the part that depends
 * on the database and on judgement calls worth writing down.
 */

export type RecognitionView = {
  /** Money that arrived in the window. The existing "income" number, unchanged. */
  cashInrMinor: number;
  /** Earned in the window, whenever it arrived. */
  recognisedInrMinor: number;
  /** Unearned at the end of the window - the obligation still outstanding. */
  deferredInrMinor: number;
  /** Recognised minus cash. Negative means we collected more than we earned. */
  varianceInrMinor: number;
  /**
   * ── The same three figures in euro (not a conversion of the above) ─────────────
   * This card used to be the one number on Finance that ignored the ₹/€ toggle, under a comment
   * saying there was "no meaningful same number in euros to switch to". That was half right: you
   * cannot convert the rupee total, but you do not have to. Every income row stores BOTH an
   * `amountInrMinor` and an `amountEurMinor`, and the aggregate helpers pick a side; the
   * straight-line spread is linear per row, so running it over the euro aggregate yields the
   * euro answer directly.
   *
   * That is the rule the rest of the page follows: the toggle PICKS a stored aggregate, it never
   * converts one. Two screens that each convert at their own moment is how they come to disagree
   * about the same payment.
   */
  cashEurMinor: number;
  recognisedEurMinor: number;
  deferredEurMinor: number;
  varianceEurMinor: number;
  itemCount: number;
  /**
   * Incomes with no service period to spread over, so taken in full on their payment date.
   * Surfaced because a high count is the honest explanation for why recognised ≈ cash.
   */
  immediateCount: number;
  /** Of `immediateCount`, how many were immediate because nothing linked them to an enrollment. */
  unlinkedCount: number;
};

/**
 * The service period an income row bought.
 *
 * THREE CASES, in priority order:
 *
 *  1. Linked enrollment with a `programEndDate` - use it. This is the real, founder-entered
 *     answer and always wins.
 *  2. Linked enrollment without one - derive it from `duration` (90/120 days). LIFETIME derives
 *     null, which routes Solo to immediate recognition: there is no ongoing obligation to spread
 *     across, and inventing a notional period would be a fabrication.
 *  3. NO linked enrollment - immediate, on the income's own date.
 *
 * Case 3 is the important admission. Most historical income rows predate `enrollmentId` and have
 * no link, so we genuinely do not know what was bought or over how long. Spreading them over an
 * assumed 90 days would be inventing data to make a report look sophisticated. Recognising them
 * as cash is the honest treatment, and `unlinkedCount` is reported so the reader can see how
 * much of the number rests on it.
 */
function periodFor(row: {
  date: Date;
  enrollment: { enrollmentDate: Date; programEndDate: Date | null; duration: string } | null;
}): { startDate: Date; endDate: Date | null } {
  const e = row.enrollment;
  if (!e) return { startDate: row.date, endDate: null };

  if (e.programEndDate) return { startDate: e.enrollmentDate, endDate: e.programEndDate };

  return {
    startDate: e.enrollmentDate,
    endDate: endDateForDuration(e.enrollmentDate, e.duration as "DAYS_90" | "DAYS_120" | "LIFETIME"),
  };
}

/**
 * Recognised / deferred / cash for a date window.
 *
 * Reads incomes whose SERVICE PERIOD could overlap the window, which is a wider net than the
 * window itself: a program sold last November is still earning revenue this February, and a
 * query filtered on `date` alone would miss exactly the rows that make recognition differ from
 * cash. The lookback is bounded at 400 days - comfortably past the longest program (120 days)
 * plus a wide margin, so it cannot become an unbounded table scan as the ledger grows.
 */
export const getRecognition = cache(
  async (from: Date, to: Date): Promise<RecognitionView> => {
    const lookback = new Date(from.getTime() - 400 * 86_400_000);

    const rows = await prisma.income.findMany({
      where: { ...ACTIVE, date: { gte: lookback, lte: to } },
      select: {
        date: true,
        amountInrMinor: true,
        amountEurMinor: true,
        fxRateUsed: true,
        enrollment: {
          select: { enrollmentDate: true, programEndDate: true, duration: true },
        },
      },
    });

    let unlinkedCount = 0;
    /**
     * The service period is a property of the ROW, not of a currency, so it is resolved once and
     * the two runs differ only in which stored aggregate they spread. Doing it this way is what
     * keeps the euro answer a real aggregate rather than the rupee one divided by a rate.
     */
    const periods = rows.map((r) => {
      if (!r.enrollment) unlinkedCount++;
      return periodFor(r);
    });

    const itemsIn = (pick: "INR" | "EUR"): RecognisableAmount[] =>
      rows.map((r, i) => ({
        amountMinor: Number(
          pick === "INR"
            ? aggInrMinor(r.amountInrMinor, r.amountEurMinor, r.fxRateUsed as never)
            : aggEurMinor(r.amountInrMinor, r.amountEurMinor, r.fxRateUsed as never),
        ),
        ...periods[i],
      }));

    const totals = recogniseAll(itemsIn("INR"), { from, to });
    const eur = recogniseAll(itemsIn("EUR"), { from, to });

    return {
      cashInrMinor: totals.cashMinor,
      recognisedInrMinor: totals.recognisedMinor,
      deferredInrMinor: totals.deferredMinor,
      varianceInrMinor: totals.recognisedMinor - totals.cashMinor,
      cashEurMinor: eur.cashMinor,
      recognisedEurMinor: eur.recognisedMinor,
      deferredEurMinor: eur.deferredMinor,
      varianceEurMinor: eur.recognisedMinor - eur.cashMinor,
      // Counted off the rupee run; both runs walk the same rows, so the counts are identical.
      itemCount: totals.itemCount,
      immediateCount: totals.immediateCount,
      unlinkedCount,
    };
  },
);

/**
 * How much of the recognition picture rests on a guess.
 *
 * A number nobody can audit is worse than no number, so the Finance panel shows this beside the
 * figures: with most income unlinked, "recognised" is nearly identical to cash and the reader
 * should know that rather than infer sophistication that isn't there.
 */
export function recognitionConfidence(view: RecognitionView): {
  level: "HIGH" | "PARTIAL" | "LOW";
  note: string;
} {
  if (view.itemCount === 0) {
    return { level: "LOW", note: "No income in this period." };
  }
  const linkedPct = Math.round(((view.itemCount - view.unlinkedCount) / view.itemCount) * 100);
  if (linkedPct >= 80) {
    return { level: "HIGH", note: `${linkedPct}% of income is linked to an enrollment.` };
  }
  if (linkedPct >= 40) {
    return {
      level: "PARTIAL",
      note: `Only ${linkedPct}% of income is linked to an enrollment - the rest is recognised on its payment date.`,
    };
  }
  return {
    level: "LOW",
    note: `Just ${linkedPct}% of income is linked to an enrollment, so this is still close to cash accounting. Link payments to enrollments to sharpen it.`,
  };
}

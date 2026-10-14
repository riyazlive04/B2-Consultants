import "server-only";
import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { aggEurMinor, aggInrMinor } from "@/lib/money";
import { ACTIVE } from "@/lib/soft-delete";
import type { ResolvedPeriod } from "@/lib/period";

/**
 * TEAM PAY - what each person is owed in a normal month, and what they have actually been paid.
 *
 * ── Why this is its own read ──────────────────────────────────────────────────────
 * Paying a colleague was an ordinary expense with their name typed into `vendor`. That is free
 * text, so "Karthik", "Karthick" and "Karthick salary" were three payees to every total in the
 * app, and the question a founder actually asks - "have I paid Asma this month?" - had no answer
 * on any screen. Meanwhile the one structured pay flow, the bonus-and-commission board, used to list only
 * profiles whose `logVariant` is APPOINTMENT_SETTER or DISCOVERY_SPECIALIST: the delivery coach
 * and every tutor were outside it by construction.
 *
 * So pay is now a LINK (`Expense.teamProfileId`) rather than a spelling, and this file is the one
 * place that reads it. Everything here is derived - there is no "paid so far" column anywhere, for
 * the same reason `PendingPayment` has none: a stored total is a total that drifts.
 *
 * ── What is deliberately NOT here ─────────────────────────────────────────────────
 * Commission (computed per payment in commission-metrics), telecaller bonuses
 * (`TelecallerPayout`, which auto-posts its own TEAM_SALARIES expense) and tutor fees
 * (`TutorFee`) each have their own rules and their own screens. This does not re-compute any of
 * them; it reports the MONEY THAT LEFT, so a payout that posted an expense shows up here exactly
 * once, as the payment it was.
 */

export type TeamPayPerson = {
  profileId: string;
  name: string;
  roleTitle: string;
  status: string;
  /** Is this person still with the business? Former members are listed only if they were paid. */
  active: boolean;
  /** The agreed monthly figure, in minor units. Zero on both sides = none agreed. */
  monthlyPay: { inr: number; eur: number };
  /** Paid inside the selected period, as both aggregates (each row at its own stamped rate). */
  paidInPeriod: { inr: number; eur: number };
  /** How many payments make up `paidInPeriod` - one salary, or a salary plus a bonus. */
  payments: number;
  /** The last time this person was paid anything, ever. ISO, or null. */
  lastPaidDate: string | null;
  /**
   * Agreed monthly pay minus what has been paid in the period, in rupees, floored at zero.
   *
   * Only meaningful on a MONTH-shaped period - a quarter would owe three salaries, not one - so
   * `monthShaped` says whether the figure means anything, instead of this file guessing.
   */
  shortfallInr: number;
};

export type TeamPaymentRow = {
  id: string;
  date: string;
  profileId: string | null;
  /** Who it paid, as the row records it - the profile's name where linked, `vendor` otherwise. */
  payee: string;
  agg: { inr: number; eur: number };
  amountInrRaw: string;
  amountEurRaw: string;
  category: string;
  businessLine: string;
  isCogs: boolean;
  notes: string | null;
  /** MANUAL, or auto-posted from a telecaller payout - the table says which. */
  source: string;
  /** True when the row names a person in free text but is linked to nobody (pre-link history). */
  unlinked: boolean;
};

export type TeamPayOverview = {
  people: TeamPayPerson[];
  rows: TeamPaymentRow[];
  totals: { agreedInr: number; paidInr: number };
  /** Whether the period is one calendar month, which is what an agreed monthly figure compares to. */
  monthShaped: boolean;
  periodLabel: string;
};

/**
 * One calendar month, give or take a day - the shape an agreed monthly salary can be compared to.
 *
 * Deliberately a RANGE rather than `spec.kind === "month"`: a custom 1st-to-30th window is a month
 * for this purpose, and a quarter is not, whatever it is labelled.
 */
function isMonthShaped(period: ResolvedPeriod): boolean {
  const days = (period.endExclusive.getTime() - period.start.getTime()) / 86400000;
  return days >= 26 && days <= 32;
}

export const getTeamPayOverview = cache(
  async (period: ResolvedPeriod): Promise<TeamPayOverview> => {
    const [profiles, periodRows, lastPaid] = await Promise.all([
      prisma.teamProfile.findMany({
        orderBy: [{ status: "asc" }, { orderIndex: "asc" }, { fullName: "asc" }],
        select: {
          id: true,
          fullName: true,
          roleTitle: true,
          status: true,
          monthlyPayInrMinor: true,
          monthlyPayEurMinor: true,
        },
      }),
      /**
       * Every cost in the window that EITHER names a team member or is categorised as team pay.
       *
       * The category half is what keeps years of pre-link history visible: those rows carry a
       * typed name and no link, and dropping them would make the section look like the business
       * had never paid anybody. They are flagged `unlinked` so they can be told apart - and so
       * the fix (edit the row, pick the person) is discoverable.
       */
      prisma.expense.findMany({
        where: {
          ...ACTIVE,
          date: { gte: period.start, lt: period.endExclusive },
          OR: [{ teamProfileId: { not: null } }, { category: "TEAM_SALARIES" }],
        },
        orderBy: { date: "desc" },
      }),
      // "Last paid" is a standing fact, not a fact about the window, so it is read unfiltered.
      prisma.expense.groupBy({
        by: ["teamProfileId"],
        where: { ...ACTIVE, teamProfileId: { not: null } },
        _max: { date: true },
      }),
    ]);

    const nameOf = new Map(profiles.map((p) => [p.id, p.fullName]));
    const lastByProfile = new Map(
      lastPaid.map((g) => [g.teamProfileId as string, g._max.date?.toISOString() ?? null]),
    );

    const rows: TeamPaymentRow[] = periodRows.map((e) => ({
      id: e.id,
      date: e.date.toISOString(),
      profileId: e.teamProfileId,
      payee: (e.teamProfileId && nameOf.get(e.teamProfileId)) || e.vendor,
      agg: {
        inr: Number(aggInrMinor(e.amountInrMinor, e.amountEurMinor, e.fxRateUsed)),
        eur: Number(aggEurMinor(e.amountInrMinor, e.amountEurMinor, e.fxRateUsed)),
      },
      amountInrRaw: e.amountInrMinor.toString(),
      amountEurRaw: e.amountEurMinor.toString(),
      category: e.category,
      businessLine: e.businessLine,
      isCogs: e.isCogs,
      notes: e.notes,
      source: e.source,
      unlinked: e.teamProfileId === null,
    }));

    const monthShaped = isMonthShaped(period);

    const people: TeamPayPerson[] = profiles
      .map((p) => {
        const mine = rows.filter((r) => r.profileId === p.id);
        const paidInPeriod = mine.reduce(
          (a, r) => ({ inr: a.inr + r.agg.inr, eur: a.eur + r.agg.eur }),
          { inr: 0, eur: 0 },
        );
        const agreedInr = Number(p.monthlyPayInrMinor);
        return {
          profileId: p.id,
          name: p.fullName,
          roleTitle: p.roleTitle,
          status: p.status,
          active: p.status === "ACTIVE",
          monthlyPay: { inr: agreedInr, eur: Number(p.monthlyPayEurMinor) },
          paidInPeriod,
          payments: mine.length,
          lastPaidDate: lastByProfile.get(p.id) ?? null,
          /**
           * Zero when nothing was agreed - an unset salary is not a debt. Floored at zero so a
           * salary plus a bonus does not read as "owed -₹5,000", which is not a sentence.
           */
          shortfallInr:
            monthShaped && agreedInr > 0 ? Math.max(0, agreedInr - paidInPeriod.inr) : 0,
        };
      })
      /**
       * A former member is listed only while they still have money in the window. Dropping them
       * outright would make a month's payments not add up to its own total; keeping them forever
       * would grow the list with people nobody pays.
       */
      .filter((p) => p.active || p.payments > 0);

    return {
      people,
      rows,
      totals: {
        agreedInr: people.filter((p) => p.active).reduce((a, p) => a + p.monthlyPay.inr, 0),
        paidInr: rows.reduce((a, r) => a + r.agg.inr, 0),
      },
      monthShaped,
      periodLabel: period.label,
    };
  },
);

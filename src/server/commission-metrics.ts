import "server-only";
import { prisma } from "@/lib/prisma";
import { istMonthRange, istToday } from "@/lib/dates";
import { aggInrMinor } from "@/lib/money";
import { ACTIVE } from "@/lib/soft-delete";
import { getCommissionRulesConfig } from "./founder-config";

/**
 * Commission (client notes, "Key Metrics"): calculated per payment received this month
 * from a linked student, split across the deal team -
 *   - the FIRST call (setter, L1)     = the lead's assigned first-caller,
 *   - the DISCOVERY call (L2)          = whoever recorded the discovery outcome,
 *   - the SALES/SSS call (closer, L3)  = Enrollment.closer, set on the won deal.
 * Same person did both calls → bothCallsPct; two people → splitPct each. The closer earns
 * closerPct on top (added to their line if they also set/ran an earlier call). The closer
 * leg is opt-in: with no closer set on the enrollment the result is unchanged from the
 * original two-way split.
 *
 * The three rates are founder-editable (Founder Console → Commission), stored in
 * AppSetting("commissionRules") and read here per report via getCommissionRulesConfig.
 * DEFAULT_COMMISSION_RULES_CONFIG (config-schema) holds the shipped 5/3/4 defaults. Every
 * rate is a percentage of the payment actually received — a cut of real cash in, per payment.
 */

type Payout = { userId: string; name: string; pct: number; amountInrMinor: number };

export async function getCommissionReport() {
  const month = istMonthRange(istToday());
  const rules = await getCommissionRulesConfig();

  const incomes = await prisma.income.findMany({
    where: { ...ACTIVE, date: { gte: month.start, lt: month.end }, studentId: { not: null } },
    orderBy: { date: "desc" },
    include: {
      student: {
        select: {
          fullName: true,
          lead: {
            select: {
              assignedToId: true,
              assignedTo: { select: { name: true } },
              outcomes: {
                orderBy: { callDate: "desc" },
                take: 1,
                select: {
                  enteredById: true,
                  enteredBy: { select: { name: true } },
                  // callDate rides along so a call logged on a caller's day off can be
                  // flagged for review (§9.4).
                  callDate: true,
                  // Part 2 §7.1: whose slot this stand-in covered, if anyone's.
                  coveredForId: true,
                  coveredFor: { select: { name: true } },
                },
              },
            },
          },
        },
      },
      // L3 closer, from the enrollment this payment is against (null on legacy deals).
      enrollment: { select: { closerId: true, closer: { select: { name: true } } } },
    },
  });

  // §9.4 — leave awareness. The only leave pattern the data actually models per-DATE is the
  // standing Saturday-off flag (`worksSaturdays`); the ON_LEAVE status is a CURRENT state and
  // says nothing about the day a past call happened, so it is deliberately not used to judge
  // history. A discovery call logged on a Saturday for a caller who doesn't work Saturdays is
  // therefore surfaced for review — it usually means a stand-in covered the slot and the
  // `coveredFor` split was never recorded, which would pay the wrong person. We flag rather
  // than reassign: the engine cannot know who actually covered, only that a human should look.
  const teamProfiles = await prisma.teamProfile.findMany({
    where: { userId: { not: null } },
    select: { userId: true, worksSaturdays: true },
  });
  const worksSaturdays = new Map(teamProfiles.map((t) => [t.userId!, t.worksSaturdays]));
  // @db.Date is stored as UTC midnight of the calendar day, so the weekday is the UTC weekday —
  // reading it in IST would shift a Saturday date back into Friday. 6 = Saturday.
  const isSaturday = (d: Date) => d.getUTCDay() === 6;

  const rows = incomes.map((i) => {
    const lead = i.student?.lead ?? null;
    const first = lead?.assignedToId
      ? { userId: lead.assignedToId, name: lead.assignedTo?.name ?? "Unknown" }
      : null;
    const outcome = lead?.outcomes[0] ?? null;
    const disco = outcome?.enteredById
      ? { userId: outcome.enteredById, name: outcome.enteredBy?.name ?? "Unknown" }
      : null;
    const closer = i.enrollment?.closerId
      ? { userId: i.enrollment.closerId, name: i.enrollment.closer?.name ?? "Unknown" }
      : null;
    // The slot's owner, when a stand-in ran this discovery call in their place.
    const coveredFor = outcome?.coveredForId
      ? { userId: outcome.coveredForId, name: outcome.coveredFor?.name ?? "Unknown" }
      : null;

    const amountInrMinor = Number(aggInrMinor(i.amountInrMinor, i.amountEurMinor, i.fxRateUsed));
    const payouts: Payout[] = [];
    let rule: string;
    if (first && disco && first.userId === disco.userId) {
      rule = `Both calls - ${rules.bothCallsPct}%`;
      payouts.push({ ...first, pct: rules.bothCallsPct, amountInrMinor: Math.round(amountInrMinor * rules.bothCallsPct / 100) });
    } else if (first && disco) {
      rule = `Split - ${rules.splitPct}% each`;
      payouts.push(
        { ...first, pct: rules.splitPct, amountInrMinor: Math.round(amountInrMinor * rules.splitPct / 100) },
        { ...disco, pct: rules.splitPct, amountInrMinor: Math.round(amountInrMinor * rules.splitPct / 100) },
      );
    } else if (first || disco) {
      const who = (first ?? disco)!;
      rule = `${first ? "First call" : "Discovery"} only - ${rules.splitPct}%`;
      payouts.push({ ...who, pct: rules.splitPct, amountInrMinor: Math.round(amountInrMinor * rules.splitPct / 100) });
    } else {
      rule = "Unattributed - assign the lead / record the outcome";
    }

    // ── Substitute cover split (Part 2 §7.1) ────────────────────────────────────
    // "When someone covers another's slot, the payout is split — the substitute keeps 20%,
    // the original owner keeps 80% of THAT PORTION."
    //
    // So this DIVIDES the discovery leg; it does not add a third one. The deal still costs
    // the business exactly what it did before — the money just lands in two pockets. Applied
    // before the closer merge, because covering a discovery call says nothing about who
    // closed the sale.
    //
    // Rounding: the substitute's share is rounded and the owner takes the REMAINDER, so the
    // two halves always sum to the original leg. Rounding both independently would leak a
    // paise on odd splits and quietly break the payout reconciliation.
    if (coveredFor && disco && coveredFor.userId !== disco.userId) {
      const legIdx = payouts.findIndex((p) => p.userId === disco.userId);
      if (legIdx !== -1) {
        const leg = payouts[legIdx];
        const subAmt = Math.round((leg.amountInrMinor * rules.substitutePct) / 100);
        const ownerAmt = leg.amountInrMinor - subAmt;
        const subPct = (leg.pct * rules.substitutePct) / 100;
        const ownerPct = leg.pct - subPct;

        payouts[legIdx] = { ...leg, pct: subPct, amountInrMinor: subAmt };
        // The owner may already hold a line (e.g. they set the first call themselves) —
        // merge rather than pay them twice on two rows.
        const ownerExisting = payouts.find((p) => p.userId === coveredFor.userId);
        if (ownerExisting) {
          ownerExisting.pct += ownerPct;
          ownerExisting.amountInrMinor += ownerAmt;
        } else {
          payouts.push({ ...coveredFor, pct: ownerPct, amountInrMinor: ownerAmt });
        }
        rule = `${rule} · covered for ${coveredFor.name} — ${rules.substitutePct}/${100 - rules.substitutePct} split`;
      }
    }

    // L3 closer earns closerPct on top; merge into their existing line if they also
    // set or ran an earlier call, otherwise it's a new payout line.
    if (closer) {
      const hadPayouts = payouts.length > 0;
      const closerAmt = Math.round((amountInrMinor * rules.closerPct) / 100);
      const existing = payouts.find((p) => p.userId === closer.userId);
      if (existing) {
        existing.pct += rules.closerPct;
        existing.amountInrMinor += closerAmt;
      } else {
        payouts.push({ ...closer, pct: rules.closerPct, amountInrMinor: closerAmt });
      }
      rule = hadPayouts ? `${rule} + closer ${rules.closerPct}%` : `Closer only - ${rules.closerPct}%`;
    }

    // Day-off review flag: a discovery call credited to someone on a Saturday they don't work,
    // where no cover split was recorded. If `coveredFor` IS set, the stand-in situation is
    // already handled, so there is nothing to review.
    const offDayReview =
      disco && outcome?.callDate && !coveredFor && worksSaturdays.get(disco.userId) === false && isSaturday(outcome.callDate)
        ? `${disco.name}'s discovery call is dated a Saturday (${outcome.callDate.toISOString().slice(0, 10)}), a day off — confirm who covered it, or record the cover so the split is right.`
        : null;

    return {
      id: i.id,
      date: i.date.toISOString(),
      studentName: i.student?.fullName ?? i.studentName,
      programLevel: i.programLevel,
      amountInrMinor,
      firstCaller: first?.name ?? null,
      discoveryCaller: disco?.name ?? null,
      closerCaller: closer?.name ?? null,
      rule,
      attributed: payouts.length > 0,
      offDayReview,
      payouts: payouts.map((p) => ({ name: p.name, pct: p.pct, amountInrMinor: p.amountInrMinor })),
    };
  });

  // per-person month totals
  const totalsMap = new Map<string, { name: string; amountInrMinor: number; deals: number }>();
  for (const r of rows) {
    for (const p of r.payouts) {
      const cur = totalsMap.get(p.name) ?? { name: p.name, amountInrMinor: 0, deals: 0 };
      cur.amountInrMinor += p.amountInrMinor;
      cur.deals += 1;
      totalsMap.set(p.name, cur);
    }
  }

  return {
    month: month.start.toISOString().slice(0, 7),
    rules,
    rows,
    totals: [...totalsMap.values()].sort((a, b) => b.amountInrMinor - a.amountInrMinor),
    unattributed: rows.filter((r) => !r.attributed).length,
    offDayReviews: rows.filter((r) => r.offDayReview).length,
  };
}

export type CommissionReport = Awaited<ReturnType<typeof getCommissionReport>>;
export type CommissionRow = CommissionReport["rows"][number];

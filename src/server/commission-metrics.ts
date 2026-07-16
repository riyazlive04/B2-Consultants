import "server-only";
import { prisma } from "@/lib/prisma";
import { istMonthRange, istToday } from "@/lib/dates";
import { aggInrMinor } from "@/lib/money";
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
    where: { date: { gte: month.start, lt: month.end }, studentId: { not: null } },
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
                select: { enteredById: true, enteredBy: { select: { name: true } } },
              },
            },
          },
        },
      },
      // L3 closer, from the enrollment this payment is against (null on legacy deals).
      enrollment: { select: { closerId: true, closer: { select: { name: true } } } },
    },
  });

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
  };
}

export type CommissionReport = Awaited<ReturnType<typeof getCommissionReport>>;
export type CommissionRow = CommissionReport["rows"][number];

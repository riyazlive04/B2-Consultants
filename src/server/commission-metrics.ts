import "server-only";
import { prisma } from "@/lib/prisma";
import { istMonthRange, istToday } from "@/lib/dates";
import { aggInrMinor } from "@/lib/money";

/**
 * Commission (client notes, "Key Metrics"): calculated per payment received this month
 * from a linked student, split by who worked the deal's two calls -
 *   - the FIRST call (setter) = the lead's assigned first-caller,
 *   - the DISCOVERY call = whoever recorded the discovery outcome.
 * Same person did both → 5% to them. Two people → 3% each. Derived at read time from
 * data that already exists - nothing new to enter, retune the rates below.
 */

export const COMMISSION_RULES = {
  bothCallsPct: 5, // one person did first call AND discovery
  splitPct: 3, // first call and discovery split between two people
} as const;

type Payout = { userId: string; name: string; pct: number; amountInrMinor: number };

export async function getCommissionReport() {
  const month = istMonthRange(istToday());

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

    const amountInrMinor = Number(aggInrMinor(i.amountInrMinor, i.amountEurMinor, i.fxRateUsed));
    const payouts: Payout[] = [];
    let rule: string;
    if (first && disco && first.userId === disco.userId) {
      rule = `Both calls - ${COMMISSION_RULES.bothCallsPct}%`;
      payouts.push({ ...first, pct: COMMISSION_RULES.bothCallsPct, amountInrMinor: Math.round(amountInrMinor * COMMISSION_RULES.bothCallsPct / 100) });
    } else if (first && disco) {
      rule = `Split - ${COMMISSION_RULES.splitPct}% each`;
      payouts.push(
        { ...first, pct: COMMISSION_RULES.splitPct, amountInrMinor: Math.round(amountInrMinor * COMMISSION_RULES.splitPct / 100) },
        { ...disco, pct: COMMISSION_RULES.splitPct, amountInrMinor: Math.round(amountInrMinor * COMMISSION_RULES.splitPct / 100) },
      );
    } else if (first || disco) {
      const who = (first ?? disco)!;
      rule = `${first ? "First call" : "Discovery"} only - ${COMMISSION_RULES.splitPct}%`;
      payouts.push({ ...who, pct: COMMISSION_RULES.splitPct, amountInrMinor: Math.round(amountInrMinor * COMMISSION_RULES.splitPct / 100) });
    } else {
      rule = "Unattributed - assign the lead / record the outcome";
    }

    return {
      id: i.id,
      date: i.date.toISOString(),
      studentName: i.student?.fullName ?? i.studentName,
      programLevel: i.programLevel,
      amountInrMinor,
      firstCaller: first?.name ?? null,
      discoveryCaller: disco?.name ?? null,
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
    rules: COMMISSION_RULES,
    rows,
    totals: [...totalsMap.values()].sort((a, b) => b.amountInrMinor - a.amountInrMinor),
    unattributed: rows.filter((r) => !r.attributed).length,
  };
}

export type CommissionReport = Awaited<ReturnType<typeof getCommissionReport>>;
export type CommissionRow = CommissionReport["rows"][number];

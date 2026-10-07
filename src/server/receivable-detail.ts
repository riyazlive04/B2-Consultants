"use server";

import { prisma } from "@/lib/prisma";
import { requireSession, resolveSections, sectionAllowed } from "@/lib/rbac";
import { getSectionsConfig } from "@/server/founder-config";
import { getPendingRows, type Money2 } from "@/server/finance-metrics";
import { levelKinds, levelLabels } from "@/server/levels";
import { BUSINESS_LINE_LABELS, lineForKind, type BusinessLine } from "@/lib/business-line";
import { aggEurMinor, aggInrMinor } from "@/lib/money";
import { ACTIVE } from "@/lib/soft-delete";
import { nameKey } from "@/lib/payment-allocation";
import { PAYMENT_METHOD_LABELS, PAYMENT_TYPE_LABELS, PENDING_STATUS_LABELS } from "@/lib/labels";

/**
 * EVERYTHING ABOUT ONE RECEIVABLE, fetched when somebody clicks the person owing the money.
 *
 * ── Why this exists ───────────────────────────────────────────────────────────────
 * The age-analysis bars on Cash Health, and the two receivables tables beside them, named a
 * student and the money they owed and then stopped. A bar linked to `/finance?pending=<id>`,
 * which nothing on the Finance page has ever read - so the click left the screen you were
 * working on, landed on the Income tab, and told you nothing you did not already know. The two
 * tables did not respond to a click at all.
 *
 * What is missing at that moment is never the amount. It is WHO this is (two students here share
 * a name, which has already mis-credited a payment), WHAT they are paying for, whether a
 * schedule exists, what has actually come in, and whether the number is even real - a payment
 * typed in without naming its plan looks exactly like money that never arrived until you see the
 * student's whole payment history beside the plan's balance.
 *
 * ── Why it loads on click rather than riding with the page ───────────────────────
 * Cash Health already ships every receivable row twice (bars and tables). Attaching a payment
 * history, an enrolment and a schedule to each would grow the payload for a panel almost all of
 * which is never opened. Fetching by id on click also means what the panel shows is current,
 * not a snapshot of whenever the page happened to render.
 */

/** One payment by this student, and how it relates to the plan being looked at. */
export type ReceivablePayment = {
  id: string;
  date: string;
  amount: Money2;
  typeLabel: string;
  methodLabel: string;
  levelLabel: string;
  /**
   * `THIS_PLAN` - the entry names this receivable. `UNLINKED` - it names no plan, so the
   * allocator spreads it across this student's plans oldest-first. `OTHER_PLAN` - it settles a
   * different receivable, and is shown only so the history is not silently incomplete.
   */
  link: "THIS_PLAN" | "UNLINKED" | "OTHER_PLAN";
};

export type ReceivableDetail = {
  id: string;
  student: {
    id: string | null;
    name: string;
    code: string | null;
    phone: string | null;
    email: string | null;
  };
  course: {
    level: string;
    levelLabel: string;
    line: BusinessLine;
    lineLabel: string;
  };
  /** The enrolment this plan bills, when one is linked - the course they are actually sitting in. */
  enrollment: {
    id: string;
    batchName: string | null;
    coach: string | null;
    enrolledOn: string;
    status: string;
    milestone: string;
  } | null;
  money: {
    totalFee: Money2;
    planExtra: Money2;
    toCollect: Money2;
    collected: Money2;
    balance: Money2;
    overpaid: Money2;
    unapplied: Money2;
  };
  schedule: {
    nextDueDate: string | null;
    daysOverdue: number;
    intervalDays: number | null;
    instalments: {
      id: string;
      seq: number;
      inr: number;
      eur: number;
      dueDate: string;
      paidDate: string | null;
      status: string;
    }[];
  };
  payments: ReceivablePayment[];
  status: string;
  statusLabel: string;
  storedStatus: string;
  settled: boolean;
  overdue: boolean;
  notes: string | null;
  /** How long this debt has been on the books, regardless of when it next falls due. */
  raisedOn: string;
};

/**
 * Readable by anyone who can see either screen this panel opens on.
 *
 * Deliberately not `requireSection`, which redirects: this is called from a modal, and a
 * redirect returned to a server-action call for a panel simply fails with no explanation.
 * Returning null lets the panel say so and stay where it is.
 */
async function mayRead(): Promise<boolean> {
  const session = await requireSession();
  const sections = resolveSections(await getSectionsConfig());
  return ["cash", "finance"].some((key) => {
    const s = sections.find((x) => x.key === key);
    return !!s && sectionAllowed(s, session.role, session.overrides);
  });
}

export async function getReceivableDetail(id: string): Promise<ReceivableDetail | null> {
  if (!(await mayRead())) return null;

  // The plan's computed figures come from the ONE allocator every other screen reads, so this
  // panel can never disagree with the bar that opened it (FIN-12).
  const rows = await getPendingRows();
  const row = rows.find((r) => r.id === id);
  if (!row) return null;

  const [plan, labels, kinds] = await Promise.all([
    prisma.pendingPayment.findUnique({
      where: { id },
      select: {
        createdAt: true,
        student: { select: { id: true, code: true, phone: true, email: true } },
        enrollment: {
          select: {
            id: true,
            enrollmentDate: true,
            status: true,
            currentMilestone: true,
            assignedCoach: true,
            batch: { select: { name: true } },
          },
        },
      },
    }),
    levelLabels(),
    levelKinds(),
  ]);
  if (!plan) return null;

  /**
   * This student's payments - not only the ones that name this plan.
   *
   * Showing just the linked entries would be a half-truth on exactly the rows that need this
   * panel most: every payment recorded before `Income.pendingPaymentId` existed names no plan,
   * yet the allocator credits it to this one. Each entry says which it is, so "₹75,000 still to
   * collect" can be checked against the money that actually arrived.
   */
  const incomes = await prisma.income.findMany({
    where: {
      ...ACTIVE,
      ...(row.studentId
        ? { studentId: row.studentId }
        : { studentName: { equals: row.studentName.trim(), mode: "insensitive" as const } }),
    },
    orderBy: { date: "desc" },
    take: 100,
    select: {
      id: true, date: true, amountInrMinor: true, amountEurMinor: true, fxRateUsed: true,
      paymentType: true, paymentMethod: true, programLevel: true, pendingPaymentId: true,
      studentName: true,
    },
  });

  const line = lineForKind(kinds.get(row.programLevel));
  const levelLabel = (code: string) => labels[code] ?? code;

  return {
    id: row.id,
    student: {
      id: row.studentId,
      name: row.studentName,
      code: plan.student?.code ?? null,
      phone: row.studentPhone,
      email: plan.student?.email ?? null,
    },
    course: {
      level: row.programLevel,
      levelLabel: levelLabel(row.programLevel),
      line,
      lineLabel: BUSINESS_LINE_LABELS[line],
    },
    enrollment: plan.enrollment
      ? {
          id: plan.enrollment.id,
          batchName: plan.enrollment.batch?.name ?? null,
          coach: plan.enrollment.assignedCoach,
          enrolledOn: plan.enrollment.enrollmentDate.toISOString(),
          status: plan.enrollment.status,
          milestone: plan.enrollment.currentMilestone,
        }
      : null,
    money: {
      totalFee: row.totalFee,
      planExtra: row.planExtra,
      toCollect: row.toCollect,
      collected: row.paidSoFar,
      balance: row.balance,
      overpaid: row.overpaid,
      unapplied: row.unapplied,
    },
    schedule: {
      nextDueDate: row.nextDueDate,
      daysOverdue: row.daysOverdue,
      intervalDays: row.intervalDays,
      instalments: row.instalments,
    },
    payments: incomes
      // A name-matched read can catch a different person of the same name where no student record
      // links them; the allocator keys on the same normalised name, so this keeps the two in step
      // rather than listing money the balance never counted.
      .filter((i) => (row.studentId ? true : nameKey(i.studentName) === nameKey(row.studentName)))
      .map((i) => ({
        id: i.id,
        date: i.date.toISOString(),
        amount: {
          inr: Number(aggInrMinor(i.amountInrMinor, i.amountEurMinor, i.fxRateUsed)),
          eur: Number(aggEurMinor(i.amountInrMinor, i.amountEurMinor, i.fxRateUsed)),
        },
        typeLabel: PAYMENT_TYPE_LABELS[i.paymentType] ?? i.paymentType,
        methodLabel: PAYMENT_METHOD_LABELS[i.paymentMethod] ?? i.paymentMethod,
        levelLabel: levelLabel(i.programLevel),
        link:
          i.pendingPaymentId === row.id
            ? ("THIS_PLAN" as const)
            : i.pendingPaymentId
              ? ("OTHER_PLAN" as const)
              : ("UNLINKED" as const),
      })),
    status: row.status,
    statusLabel: PENDING_STATUS_LABELS[row.status] ?? row.status,
    storedStatus: row.storedStatus,
    settled: row.settled,
    overdue: row.overdue,
    notes: row.notes,
    raisedOn: plan.createdAt.toISOString(),
  };
}

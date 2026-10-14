"use server";

import { capabilityCheck } from "@/lib/rbac";
import { getTodayInrPerEur } from "@/lib/fx";
import { prisma } from "@/lib/prisma";
import { getActiveLevels } from "@/server/levels";
import { levelOptions } from "@/lib/levels";
import { toDateInputValue, istToday } from "@/lib/dates";
import {
  getExpenseCategoriesConfig,
  getInstalmentPlanConfig,
  getPaymentTypesConfig,
} from "@/server/founder-config";
import type {
  ExpenseCategoriesConfig,
  InstalmentPlanConfig,
  PaymentTypesConfig,
} from "@/lib/config-schema";
import { levelKinds } from "@/server/levels";
import { lineForKind, type BusinessLine } from "@/lib/business-line";
import { getPendingRows } from "@/server/finance-metrics";
import { resolveBusinessLine } from "@/server/business-line-view";
import { formatStudentCode, nextStudentNumber } from "@/lib/student-code";
import { PROGRAM_LEVEL_LABELS } from "@/lib/labels";
import { ACTIVE } from "@/lib/soft-delete";
import { nameKey, type OpenPlan } from "@/lib/income-form";

/**
 * The dependencies the quick-record forms need - the live FX rate (so the ₹↔€ preview matches
 * what the server will stamp), the student list for the income autocomplete, and the level list.
 *
 * Fetched lazily when the Record modal first opens rather than shipped with every page: the CTA
 * lives in the shell on every screen, and none of this is needed until someone actually clicks it.
 * Guarded by the same capability the write actions check, so it never leaks the roster to a viewer
 * who couldn't record anyway - it returns null instead.
 */
export type RecordFormData = {
  today: string;
  fxRate: number;
  fxStale: boolean;
  fxDate: string;
  studentOptions: { value: string; label: string; hint?: string }[];
  levelOptions: { value: string; label: string }[];
  /**
   * The founder's payment types and instalment prices. Travel WITH the form data rather than
   * being fetched per keystroke, so the quick form prices a plan as it is typed - the same rule
   * the Finance page follows, and the reason the two forms cannot disagree about what a plan costs.
   */
  paymentTypes: PaymentTypesConfig;
  instalmentPlans: InstalmentPlanConfig;
  /**
   * The founder's expense categories, for the Expense half of this modal. The Record button is
   * the door most costs come through, so a category added in the Console has to appear here too
   * - it offered a hardcoded eight while the Finance page offered the founder's list.
   */
  expenseCategories: ExpenseCategoriesConfig;
  /**
   * ── What the shared income fields need, beyond the above ────────────────────────
   * The quick form now renders the SAME fields as the Finance page (components/finance
   * /IncomeFields), which means it needs the same catalogues. Before this it had none of them,
   * which is exactly why it could not offer the business picker or the plan link: the data to
   * answer "which business sells this level" and "which receivable could this be paying off" was
   * never sent to it.
   */
  levelLines: Record<string, BusinessLine>;
  /** Every receivable still owed something, so a payment can name the plan it settles (FIN-12). */
  openPlans: OpenPlan[];
  /** Next free student number per business line, for the editable ID on a minted student. */
  nextStudentCodes: Record<string, string>;
  /** Payers known only by a name on an old payment - offered beneath the linked students. */
  payerOptions: { value: string; label: string; hint?: string }[];
  /**
   * The business line the operator last selected, or null for Combined.
   *
   * The selection is a cookie, so it is in force on every screen - including the ones that have
   * no switch of their own. The Record button lives in the shell on all of them, and opened at B2
   * regardless, which made the sticky choice look like it had been forgotten.
   */
  defaultLine: BusinessLine | null;
  /**
   * Whether this operator may mint a Student while recording. ADMIN only, matching
   * students-actions and the Finance page - and the server ignores the tick for anyone else, so
   * this only decides whether the offer appears at all.
   */
  canCreateStudent: boolean;
};

export async function getRecordFormData(): Promise<RecordFormData | null> {
  const { allowed, session } = await capabilityCheck("finance.write");
  if (!allowed) return null;

  const [
    fx, students, levels, paymentTypes, instalmentPlans, expenseCategories, kinds, pendings, viewLine,
  ] =
    await Promise.all([
      getTodayInrPerEur(),
      prisma.student.findMany({ orderBy: { fullName: "asc" }, select: { id: true, fullName: true, code: true } }),
      getActiveLevels(),
      getPaymentTypesConfig(),
      getInstalmentPlanConfig(),
      getExpenseCategoriesConfig(),
      levelKinds(),
      getPendingRows(),
      resolveBusinessLine(undefined),
    ]);

  const lineOfLevel = (code: string) => lineForKind(kinds.get(code));
  // The next free number in each series, off the roster already loaded - same as the Finance
  // page does it, and for the same reason: a round trip for a suggestion is a round trip wasted.
  const issued = students.map((s) => s.code);
  const codes = {
    B2: formatStudentCode(nextStudentNumber(issued, "B2"), "B2"),
    GERMAN_NOTE: formatStudentCode(nextStudentNumber(issued, "GERMAN_NOTE"), "GERMAN_NOTE"),
  };
  const levelLabel = (code: string) => PROGRAM_LEVEL_LABELS[code] ?? code;

  return {
    today: toDateInputValue(istToday()),
    fxRate: Number(fx.rate),
    fxStale: fx.stale,
    fxDate: fx.date.toISOString(),
    // Code rides as a searchable `hint`, never written into the name field (§6.1 / ComboBox).
    studentOptions: students.map((s) => ({ value: s.id, label: s.fullName, hint: s.code ?? undefined })),
    levelOptions: levelOptions(levels),
    paymentTypes,
    instalmentPlans,
    expenseCategories,
    levelLines: Object.fromEntries(levelOptions(levels).map((o) => [o.value, lineOfLevel(o.value)])),
    /**
     * Only the plans that still owe something: a settled receivable is not something a new
     * payment can pay off, and offering it would invite exactly the overpayment the balance
     * maths now has to flag.
     */
    openPlans: pendings
      .filter((p) => p.balance.inr > 0 || p.balance.eur > 0)
      .map((p) => ({
        id: p.id,
        studentId: p.studentId,
        studentName: p.studentName,
        programLevel: p.programLevel,
        levelLabel: levelLabel(p.programLevel),
        balanceInr: p.balance.inr,
        nextDueDate: p.nextDueDate,
      })),
    nextStudentCodes: codes,
    // "ALL" is a view of both books, so it seeds nothing - the level decides, as it always has.
    defaultLine: viewLine === "ALL" ? null : viewLine,
    canCreateStudent: session.role === "ADMIN",
    /**
     * Names that have received a payment but have no Student row. Offered under the linked
     * students so a repeat payer can be found by name, exactly as on the Finance page.
     */
    payerOptions: [
      ...new Map(
        (await prisma.income.findMany({
          where: { ...ACTIVE, studentId: null },
          select: { studentName: true },
          distinct: ["studentName"],
          take: 200,
        }))
          .map((i) => i.studentName.trim())
          .filter((n) => n && !students.some((s: { fullName: string }) => nameKey(s.fullName) === nameKey(n)))
          .map((n) => [nameKey(n), n] as const),
      ).values(),
    ]
      .sort((a, b) => a.localeCompare(b))
      .map((label) => ({ value: "", label, hint: "no record yet" })),
  };
}

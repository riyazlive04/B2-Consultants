import "server-only";
import { prisma } from "@/lib/prisma";
import { agreementDataSchema, defaultInstalments, type AgreementData } from "@/lib/agreement";

/**
 * Read side of the agreements section.
 *
 * ONE RULE THAT MATTERS: `pdfBytes` is a `bytea` that can run to a few hundred KB. Prisma will
 * happily stream every one of them into memory if you `findMany` without a `select`. Every query
 * here is explicit, and the bytes are fetched only by the download route, one row at a time.
 */

/** §7.1 of the master. A starting point for the form, not a constant of the universe. */
export const DEFAULT_TOTAL_INR_MINOR = "6999900"; // 69,999 INR

const LIST_SELECT = {
  id: true,
  documentNo: true,
  status: true,
  templateVersion: true,
  data: true,
  createdAt: true,
  issuedAt: true,
  signedAt: true,
  expiresAt: true,
  pdfSha256: true,
  student: { select: { id: true, fullName: true } },
  lead: { select: { id: true, name: true } },
  issuedBy: { select: { id: true, name: true } },
} as const;

export type AgreementRow = Awaited<ReturnType<typeof listAgreements>>[number];

export async function listAgreements() {
  const rows = await prisma.agreement.findMany({
    select: LIST_SELECT,
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return rows.map((r) => ({
    ...r,
    // `data` is Json to Prisma; the form and the table both want the typed shape.
    parsed: agreementDataSchema.safeParse(r.data),
  }));
}

export async function getAgreementDetail(id: string) {
  const row = await prisma.agreement.findUnique({
    where: { id },
    select: {
      ...LIST_SELECT,
      dataSha256: true,
      pdfSize: true,
      founderSignedAt: true,
      founderDevice: true,
      signerDevice: true,
      declinedAt: true,
      declineReason: true,
      voidedAt: true,
      events: { orderBy: { createdAt: "asc" } },
      whatsappMessages: {
        select: { id: true, kind: true, status: true, error: true, createdAt: true },
        orderBy: { createdAt: "desc" },
        take: 20,
      },
    },
  });
  if (!row) return null;
  return { ...row, parsed: agreementDataSchema.safeParse(row.data) };
}

export type AgreementCounts = { draft: number; awaiting: number; signed: number; other: number };

export async function getAgreementCounts(): Promise<AgreementCounts> {
  const grouped = await prisma.agreement.groupBy({ by: ["status"], _count: { _all: true } });
  const at = (s: string) => grouped.find((g) => g.status === s)?._count._all ?? 0;
  return {
    draft: at("DRAFT"),
    awaiting: at("SENT") + at("VIEWED"),
    signed: at("SIGNED"),
    other: at("DECLINED") + at("VOIDED") + at("EXPIRED"),
  };
}

// ───────────────────────────── Prefill ─────────────────────────────

export type AgreementPrefill = {
  leadId: string | null;
  studentId: string | null;
  data: AgreementData;
  /** Explained to the founder above the form, so they know what to double-check. */
  notes: string[];
};

const EMPTY: AgreementData = {
  student: { fullName: "", address: "", phone: "", email: "" },
  batch: { number: "", startDate: "" },
  payment: defaultInstalments(DEFAULT_TOTAL_INR_MINOR),
};

/**
 * Open the form on what the CRM already knows. Everything here is a *suggestion* — once issued,
 * the agreement's `data` is frozen and never reads these rows again.
 *
 * The two fields the schema has no home for (postal address, batch) always come up blank, because
 * guessing them on a contract would be worse than asking.
 */
export async function getAgreementPrefill(opts: {
  leadId?: string | null;
  studentId?: string | null;
}): Promise<AgreementPrefill> {
  const notes: string[] = [];
  const data: AgreementData = structuredClone(EMPTY);

  if (opts.studentId) {
    const student = await prisma.student.findUnique({
      where: { id: opts.studentId },
      select: {
        id: true,
        fullName: true,
        email: true,
        phone: true,
        leadId: true,
        pendingPayments: {
          where: { status: { in: ["ACTIVE", "OVERDUE"] } },
          select: { totalFeeInrMinor: true },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    });
    if (student) {
      data.student.fullName = student.fullName;
      data.student.email = student.email ?? "";
      data.student.phone = student.phone ?? "";
      const fee = student.pendingPayments[0]?.totalFeeInrMinor;
      if (fee && fee > BigInt(0)) {
        data.payment = defaultInstalments(fee.toString());
        notes.push("Fee taken from this student's pending payment.");
      }
      return { leadId: student.leadId, studentId: student.id, data, notes };
    }
  }

  if (opts.leadId) {
    const lead = await prisma.lead.findUnique({
      where: { id: opts.leadId },
      select: { id: true, name: true, email: true, phone: true, paymentPlan: true, stage: true },
    });
    if (lead) {
      data.student.fullName = lead.name;
      data.student.email = lead.email ?? "";
      // Blank, not null, when the lead has no number (nullable since the Synamate import) — this
      // is a form suggestion, and `agreement.ts` requires min(5) before it can ever be issued.
      data.student.phone = lead.phone ?? "";
      if (lead.paymentPlan === "FULL_PAY") {
        data.payment = {
          option: "FULL",
          totalInrMinor: DEFAULT_TOTAL_INR_MINOR,
          dueMilestone: "Before commencement of Week 1",
        };
      }
      if (lead.stage !== "WON") {
        notes.push(`This lead is at stage "${lead.stage}", not WON. Check before issuing.`);
      }
      return { leadId: lead.id, studentId: null, data, notes };
    }
  }

  return { leadId: null, studentId: null, data, notes };
}

/** Leads the founder is likely to be drawing up an agreement for. */
export async function getAgreementCandidates() {
  const [leads, students] = await Promise.all([
    prisma.lead.findMany({
      where: { stage: "WON" },
      select: { id: true, name: true, phone: true },
      orderBy: { updatedAt: "desc" },
      take: 50,
    }),
    prisma.student.findMany({
      select: { id: true, fullName: true, phone: true },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
  ]);
  return { leads, students };
}

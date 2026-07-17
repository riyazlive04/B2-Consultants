import "server-only";
import { prisma } from "@/lib/prisma";
import {
  agreementDataSchema,
  defaultInstalments,
  effectiveAgreementStatus,
  type AgreementData,
} from "@/lib/agreement";

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
  // A groupBy on the STORED status cannot see expiry — it would count a fortnight-dead link as
  // "awaiting signature" forever. Agreements are low-volume and this selects two thin columns
  // (never pdfBytes), so read and derive: the tiles then agree with the rows.
  const rows = await prisma.agreement.findMany({ select: { status: true, expiresAt: true } });
  const counts: AgreementCounts = { draft: 0, awaiting: 0, signed: 0, other: 0 };
  for (const r of rows) {
    switch (effectiveAgreementStatus(r)) {
      case "DRAFT":
        counts.draft++;
        break;
      case "SENT":
      case "VIEWED":
        counts.awaiting++;
        break;
      case "SIGNED":
        counts.signed++;
        break;
      default:
        counts.other++; // DECLINED / VOIDED / EXPIRED
    }
  }
  return counts;
}

// ───────────────────────────── Prefill ─────────────────────────────

export type AgreementPrefill = {
  leadId: string | null;
  studentId: string | null;
  data: AgreementData;
  /** Explained to the founder above the form, so they know what to double-check. */
  notes: string[];
  /**
   * Fields that still genuinely need a human. Drives the form's "needs you" markers and the
   * one-click send's decision to route to the form instead of issuing blind.
   */
  missing: string[];
  /** Field keys we filled from the CRM, so the form can mark them as auto-filled. */
  filled: string[];
};

const EMPTY: AgreementData = {
  student: { fullName: "", address: "", phone: "", email: "" },
  batch: { number: "", startDate: "" },
  payment: defaultInstalments(DEFAULT_TOTAL_INR_MINOR),
};

/**
 * Open the form on everything the CRM already knows. Every value here is a *suggestion* — once
 * issued, the agreement's `data` is frozen and never reads these rows again.
 *
 * Postal address and batch have no column anywhere in the schema (they are terms of *this*
 * document, which is why they live in `AgreementData`). But they DO exist in this client's
 * previous agreement — so a re-issue lifts them from there rather than asking a second time. A
 * brand-new client's first agreement still has to be typed, and says so.
 */
export async function getAgreementPrefill(opts: {
  leadId?: string | null;
  studentId?: string | null;
}): Promise<AgreementPrefill> {
  const notes: string[] = [];
  const filled: string[] = [];
  const data: AgreementData = structuredClone(EMPTY);
  let leadId: string | null = null;
  let studentId: string | null = null;

  const mark = (key: string, value: string) => {
    if (value) filled.push(key);
  };

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
        enrollments: {
          select: { enrollmentDate: true, programLevel: true },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    });
    if (student) {
      studentId = student.id;
      leadId = student.leadId;
      data.student.fullName = student.fullName;
      data.student.email = student.email ?? "";
      data.student.phone = student.phone ?? "";
      mark("fullName", data.student.fullName);
      mark("email", data.student.email);
      mark("phone", data.student.phone);

      const fee = student.pendingPayments[0]?.totalFeeInrMinor;
      if (fee && fee > BigInt(0)) {
        data.payment = defaultInstalments(fee.toString());
        filled.push("payment");
        notes.push("Fee taken from this student's pending payment.");
      }
      const enrolled = student.enrollments[0];
      if (enrolled?.enrollmentDate) {
        data.batch.startDate = toIsoDate(enrolled.enrollmentDate);
        filled.push("batchStartDate");
      }
    }
  } else if (opts.leadId) {
    const lead = await prisma.lead.findUnique({
      where: { id: opts.leadId },
      select: { id: true, name: true, email: true, phone: true, paymentPlan: true, stage: true },
    });
    if (lead) {
      leadId = lead.id;
      data.student.fullName = lead.name;
      data.student.email = lead.email ?? "";
      // Blank, not null, when the lead has no number (nullable since the Synamate import) — this
      // is a form suggestion, and `agreement.ts` requires min(5) before it can ever be issued.
      data.student.phone = lead.phone ?? "";
      mark("fullName", data.student.fullName);
      mark("email", data.student.email);
      mark("phone", data.student.phone);

      if (lead.paymentPlan === "FULL_PAY") {
        data.payment = {
          option: "FULL",
          totalInrMinor: DEFAULT_TOTAL_INR_MINOR,
          dueMilestone: "Before commencement of Week 1",
        };
        filled.push("payment");
        notes.push("Full-pay plan taken from the lead's payment plan.");
      }
    }
  }

  // The two fields nothing else in the schema holds — lift them from this client's last agreement.
  if (leadId || studentId) {
    const prior = await prisma.agreement.findFirst({
      where: leadId ? { OR: [{ leadId }, { student: { leadId } }] } : { studentId: studentId! },
      orderBy: { createdAt: "desc" },
      select: { documentNo: true, data: true },
    });
    const parsed = prior ? agreementDataSchema.safeParse(prior.data) : null;
    if (prior && parsed?.success) {
      let lifted = false;
      if (!data.student.address && parsed.data.student.address) {
        data.student.address = parsed.data.student.address;
        filled.push("address");
        lifted = true;
      }
      if (!data.batch.number && parsed.data.batch.number) {
        data.batch.number = parsed.data.batch.number;
        filled.push("batchNumber");
        lifted = true;
      }
      if (!data.batch.startDate && parsed.data.batch.startDate) {
        data.batch.startDate = parsed.data.batch.startDate;
        filled.push("batchStartDate");
        lifted = true;
      }
      if (lifted) {
        notes.push(
          `Address and batch carried over from ${prior.documentNo} — check they are still current before issuing.`,
        );
      }
    }
  }

  const missing: string[] = [];
  if (!data.student.fullName) missing.push("Full name");
  if (!data.student.phone) missing.push("WhatsApp number");
  if (!data.student.address) missing.push("Postal address");
  if (!data.batch.number) missing.push("Batch");
  if (!data.batch.startDate) missing.push("Programme start date");

  return { leadId, studentId, data, notes, missing, filled };
}

/** A `@db.Date` column back to the `yyyy-mm-dd` the agreement schema wants. */
function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// `getAgreementCandidates` (WON-only leads + every student, rendered as a flat chip wall) was
// replaced by `getAgreementCandidatesGrouped` in server/agreement-state.ts, which annotates every
// candidate with its derived workflow state so the picker can group and rank them.

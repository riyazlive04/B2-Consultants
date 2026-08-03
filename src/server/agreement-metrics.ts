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
  // `code` rides along so the table can show "B2-0042" beside the name (Error Log I1).
  // An agreement is the document that binds a fee to a person; getting the person wrong here
  // is the most expensive version of the duplicate-name problem, not the cheapest.
  student: { select: { id: true, fullName: true, code: true } },
  // The lead's own students, so a code can be resolved even when the agreement was raised
  // against the lead and never directly linked to a Student (Error Log I1). A lead may have
  // MANY students, so this is only usable when there is exactly one — see `resolveStudentCode`.
  lead: { select: { id: true, name: true, students: { select: { id: true, code: true } } } },
  issuedBy: { select: { id: true, name: true } },
} as const;

/**
 * The student code to show for an agreement.
 *
 * Direct link wins. Otherwise fall back to the lead's student — but ONLY when the lead has
 * exactly one, because showing the wrong "Anna Smith"'s code on a signed contract is worse
 * than showing none. Zero or many → no code, and the name stands alone as it did before.
 */
function resolveStudentCode(row: {
  student: { code: string | null } | null;
  lead: { students: { code: string | null }[] } | null;
}): string | null {
  if (row.student?.code) return row.student.code;
  const leadStudents = row.lead?.students ?? [];
  return leadStudents.length === 1 ? leadStudents[0].code : null;
}

export type AgreementRow = Awaited<ReturnType<typeof listAgreements>>[number];

export async function listAgreements() {
  const rows = await prisma.agreement.findMany({
    select: LIST_SELECT,
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return rows.map((r) => ({
    ...r,
    studentCode: resolveStudentCode(r),
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

export type AgreementCounts = {
  draft: number;
  awaiting: number;
  signed: number;
  other: number;
  draftLinked: number; // draft already has a student attached, not just a lead
  draftUnlinked: number;
  awaitingSent: number; // sent, not yet opened
  awaitingViewed: number; // student has opened the link at least once
  signedRecent: number; // signed in the last 30 days
  signedEarlier: number;
  otherDeclined: number;
  otherVoided: number;
  otherExpired: number;
};

export async function getAgreementCounts(): Promise<AgreementCounts> {
  // A groupBy on the STORED status cannot see expiry — it would count a fortnight-dead link as
  // "awaiting signature" forever. Agreements are low-volume and this selects a few thin columns
  // (never pdfBytes), so read and derive: the tiles then agree with the rows.
  const rows = await prisma.agreement.findMany({
    select: { status: true, expiresAt: true, studentId: true, signedAt: true },
  });
  const counts: AgreementCounts = {
    draft: 0,
    awaiting: 0,
    signed: 0,
    other: 0,
    draftLinked: 0,
    draftUnlinked: 0,
    awaitingSent: 0,
    awaitingViewed: 0,
    signedRecent: 0,
    signedEarlier: 0,
    otherDeclined: 0,
    otherVoided: 0,
    otherExpired: 0,
  };
  const recentCutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  for (const r of rows) {
    const status = effectiveAgreementStatus(r);
    switch (status) {
      case "DRAFT":
        counts.draft++;
        if (r.studentId) counts.draftLinked++;
        else counts.draftUnlinked++;
        break;
      case "SENT":
      case "VIEWED":
        counts.awaiting++;
        if (status === "SENT") counts.awaitingSent++;
        else counts.awaitingViewed++;
        break;
      case "SIGNED":
        counts.signed++;
        if (r.signedAt && r.signedAt.getTime() >= recentCutoff) counts.signedRecent++;
        else counts.signedEarlier++;
        break;
      default: // DECLINED / VOIDED / EXPIRED
        counts.other++;
        if (status === "DECLINED") counts.otherDeclined++;
        else if (status === "VOIDED") counts.otherVoided++;
        else counts.otherExpired++;
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

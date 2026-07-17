import "server-only";
import type { WhatsAppStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { LEAD_STAGE_LABELS, PROGRAM_LEVEL_LABELS } from "@/lib/labels";
import {
  agreementGroup,
  deriveAgreementState,
  eligibleStages,
  type AgreementGroup,
  type AgreementState,
  type AgreementSummary,
  type AgreementWorkflowConfig,
  type LatestAgreement,
} from "@/lib/agreement-state";
import { getAgreementPrefill } from "./agreement-metrics";
import { getAgreementWorkflow } from "./founder-config";

/**
 * Server side of the derived agreement state: turn prisma rows into the pure function's input.
 *
 * Everything here is BATCHED. The picker asks for the state of a few hundred clients at once, so a
 * per-candidate query would be an N+1 the founder feels on every page load. Two findMany calls and
 * one whatsapp lookup cover the whole list.
 *
 * NEVER select `pdfBytes` here — see the header of agreement-metrics.ts.
 */

const AGR_SELECT = {
  id: true,
  documentNo: true,
  status: true,
  expiresAt: true,
  signedAt: true,
  createdAt: true,
} as const;

type AgreementRow = {
  id: string;
  documentNo: string;
  status: string;
  expiresAt: Date | null;
  signedAt: Date | null;
  createdAt: Date;
};

/**
 * Which of a client's agreements IS the client's agreement right now.
 *
 * A signed one always wins: `cloneAgreement` deliberately does NOT void a SIGNED row (it is
 * superseded, and both survive), so "latest by createdAt" alone would let a fresh revision draft
 * hide an executed contract. Otherwise it's the newest row that hasn't been withdrawn — voiding is
 * exactly how the founder says "that one no longer counts".
 */
export function pickCurrentAgreement(rows: AgreementRow[]): LatestAgreement {
  const byNewest = [...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const signed = byNewest.find((r) => r.status === "SIGNED");
  const live = signed ?? byNewest.find((r) => r.status !== "VOIDED" && r.status !== "DECLINED");
  if (!live) return null;
  return {
    id: live.id,
    documentNo: live.documentNo,
    status: live.status,
    expiresAt: live.expiresAt,
    signedAt: live.signedAt,
  };
}

/**
 * Statuses that mean a message genuinely left the building. SKIPPED (WATI off, no template, opted
 * out) and FAILED must never count — the whole point of COMPLETED is that the student actually has
 * their copy, so a row proving we *tried* is not delivery. Mirrors `SUCCESSFUL` in whatsapp.ts.
 */
const DELIVERED_WA: WhatsAppStatus[] = ["QUEUED", "SENT", "DELIVERED", "READ", "REPLIED"];

/** Which of these agreements have had their countersigned copy actually delivered. */
export async function getCopyDeliveredSet(agreementIds: string[]): Promise<Set<string>> {
  if (agreementIds.length === 0) return new Set();
  const rows = await prisma.whatsAppMessage.findMany({
    where: {
      agreementId: { in: agreementIds },
      kind: "AGREEMENT_COPY",
      direction: "OUTBOUND",
      status: { in: DELIVERED_WA },
    },
    select: { agreementId: true },
  });
  return new Set(rows.map((r) => r.agreementId!).filter(Boolean));
}

export type ClientAgreementInfo = {
  state: AgreementState;
  agreement: LatestAgreement;
  config: AgreementWorkflowConfig;
};

/**
 * The agreement state of ONE client — the contact profile's card and the one-click action both
 * read this. Accepts either side of the link: agreements hang off a Lead, a Student, or both.
 */
export async function getClientAgreementState(opts: {
  leadId?: string | null;
  studentId?: string | null;
}): Promise<ClientAgreementInfo> {
  const config = await getAgreementWorkflow();
  const empty: ClientAgreementInfo = { state: "NOT_REQUIRED", agreement: null, config };
  if (!opts.leadId && !opts.studentId) return empty;

  // A lead's agreement may have been drafted against the Student row it later became, so look
  // down both sides of the link rather than only the id we were handed.
  const where = opts.leadId
    ? { OR: [{ leadId: opts.leadId }, { student: { leadId: opts.leadId } }] }
    : { studentId: opts.studentId! };

  const [rows, leadStage] = await Promise.all([
    prisma.agreement.findMany({ where, select: AGR_SELECT, orderBy: { createdAt: "desc" } }),
    resolveLeadStage(opts),
  ]);

  const agreement = pickCurrentAgreement(rows);
  const delivered = agreement ? await getCopyDeliveredSet([agreement.id]) : new Set<string>();
  const state = deriveAgreementState(
    { agreement, copyDelivered: agreement ? delivered.has(agreement.id) : false, leadStage },
    config,
  );
  return { state, agreement, config };
}

async function resolveLeadStage(opts: { leadId?: string | null; studentId?: string | null }) {
  if (opts.leadId) {
    const lead = await prisma.lead.findUnique({ where: { id: opts.leadId }, select: { stage: true } });
    return lead?.stage ?? null;
  }
  const student = await prisma.student.findUnique({
    where: { id: opts.studentId! },
    select: { lead: { select: { stage: true } } },
  });
  return student?.lead?.stage ?? null;
}

/**
 * The client-safe projection of a client's agreement position — what the task card renders.
 *
 * `missing` is computed from the same prefill the form would open on, so the card can promise a
 * one-click send only when the CRM genuinely has every field a contract needs.
 */
export async function getAgreementSummaryFor(opts: {
  leadId?: string | null;
  studentId?: string | null;
}): Promise<AgreementSummary> {
  const [info, prefill] = await Promise.all([
    getClientAgreementState(opts),
    getAgreementPrefill({ leadId: opts.leadId ?? null, studentId: opts.studentId ?? null }),
  ]);
  return {
    state: info.state,
    config: info.config,
    agreementId: info.agreement?.id ?? null,
    documentNo: info.agreement?.documentNo ?? null,
    leadId: prefill.leadId ?? opts.leadId ?? null,
    studentId: prefill.studentId ?? opts.studentId ?? null,
    missing: prefill.missing,
  };
}

// ───────────────────────────── Dashboard tasks ─────────────────────────────

export type AgreementTaskCounts = {
  /** Eligible clients with nothing drafted yet, plus drafts sitting uncountersigned. */
  readyToSend: number;
  awaitingSignature: number;
  expired: number;
  /** Signed but the countersigned copy never reached the student. Wired in Phase D. */
  signedNoCopy: number;
};

/**
 * The three numbers the founder's dashboard asks for. Deliberately COUNTS, not rows: this runs
 * inside `computeNotifications`, which the bell re-polls every couple of minutes.
 */
export async function getAgreementTaskCounts(): Promise<AgreementTaskCounts> {
  const config = await getAgreementWorkflow();
  const now = new Date();
  const eligible = [...eligibleStages(config.readiness)];

  const [drafts, readyLeads, awaitingSignature, expired, signedNoCopy] = await Promise.all([
    prisma.agreement.count({ where: { status: "DRAFT" } }),
    // Eligible leads that have never had an agreement that still counts. A withdrawn (VOIDED /
    // DECLINED) one leaves the client back in "ready" — which is exactly what the founder wants
    // to be reminded of.
    prisma.lead.count({
      where: {
        stage: { in: eligible as unknown as never[] },
        agreements: { none: { status: { notIn: ["VOIDED", "DECLINED"] } } },
      },
    }),
    prisma.agreement.count({
      where: {
        status: { in: ["SENT", "VIEWED"] },
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
    }),
    prisma.agreement.count({
      where: { status: { in: ["SENT", "VIEWED"] }, expiresAt: { lte: now } },
    }),
    // Signed, but the copy never actually reached them — the gap between SIGNED and COMPLETED.
    prisma.agreement.count({
      where: {
        status: "SIGNED",
        whatsappMessages: {
          none: { kind: "AGREEMENT_COPY", direction: "OUTBOUND", status: { in: DELIVERED_WA } },
        },
      },
    }),
  ]);

  return { readyToSend: drafts + readyLeads, awaitingSignature, expired, signedNoCopy };
}

// ───────────────────────────── The picker's candidate list ─────────────────────────────

/** One row in the searchable picker. Serializable — it crosses to a client component. */
export type AgreementCandidate = {
  kind: "lead" | "student";
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  /** Pipeline stage / programme + coach — the context that makes two same-named rows distinguishable. */
  subtitle: string;
  state: AgreementState;
  group: AgreementGroup;
};

// An agreement only makes sense once a deal is real. Everything earlier is still noise in a picker
// whose whole job is to be scannable — but the founder can still reach those leads via search,
// because we keep WON/LOST-adjacent stages out rather than filtering to a single stage.
const CANDIDATE_STAGES = [
  "PROPOSAL_SENT",
  "SENT_TO_WORKSHOP",
  "WORKSHOP_FOLLOWUP",
  "OFFER_FOLLOWUP",
  "DEPOSIT_FOLLOWUP",
  "DEPOSIT_PAID",
  "WON",
] as const;

/**
 * Every client the founder might draw up an agreement for, annotated with the state that decides
 * which group they land in. Replaces `getAgreementCandidates` (WON-only chips + every student).
 */
export async function getAgreementCandidatesGrouped(): Promise<AgreementCandidate[]> {
  const config = await getAgreementWorkflow();

  const [leads, students] = await Promise.all([
    prisma.lead.findMany({
      where: { stage: { in: CANDIDATE_STAGES as unknown as never[] } },
      select: {
        id: true,
        name: true,
        phone: true,
        email: true,
        stage: true,
        wonLevel: true,
        agreements: { select: AGR_SELECT },
      },
      orderBy: { updatedAt: "desc" },
      take: 300,
    }),
    prisma.student.findMany({
      select: {
        id: true,
        fullName: true,
        phone: true,
        email: true,
        lead: { select: { stage: true } },
        agreements: { select: AGR_SELECT },
        enrollments: {
          select: { programLevel: true, assignedCoach: true },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
      orderBy: { createdAt: "desc" },
      take: 300,
    }),
  ]);

  // One whatsapp lookup for every candidate's current agreement, instead of one per row.
  const currentByLead = new Map(leads.map((l) => [l.id, pickCurrentAgreement(l.agreements)]));
  const currentByStudent = new Map(students.map((s) => [s.id, pickCurrentAgreement(s.agreements)]));
  const allIds = [...currentByLead.values(), ...currentByStudent.values()]
    .filter((a): a is NonNullable<LatestAgreement> => !!a)
    .map((a) => a.id);
  const delivered = await getCopyDeliveredSet(allIds);

  const build = (
    kind: "lead" | "student",
    id: string,
    name: string,
    phone: string | null,
    email: string | null,
    subtitle: string,
    agreement: LatestAgreement,
    leadStage: string | null,
  ): AgreementCandidate => {
    const state = deriveAgreementState(
      { agreement, copyDelivered: agreement ? delivered.has(agreement.id) : false, leadStage },
      config,
    );
    return { kind, id, name, phone, email, subtitle, state, group: agreementGroup(state) };
  };

  const leadRows = leads.map((l) =>
    build(
      "lead",
      l.id,
      l.name,
      l.phone,
      l.email,
      [LEAD_STAGE_LABELS[l.stage] ?? l.stage, l.wonLevel ? PROGRAM_LEVEL_LABELS[l.wonLevel] : null]
        .filter(Boolean)
        .join(" · "),
      currentByLead.get(l.id) ?? null,
      l.stage,
    ),
  );

  const studentRows = students.map((s) => {
    const e = s.enrollments[0];
    return build(
      "student",
      s.id,
      s.fullName,
      s.phone,
      s.email,
      ["Student", e ? PROGRAM_LEVEL_LABELS[e.programLevel] : null, e?.assignedCoach]
        .filter(Boolean)
        .join(" · "),
      currentByStudent.get(s.id) ?? null,
      s.lead?.stage ?? null,
    );
  });

  return [...leadRows, ...studentRows];
}

import "server-only";
import type { OutreachPhase, OutreachStep, QualifiedVerdict } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { formatDateTimeInZone } from "@/lib/format";
import { reactionState, isActionable, type JourneyState } from "@/lib/outreach-engine";
import { STEP_BY_KEY, CALL_SCRIPTS } from "@/lib/outreach-sop";
import { readOutreachConfig, projectJourney, renderStep, type JourneyRow } from "./outreach";

/**
 * Outreach SOP — reads for the queue and the Key Metrics sheet.
 *
 * Two surfaces, one source: the queue is "what do I do next", Key Metrics is
 * "Key Metrics Sales B2_2026.xlsx" as the SOP knows it. Both project the same journey rows.
 */

const INCLUDE = {
  steps: true,
  lead: { select: { id: true, name: true, phone: true, email: true } },
  booking: { include: { slot: { select: { startsAt: true } } } },
  respTouchpoint: { select: { id: true, name: true } },
  respDisco: { select: { id: true, name: true } },
} as const;

// ─────────────────────────────── The due queue ───────────────────────────────

export type QueueStep = {
  stepLogId: string;
  step: OutreachStep;
  sopStep: string;
  label: string;
  channel: "WHATSAPP" | "CALL" | "SYSTEM";
  dueAt: string;
  /** Actionable right now (materialised, DUE, and past its due time). */
  actionable: boolean;
  /** Rendered message, variables resolved. Null for CALL/SYSTEM steps. */
  body: string | null;
  /** SOP variables that could not be resolved — blocks the send until fixed. */
  unresolved: string[];
  script: (typeof CALL_SCRIPTS)[OutreachStep] | null;
};

export type QueueRow = {
  journeyId: string;
  leadId: string;
  name: string;
  /** Null since the Synamate import. Shown on the card only — the ladder's own sends go through
   *  sendWhatsApp(), which refuses a missing number and logs a SKIPPED row. */
  phone: string | null;
  email: string | null;
  phase: OutreachPhase;
  qualified: QualifiedVerdict | null;
  redFlag: boolean;
  redFlagReason: string | null;
  zoomLink: string | null;
  contactedAt: string | null;
  /** Step 2's live SLA clock. Null once the branch is settled and no longer interesting. */
  sla: {
    branch: "FAST" | "SLOW" | "PENDING";
    remainingMs: number;
    breached: boolean;
    approaching: boolean;
  } | null;
  discoAtIst: string | null;
  discoAtCet: string | null;
  sssAtIst: string | null;
  whatsappSent: boolean;
  whatsappConfirmed: boolean;
  salesCallConfirmed: boolean;
  highlyQualified: boolean | null;
  bantAvg: number | null;
  steps: QueueStep[];
  /** The single next thing to do. Null when the journey is waiting on someone else. */
  next: QueueStep | null;
};

function toQueueRow(row: JourneyRow, now: Date, sla: ReturnType<typeof defaultSla>, specialistFallback: string): QueueRow {
  const state: JourneyState = projectJourney(row);
  const r = reactionState(state, now, sla);
  const specialist = row.respTouchpoint?.name ?? specialistFallback;

  const steps: QueueStep[] = row.steps
    .filter((s) => s.status === "DUE")
    .sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime())
    .map((s) => {
      const def = STEP_BY_KEY[s.step];
      const { body, unresolved } = renderStep(row, s.step, specialist);
      return {
        stepLogId: s.id,
        step: s.step,
        sopStep: def?.sopStep ?? "",
        label: def?.label ?? s.step,
        channel: s.channel,
        dueAt: s.dueAt.toISOString(),
        actionable: isActionable({ status: s.status, dueAt: s.dueAt, actedAt: s.actedAt, outcome: s.outcome }, now),
        body,
        unresolved,
        script: CALL_SCRIPTS[s.step] ?? null,
      };
    });

  const disco = row.booking?.slot?.startsAt ?? null;

  return {
    journeyId: row.id,
    leadId: row.leadId,
    name: row.lead.name,
    phone: row.lead.phone,
    email: row.lead.email,
    phase: row.phase,
    qualified: row.qualified,
    redFlag: row.redFlag,
    redFlagReason: row.redFlagReason,
    zoomLink: row.zoomLink,
    contactedAt: row.contactedAt?.toISOString() ?? null,
    // The clock only matters while the branch is still in play.
    sla: row.phase === "OPT_IN" || r.branch === "PENDING" ? { branch: r.branch, remainingMs: r.remainingMs, breached: r.breached, approaching: r.approaching } : null,
    discoAtIst: disco ? formatDateTimeInZone(disco, "Asia/Kolkata") : null,
    discoAtCet: disco ? formatDateTimeInZone(disco, "Europe/Berlin") : null,
    sssAtIst: row.sssAt ? formatDateTimeInZone(row.sssAt, "Asia/Kolkata") : null,
    whatsappSent: row.whatsappSent,
    whatsappConfirmed: row.whatsappConfirmed,
    salesCallConfirmed: row.salesCallConfirmed,
    highlyQualified: row.highlyQualified,
    bantAvg: row.booking?.bantAvg ?? null,
    steps,
    next: steps.find((s) => s.actionable) ?? null,
  };
}

function defaultSla() {
  return {
    reactionMinutes: 5,
    check1Hours: 2,
    check2Hours: 1,
    finalCheckHours: 2,
    discoConfirm1LeadHours: 36,
    discoConfirm2LeadHours: 24,
    discoCancelLeadHours: 12,
    sssConfirm1LeadHours: 24,
    sssConfirm2LeadHours: 12,
    sssCancelLeadHours: 10,
  };
}

export type OutreachQueue = {
  enabled: boolean;
  /** Actionable now — the specialist's actual to-do list. */
  due: QueueRow[];
  /** Materialised but not yet due — visible so nothing is a surprise. */
  upcoming: QueueRow[];
  /** Live journeys with nothing outstanding (waiting on the prospect or another role). */
  waiting: QueueRow[];
  counts: { due: number; upcoming: number; waiting: number; breaching: number };
};

export async function getOutreachQueue(): Promise<OutreachQueue> {
  const cfg = await readOutreachConfig();
  const now = new Date();

  const rows = await prisma.outreachJourney.findMany({
    where: { phase: { notIn: ["IGNORED", "CANCELLED", "CLOSED_NOT_HQ", "COMPLETED"] } },
    include: INCLUDE,
    orderBy: { optInAt: "desc" },
    take: 300,
  });

  const mapped = rows.map((r) => toQueueRow(r as JourneyRow, now, cfg.sla, cfg.defaultSpecialistName));

  const due = mapped.filter((r) => r.next !== null);
  const upcoming = mapped.filter((r) => r.next === null && r.steps.length > 0);
  const waiting = mapped.filter((r) => r.steps.length === 0);

  // Sort the to-do list by urgency: an SLA about to blow outranks a reminder due in an hour.
  due.sort((a, b) => {
    const aSla = a.sla?.breached || a.sla?.approaching ? 0 : 1;
    const bSla = b.sla?.breached || b.sla?.approaching ? 0 : 1;
    if (aSla !== bSla) return aSla - bSla;
    return new Date(a.next!.dueAt).getTime() - new Date(b.next!.dueAt).getTime();
  });

  return {
    enabled: cfg.enabled,
    due,
    upcoming,
    waiting,
    counts: {
      due: due.length,
      upcoming: upcoming.length,
      waiting: waiting.length,
      breaching: mapped.filter((r) => r.sla?.approaching || r.sla?.breached).length,
    },
  };
}

// ─────────────────────────────── Key Metrics (Step 12) ───────────────────────────────

/**
 * "Key Metrics Sales B2_2026.xlsx", as the SOP knows it.
 *
 * The six Step-12 transfer fields plus every column the later steps write. Note `apptTimeCet` is a
 * real conversion of the stored UTC instant, not a copy of the IST string — checklist §L asks for
 * exactly that ("Timezone conversion (booking time → CET) is correct, not just copied raw").
 *
 * The zone LABEL is computed rather than hardcoded: Europe/Berlin is CEST (UTC+2) from late March
 * to late October, so a fixed "CET" is wrong for ~7 months a year. The existing bookings table has
 * that bug; this one doesn't.
 */
export type KeyMetricsRow = {
  journeyId: string;
  apptDate: string | null;
  apptTimeCet: string | null;
  cetLabel: string | null;
  name: string;
  email: string | null;
  /** Null since the Synamate import — this is a sheet column, not a send target. */
  phone: string | null;
  bantScore: number | null;
  qualified: QualifiedVerdict | null;
  respTouchpoint: string | null;
  respDisco: string | null;
  whatsappSent: boolean;
  whatsappConfirmed: boolean;
  salesCallConfirmed: boolean;
  highlyQualified: boolean | null;
  phase: OutreachPhase;
  /** The SOP's "mark the row RED" flag. */
  red: boolean;
  redReason: string | null;
};

/** "CET" or "CEST" for a given instant — the real abbreviation, not an assumption. */
function berlinLabel(d: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Berlin",
    timeZoneName: "short",
  }).formatToParts(d);
  return parts.find((p) => p.type === "timeZoneName")?.value ?? "CET";
}

export async function getKeyMetrics(): Promise<KeyMetricsRow[]> {
  const rows = await prisma.outreachJourney.findMany({
    where: { bookingId: { not: null } },
    include: INCLUDE,
    orderBy: { optInAt: "desc" },
    take: 500,
  });

  return rows.map((row) => {
    const appt = row.booking?.slot?.startsAt ?? null;
    return {
      journeyId: row.id,
      apptDate: appt
        ? new Intl.DateTimeFormat("en-GB", {
            timeZone: "Europe/Berlin",
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
          }).format(appt)
        : null,
      apptTimeCet: appt
        ? new Intl.DateTimeFormat("en-GB", {
            timeZone: "Europe/Berlin",
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
          }).format(appt)
        : null,
      cetLabel: appt ? berlinLabel(appt) : null,
      name: row.lead.name,
      email: row.lead.email,
      phone: row.lead.phone,
      bantScore: row.bantScoreAtQual ?? row.booking?.bantAvg ?? null,
      qualified: row.qualified,
      respTouchpoint: row.respTouchpoint?.name ?? null,
      respDisco: row.respDisco?.name ?? null,
      whatsappSent: row.whatsappSent,
      whatsappConfirmed: row.whatsappConfirmed,
      salesCallConfirmed: row.salesCallConfirmed,
      highlyQualified: row.highlyQualified,
      phase: row.phase,
      red: row.redFlag,
      redReason: row.redFlagReason,
    };
  });
}

/** The team members who can own a touchpoint / discovery call (Step 12's two dropdowns). */
export async function getAssignableUsers() {
  return prisma.user.findMany({
    where: { status: "ACTIVE", role: { in: ["ADMIN", "USER", "HEAD"] } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}

/** Dormant / closed journeys — Step 9's IGNORE bucket. Kept in records, never deleted (§I). */
export async function getClosedJourneys() {
  const rows = await prisma.outreachJourney.findMany({
    where: { phase: { in: ["IGNORED", "CANCELLED", "CLOSED_NOT_HQ", "COMPLETED"] } },
    include: INCLUDE,
    orderBy: { updatedAt: "desc" },
    take: 200,
  });
  return rows.map((r) => ({
    journeyId: r.id,
    name: r.lead.name,
    phone: r.lead.phone,
    phase: r.phase,
    red: r.redFlag,
    redReason: r.redFlagReason,
    closedAt: (r.ignoredAt ?? r.cancelledAt ?? r.updatedAt).toISOString(),
  }));
}

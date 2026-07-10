import "server-only";
import { Prisma, type WhatsAppKind, type WhatsAppStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { istToday } from "@/lib/dates";
import { formatDateTimeInZone, formatInrMinor } from "@/lib/format";
import { WHATSAPP_KIND_LABELS, type WatiTemplateConfig } from "@/lib/whatsapp";
import { normalizeWhatsappNumber } from "@/lib/phone";
import {
  getWatiRuntime,
  sendTemplateMessage,
  sendSessionMessage,
  fetchWatiMessages,
  type WatiRuntime,
  type WatiParameter,
} from "@/lib/wati";
import { getPendingRows } from "./finance-metrics";

/**
 * WhatsApp sending service + automatic reminder engine (WATI). Everything funnels through
 * `sendWhatsApp`, which is fail-safe: it normalizes the number, honours opt-outs, resolves the
 * per-touchpoint template, calls WATI, and always writes an append-only WhatsAppMessage row
 * (SENT / FAILED / SKIPPED). It NEVER throws into a request path.
 *
 * `runDueReminders` is the automatic cadence, called by /api/cron/whatsapp (external cron) and the
 * Admin "Run reminders now" button. When the feature is off it short-circuits (no row spam).
 */

const HR = 3_600_000;

// Statuses that count as "a message actually went out" (for the per-lead reminder cap).
const SUCCESSFUL: WhatsAppStatus[] = ["QUEUED", "SENT", "DELIVERED", "READ", "REPLIED"];

function firstName(full: string): string {
  const n = full.trim().split(/\s+/)[0];
  return n || full.trim() || "there";
}

function bookingUrl(): string {
  return `${(process.env.BETTER_AUTH_URL ?? "").replace(/\/+$/, "")}/book`;
}

// ───────────────────────────── Core send ─────────────────────────────

export type WhatsAppTarget = {
  leadId?: string | null;
  studentId?: string | null;
  bookingRequestId?: string | null;
  pendingPaymentId?: string | null;
  agreementId?: string | null;
};

export type SendWhatsAppInput = WhatsAppTarget & {
  kind: WhatsAppKind;
  to: string | null | undefined; // raw phone/WhatsApp
  vars: Record<string, string>; // pool of values this touchpoint can offer (WHATSAPP_AVAILABLE_VARS[kind])
  sentById?: string | null; // set for manual sends (also forces SKIPPED to be logged for feedback)
  bodySummary?: string;
  /** When false, a disabled/paused/unconfigured send returns silently WITHOUT a row (event-driven paths). */
  logSkips?: boolean;
  /** Pass a shared runtime when sending in a loop, to avoid re-reading config each time. */
  runtime?: WatiRuntime;
};

export type SendOutcome = {
  messageId: string | null;
  status: WhatsAppStatus;
  sent: boolean;
  skipped: boolean;
  error?: string;
};

async function isOptedOut(number: string): Promise<boolean> {
  const row = await prisma.whatsAppOptOut.findUnique({ where: { phone: number } });
  return !!row;
}

/**
 * Build WATI's `parameters` from the TEMPLATE's own variable list — a WhatsApp template accepts
 * exactly the variables it was approved with, so sending an extra one is rejected outright.
 * Returns the missing names instead of substituting blanks: an empty variable renders a broken
 * message ("Hi ,") and WhatsApp rejects empty params anyway, so we'd rather skip and say why.
 */
function buildParameters(
  template: WatiTemplateConfig,
  vars: Record<string, string>,
): { ok: true; params: WatiParameter[] } | { ok: false; missing: string[] } {
  const missing: string[] = [];
  const params = template.params.map((name) => {
    const value = vars[name];
    if (value === undefined || value === "") missing.push(name);
    return { name, value: value ?? "" };
  });
  return missing.length ? { ok: false, missing } : { ok: true, params };
}

async function writeRow(input: {
  kind: WhatsAppKind;
  status: WhatsAppStatus;
  toNumber: string;
  templateName: string | null;
  body: string | null;
  params: Prisma.InputJsonValue;
  watiMessageId?: string | null;
  error?: string | null;
  sentById?: string | null;
  target: WhatsAppTarget;
}): Promise<string> {
  const row = await prisma.whatsAppMessage.create({
    data: {
      direction: "OUTBOUND",
      kind: input.kind,
      status: input.status,
      toNumber: input.toNumber,
      templateName: input.templateName,
      body: input.body,
      params: input.params,
      watiMessageId: input.watiMessageId ?? null,
      error: input.error ?? null,
      sentById: input.sentById ?? null,
      leadId: input.target.leadId ?? null,
      studentId: input.target.studentId ?? null,
      bookingRequestId: input.target.bookingRequestId ?? null,
      pendingPaymentId: input.target.pendingPaymentId ?? null,
      agreementId: input.target.agreementId ?? null,
    },
    select: { id: true },
  });
  return row.id;
}

/**
 * Send one WhatsApp template message and log it. Fail-safe: resolves a SendOutcome, never throws.
 */
export async function sendWhatsApp(input: SendWhatsAppInput): Promise<SendOutcome> {
  const { kind, to, vars, sentById = null, target, logSkips = true } = {
    ...input,
    target: {
      leadId: input.leadId,
      studentId: input.studentId,
      bookingRequestId: input.bookingRequestId,
      pendingPaymentId: input.pendingPaymentId,
      agreementId: input.agreementId,
    } satisfies WhatsAppTarget,
  };

  const runtime = input.runtime ?? (await getWatiRuntime());
  const template = runtime.settings.templates[kind];
  const number = normalizeWhatsappNumber(to, runtime.settings.defaultCountry);
  const label = WHATSAPP_KIND_LABELS[kind];
  const body = input.bodySummary ?? label;
  const paramsJson = { template: template?.name ?? null, vars } as Prisma.InputJsonValue;

  // Reasons the message can't actually go out. The first three are "system off" — for
  // event-driven callers (logSkips=false) we stay silent rather than spamming SKIPPED rows.
  let systemOff: string | null = null;
  if (!runtime.envEnabled) systemOff = "WhatsApp sending is off (WATI_ENABLED not set)";
  else if (runtime.paused) systemOff = "WhatsApp is paused in settings";
  else if (!runtime.configured) systemOff = "WATI is not configured (endpoint/token missing)";

  // Resolve the template's own variables. Done before the opt-out lookup so a misconfigured
  // template surfaces immediately, without a DB round-trip.
  const built = template ? buildParameters(template, vars) : null;

  // Positive knowledge from the last catalog refresh that this template can't be sent. An unknown
  // template is allowed through — WATI stays the authority, so a stale cache never blocks a
  // genuinely approved template.
  const knownStatus = template?.name ? runtime.templateStatus[template.name] : undefined;

  let dataSkip: string | null = null;
  if (!systemOff) {
    if (!number) dataSkip = "No valid WhatsApp number — save it with a country code (e.g. +91… or +49…)";
    else if (!template?.name) dataSkip = `No WATI template configured for "${label}"`;
    else if (knownStatus && knownStatus !== "APPROVED") {
      dataSkip = `Template "${template.name}" is ${knownStatus} in WATI — pick an APPROVED template in WhatsApp → Settings.`;
    } else if (built && !built.ok) {
      dataSkip =
        `Template "${template.name}" expects ${built.missing.map((m) => `{{${m}}}`).join(", ")}, ` +
        `which "${label}" cannot supply. Fix the variable list in WhatsApp → Settings.`;
    } else if (await isOptedOut(number)) dataSkip = "Recipient has opted out of WhatsApp";
  }

  const skipReason = systemOff ?? dataSkip;
  if (skipReason) {
    if (systemOff && !logSkips) {
      return { messageId: null, status: "SKIPPED", sent: false, skipped: true, error: skipReason };
    }
    const messageId = await writeRow({
      kind,
      status: "SKIPPED",
      toNumber: number ?? String(to ?? "").slice(0, 32),
      templateName: template?.name ?? null,
      body,
      params: paramsJson,
      error: skipReason,
      sentById,
      target,
    });
    return { messageId, status: "SKIPPED", sent: false, skipped: true, error: skipReason };
  }

  // Enabled + configured + template + valid number + not opted-out → real send.
  const result = await sendTemplateMessage({
    endpoint: runtime.endpoint!,
    token: runtime.token!,
    whatsappNumber: number!,
    templateName: template!.name,
    broadcastName: template!.broadcastName,
    parameters: (built as { ok: true; params: WatiParameter[] }).params,
  });

  const status: WhatsAppStatus = result.ok ? "SENT" : "FAILED";
  const messageId = await writeRow({
    kind,
    status,
    toNumber: number!,
    templateName: template!.name,
    body,
    params: paramsJson,
    watiMessageId: result.watiMessageId,
    error: result.ok ? null : result.error ?? "Send failed",
    sentById,
    target,
  });
  return {
    messageId,
    status,
    sent: result.ok,
    skipped: false,
    error: result.ok ? undefined : result.error,
  };
}

// ───────────────────────── Status lookup (for section badges) ─────────────────────────

export type WhatsAppTargetField =
  | "leadId"
  | "studentId"
  | "bookingRequestId"
  | "pendingPaymentId"
  | "agreementId";
export type LastMessage = { status: WhatsAppStatus; kind: WhatsAppKind; createdAt: Date };

/** Most-recent OUTBOUND message per target id — powers the "last WhatsApp" badge in the sections. */
export async function getLastWhatsAppByTarget(
  field: WhatsAppTargetField,
  ids: string[],
): Promise<Map<string, LastMessage>> {
  const map = new Map<string, LastMessage>();
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return map;
  const where: Prisma.WhatsAppMessageWhereInput = { direction: "OUTBOUND" };
  (where as Record<string, unknown>)[field] = { in: unique };
  const rows = await prisma.whatsAppMessage.findMany({
    where,
    orderBy: { createdAt: "desc" },
    select: {
      status: true,
      kind: true,
      createdAt: true,
      leadId: true,
      studentId: true,
      bookingRequestId: true,
      pendingPaymentId: true,
      agreementId: true,
    },
  });
  for (const r of rows) {
    const id = r[field];
    if (id && !map.has(id)) map.set(id, { status: r.status, kind: r.kind, createdAt: r.createdAt });
  }
  return map;
}

export type WhatsAppStatusCell = { status: WhatsAppStatus; kind: WhatsAppKind; at: string };

/** Serializable version of getLastWhatsAppByTarget — safe to pass from a server page to a client table. */
export async function getWhatsAppStatusMap(
  field: WhatsAppTargetField,
  ids: string[],
): Promise<Record<string, WhatsAppStatusCell>> {
  const m = await getLastWhatsAppByTarget(field, ids);
  const out: Record<string, WhatsAppStatusCell> = {};
  for (const [id, v] of m) out[id] = { status: v.status, kind: v.kind, at: v.createdAt.toISOString() };
  return out;
}

// ───────────────────────── Reconcile with WATI (what Meta actually did) ─────────────────────────

/**
 * `SENT` only ever meant "WATI accepted the request". Meta can reject the message moments later —
 * a deleted template, a marketing quality restriction — and reports that asynchronously via the
 * webhook. When the webhook can't reach us (local dev, a downtime window, a dropped delivery), our
 * history silently keeps claiming `Sent` for messages that never arrived.
 *
 * This pulls WATI's own message log and corrects our rows. It's the safety net that makes the
 * WhatsApp history trustworthy without depending on inbound webhooks.
 */
export type ReconcileResult = { checked: number; updated: number; failed: number; error?: string };

/** Non-terminal states worth re-checking. READ/REPLIED/FAILED are final for our purposes. */
const RECONCILABLE: WhatsAppStatus[] = ["QUEUED", "SENT", "DELIVERED"];

function mapWatiStatus(s: string): WhatsAppStatus | null {
  if (s.includes("FAIL")) return "FAILED";
  if (s.includes("READ")) return "READ";
  if (s.includes("DELIVER")) return "DELIVERED";
  if (s.includes("SENT")) return "SENT";
  return null;
}

export async function reconcileWhatsAppStatuses(withinHours = 72): Promise<ReconcileResult> {
  const runtime = await getWatiRuntime();
  if (!runtime.configured) return { checked: 0, updated: 0, failed: 0, error: "WATI is not configured" };

  const since = new Date(Date.now() - withinHours * HR);
  const rows = await prisma.whatsAppMessage.findMany({
    where: { direction: "OUTBOUND", createdAt: { gte: since }, status: { in: RECONCILABLE } },
    orderBy: { createdAt: "desc" },
    select: { id: true, toNumber: true, templateName: true, createdAt: true, status: true },
  });
  if (!rows.length) return { checked: 0, updated: 0, failed: 0 };

  let updated = 0;
  let failed = 0;
  const numbers = [...new Set(rows.map((r) => r.toNumber))];

  for (const number of numbers) {
    const res = await fetchWatiMessages(number);
    if (!res.ok) continue;
    const used = new Set<string>();

    for (const row of rows.filter((r) => r.toNumber === number)) {
      // WATI gives us no id at send time, so match on template + send instant (±5 min).
      const match = res.messages.find(
        (m) =>
          !used.has(m.id) &&
          Math.abs(m.createdAt.getTime() - row.createdAt.getTime()) < 5 * 60_000 &&
          (!m.templateName || !row.templateName || m.templateName === row.templateName),
      );
      if (!match) continue;
      used.add(match.id);

      const mapped = mapWatiStatus(match.status);
      if (!mapped || mapped === row.status) continue;

      await prisma.whatsAppMessage.update({
        where: { id: row.id },
        data: { status: mapped, watiMessageId: match.id, error: match.failedDetail },
      });
      updated++;
      if (mapped === "FAILED") failed++;
    }
  }
  return { checked: rows.length, updated, failed };
}

// ───────────────────────── Throttle (idempotency / cadence) ─────────────────────────

function targetWhere(t: WhatsAppTarget): Prisma.WhatsAppMessageWhereInput {
  if (t.leadId) return { leadId: t.leadId };
  if (t.studentId) return { studentId: t.studentId };
  if (t.bookingRequestId) return { bookingRequestId: t.bookingRequestId };
  if (t.pendingPaymentId) return { pendingPaymentId: t.pendingPaymentId };
  return {};
}

/**
 * True when it's OK to send `kind` to `t` now.
 *  - maxCount: caps *successful* sends (SKIPPED/FAILED don't count toward the cap).
 *  - minSpacingMs: backs off from the last attempt of ANY kind-row (incl. SKIPPED/FAILED) so a
 *    bad number or missing template can't be retried every run.
 */
async function throttleOk(
  kind: WhatsAppKind,
  t: WhatsAppTarget,
  opts: { minSpacingMs?: number; maxCount?: number },
): Promise<boolean> {
  const base: Prisma.WhatsAppMessageWhereInput = { kind, direction: "OUTBOUND", ...targetWhere(t) };
  if (opts.maxCount !== undefined) {
    const count = await prisma.whatsAppMessage.count({ where: { ...base, status: { in: SUCCESSFUL } } });
    if (count >= opts.maxCount) return false;
  }
  if (opts.minSpacingMs !== undefined) {
    const last = await prisma.whatsAppMessage.findFirst({
      where: base,
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });
    if (last && Date.now() - last.createdAt.getTime() < opts.minSpacingMs) return false;
  }
  return true;
}

// ───────────────────────────── Reminder engine ─────────────────────────────

export type KindTally = { sent: number; skipped: number; failed: number };
export type ReminderRun = {
  enabled: boolean;
  reason?: string;
  ranAt: string;
  perKind: Partial<Record<WhatsAppKind, KindTally>>;
  total: KindTally;
};

/**
 * Scan every touchpoint and send the reminders that are due. Idempotent: re-running immediately
 * sends nothing new (throttle windows). Short-circuits when the feature is off so it can be polled
 * cheaply by an external cron.
 */
export async function runDueReminders(): Promise<ReminderRun> {
  const ranAt = new Date().toISOString();
  // Correct any stale "Sent" rows first — Meta may have rejected them after WATI accepted.
  // Cheap, and it keeps the history honest even when the inbound webhook never arrives.
  await reconcileWhatsAppStatuses().catch(() => undefined);
  const runtime = await getWatiRuntime();
  const perKind: Partial<Record<WhatsAppKind, KindTally>> = {};
  const total: KindTally = { sent: 0, skipped: 0, failed: 0 };

  if (!runtime.enabled) {
    const reason = !runtime.envEnabled
      ? "WATI_ENABLED is not set"
      : runtime.paused
        ? "WhatsApp is paused in settings"
        : "WATI is not configured (endpoint/token missing)";
    return { enabled: false, reason, ranAt, perKind, total };
  }

  const cadence = runtime.settings.cadence;
  let budget = Math.max(0, cadence.maxPerRun);
  const now = Date.now();
  const today = istToday();

  const record = (kind: WhatsAppKind, out: SendOutcome) => {
    const t = (perKind[kind] ??= { sent: 0, skipped: 0, failed: 0 });
    if (out.sent) { t.sent++; total.sent++; budget--; }
    else if (out.status === "FAILED") { t.failed++; total.failed++; budget--; }
    else { t.skipped++; total.skipped++; }
  };
  // A touchpoint only runs when its template exists — avoids per-candidate SKIPPED spam every run.
  const hasTemplate = (kind: WhatsAppKind) => !!runtime.settings.templates[kind]?.name;

  // 1. Discovery-call reminders — un-booked leads.
  if (budget > 0 && hasTemplate("DISCO_REMINDER")) {
    const cutoff = new Date(now - cadence.discoFirstDelayHours * HR);
    const leads = await prisma.lead.findMany({
      where: { stage: { in: ["NEW_LEAD", "DISCO_NOT_BOOKED"] }, createdAt: { lte: cutoff }, phone: { not: "" } },
      orderBy: { createdAt: "asc" },
      take: Math.min(budget * 2 + 50, 500),
      select: { id: true, name: true, phone: true },
    });
    for (const l of leads) {
      if (budget <= 0) break;
      if (!(await throttleOk("DISCO_REMINDER", { leadId: l.id }, { minSpacingMs: cadence.discoRepeatHours * HR, maxCount: cadence.discoMaxReminders }))) continue;
      record("DISCO_REMINDER", await sendWhatsApp({
        kind: "DISCO_REMINDER", to: l.phone, leadId: l.id, runtime,
        vars: { name: firstName(l.name), booking_url: bookingUrl() },
      }));
    }
  }

  // 2. Pre-call reminders — booked slots coming up.
  if (budget > 0 && hasTemplate("BOOKING_REMINDER")) {
    const leadHours = cadence.bookingReminderLeadHours;
    const maxLead = Math.max(...leadHours);
    const minLead = Math.min(...leadHours);
    const bookings = await prisma.bookingRequest.findMany({
      where: { status: "BOOKED", slot: { startsAt: { gt: new Date(now), lte: new Date(now + maxLead * HR) } } },
      include: { slot: { select: { startsAt: true } } },
      take: Math.min(budget * 2 + 50, 500),
    });
    for (const b of bookings) {
      if (budget <= 0) break;
      if (!(await throttleOk("BOOKING_REMINDER", { bookingRequestId: b.id }, { minSpacingMs: minLead * HR, maxCount: leadHours.length }))) continue;
      record("BOOKING_REMINDER", await sendWhatsApp({
        kind: "BOOKING_REMINDER", to: b.whatsapp || b.phone, bookingRequestId: b.id, leadId: b.leadId ?? undefined, runtime,
        vars: {
          name: firstName(b.name),
          slot_time: b.slot ? formatDateTimeInZone(b.slot.startsAt, "Asia/Kolkata") : "",
          booking_url: bookingUrl(),
        },
      }));
    }
  }

  // 3. No-show follow-ups — one nudge to rebook.
  if (budget > 0 && hasTemplate("NO_SHOW_FOLLOWUP")) {
    const leads = await prisma.lead.findMany({
      where: {
        stage: "NO_SHOW",
        phone: { not: "" },
        updatedAt: { gte: new Date(now - 14 * 24 * HR), lte: new Date(now - cadence.noShowDelayHours * HR) },
      },
      take: Math.min(budget * 2 + 50, 300),
      select: { id: true, name: true, phone: true },
    });
    for (const l of leads) {
      if (budget <= 0) break;
      if (!(await throttleOk("NO_SHOW_FOLLOWUP", { leadId: l.id }, { minSpacingMs: 7 * 24 * HR, maxCount: 1 }))) continue;
      record("NO_SHOW_FOLLOWUP", await sendWhatsApp({
        kind: "NO_SHOW_FOLLOWUP", to: l.phone, leadId: l.id, runtime,
        vars: { name: firstName(l.name), booking_url: bookingUrl() },
      }));
    }
  }

  // 4. Payment reminders — overdue pending payments (balance still > 0).
  if (budget > 0 && hasTemplate("PAYMENT_REMINDER")) {
    const [pendingRows, overdue] = await Promise.all([
      getPendingRows(),
      prisma.pendingPayment.findMany({
        where: { status: "ACTIVE", nextDueDate: { lt: today } },
        include: { student: { select: { phone: true } } },
        take: Math.min(budget * 2 + 50, 300),
      }),
    ]);
    const byId = new Map(pendingRows.map((r) => [r.id, r]));
    for (const p of overdue) {
      if (budget <= 0) break;
      const phone = p.student?.phone;
      if (!phone) continue;
      const row = byId.get(p.id);
      if (row && row.balance.inr <= 0) continue; // already settled
      if (!(await throttleOk("PAYMENT_REMINDER", { pendingPaymentId: p.id }, { minSpacingMs: cadence.paymentRepeatHours * HR }))) continue;
      const amount = row ? formatInrMinor(row.balance.inr) : formatInrMinor(p.totalFeeInrMinor);
      record("PAYMENT_REMINDER", await sendWhatsApp({
        kind: "PAYMENT_REMINDER", to: phone, pendingPaymentId: p.id, studentId: p.studentId ?? undefined, runtime,
        vars: { name: firstName(p.studentName), amount },
      }));
    }
  }

  // 5. Check-in nudges — active enrollments whose check-in date has arrived/passed.
  if (budget > 0 && hasTemplate("CHECKIN_NUDGE")) {
    const enrollments = await prisma.enrollment.findMany({
      where: { status: "ACTIVE", nextCheckInDate: { lte: today }, student: { phone: { not: null } } },
      include: { student: { select: { id: true, fullName: true, phone: true } } },
      take: Math.min(budget * 2 + 50, 300),
    });
    for (const e of enrollments) {
      if (budget <= 0) break;
      if (!e.student.phone) continue;
      if (!(await throttleOk("CHECKIN_NUDGE", { studentId: e.student.id }, { minSpacingMs: cadence.studentRepeatHours * HR }))) continue;
      record("CHECKIN_NUDGE", await sendWhatsApp({
        kind: "CHECKIN_NUDGE", to: e.student.phone, studentId: e.student.id, runtime,
        vars: { name: firstName(e.student.fullName) },
      }));
    }
  }

  // 6. Sprint-miss nudges — recently missed sprint weeks.
  if (budget > 0 && hasTemplate("SPRINT_MISS_NUDGE")) {
    const misses = await prisma.sprintWeek.findMany({
      where: {
        status: "MISSED",
        weekEnd: { gte: new Date(now - 21 * 24 * HR) },
        enrollment: { status: "ACTIVE", student: { phone: { not: null } } },
      },
      include: { enrollment: { include: { student: { select: { id: true, fullName: true, phone: true } } } } },
      orderBy: { weekEnd: "desc" },
      take: Math.min(budget * 2 + 50, 300),
    });
    for (const m of misses) {
      if (budget <= 0) break;
      const s = m.enrollment.student;
      if (!s.phone) continue;
      if (!(await throttleOk("SPRINT_MISS_NUDGE", { studentId: s.id }, { minSpacingMs: cadence.studentRepeatHours * HR }))) continue;
      record("SPRINT_MISS_NUDGE", await sendWhatsApp({
        kind: "SPRINT_MISS_NUDGE", to: s.phone, studentId: s.id, runtime,
        vars: { name: firstName(s.fullName) },
      }));
    }
  }

  return { enabled: true, ranAt, perKind, total };
}

// ───────────────────────── Manual / event-driven wrappers ─────────────────────────
// Used by server actions and by the booking flow. sentById is passed for manual sends so the
// SKIPPED feedback is logged; the auto booking-confirmation path passes no sentById and stays quiet.

const notFound = (what: string): SendOutcome => ({
  messageId: null, status: "SKIPPED", sent: false, skipped: true, error: `${what} not found`,
});

export async function sendDiscoReminderToLead(leadId: string, sentById?: string | null): Promise<SendOutcome> {
  const l = await prisma.lead.findUnique({ where: { id: leadId }, select: { id: true, name: true, phone: true } });
  if (!l) return notFound("Lead");
  return sendWhatsApp({
    kind: "DISCO_REMINDER", to: l.phone, leadId: l.id, sentById,
    vars: { name: firstName(l.name), booking_url: bookingUrl() },
  });
}

export async function sendNoShowFollowupToLead(leadId: string, sentById?: string | null): Promise<SendOutcome> {
  const l = await prisma.lead.findUnique({ where: { id: leadId }, select: { id: true, name: true, phone: true } });
  if (!l) return notFound("Lead");
  return sendWhatsApp({
    kind: "NO_SHOW_FOLLOWUP", to: l.phone, leadId: l.id, sentById,
    vars: { name: firstName(l.name), booking_url: bookingUrl() },
  });
}

async function loadBooking(bookingRequestId: string) {
  return prisma.bookingRequest.findUnique({
    where: { id: bookingRequestId },
    include: { slot: { select: { startsAt: true } } },
  });
}

export async function sendBookingConfirmation(bookingRequestId: string, sentById?: string | null): Promise<SendOutcome> {
  const b = await loadBooking(bookingRequestId);
  if (!b) return notFound("Booking");
  return sendWhatsApp({
    kind: "BOOKING_CONFIRMATION", to: b.whatsapp || b.phone, bookingRequestId: b.id, leadId: b.leadId ?? undefined,
    sentById: sentById ?? null,
    // Auto path (no sentById) stays quiet when WATI is off; manual send logs the skip.
    logSkips: !!sentById,
    vars: {
      name: firstName(b.name),
      slot_time: b.slot ? formatDateTimeInZone(b.slot.startsAt, "Asia/Kolkata") : "",
      booking_url: bookingUrl(),
    },
  });
}

export async function sendBookingReminderFor(bookingRequestId: string, sentById?: string | null): Promise<SendOutcome> {
  const b = await loadBooking(bookingRequestId);
  if (!b) return notFound("Booking");
  return sendWhatsApp({
    kind: "BOOKING_REMINDER", to: b.whatsapp || b.phone, bookingRequestId: b.id, leadId: b.leadId ?? undefined, sentById,
    vars: {
      name: firstName(b.name),
      slot_time: b.slot ? formatDateTimeInZone(b.slot.startsAt, "Asia/Kolkata") : "",
      booking_url: bookingUrl(),
    },
  });
}

export async function sendPaymentReminderFor(pendingPaymentId: string, sentById?: string | null): Promise<SendOutcome> {
  const [p, pendingRows] = await Promise.all([
    prisma.pendingPayment.findUnique({
      where: { id: pendingPaymentId },
      include: { student: { select: { phone: true } } },
    }),
    getPendingRows(),
  ]);
  if (!p) return notFound("Pending payment");
  const phone = p.student?.phone ?? null;
  const row = pendingRows.find((r) => r.id === p.id);
  const amount = row ? formatInrMinor(row.balance.inr) : formatInrMinor(p.totalFeeInrMinor);
  return sendWhatsApp({
    kind: "PAYMENT_REMINDER", to: phone, pendingPaymentId: p.id, studentId: p.studentId ?? undefined, sentById,
    vars: { name: firstName(p.studentName), amount },
  });
}

export async function sendStudentNudgeFor(
  enrollmentId: string,
  kind: Extract<WhatsAppKind, "CHECKIN_NUDGE" | "SPRINT_MISS_NUDGE">,
  sentById?: string | null,
): Promise<SendOutcome> {
  const e = await prisma.enrollment.findUnique({
    where: { id: enrollmentId },
    include: { student: { select: { id: true, fullName: true, phone: true } } },
  });
  if (!e) return notFound("Enrollment");
  return sendWhatsApp({
    kind, to: e.student.phone, studentId: e.student.id, sentById,
    vars: { name: firstName(e.student.fullName) },
  });
}

/**
 * Realistic sample values for every variable a touchpoint can supply — so a test send exercises
 * the exact template, with the exact parameter count, that production will use.
 */
function sampleVars(): Record<string, string> {
  const tomorrow = new Date(Date.now() + 24 * HR);
  return {
    name: "there",
    booking_url: bookingUrl(),
    slot_time: formatDateTimeInZone(tomorrow, "Asia/Kolkata"),
    amount: formatInrMinor(2_500_000), // ₹25,000 in paise
  };
}

/**
 * Free-form (session) message — valid ONLY inside the 24-hour window opened by the contact
 * messaging us first. Unlike a marketing template it is NOT subject to Meta's per-user marketing
 * frequency caps, so this is what actually lands when a template is being throttled.
 * Business-initiated reminders still use templates; this exists for testing and for replying
 * inside an open conversation.
 */
export async function sendFreeFormMessage(
  toRaw: string,
  text: string,
  sentById?: string | null,
): Promise<SendOutcome> {
  const runtime = await getWatiRuntime();
  const number = normalizeWhatsappNumber(toRaw, runtime.settings.defaultCountry);
  const target: WhatsAppTarget = {};
  const noParams = {} as Prisma.InputJsonValue;

  let skip: string | null = null;
  if (!runtime.envEnabled) skip = "WhatsApp sending is off (WATI_ENABLED not set)";
  else if (runtime.paused) skip = "WhatsApp is paused in settings";
  else if (!runtime.configured) skip = "WATI is not configured (endpoint/token missing)";
  else if (!number) skip = "No valid WhatsApp number — include the country code";
  else if (!text.trim()) skip = "Message text is empty";
  else if (await isOptedOut(number)) skip = "Recipient has opted out of WhatsApp";

  if (skip) {
    const messageId = await writeRow({
      kind: "MANUAL", status: "SKIPPED", toNumber: number ?? String(toRaw).slice(0, 32),
      templateName: null, body: text.slice(0, 500), params: noParams, error: skip, sentById, target,
    });
    return { messageId, status: "SKIPPED", sent: false, skipped: true, error: skip };
  }

  const result = await sendSessionMessage({
    endpoint: runtime.endpoint!,
    token: runtime.token!,
    whatsappNumber: number!,
    messageText: text,
  });

  const status: WhatsAppStatus = result.ok ? "SENT" : "FAILED";
  const messageId = await writeRow({
    kind: "MANUAL", status, toNumber: number!, templateName: null,
    body: text.slice(0, 500), params: noParams,
    watiMessageId: result.watiMessageId,
    error: result.ok ? null : result.error ?? "Send failed",
    sentById, target,
  });
  return { messageId, status, sent: result.ok, skipped: false, error: result.ok ? undefined : result.error };
}

/**
 * "Send test" from the settings page. Sends the template mapped to `kind` to one number, filling
 * that touchpoint's variables with sample values. Test rows carry no lead/student link, so they
 * never affect the reminder engine's per-contact throttles.
 */
export async function sendTestMessage(
  toRaw: string,
  kind: WhatsAppKind = "MANUAL",
  sentById?: string | null,
): Promise<SendOutcome> {
  return sendWhatsApp({
    kind, to: toRaw, sentById,
    bodySummary: `Test send — ${WHATSAPP_KIND_LABELS[kind]}`,
    vars: sampleVars(),
  });
}

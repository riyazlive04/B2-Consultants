import "server-only";
import { Prisma, type LeadStage } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  coerceStageMessages,
  DEFAULT_STAGE_MESSAGES,
  STAGE_MESSAGES_KEY,
  stageWhatsAppKind,
  type StageMessagesConfig,
} from "@/lib/stage-messages";
import { sendEmailMessage } from "@/server/messaging";
import { sendWhatsApp } from "@/server/whatsapp";
import { coerceOutreachConfig } from "@/lib/outreach-sop";
import { formatDateTimeInZone } from "@/lib/format";

/**
 * Stage messages engine: sends a stage's email + WhatsApp every time a lead enters that stage.
 *
 * ── Why a sweep over LeadStageHistory, not a hook in each action ──────────────
 * A stage is written from 18 places (Pipeline drag, lead edit, Opportunities board, bookings,
 * call logs, the SOP engine, workflows...). Every one of them appends a LeadStageHistory row, so
 * that table IS the event stream. Reading it from one place means a new stage writer can never
 * forget to message, and no user action waits on WATI/Resend.
 *
 * ── Cursor ──────────────────────────────────────────────────────────────────
 * AppSetting("stageMessagesCursor") holds the last (changedAt, id) handled. On the very first run
 * it is set to NOW and nothing is sent, so shipping this messages nobody retroactively. The cursor
 * also advances while the feature is switched off, so switching it on never replays a backlog.
 * Rows younger than SETTLE_MS are left for the next tick: `changedAt` is the writer's transaction
 * start, so a row can commit slightly after a later-stamped one, and passing it would lose it.
 *
 * ── Who is messaged ─────────────────────────────────────────────────────────
 * Every stage entry, manual or automatic, including a brand-new opt-in and the move to
 * WHATSAPP_SENT, even if the lead was messaged a moment ago. Each history row is announced for
 * the stage it records. Skipped: archived leads, and a MANUAL move that the same lead's next
 * move replaced within MISDRAG_MS (a mis-drag corrected on the spot). Automatic moves are never
 * treated as mis-drags: a new opt-in moves on to WhatsApp Sent within seconds and must still get
 * its New Lead message.
 */

const CURSOR_KEY = "stageMessagesCursor";
const LOCK_KEY = 732_604_119; // arbitrary, unique to this engine
const BATCH = 100;
const MISDRAG_MS = 20_000;
// Longer than MISDRAG_MS, so the correcting move has been written by the time a row is judged.
const SETTLE_MS = MISDRAG_MS + 10_000;

type Cursor = { at: string; id: string };

export async function getStageMessagesConfig(): Promise<StageMessagesConfig> {
  const row = await prisma.appSetting.findUnique({ where: { key: STAGE_MESSAGES_KEY } });
  return row ? coerceStageMessages(row.value) : DEFAULT_STAGE_MESSAGES;
}

export async function writeStageMessagesConfig(config: StageMessagesConfig): Promise<void> {
  const value = config as unknown as Prisma.InputJsonValue;
  await prisma.appSetting.upsert({
    where: { key: STAGE_MESSAGES_KEY },
    create: { key: STAGE_MESSAGES_KEY, value },
    update: { value },
  });
}

type Claimed = {
  id: string;
  leadId: string;
  fromStage: string | null;
  toStage: string;
  changedById: string | null;
  changedAt: Date;
};

/**
 * Claim the next batch and advance the cursor in ONE transaction under an advisory lock, so two
 * overlapping cron ticks can never claim (and send) the same row twice.
 */
async function claimBatch(): Promise<{ rows: Claimed[]; initialised?: boolean; busy?: boolean }> {
  return prisma.$transaction(async (tx) => {
    const [{ locked }] = await tx.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(${LOCK_KEY}) AS locked`;
    if (!locked) return { rows: [], busy: true };

    const row = await tx.appSetting.findUnique({ where: { key: CURSOR_KEY } });
    const cursor = row?.value as Cursor | null | undefined;
    if (!cursor?.at) {
      const value = { at: new Date().toISOString(), id: "" } as Prisma.InputJsonValue;
      await tx.appSetting.upsert({ where: { key: CURSOR_KEY }, create: { key: CURSOR_KEY, value }, update: { value } });
      return { rows: [], initialised: true };
    }

    const at = new Date(cursor.at);
    const rows = await tx.leadStageHistory.findMany({
      where: {
        changedAt: { lte: new Date(Date.now() - SETTLE_MS) },
        OR: [{ changedAt: { gt: at } }, { changedAt: at, id: { gt: cursor.id } }],
      },
      orderBy: [{ changedAt: "asc" }, { id: "asc" }],
      take: BATCH,
      select: { id: true, leadId: true, fromStage: true, toStage: true, changedById: true, changedAt: true },
    });
    if (rows.length) {
      const last = rows[rows.length - 1];
      const value = { at: last.changedAt.toISOString(), id: last.id } as Prisma.InputJsonValue;
      await tx.appSetting.update({ where: { key: CURSOR_KEY }, data: { value } });
    }
    return { rows };
  });
}

export async function runStageMessages() {
  const claim = await claimBatch();
  if (claim.busy) return { busy: true };
  if (claim.initialised) return { initialised: true };

  const cfg = await getStageMessagesConfig();
  const result = { claimed: claim.rows.length, emails: 0, whatsapps: 0, skipped: 0, disabled: !cfg.enabled };
  if (!cfg.enabled || claim.rows.length === 0) return result;

  for (const r of claim.rows) {
    const sent = await sendForRow(r, cfg).catch(() => null);
    if (!sent) {
      result.skipped++;
      continue;
    }
    if (sent.email) result.emails++;
    if (sent.whatsapp) result.whatsapps++;
  }
  return result;
}

async function sendForRow(r: Claimed, cfg: StageMessagesConfig): Promise<{ email: boolean; whatsapp: boolean } | null> {
  const lead = await prisma.lead.findUnique({
    where: { id: r.leadId },
    select: { id: true, name: true, email: true, phone: true, deletedAt: true, assignedTo: { select: { name: true } } },
  });
  if (!lead || lead.deletedAt) return null;

  if (r.changedById) {
    // Any later move of this lead within the window means this one was a mis-drag.
    const correctedBy = await prisma.leadStageHistory.findFirst({
      where: {
        leadId: r.leadId,
        OR: [
          { changedAt: { gt: r.changedAt, lte: new Date(r.changedAt.getTime() + MISDRAG_MS) } },
          { changedAt: r.changedAt, id: { gt: r.id } },
        ],
      },
      select: { id: true },
    });
    if (correctedBy) return null;
  }

  return sendStageMessage(lead, r.toStage as LeadStage, r.changedById, cfg);
}

type StageLead = {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  assignedTo: { name: string | null } | null;
};

async function sendStageMessage(
  lead: StageLead,
  stage: LeadStage,
  sentById: string | null,
  cfg: StageMessagesConfig,
): Promise<{ email: boolean; whatsapp: boolean } | null> {
  const msg = cfg.stages[stage];
  if (!msg || (!msg.email && !msg.whatsapp)) return null;

  let email = false;
  let whatsapp = false;

  if (msg.email && lead.email && msg.subject.trim() && msg.body.trim()) {
    const out = await sendEmailMessage({
      leadId: lead.id,
      subject: msg.subject,
      body: msg.body,
      sentById,
    });
    email = out.status === "SENT";
  }

  if (msg.whatsapp && lead.phone) {
    const firstName = (lead.name ?? "").trim().split(/\s+/)[0] || "there";
    const sender = await senderName(sentById, lead);
    const out = await sendWhatsApp({
      kind: stageWhatsAppKind(stage),
      to: lead.phone,
      vars: { name: firstName, sender, booking_url: bookingUrl(), ...(await callVars(lead.id, stage)) },
      leadId: lead.id,
      sentById,
      bodySummary: `Stage message · ${stage}`,
      // Engine caller: stay silent while WhatsApp is off, and log an unbound template once, not per move.
      logSkips: false,
    });
    whatsapp = out.sent;
  }

  return { email, whatsapp };
}

/**
 * An existing lead submitted an opt-in form again: send the New Lead message without moving them.
 *
 * A resubmission by a lead mid-chase deliberately changes no stage (lib/returning-opt-in.ts), so
 * the sweep never sees it. When the returning opt-in DID reopen the lead to New Lead, that wrote a
 * history row and the sweep sends the message, so this stands down to avoid sending it twice.
 */
export async function announceReturningOptIn(leadId: string): Promise<void> {
  const cfg = await getStageMessagesConfig();
  if (!cfg.enabled) return;
  const reopened = await prisma.leadStageHistory.findFirst({
    where: { leadId, toStage: "NEW_LEAD", changedAt: { gte: new Date(Date.now() - 5 * 60_000) } },
    select: { id: true },
  });
  if (reopened) return;
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: { id: true, name: true, email: true, phone: true, deletedAt: true, assignedTo: { select: { name: true } } },
  });
  if (!lead || lead.deletedAt) return;
  await sendStageMessage(lead, "NEW_LEAD", null, cfg);
}

function bookingUrl(): string {
  return `${(process.env.BETTER_AUTH_URL ?? "").replace(/\/+$/, "")}/book`;
}

/**
 * `{{sender}}` for a stage template, so the SOP's approved templates (which sign off with it) can
 * be reused: whoever moved the lead, else its owner, else the SOP's default specialist name.
 */
async function senderName(sentById: string | null, lead: StageLead): Promise<string> {
  if (sentById) {
    const u = await prisma.user.findUnique({ where: { id: sentById }, select: { name: true } });
    if (u?.name?.trim()) return u.name.trim().split(/\s+/)[0];
  }
  if (lead.assignedTo?.name?.trim()) return lead.assignedTo.name.trim().split(/\s+/)[0];
  const row = await prisma.appSetting.findUnique({ where: { key: "outreachConfig" } });
  return coerceOutreachConfig(row?.value ?? null).defaultSpecialistName;
}

/**
 * The call details a stage template may ask for: {{date}}, {{time}}, {{slot_time}}, {{zoom_link}},
 * {{sss_url}}. Same names and formats the SOP and booking templates use, so their approved
 * templates can be bound to a stage as-is.
 *
 * SSS stages read the Success Strategy Session time; every other stage reads the discovery call,
 * from the journey's booking or else the lead's latest booked slot, and only while it is BOOKED. A value that does not exist
 * is left OUT rather than blank: a template that needs it is then skipped with a clear reason
 * instead of sending "your call on  at ".
 */
async function callVars(leadId: string, stage: LeadStage): Promise<Record<string, string>> {
  const journey = await prisma.outreachJourney.findUnique({
    where: { leadId },
    select: {
      sssAt: true,
      zoomLink: true,
      booking: { select: { status: true, slot: { select: { startsAt: true } } } },
    },
  });
  // Only a LIVE booking: a no-show or cancelled call would put an old date in a new message.
  let disco = journey?.booking?.status === "BOOKED" ? (journey.booking.slot?.startsAt ?? null) : null;
  if (!disco) {
    const latest = await prisma.bookingRequest.findFirst({
      where: { leadId, status: "BOOKED", slot: { isNot: null } },
      orderBy: { createdAt: "desc" },
      select: { slot: { select: { startsAt: true } } },
    });
    disco = latest?.slot?.startsAt ?? null;
  }
  const when = stage.startsWith("SSS_") ? (journey?.sssAt ?? disco) : (disco ?? journey?.sssAt ?? null);

  const vars: Record<string, string> = { sss_url: "https://optin.b2consultants.de/sss" };
  if (when) {
    const formatted = formatDateTimeInZone(when, "Asia/Kolkata");
    const i = formatted.lastIndexOf(", ");
    vars.slot_time = formatted;
    vars.date = i === -1 ? formatted : formatted.slice(0, i);
    if (i !== -1) vars.time = formatted.slice(i + 2);
  }
  if (journey?.zoomLink) vars.zoom_link = journey.zoomLink;
  return vars;
}

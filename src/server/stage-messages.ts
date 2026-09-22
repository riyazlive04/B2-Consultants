import "server-only";
import { Prisma } from "@prisma/client";
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
 * ── Who is NOT messaged (the "no doubles" rules) ────────────────────────────
 * - The lead has already moved on to another stage (a mis-drag corrected within the minute, or a
 *   chain of automatic moves): only the stage they are actually in is announced.
 * - Archived leads.
 * - SYSTEM moves (changedById null) that another message already covers:
 *   · fromStage null - a brand-new opt-in; the SOP intro owns first contact.
 *   · into WHATSAPP_SENT - the move exists BECAUSE a WhatsApp just went out.
 *   · the lead received any outbound WhatsApp/email in the last RECENT_SEND_MS - the move was the
 *     side effect of a booking confirmation, a cancellation notice, a chase close-out etc.
 *   A human move always sends: that is the explicit ask.
 */

const CURSOR_KEY = "stageMessagesCursor";
const LOCK_KEY = 732_604_119; // arbitrary, unique to this engine
const BATCH = 100;
const SETTLE_MS = 20_000;
const RECENT_SEND_MS = 15 * 60_000;

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

  // Several moves of one lead in one batch: only the latest can match their current stage anyway.
  const latest = new Map<string, Claimed>();
  for (const r of claim.rows) latest.set(r.leadId, r);

  for (const r of latest.values()) {
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
    select: { id: true, name: true, email: true, phone: true, stage: true, deletedAt: true },
  });
  if (!lead || lead.deletedAt || lead.stage !== r.toStage) return null;

  const msg = cfg.stages[lead.stage];
  if (!msg || (!msg.email && !msg.whatsapp)) return null;

  if (!r.changedById) {
    if (r.fromStage === null || r.toStage === "WHATSAPP_SENT") return null;
    const since = new Date(Date.now() - RECENT_SEND_MS);
    const [wa, em] = await Promise.all([
      prisma.whatsAppMessage.count({
        where: { leadId: lead.id, direction: "OUTBOUND", status: { not: "SKIPPED" }, createdAt: { gte: since } },
      }),
      prisma.message.count({
        where: { leadId: lead.id, direction: "OUTBOUND", status: "SENT", createdAt: { gte: since } },
      }),
    ]);
    if (wa + em > 0) return null;
  }

  let email = false;
  let whatsapp = false;

  if (msg.email && lead.email && msg.subject.trim() && msg.body.trim()) {
    const out = await sendEmailMessage({
      leadId: lead.id,
      subject: msg.subject,
      body: msg.body,
      sentById: r.changedById,
    });
    email = out.status === "SENT";
  }

  if (msg.whatsapp && lead.phone) {
    const firstName = (lead.name ?? "").trim().split(/\s+/)[0] || "there";
    const out = await sendWhatsApp({
      kind: stageWhatsAppKind(lead.stage),
      to: lead.phone,
      vars: { name: firstName },
      leadId: lead.id,
      sentById: r.changedById,
      bodySummary: `Stage message · ${lead.stage}`,
      // Engine caller: stay silent while WhatsApp is off, and log an unbound template once, not per move.
      logSkips: false,
    });
    whatsapp = out.sent;
  }

  return { email, whatsapp };
}

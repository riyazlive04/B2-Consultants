import "server-only";
import type { OutreachStep, Prisma, WhatsAppKind } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { formatDateTimeInZone } from "@/lib/format";
import {
  coerceOutreachConfig,
  renderOutreachTemplate,
  unresolvedVars,
  qualifiedFromBant,
  STEP_BY_KEY,
  type OutreachConfig,
  type OutreachVars,
} from "@/lib/outreach-sop";
import {
  planJourney,
  normalizeEmail,
  isActionable,
  isTerminal,
  type JourneyState,
} from "@/lib/outreach-engine";
import { normalizeWhatsappNumber } from "@/lib/phone";
import { sendWhatsApp } from "./whatsapp";

/**
 * Outreach SOP — the DB shell around `lib/outreach-engine.ts`.
 *
 * All the decisions live in the pure engine; this file only reads state, writes what the engine
 * decided, and (optionally) hands a rendered message to the WATI layer. Keeping the split strict
 * is what lets the SOP's timing rules be tested at their boundaries without a database.
 *
 * The engine has no autonomous clock — `runDueOutreach()` is the scheduler seam, same stance as
 * the existing WhatsApp reminder engine (see /api/cron/outreach).
 */

const CONFIG_KEY = "outreachConfig";

// ─────────────────────────────── Config ───────────────────────────────

export async function readOutreachConfig(): Promise<OutreachConfig> {
  const row = await prisma.appSetting.findUnique({ where: { key: CONFIG_KEY } });
  return coerceOutreachConfig(row?.value ?? null);
}

export async function writeOutreachConfig(cfg: OutreachConfig): Promise<void> {
  const value = coerceOutreachConfig(cfg) as unknown as Prisma.InputJsonValue;
  await prisma.appSetting.upsert({
    where: { key: CONFIG_KEY },
    create: { key: CONFIG_KEY, value },
    update: { value },
  });
}

// ─────────────────────────────── Journey lifecycle ───────────────────────────────

/**
 * Step 1 → the journey exists. Called from every intake path.
 *
 * Idempotent by the leadId unique: a webhook redelivery or a second capture for the same human
 * links to the existing journey rather than restarting their SOP clock. That matters — restarting
 * it would re-open a chase against someone already deep in the disco ladder.
 */
export async function ensureJourney(leadId: string, optInAt?: Date) {
  const existing = await prisma.outreachJourney.findUnique({ where: { leadId } });
  if (existing) return existing;

  const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { createdAt: true } });
  if (!lead) return null;

  try {
    return await prisma.outreachJourney.create({
      data: { leadId, optInAt: optInAt ?? lead.createdAt },
    });
  } catch {
    // Lost a race with a concurrent capture — the other writer's row is just as good.
    return prisma.outreachJourney.findUnique({ where: { leadId } });
  }
}

const JOURNEY_INCLUDE = {
  steps: true,
  lead: { select: { id: true, name: true, phone: true, email: true } },
  booking: { include: { slot: { select: { startsAt: true } } } },
  respTouchpoint: { select: { id: true, name: true } },
  respDisco: { select: { id: true, name: true } },
} satisfies Prisma.OutreachJourneyInclude;

export type JourneyRow = Prisma.OutreachJourneyGetPayload<{ include: typeof JOURNEY_INCLUDE }>;

export async function getJourney(journeyId: string): Promise<JourneyRow | null> {
  return prisma.outreachJourney.findUnique({ where: { id: journeyId }, include: JOURNEY_INCLUDE });
}

/** Project a DB row into the pure engine's input. The only place the two representations meet. */
export function projectJourney(row: JourneyRow): JourneyState {
  const steps: JourneyState["steps"] = {};
  for (const s of row.steps) {
    steps[s.step] = { status: s.status, dueAt: s.dueAt, actedAt: s.actedAt, outcome: s.outcome };
  }
  return {
    phase: row.phase,
    optInAt: row.optInAt,
    contactedAt: row.contactedAt,
    discoAt: row.booking?.slot?.startsAt ?? null,
    sssAt: row.sssAt,
    booked: row.bookingId !== null,
    qualified: row.qualified,
    whatsappConfirmed: row.whatsappConfirmed,
    salesCallConfirmed: row.salesCallConfirmed,
    highlyQualified: row.highlyQualified,
    steps,
  };
}

// ─────────────────────────────── Step 10: the booking cross-check ───────────────────────────────

/**
 * Step 10 — "is the personalized discovery call booked?"
 *
 * The SOP does this by copying the email out of one sheet and Ctrl+F-ing the other. We do the same
 * comparison, but case- and whitespace-insensitively, which is strictly more reliable than the
 * manual process (see `normalizeEmail` for why aliasing is deliberately NOT folded).
 *
 * Phone is a fallback, not a peer: a prospect can book with a different email than they opted in
 * with, and phone is the identity the WhatsApp conversation actually runs on. It is normalized
 * through libphonenumber so `+91 98765 43210` and `919876543210` match — the exact-string compare
 * this app used before would call those two different people.
 *
 * Returns the booking, or null. Never guesses.
 */
export async function findBookingForLead(leadId: string) {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: { email: true, phone: true },
  });
  if (!lead) return null;

  const email = normalizeEmail(lead.email);
  if (email) {
    // Postgres `mode: "insensitive"` + a trim on our side covers the SOP's stated failure modes.
    const byEmail = await prisma.bookingRequest.findFirst({
      where: { email: { equals: email, mode: "insensitive" }, status: { not: "CANCELLED" } },
      orderBy: { createdAt: "desc" },
    });
    if (byEmail) return byEmail;
  }

  const phone = normalizeWhatsappNumber(lead.phone);
  if (phone) {
    // No SQL-side normalization exists for phones, so compare in JS over a bounded recent set.
    const candidates = await prisma.bookingRequest.findMany({
      where: { status: { not: "CANCELLED" } },
      orderBy: { createdAt: "desc" },
      take: 500,
      select: { id: true, phone: true, whatsapp: true },
    });
    const hit = candidates.find(
      (c) => normalizeWhatsappNumber(c.phone) === phone || normalizeWhatsappNumber(c.whatsapp) === phone,
    );
    if (hit) return prisma.bookingRequest.findUnique({ where: { id: hit.id } });
  }

  return null;
}

/**
 * Run the Step 10 check and record the result on the journey. Returns true when booked.
 * Linking the booking is what flips `booked` in the engine, which in turn stops the chase ladder
 * and opens qualification.
 */
export async function runBookingCheck(journeyId: string): Promise<boolean> {
  const row = await getJourney(journeyId);
  if (!row || row.bookingId) return row?.bookingId != null;

  const booking = await findBookingForLead(row.leadId);
  if (!booking) return false;

  // The booking may already belong to another journey (two Leads for one human, pre-normalization).
  // The @@unique on bookingId would throw; treat that as "not ours" rather than crashing the cron.
  try {
    await prisma.outreachJourney.update({
      where: { id: journeyId },
      data: { bookingId: booking.id },
    });
    return true;
  } catch {
    return false;
  }
}

// ─────────────────────────────── Rendering ───────────────────────────────

/**
 * Render one step's message for one prospect, and report anything left unresolved.
 *
 * `[DATE]`/`[TIME]` render in IST because these messages go to the prospect, who is in India — the
 * SOP's Step 13 says so outright ("on *[DATE]* at *[TIME]* IST"). CET is the internal Key Metrics
 * view's concern, not the prospect's (see outreach-metrics.ts).
 */
export function renderStep(
  row: JourneyRow,
  step: OutreachStep,
  specialistName: string,
): { body: string | null; unresolved: string[] } {
  const def = STEP_BY_KEY[step];
  if (!def?.body) return { body: null, unresolved: [] };

  const firstName = (row.lead.name ?? "").trim().split(/\s+/)[0] || row.lead.name;
  const isSss = step.startsWith("SSS_");
  const when = isSss ? row.sssAt : (row.booking?.slot?.startsAt ?? null);

  const vars: OutreachVars = {
    "[Prospect’s First Name]": firstName,
    "[Your Name]": specialistName,
  };
  if (when) {
    // The prospect's own timezone. formatDateTimeInZone yields e.g. "Sat 18 Jul, 07:00 PM".
    const [date, time] = splitDateTime(formatDateTimeInZone(when, "Asia/Kolkata"));
    vars["[DATE]"] = date;
    vars["[TIME]"] = time;
  }
  if (row.zoomLink) vars["<<INSERT ZOOM LINK HERE>>"] = row.zoomLink;

  const body = renderOutreachTemplate(def.body, vars);
  // The video placeholder is an instruction to the human, not a variable — it is expected to
  // survive rendering, so it never counts as "unresolved".
  const unresolved = unresolvedVars(body).filter((v) => v !== "<< ATTACH VIDEO TO THIS MESSAGE>>");
  return { body, unresolved };
}

/** "Sat 18 Jul, 07:00 PM" → ["Sat 18 Jul", "07:00 PM"]. */
function splitDateTime(formatted: string): [string, string] {
  const i = formatted.lastIndexOf(", ");
  return i === -1 ? [formatted, ""] : [formatted.slice(0, i), formatted.slice(i + 2)];
}

// ─────────────────────────────── The engine run ───────────────────────────────

export type OutreachRun = {
  enabled: boolean;
  scanned: number;
  materialised: number;
  superseded: number;
  autoSent: number;
  autoFailed: number;
  phaseChanges: number;
  checked: number;
  notes: string[];
};

/**
 * One pass of the SOP engine. Idempotent — run it as often as the cron fires.
 *
 * Order matters: run the Step 10 booking checks BEFORE planning, so a prospect who booked since
 * the last tick has `booked = true` when the ladder is computed and their chase stops in the same
 * pass rather than sending one more follow-up first.
 */
export async function runDueOutreach(): Promise<OutreachRun> {
  const run: OutreachRun = {
    enabled: false,
    scanned: 0,
    materialised: 0,
    superseded: 0,
    autoSent: 0,
    autoFailed: 0,
    phaseChanges: 0,
    checked: 0,
    notes: [],
  };

  const cfg = await readOutreachConfig();
  run.enabled = cfg.enabled;
  if (!cfg.enabled) {
    run.notes.push("Outreach engine is disabled (Outreach → Settings).");
    return run;
  }

  const active = await prisma.outreachJourney.findMany({
    where: { phase: { notIn: ["IGNORED", "CANCELLED", "CLOSED_NOT_HQ", "COMPLETED"] } },
    select: { id: true },
    take: cfg.maxPerRun,
    orderBy: { updatedAt: "asc" },
  });

  const now = new Date();

  for (const { id } of active) {
    run.scanned++;

    // ── Step 10 first: any actionable SYSTEM check materialised for this journey.
    const pendingChecks = await prisma.outreachStepLog.findMany({
      where: {
        journeyId: id,
        status: "DUE",
        step: { in: ["CHECK_1", "CHECK_2", "FINAL_CHECK"] },
        dueAt: { lte: now },
      },
    });
    for (const check of pendingChecks) {
      const booked = await runBookingCheck(id);
      run.checked++;
      await prisma.outreachStepLog.update({
        where: { id: check.id },
        data: { status: "SENT", actedAt: now, outcome: booked ? "BOOKED" : "NOT_BOOKED" },
      });
    }

    const row = await getJourney(id);
    if (!row) continue;

    // ── Auto-derive the Qualified verdict from BANT (Step 11). The verdict is a pure function of
    // the score, so the engine can take it; a human can still override it in the UI.
    if (row.bookingId && row.qualified === null && row.booking?.bantAvg != null) {
      const verdict = qualifiedFromBant(row.booking.bantAvg);
      if (verdict) {
        await prisma.outreachJourney.update({
          where: { id },
          data: { qualified: verdict, qualifiedAt: now, bantScoreAtQual: row.booking.bantAvg },
        });
      }
    }

    const fresh = (await getJourney(id))!;
    const state = projectJourney(fresh);
    const plan = planJourney(state, now, cfg.sla);

    // ── Materialise.
    for (const m of plan.materialise) {
      const def = STEP_BY_KEY[m.step];
      try {
        await prisma.outreachStepLog.create({
          data: { journeyId: id, step: m.step, dueAt: m.dueAt, channel: def.channel },
        });
        run.materialised++;
      } catch {
        // @@unique([journeyId, step]) — another run beat us to it. Exactly the intended outcome.
      }
    }

    // ── Supersede what events overtook.
    if (plan.supersede.length) {
      const res = await prisma.outreachStepLog.updateMany({
        where: { journeyId: id, step: { in: plan.supersede }, status: "DUE" },
        data: { status: "SUPERSEDED", actedAt: now },
      });
      run.superseded += res.count;
    }

    // ── Phase.
    if (plan.phase !== fresh.phase) {
      await prisma.outreachJourney.update({
        where: { id },
        data: {
          phase: plan.phase,
          ...(plan.phase === "IGNORED" ? { ignoredAt: now } : {}),
        },
      });
      run.phaseChanges++;
    }

    // ── Auto-send anything the admin has opted in AND that is actually due.
    const sent = await autoSendDue(id, cfg, now);
    run.autoSent += sent.ok;
    run.autoFailed += sent.failed;
    run.notes.push(...sent.notes);
  }

  return run;
}

/**
 * Auto-send the due WhatsApp steps an admin has explicitly opted in.
 *
 * Every gate here fails closed and leaves the row DUE for a human rather than sending something
 * wrong: not opted in, not a WhatsApp step, not yet due, unresolved variables, no valid number, or
 * no WATI template mapped for the touchpoint. A DUE row is a safe resting state — the specialist
 * sees it in the queue and sends it themselves.
 */
async function autoSendDue(
  journeyId: string,
  cfg: OutreachConfig,
  now: Date,
): Promise<{ ok: number; failed: number; notes: string[] }> {
  const out = { ok: 0, failed: 0, notes: [] as string[] };

  const row = await getJourney(journeyId);
  if (!row || isTerminal(row.phase)) return out;

  const due = row.steps.filter(
    (s) =>
      s.status === "DUE" &&
      cfg.autoSend[s.step] === true &&
      STEP_BY_KEY[s.step]?.channel === "WHATSAPP" &&
      isActionable({ status: s.status, dueAt: s.dueAt, actedAt: s.actedAt, outcome: s.outcome }, now),
  );

  for (const s of due) {
    const specialist = row.respTouchpoint?.name ?? cfg.defaultSpecialistName;
    const { body, unresolved } = renderStep(row, s.step, specialist);
    if (!body) continue;

    if (unresolved.length) {
      // Checklist: "no unresolved placeholders reaching the send step". Leave it for a human.
      out.notes.push(`${row.lead.name} · ${s.step}: needs ${unresolved.join(", ")} — left for manual send.`);
      continue;
    }

    const kind = mapToWhatsAppKind(s.step);
    if (!kind) continue; // not a WhatsApp step — nothing to auto-send

    const res = await sendWhatsApp({
      kind,
      to: row.lead.phone,
      leadId: row.leadId,
      bookingRequestId: row.bookingId ?? undefined,
      // The pool this touchpoint can offer. WATI substitutes server-side from its own approved
      // variable list; `body` rides along as bodySummary purely as the audit record.
      vars: whatsappVarsFor(row, s.step, specialist),
      bodySummary: body,
      // sentById stays null: an auto-send has no human author, matching the existing convention
      // in whatsapp.ts where null = automatic.
      logSkips: false,
    });

    if (res.sent) {
      await markSent(s.id, body, null, res.messageId);
      out.ok++;
    } else {
      // Not a failure of the SOP — usually the WATI layer being off or the touchpoint unmapped.
      // Leave the row DUE so the specialist sends it by hand; that is the designed fallback.
      out.notes.push(`${row.lead.name} · ${s.step}: ${res.error ?? "send skipped"} — left for manual send.`);
      if (res.status === "FAILED") out.failed++;
    }
  }

  return out;
}

/**
 * SOP step → WhatsAppKind. Reuses the existing WATI layer's template mapping, opt-out enforcement
 * and delivery log rather than growing a second one.
 *
 * STRICTLY 1:1, and that matters. The app binds exactly ONE WATI template per kind, so pointing
 * two SOP steps at one kind would send the intro's text where the follow-up's belonged — a silent
 * wrong-message bug that no type would catch. Nine SOP messages, nine kinds, nine templates.
 */
const STEP_TO_KIND = {
  INTRO_WHATSAPP: "SOP_INTRO",
  FOLLOWUP_WHATSAPP: "SOP_FOLLOWUP",
  DISCO_WELCOME: "SOP_DISCO_WELCOME",
  DISCO_CONFIRM_1: "SOP_DISCO_CONFIRM_1",
  DISCO_CONFIRM_2: "SOP_DISCO_CONFIRM_2",
  DISCO_CANCEL_MSG: "SOP_DISCO_CANCEL",
  SSS_CONFIRM_1: "SOP_SSS_CONFIRM_1",
  SSS_CONFIRM_2: "SOP_SSS_CONFIRM_2",
  SSS_CANCEL_MSG: "SOP_SSS_CANCEL",
} as const satisfies Partial<Record<OutreachStep, WhatsAppKind>>;

function mapToWhatsAppKind(step: OutreachStep): WhatsAppKind | null {
  return (STEP_TO_KIND as Partial<Record<OutreachStep, WhatsAppKind>>)[step] ?? null;
}

/**
 * The variable pool for a SOP touchpoint, matching the names the approved templates declare
 * (docs/WHATSAPP_TEMPLATES.md). WATI substitutes server-side from this; `renderStep`'s text is the
 * audit copy of what that should produce.
 *
 * Values are resolved the same way `renderStep` resolves them, so the sent message and the logged
 * message cannot drift.
 */
function whatsappVarsFor(row: JourneyRow, step: OutreachStep, specialistName: string): Record<string, string> {
  const firstName = (row.lead.name ?? "").trim().split(/\s+/)[0] || row.lead.name;
  const isSss = step.startsWith("SSS_");
  const when = isSss ? row.sssAt : (row.booking?.slot?.startsAt ?? null);

  const vars: Record<string, string> = { name: firstName, sender: specialistName };
  if (when) {
    const [date, time] = splitDateTime(formatDateTimeInZone(when, "Asia/Kolkata"));
    vars.date = date;
    vars.time = time;
  }
  if (row.zoomLink) vars.zoom_link = row.zoomLink;
  return vars;
}

/** Transition a step to SENT. Shared by the auto-sender and the manual "Mark sent" action. */
export async function markSent(
  stepLogId: string,
  body: string | null,
  actedById: string | null,
  whatsAppMessageId: string | null,
) {
  return prisma.outreachStepLog.update({
    where: { id: stepLogId },
    data: {
      status: "SENT",
      actedAt: new Date(),
      actedById,
      renderedBody: body,
      whatsAppMessageId,
    },
  });
}

/**
 * Re-plan a single journey right now — used after a human action so the next step appears
 * immediately instead of waiting for the cron tick. Same engine, same idempotency.
 */
export async function refreshJourney(journeyId: string): Promise<void> {
  const cfg = await readOutreachConfig();
  const row = await getJourney(journeyId);
  if (!row) return;

  const now = new Date();
  const plan = planJourney(projectJourney(row), now, cfg.sla);

  for (const m of plan.materialise) {
    try {
      await prisma.outreachStepLog.create({
        data: { journeyId, step: m.step, dueAt: m.dueAt, channel: STEP_BY_KEY[m.step].channel },
      });
    } catch {
      /* unique — already there */
    }
  }
  if (plan.supersede.length) {
    await prisma.outreachStepLog.updateMany({
      where: { journeyId, step: { in: plan.supersede }, status: "DUE" },
      data: { status: "SUPERSEDED", actedAt: now },
    });
  }
  if (plan.phase !== row.phase) {
    await prisma.outreachJourney.update({
      where: { id: journeyId },
      data: { phase: plan.phase, ...(plan.phase === "IGNORED" ? { ignoredAt: now } : {}) },
    });
  }
}

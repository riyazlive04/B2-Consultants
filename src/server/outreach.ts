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
  QUALIFIED_LABELS,
  type OutreachConfig,
  type OutreachVars,
} from "@/lib/outreach-sop";
import { sendEmailMessage } from "./messaging";
import {
  planJourney,
  normalizeEmail,
  isActionable,
  isTerminal,
  type JourneyState,
} from "@/lib/outreach-engine";
import { normalizeWhatsappNumber } from "@/lib/phone";
import { sendWhatsApp } from "./whatsapp";
import { logSystemActivity, SYSTEM_ACTORS } from "./activity-log";
import { advanceLeadStage } from "./lead-stage-auto";

/**
 * Outreach SOP - the DB shell around `lib/outreach-engine.ts`.
 *
 * All the decisions live in the pure engine; this file only reads state, writes what the engine
 * decided, and (optionally) hands a rendered message to the WATI layer. Keeping the split strict
 * is what lets the SOP's timing rules be tested at their boundaries without a database.
 *
 * The engine has no autonomous clock - `runDueOutreach()` is the scheduler seam, same stance as
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
 * links to the existing journey rather than restarting their SOP clock. That matters - restarting
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
    // Lost a race with a concurrent capture - the other writer's row is just as good.
    return prisma.outreachJourney.findUnique({ where: { leadId } });
  }
}

const JOURNEY_INCLUDE = {
  steps: true,
  // `bantAvg`/`bantSource` ride along so Step 11 can score a prospect who answered the band-score
  // questions on the LANDING PAGE rather than on our booking form - see `bantForQualification`.
  lead: {
    select: { id: true, name: true, phone: true, email: true, bantAvg: true, bantSource: true },
  },
  booking: { include: { slot: { select: { startsAt: true } } } },
  respTouchpoint: { select: { id: true, name: true } },
  respDisco: { select: { id: true, name: true } },
} satisfies Prisma.OutreachJourneyInclude;

export type JourneyRow = Prisma.OutreachJourneyGetPayload<{ include: typeof JOURNEY_INCLUDE }>;

export async function getJourney(journeyId: string): Promise<JourneyRow | null> {
  return prisma.outreachJourney.findUnique({ where: { id: journeyId }, include: JOURNEY_INCLUDE });
}

/**
 * The BANT average Step 11 should judge this prospect on, and where it came from.
 *
 * Booking first, lead second. The booking form asks more and asks it later, so when both exist
 * it is the better evidence; the lead's score is the landing page's, taken at opt-in.
 *
 * Falling back to the lead is the whole point of scoring at opt-in. Before it, this verdict was
 * reachable ONLY through a `BookingRequest`, so a prospect who answered every qualification
 * question on the landing page still arrived at the discovery specialist unqualified - the
 * engine had a score sitting one join away and no way to read it.
 */
export function bantForQualification(
  row: Pick<JourneyRow, "booking" | "lead">,
): { avg: number; from: "booking" | "opt-in" } | null {
  if (row.booking?.bantAvg != null) return { avg: row.booking.bantAvg, from: "booking" };
  if (row.lead.bantAvg != null) return { avg: row.lead.bantAvg, from: "opt-in" };
  return null;
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
 * Step 10 - "is the personalized discovery call booked?"
 *
 * The SOP does this by copying the email out of one sheet and Ctrl+F-ing the other. We do the same
 * comparison, but case- and whitespace-insensitively, which is strictly more reliable than the
 * manual process (see `normalizeEmail` for why aliasing is deliberately NOT folded).
 *
 * Phone is a fallback, not a peer: a prospect can book with a different email than they opted in
 * with, and phone is the identity the WhatsApp conversation actually runs on. It is normalized
 * through libphonenumber so `+91 98765 43210` and `919876543210` match - the exact-string compare
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
 * `[DATE]`/`[TIME]` render in IST because these messages go to the prospect, who is in India - the
 * SOP's Step 13 says so outright ("on *[DATE]* at *[TIME]* IST"). CET is the internal Key Metrics
 * view's concern, not the prospect's (see outreach-metrics.ts).
 */
export function renderStep(
  row: JourneyRow,
  step: OutreachStep,
  specialistName: string,
): { body: string | null; subject: string | null; unresolved: string[] } {
  const def = STEP_BY_KEY[step];
  if (!def?.body) return { body: null, subject: null, unresolved: [] };

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
  // The subject goes through the SAME variable pool as the body, so a subject naming the
  // prospect cannot drift from the greeting inside the mail.
  const subject = def.subject ? renderOutreachTemplate(def.subject, vars) : null;
  // The video placeholder is an instruction to the human, not a variable - it is expected to
  // survive rendering, so it never counts as "unresolved".
  const unresolved = unresolvedVars(body).filter((v) => v !== "<< ATTACH VIDEO TO THIS MESSAGE>>");
  return { body, subject, unresolved };
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
 * One pass of the SOP engine. Idempotent - run it as often as the cron fires.
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

  /**
   * The recency floor. Without it this matched every non-terminal journey ever created, and
   * `updatedAt asc` below started at the oldest - so arming the engine replayed the SOP across
   * the entire historical import. See `OutreachConfig.maxAgeDays`.
   */
  const oldestOptIn = new Date(Date.now() - cfg.maxAgeDays * 24 * 60 * 60 * 1000);
  const active = await prisma.outreachJourney.findMany({
    where: {
      phase: { notIn: ["IGNORED", "CANCELLED", "CLOSED_NOT_HQ", "COMPLETED"] },
      optInAt: { gte: oldestOptIn },
    },
    // `lead.name` and `bookingId` ride along for the activity log: the founder's feed names the
    // prospect, and the pre-loop link state is what tells a check that FOUND a booking apart from
    // one that merely re-confirmed a link an earlier check already made.
    // `leadId` rides along too: the final check moves the pipeline card, which needs the lead.
    select: { id: true, leadId: true, bookingId: true, lead: { select: { name: true } } },
    take: cfg.maxPerRun,
    orderBy: { updatedAt: "asc" },
  });

  const now = new Date();

  for (const { id, leadId, bookingId, lead } of active) {
    run.scanned++;

    // ── Step 10 first: any actionable SYSTEM check materialised for this journey.
    const pendingChecks = await prisma.outreachStepLog.findMany({
      where: {
        journeyId: id,
        status: "DUE",
        step: { in: ["CHECK_1", "CHECK_2", "CHECK_3", "FINAL_CHECK"] },
        dueAt: { lte: now },
      },
    });
    // runBookingCheck reports "is it booked", not "did I link it just now" - it returns true
    // forever once the link exists. Tracking it here keeps CHECK_2 and FINAL_CHECK from each
    // re-announcing a booking CHECK_1 already found.
    let linked = bookingId !== null;
    for (const check of pendingChecks) {
      const booked = await runBookingCheck(id);
      run.checked++;
      await prisma.outreachStepLog.update({
        where: { id: check.id },
        data: { status: "SENT", actedAt: now, outcome: booked ? "BOOKED" : "NOT_BOOKED" },
      });
      /**
       * The final check is the give-up, and the founder's flow says the CARD moves, not just the
       * journey. Marking the journey IGNORED was invisible on the pipeline board, so a dead lead
       * sat in an open stage forever and the board overstated the pipeline.
       *
       * Guarded on the open stages only: a lead someone has since moved to WON, or parked
       * somewhere deliberately, is not dragged backwards by a cron.
       */
      if (!booked && check.step === "FINAL_CHECK") {
        await advanceLeadStage(leadId, "LOST", ["NEW_LEAD", "WHATSAPP_SENT", "DISCO_NOT_BOOKED"]);
      }
      if (booked && !linked) {
        linked = true;
        await logSystemActivity(SYSTEM_ACTORS.outreach, {
          action: "outreach.booking.match",
          section: "outreach",
          entityType: "OutreachJourney",
          entityId: id,
          summary: `Matched ${lead.name} to their booked discovery call - ${STEP_BY_KEY[check.step].label}`,
          meta: { step: check.step },
        });
      }
    }

    const row = await getJourney(id);
    if (!row) continue;

    // ── Auto-derive the Qualified verdict from BANT (Step 11). The verdict is a pure function of
    // the score, so the engine can take it; a human can still override it in the UI.
    //
    // The score may now come from the LEAD as well as the booking - a prospect who answered the
    // band-score questions on the landing page carries one from opt-in. That closes a real hole:
    // a booking matched by Step 10's cross-check rather than created by our own /book form has no
    // `bantAvg` of its own, so Step 11 could never fire for it and the prospect reached the
    // discovery specialist unqualified despite having answered every question.
    //
    // Still gated on `bookingId`. Qualified is the SOP's Step 11 verdict and it drives the Step
    // 13/17 messaging ladder, all of which is gated on `booked` in the pure engine - recording a
    // verdict for someone still being chased for a booking would put the two out of step.
    const scored = row.qualified === null ? bantForQualification(row) : null;
    if (row.bookingId && scored) {
      const verdict = qualifiedFromBant(scored.avg);
      if (verdict) {
        await prisma.outreachJourney.update({
          where: { id },
          data: { qualified: verdict, qualifiedAt: now, bantScoreAtQual: scored.avg },
        });
        await logSystemActivity(SYSTEM_ACTORS.outreach, {
          action: "outreach.qualification.record",
          section: "outreach",
          entityType: "OutreachJourney",
          entityId: id,
          // Naming the SOURCE matters in the founder's feed: "scored 2.8 from the landing page"
          // and "scored 2.8 from the booking form" are different amounts of evidence, and the
          // person reviewing a borderline verdict needs to know which one they are looking at.
          summary: `Scored ${row.lead.name} ${QUALIFIED_LABELS[verdict]} from a BANT average of ${scored.avg.toFixed(1)} (${scored.from === "opt-in" ? "landing page" : "booking form"})`,
          meta: { verdict, bantAvg: scored.avg, bantFrom: scored.from },
        });
      }
    }

    const fresh = (await getJourney(id))!;
    const state = projectJourney(fresh);
    const plan = planJourney(state, now, cfg.sla, { firstCallMode: cfg.firstCallMode });

    // ── Materialise.
    for (const m of plan.materialise) {
      const def = STEP_BY_KEY[m.step];
      try {
        await prisma.outreachStepLog.create({
          data: { journeyId: id, step: m.step, dueAt: m.dueAt, channel: def.channel },
        });
        run.materialised++;
      } catch {
        // @@unique([journeyId, step]) - another run beat us to it. Exactly the intended outcome.
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
      // Only the give-up goes on the feed. The other transitions restate something the feed
      // already carries (a step sent, a booking matched), whereas this one is the engine
      // deciding on its own that a prospect is dormant - and nobody else will say so.
      if (plan.phase === "IGNORED") {
        await logSystemActivity(SYSTEM_ACTORS.outreach, {
          action: "outreach.journey.ignore",
          section: "outreach",
          entityType: "OutreachJourney",
          entityId: id,
          summary: `Marked ${fresh.lead.name} dormant - no response through the follow-up ladder`,
          meta: { from: fresh.phase },
        });
      }
    }

    /**
     * ── Step 17/18: release the calendar, automatically.
     *
     * A SYSTEM step with no message, so it never passes through the auto-send path - it has to be
     * executed here. The planner only materialises it once the prospect has been told, on either
     * channel, so reaching this point means the notice is out and the slot should go.
     */
    const dueCancels = await prisma.outreachStepLog.findMany({
      where: { journeyId: id, status: "DUE", step: "DISCO_CANCEL", dueAt: { lte: now } },
      select: { id: true },
    });
    for (const c of dueCancels) {
      const res = await releaseDiscoBooking(id);
      await prisma.outreachStepLog.update({
        where: { id: c.id },
        data: { status: "SENT", actedAt: now, outcome: res.cancelled ? "CANCELLED" : "ALREADY_CANCELLED" },
      });
      if (res.cancelled) {
        await logSystemActivity(SYSTEM_ACTORS.outreach, {
          action: "outreach.disco.cancel",
          section: "outreach",
          entityType: "OutreachJourney",
          entityId: id,
          summary: `Released ${lead.name}'s discovery call${res.freedSlot ? " and re-opened the slot" : ""}`,
          meta: { freedSlot: res.freedSlot },
        });
      }
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
 * no WATI template mapped for the touchpoint. A DUE row is a safe resting state - the specialist
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
      (STEP_BY_KEY[s.step]?.channel === "WHATSAPP" || STEP_BY_KEY[s.step]?.channel === "EMAIL") &&
      isActionable({ status: s.status, dueAt: s.dueAt, actedAt: s.actedAt, outcome: s.outcome }, now),
  );

  for (const s of due) {
    const specialist = row.respTouchpoint?.name ?? cfg.defaultSpecialistName;
    const { body, subject, unresolved } = renderStep(row, s.step, specialist);
    if (!body) continue;

    if (unresolved.length) {
      // Checklist: "no unresolved placeholders reaching the send step". Leave it for a human.
      out.notes.push(`${row.lead.name} · ${s.step}: needs ${unresolved.join(", ")} - left for manual send.`);
      continue;
    }

    const isEmail = STEP_BY_KEY[s.step]?.channel === "EMAIL";
    if (!isEmail && !mapToWhatsAppKind(s.step)) continue; // not a WhatsApp step - nothing to auto-send

    // Shared with the instant-intro path. See `sopWhatsAppSend` for why this is one function.
    const res = isEmail
      ? await sopEmailSend(row, subject, body)
      : await sopWhatsAppSend(row, s.step, specialist, body);

    if (res.sent) {
      await markSent(s.id, body, null, res.messageId);
      out.ok++;
      // Only a real send lands here - every gate above leaves the row DUE for a human, and a
      // feed claiming a message that never left the building is worse than no feed at all.
      const def = STEP_BY_KEY[s.step];
      await logSystemActivity(SYSTEM_ACTORS.outreach, {
        action: "outreach.step.send",
        section: "outreach",
        entityType: "OutreachJourney",
        entityId: row.id,
        summary: `Sent ${row.lead.name} ${def.sopStep} - ${def.label}`,
        meta: { step: s.step, sopStep: def.sopStep, messageId: res.messageId },
      });
    } else {
      // Not a failure of the SOP - usually the WATI layer being off or the touchpoint unmapped.
      // Leave the row DUE so the specialist sends it by hand; that is the designed fallback.
      out.notes.push(`${row.lead.name} · ${s.step}: ${res.error ?? "send skipped"} - left for manual send.`);
      if (res.status === "FAILED") out.failed++;
    }
  }

  return out;
}

/**
 * Send one SOP step through the WATI layer.
 *
 * Extracted from `autoSendDue` so the INSTANT intro path (`outreach-instant.ts`) sends through
 * exactly the same call rather than assembling its own. The variable pool, the audit body, the
 * null `sentById` convention and `logSkips: false` are all load-bearing details that would drift
 * the moment there were two copies of them - and drifting here means sending a prospect the wrong
 * template, which no type would catch.
 *
 * Returns the raw send outcome; the caller decides what to do with a skip. It never marks the step
 * SENT - that stays the caller's job, because only the caller knows which step row it holds.
 */
export async function sopWhatsAppSend(
  row: JourneyRow,
  step: OutreachStep,
  specialistName: string,
  body: string,
) {
  const kind = mapToWhatsAppKind(step);
  if (!kind) return { sent: false, status: "SKIPPED" as const, error: "not a WhatsApp step", messageId: null };
  return sendWhatsApp({
    kind,
    to: row.lead.phone,
    leadId: row.leadId,
    bookingRequestId: row.bookingId ?? undefined,
    vars: whatsappVarsFor(row, step, specialistName),
    bodySummary: body,
    logSkips: false,
  });
}

/**
 * Step 17/18 - actually release the booked discovery call.
 *
 * Both routes into this (BANT below the bar, and no confirmation after two calls) end here, and
 * the founder's instruction is that the calendar is cleared automatically rather than left as a
 * checklist item somebody has to remember. The prospect has already been told on both channels -
 * the planner gates this step behind the notice going out - so nobody finds an empty calendar
 * without an explanation.
 *
 * Mirrors the transaction in `booking-automation.ts`: detach the booking from its slot (freeing
 * the unique `slotId`), re-open the slot so it can be sold again, and walk the lead back to
 * DISCO_NOT_BOOKED so the board shows the truth. Returns what it did, for the activity feed.
 */
async function releaseDiscoBooking(journeyId: string): Promise<{ cancelled: boolean; freedSlot: boolean }> {
  const row = await prisma.outreachJourney.findUnique({
    where: { id: journeyId },
    select: { bookingId: true, leadId: true, booking: { select: { id: true, status: true, slotId: true } } },
  });
  const b = row?.booking;
  // Already cancelled by a human, or never booked: nothing to do, and saying so is not an error.
  if (!b || b.status === "CANCELLED") return { cancelled: false, freedSlot: false };

  const freedSlotId = b.slotId;
  await prisma.$transaction(async (tx) => {
    await tx.bookingRequest.update({ where: { id: b.id }, data: { status: "CANCELLED", slotId: null } });
    if (freedSlotId) {
      await tx.appointmentSlot.update({ where: { id: freedSlotId }, data: { status: "OPEN" } });
    }
    if (row.leadId) {
      const lead = await tx.lead.findUnique({ where: { id: row.leadId }, select: { stage: true } });
      if (lead && lead.stage === "DISCO_BOOKED") {
        await tx.lead.update({ where: { id: row.leadId }, data: { stage: "DISCO_NOT_BOOKED" } });
        await tx.leadStageHistory.create({
          data: { leadId: row.leadId, fromStage: "DISCO_BOOKED", toStage: "DISCO_NOT_BOOKED" },
        });
      }
    }
  });
  return { cancelled: true, freedSlot: Boolean(freedSlotId) };
}

/**
 * Send one SOP step by email, shaped to the same return contract as `sopWhatsAppSend` so the
 * caller's send/mark/log path stays one branch rather than two.
 *
 * Goes through `sendEmailMessage` rather than Resend directly: that is where the EMAIL_ENABLED
 * gate, the `message` delivery log and the recipient allowlist already live, and a second path
 * around them is exactly how an outbound channel ends up unlogged or ungated.
 */
async function sopEmailSend(row: JourneyRow, subject: string | null, body: string) {
  if (!row.lead.email) {
    return { sent: false, status: "SKIPPED" as const, error: "lead has no email address", messageId: null };
  }
  const res = await sendEmailMessage({
    leadId: row.leadId,
    to: row.lead.email,
    subject: subject ?? "Your free Discovery Call spot is still open",
    body,
    // No human pressed send. Matches the null `sentById` convention the WhatsApp path uses.
    sentById: null,
  });
  return {
    sent: res.status === "SENT",
    status: res.status,
    error: res.ok && res.status === "SENT" ? null : res.message,
    messageId: null,
  };
}

/**
 * SOP step → WhatsAppKind. Reuses the existing WATI layer's template mapping, opt-out enforcement
 * and delivery log rather than growing a second one.
 *
 * STRICTLY 1:1, and that matters. The app binds exactly ONE WATI template per kind, so pointing
 * two SOP steps at one kind would send the intro's text where the follow-up's belonged - a silent
 * wrong-message bug that no type would catch. Nine SOP messages, nine kinds, nine templates.
 */
const STEP_TO_KIND = {
  INTRO_WHATSAPP: "SOP_INTRO",
  FOLLOWUP_WHATSAPP: "SOP_FOLLOWUP",
  FOLLOWUP_WHATSAPP_2: "SOP_FOLLOWUP_2",
  // DISCO_REJECT_MSG is DELIBERATELY ABSENT. Business-initiated WhatsApp must use a template Meta
  // has approved, and B2 has none for a not-qualified notice - the closest approved template says
  // "we didn't receive your confirmation", which is untrue here and would be a lie told to a real
  // person. With no mapping the step stays DUE in the queue for a human, which is the correct
  // failure. Map it to SOP_NOT_QUALIFIED once a template is approved in WATI.
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
  const updated = await prisma.outreachStepLog.update({
    where: { id: stepLogId },
    data: {
      status: "SENT",
      actedAt: new Date(),
      actedById,
      renderedBody: body,
      whatsAppMessageId,
    },
    include: { journey: { select: { leadId: true } } },
  });

  /**
   * The board's "WhatsApp Sent" column IS this step.
   *
   * Advancing here rather than at the three call sites - the cron auto-sender, the instant intro
   * at capture, and the specialist's manual "Mark sent" - means every route that can send the
   * intro moves the card, and no future fourth route can forget to. Only from NEW_LEAD: a lead
   * further along has overtaken this signal (see `advanceLeadStage`).
   *
   * Awaited, but it cannot fail the send: the step is already SENT and committed by this point,
   * so the worst case is a card left in Fresh Optins with the message genuinely delivered.
   */
  if (updated.step === "INTRO_WHATSAPP") {
    await advanceLeadStage(updated.journey.leadId, "WHATSAPP_SENT", ["NEW_LEAD"]);
  }
  return updated;
}

/**
 * Re-plan a single journey right now - used after a human action so the next step appears
 * immediately instead of waiting for the cron tick. Same engine, same idempotency.
 */
export async function refreshJourney(journeyId: string): Promise<void> {
  const cfg = await readOutreachConfig();
  const row = await getJourney(journeyId);
  if (!row) return;

  const now = new Date();
  const plan = planJourney(projectJourney(row), now, cfg.sla, { firstCallMode: cfg.firstCallMode });

  for (const m of plan.materialise) {
    try {
      await prisma.outreachStepLog.create({
        data: { journeyId, step: m.step, dueAt: m.dueAt, channel: STEP_BY_KEY[m.step].channel },
      });
    } catch {
      /* unique - already there */
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

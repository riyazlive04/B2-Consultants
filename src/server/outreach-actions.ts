"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { OutreachStep } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSection, requireAdmin, requireSession } from "@/lib/rbac";
import { hasCapability, capabilityDeniedMessage } from "@/lib/capabilities";
import { formatDateTimeInZone } from "@/lib/format";
import { coerceOutreachConfig, DEFAULT_SLA, qualifiedFromBant, STEP_BY_KEY } from "@/lib/outreach-sop";
import { logActivity, diffFields } from "./activity-log";
import {
  getJourney,
  markSent,
  refreshJourney,
  renderStep,
  runBookingCheck,
  runDueOutreach,
  readOutreachConfig,
  writeOutreachConfig,
} from "./outreach";

/**
 * Outreach SOP — server actions.
 *
 * Every action that changes a status records WHO and WHEN (checklist §S: "every status change is
 * timestamped + attributed to a user"). The step log is the audit trail; nothing here mutates a
 * status without leaving one.
 */

export type ActionResult = { ok: true } | { ok: false; error: string };

const PATH = "/outreach";

function fail(error: string): ActionResult {
  return { ok: false, error };
}

// ─────────────────────────────── Step actions ───────────────────────────────

const markSentSchema = z.object({ stepLogId: z.string().min(1) });

/**
 * "I sent it." The default path — the SOP is human-executed and this is the specialist saying so.
 * Re-rendering at mark time (rather than trusting a body posted from the browser) keeps the audit
 * record honest: what we store is what the server would have sent.
 */
export async function markStepSent(form: FormData): Promise<ActionResult> {
  const session = await requireSection("outreach");
  const parsed = markSentSchema.safeParse({ stepLogId: form.get("stepLogId") });
  if (!parsed.success) return fail("Missing step");

  const log = await prisma.outreachStepLog.findUnique({
    where: { id: parsed.data.stepLogId },
    select: { id: true, journeyId: true, step: true, status: true },
  });
  if (!log) return fail("Step not found");
  // Idempotency at the action layer too — a double-click must not double-log.
  if (log.status !== "DUE") return fail(`This step is already ${log.status.toLowerCase()}`);

  const row = await getJourney(log.journeyId);
  if (!row) return fail("Journey not found");

  const cfg = await readOutreachConfig();
  const specialist = row.respTouchpoint?.name ?? session.user.name ?? cfg.defaultSpecialistName;
  const { body, unresolved } = renderStep(row, log.step, specialist);

  if (unresolved.length) {
    return fail(`Can't log this yet — ${unresolved.join(", ")} is still unresolved.`);
  }

  await markSent(log.id, body, session.user.id, null);

  // Step 14's rule: "WhatsApp Sent" flips on actual delivery, never on scheduling (checklist §N).
  // Marking sent IS the delivery event on the manual path, so it flips here and nowhere else.
  if (log.step === "DISCO_CONFIRM_1") {
    await prisma.outreachJourney.update({
      where: { id: log.journeyId },
      data: { whatsappSent: true, whatsappSentAt: new Date() },
    });
  }

  await refreshJourney(log.journeyId);

  await logActivity(session, {
    action: "outreach.step.send",
    section: "outreach",
    entityType: "OutreachStepLog",
    entityId: log.id,
    summary: `Sent "${STEP_BY_KEY[log.step].label}" to ${row.lead.name}`,
    meta: { step: log.step, sopStep: STEP_BY_KEY[log.step].sopStep, journeyId: log.journeyId },
  });

  revalidatePath(PATH);
  return { ok: true };
}

const skipSchema = z.object({ stepLogId: z.string().min(1), note: z.string().trim().max(500).optional() });

export async function skipStep(form: FormData): Promise<ActionResult> {
  const session = await requireSection("outreach");
  const parsed = skipSchema.safeParse({ stepLogId: form.get("stepLogId"), note: form.get("note") ?? undefined });
  if (!parsed.success) return fail("Missing step");

  const log = await prisma.outreachStepLog.findUnique({
    where: { id: parsed.data.stepLogId },
    include: { journey: { select: { lead: { select: { name: true } } } } },
  });
  if (!log) return fail("Step not found");
  if (log.status !== "DUE") return fail(`This step is already ${log.status.toLowerCase()}`);

  await prisma.outreachStepLog.update({
    where: { id: log.id },
    data: { status: "SKIPPED", actedAt: new Date(), actedById: session.user.id, note: parsed.data.note ?? null },
  });
  await refreshJourney(log.journeyId);

  await logActivity(session, {
    action: "outreach.step.cancel",
    section: "outreach",
    entityType: "OutreachStepLog",
    entityId: log.id,
    summary: `Skipped "${STEP_BY_KEY[log.step].label}" for ${log.journey.lead.name}`,
    meta: { step: log.step, note: parsed.data.note ?? null, journeyId: log.journeyId },
  });

  revalidatePath(PATH);
  return { ok: true };
}

const callSchema = z.object({
  stepLogId: z.string().min(1),
  outcome: z.enum(["YES", "NO", "NO_ANSWER"]),
  note: z.string().trim().max(500).optional(),
});

const CALL_OUTCOME_TEXT: Record<string, string> = { YES: "yes", NO: "no", NO_ANSWER: "no answer" };

/**
 * Log a call attempt and its Yes/No outcome (Steps 4, 8, 16).
 *
 * Checklist §H: a "NO" at Step 8 must end this lead's active follow-up cycle — that is the engine's
 * job (`nextPhase` reads the outcome), which `refreshJourney` applies below. Checklist §N: both
 * Step 16 attempts must be logged before the cancellation unlocks, which is why the two attempts
 * are separate steps rather than a counter.
 */
export async function logCallOutcome(form: FormData): Promise<ActionResult> {
  const session = await requireSection("outreach");
  const parsed = callSchema.safeParse({
    stepLogId: form.get("stepLogId"),
    outcome: form.get("outcome"),
    note: form.get("note") ?? undefined,
  });
  if (!parsed.success) return fail("Pick an outcome");

  const log = await prisma.outreachStepLog.findUnique({
    where: { id: parsed.data.stepLogId },
    include: { journey: { select: { lead: { select: { name: true } } } } },
  });
  if (!log) return fail("Step not found");
  if (log.status !== "DUE") return fail(`This step is already ${log.status.toLowerCase()}`);

  await prisma.outreachStepLog.update({
    where: { id: log.id },
    data: {
      status: "SENT",
      actedAt: new Date(),
      actedById: session.user.id,
      outcome: parsed.data.outcome,
      note: parsed.data.note ?? null,
    },
  });

  // A verbal YES at a Step 16 confirmation call is a confirmation — it stops the cancellation
  // ladder exactly as a WhatsApp "YES" would.
  if (
    parsed.data.outcome === "YES" &&
    (log.step === "DISCO_CONFIRM_CALL_1" || log.step === "DISCO_CONFIRM_CALL_2")
  ) {
    await prisma.outreachJourney.update({
      where: { id: log.journeyId },
      data: { whatsappConfirmed: true, whatsappConfirmedAt: new Date() },
    });
  }

  await refreshJourney(log.journeyId);

  await logActivity(session, {
    action: "outreach.call.log",
    section: "outreach",
    entityType: "OutreachStepLog",
    entityId: log.id,
    summary: `Logged a call with ${log.journey.lead.name} for "${STEP_BY_KEY[log.step].label}" — ${CALL_OUTCOME_TEXT[parsed.data.outcome]}`,
    meta: { step: log.step, outcome: parsed.data.outcome, journeyId: log.journeyId },
  });

  revalidatePath(PATH);
  return { ok: true };
}

// ─────────────────────────────── Journey actions ───────────────────────────────

const contactedSchema = z.object({ journeyId: z.string().min(1), at: z.string().optional() });

/**
 * Step 2's "Time Contacted". The SOP has the specialist type this in IST; the column is a UTC
 * instant, so the browser sends an IST wall-clock and we convert with the fixed +05:30 offset
 * (India has no DST, so this is exact — same approach as dates.ts:istWallToUtc).
 */
export async function setContactedAt(form: FormData): Promise<ActionResult> {
  const session = await requireSection("outreach");
  const parsed = contactedSchema.safeParse({
    journeyId: form.get("journeyId"),
    at: form.get("at") ?? undefined,
  });
  if (!parsed.success) return fail("Missing journey");

  let when = new Date();
  if (parsed.data.at) {
    // datetime-local gives "2026-07-15T14:30" with no zone — the specialist means IST.
    const d = new Date(`${parsed.data.at}:00+05:30`);
    if (Number.isNaN(d.getTime())) return fail("That isn't a valid date/time");
    when = d;
  }

  await prisma.outreachJourney.update({
    where: { id: parsed.data.journeyId },
    data: { contactedAt: when },
  });
  // Keep the CRM's own speed-to-lead column in step — it feeds the pipeline's speed pill.
  const j = await prisma.outreachJourney.findUnique({
    where: { id: parsed.data.journeyId },
    select: { leadId: true, lead: { select: { name: true } } },
  });
  if (j) {
    await prisma.lead.update({ where: { id: j.leadId }, data: { contactedAt: when } });
  }

  await refreshJourney(parsed.data.journeyId);

  await logActivity(session, {
    action: "lead.contacted",
    section: "outreach",
    entityType: "OutreachJourney",
    entityId: parsed.data.journeyId,
    summary: `Set the contacted time for ${j?.lead.name ?? "this prospect"} to ${formatDateTimeInZone(when, "Asia/Kolkata")} IST`,
    meta: { contactedAt: when.toISOString(), leadId: j?.leadId ?? null },
  });

  revalidatePath(PATH);
  return { ok: true };
}

/** Step 10, on demand — the "check now" button next to a prospect. */
export async function checkBookingNow(form: FormData): Promise<ActionResult> {
  const session = await requireSection("outreach");
  const journeyId = String(form.get("journeyId") ?? "");
  if (!journeyId) return fail("Missing journey");

  // runBookingCheck answers "is it booked?", not "did this press link it" — it returns true for an
  // already-linked journey without writing. The before-state is what tells a fresh link from a no-op.
  const before = await prisma.outreachJourney.findUnique({
    where: { id: journeyId },
    select: { bookingId: true, lead: { select: { name: true } } },
  });
  const linked = await runBookingCheck(journeyId);
  await refreshJourney(journeyId);

  if (linked && before && !before.bookingId) {
    await logActivity(session, {
      action: "outreach.booking.update",
      section: "outreach",
      entityType: "OutreachJourney",
      entityId: journeyId,
      summary: `Linked ${before.lead.name}'s discovery booking to their outreach journey`,
      meta: { journeyId },
    });
  }

  revalidatePath(PATH);
  return { ok: true };
}

const qualifySchema = z.object({
  journeyId: z.string().min(1),
  qualified: z.enum(["YES", "MAYBE", "NO"]),
});

/**
 * Step 11/12 — record the Qualified verdict.
 *
 * The engine already derives this from BANT automatically; this action exists for the override the
 * SOP implies ("evaluate the data from the appointment booking sheet"). Either way it is
 * attributed and timestamped, which is the audit gap the checklist flags (§K: "Score entry is
 * auditable (who scored, when)").
 */
export async function setQualified(form: FormData): Promise<ActionResult> {
  const session = await requireSection("outreach");
  const parsed = qualifySchema.safeParse({
    journeyId: form.get("journeyId"),
    qualified: form.get("qualified"),
  });
  if (!parsed.success) return fail("Pick a verdict");

  const row = await getJourney(parsed.data.journeyId);
  if (!row) return fail("Journey not found");

  await prisma.outreachJourney.update({
    where: { id: parsed.data.journeyId },
    data: {
      qualified: parsed.data.qualified,
      qualifiedAt: new Date(),
      qualifiedById: session.user.id,
      // Stamp the score the verdict was taken on, so a later re-tune of the BANT model can't
      // silently rewrite history (the gap flagged at §K).
      bantScoreAtQual: row.booking?.bantAvg ?? null,
    },
  });
  await refreshJourney(parsed.data.journeyId);

  await logActivity(session, {
    action: "outreach.qualified.record",
    section: "outreach",
    entityType: "OutreachJourney",
    entityId: parsed.data.journeyId,
    summary: `Recorded the Qualified verdict for ${row.lead.name} — ${parsed.data.qualified}`,
    meta: { qualified: parsed.data.qualified, bantScoreAtQual: row.booking?.bantAvg ?? null },
  });

  revalidatePath(PATH);
  return { ok: true };
}

const assignSchema = z.object({
  journeyId: z.string().min(1),
  respTouchpointId: z.string().optional(),
  respDiscoId: z.string().optional(),
});

/** Step 12 — the two Key Metrics assignment dropdowns. */
export async function assignResponsibilities(form: FormData): Promise<ActionResult> {
  const session = await requireSection("outreach");
  const parsed = assignSchema.safeParse({
    journeyId: form.get("journeyId"),
    respTouchpointId: form.get("respTouchpointId") ?? undefined,
    respDiscoId: form.get("respDiscoId") ?? undefined,
  });
  if (!parsed.success) return fail("Missing journey");

  const j = await prisma.outreachJourney.update({
    where: { id: parsed.data.journeyId },
    data: {
      respTouchpointId: parsed.data.respTouchpointId || null,
      respDiscoId: parsed.data.respDiscoId || null,
    },
    include: {
      lead: { select: { name: true } },
      respTouchpoint: { select: { name: true } },
      respDisco: { select: { name: true } },
    },
  });

  await logActivity(session, {
    action: "outreach.responsibilities.assign",
    section: "outreach",
    entityType: "OutreachJourney",
    entityId: j.id,
    summary: `Assigned ${j.lead.name}'s outreach — touchpoint ${j.respTouchpoint?.name ?? "nobody"}, discovery ${j.respDisco?.name ?? "nobody"}`,
    meta: { respTouchpointId: j.respTouchpointId, respDiscoId: j.respDiscoId },
  });

  revalidatePath(PATH);
  return { ok: true };
}

const confirmSchema = z.object({ journeyId: z.string().min(1), confirmed: z.enum(["YES", "NO"]) });

/**
 * Steps 14/15 — "WhatsApp Confirmed".
 *
 * Only an explicit prospect confirmation sets this (checklist §N). Note the app's WATI webhook
 * treats ANY inbound reply as a confirmation; that is fixed separately (see wati/webhook) — but
 * this manual path is the authoritative one, because the specialist has read the reply.
 */
export async function setWhatsappConfirmed(form: FormData): Promise<ActionResult> {
  const session = await requireSection("outreach");
  const parsed = confirmSchema.safeParse({
    journeyId: form.get("journeyId"),
    confirmed: form.get("confirmed"),
  });
  if (!parsed.success) return fail("Missing value");

  const yes = parsed.data.confirmed === "YES";
  const j = await prisma.outreachJourney.update({
    where: { id: parsed.data.journeyId },
    data: {
      whatsappConfirmed: yes,
      whatsappConfirmedAt: yes ? new Date() : null,
      // Step 16: a NO marks the row RED. redFlag is its own field precisely so it can never
      // silently overwrite another status column (checklist §N).
      ...(yes ? {} : { redFlag: true, redFlagReason: "No confirmation for the Discovery call (Step 16)" }),
    },
    include: { lead: { select: { name: true } } },
  });
  await refreshJourney(parsed.data.journeyId);

  await logActivity(session, {
    action: "outreach.disco.confirm",
    section: "outreach",
    entityType: "OutreachJourney",
    entityId: j.id,
    summary: yes
      ? `${j.lead.name} confirmed their Discovery call`
      : `${j.lead.name} did not confirm their Discovery call — flagged red`,
    meta: { whatsappConfirmed: yes },
  });

  revalidatePath(PATH);
  return { ok: true };
}

/** Steps 19/20 — "Sales Call Confirmed". */
export async function setSalesCallConfirmed(form: FormData): Promise<ActionResult> {
  const session = await requireSection("outreach");
  const parsed = confirmSchema.safeParse({
    journeyId: form.get("journeyId"),
    confirmed: form.get("confirmed"),
  });
  if (!parsed.success) return fail("Missing value");

  const yes = parsed.data.confirmed === "YES";
  const j = await prisma.outreachJourney.update({
    where: { id: parsed.data.journeyId },
    data: {
      salesCallConfirmed: yes,
      salesCallConfirmedAt: yes ? new Date() : null,
      ...(yes ? {} : { redFlag: true, redFlagReason: "No confirmation for the SSS call (Step 21)" }),
    },
    include: { lead: { select: { name: true } } },
  });
  await refreshJourney(parsed.data.journeyId);

  await logActivity(session, {
    action: "outreach.sss.confirm",
    section: "outreach",
    entityType: "OutreachJourney",
    entityId: j.id,
    summary: yes
      ? `${j.lead.name} confirmed their SSS call`
      : `${j.lead.name} did not confirm their SSS call — flagged red`,
    meta: { salesCallConfirmed: yes },
  });

  revalidatePath(PATH);
  return { ok: true };
}

const hqSchema = z.object({
  journeyId: z.string().min(1),
  highlyQualified: z.enum(["YES", "NO"]),
  sssAt: z.string().optional(),
});

/**
 * Step 18 — the Discovery Specialist's "Highly Qualified" verdict.
 *
 * THE role boundary the checklist calls out (§P: "writable only by Discovery Specialist role
 * (permission check)"). Guarded by the `outreach.qualify` capability — Admin grants it to Asma,
 * and an Outreach Specialist holding only `requireSection("outreach")` is refused here.
 *
 * This is deliberately a hard error rather than a redirect: the outreach specialist can SEE the
 * field (they need to read the verdict to know whether Step 19 runs), they simply cannot write it.
 */
export async function setHighlyQualified(form: FormData): Promise<ActionResult> {
  const session = await requireSection("outreach");
  if (!hasCapability(session.role, session.capabilities, "outreach.qualify")) {
    return fail(capabilityDeniedMessage("outreach.qualify"));
  }

  const parsed = hqSchema.safeParse({
    journeyId: form.get("journeyId"),
    highlyQualified: form.get("highlyQualified"),
    sssAt: form.get("sssAt") ?? undefined,
  });
  if (!parsed.success) return fail("Pick a verdict");

  const yes = parsed.data.highlyQualified === "YES";
  let sssAt: Date | null = null;
  if (yes && parsed.data.sssAt) {
    const d = new Date(`${parsed.data.sssAt}:00+05:30`); // IST wall-clock, as entered
    if (Number.isNaN(d.getTime())) return fail("That isn't a valid SSS date/time");
    sssAt = d;
  }
  if (yes && !sssAt) return fail("A Highly Qualified prospect needs an SSS date/time to confirm against");

  const j = await prisma.outreachJourney.update({
    where: { id: parsed.data.journeyId },
    data: { highlyQualified: yes, highlyQualifiedAt: new Date(), sssAt },
    include: { lead: { select: { name: true } } },
  });
  await refreshJourney(parsed.data.journeyId);

  await logActivity(session, {
    action: "outreach.highlyQualified.record",
    section: "outreach",
    entityType: "OutreachJourney",
    entityId: j.id,
    summary: yes
      ? `Marked ${j.lead.name} Highly Qualified${sssAt ? ` — SSS on ${formatDateTimeInZone(sssAt, "Asia/Kolkata")} IST` : ""}`
      : `Marked ${j.lead.name} not Highly Qualified`,
    meta: { highlyQualified: yes, sssAt: sssAt?.toISOString() ?? null },
  });

  revalidatePath(PATH);
  return { ok: true };
}

const zoomSchema = z.object({ journeyId: z.string().min(1), zoomLink: z.string().trim().max(500) });

/** Cross-cutting §R — the Zoom link the confirmation templates need. */
export async function setZoomLink(form: FormData): Promise<ActionResult> {
  const session = await requireSection("outreach");
  const parsed = zoomSchema.safeParse({
    journeyId: form.get("journeyId"),
    zoomLink: form.get("zoomLink"),
  });
  if (!parsed.success) return fail("Missing link");

  const link = parsed.data.zoomLink;
  if (link && !/^https?:\/\//i.test(link)) return fail("A Zoom link must start with http(s)://");

  const before = await prisma.outreachJourney.findUnique({
    where: { id: parsed.data.journeyId },
    select: { zoomLink: true, lead: { select: { name: true } } },
  });

  const j = await prisma.outreachJourney.update({
    where: { id: parsed.data.journeyId },
    data: { zoomLink: link || null },
  });

  const diff = diffFields({ zoomLink: before?.zoomLink ?? null }, { zoomLink: j.zoomLink });
  if (diff.changed.length) {
    await logActivity(session, {
      action: "outreach.zoom.update",
      section: "outreach",
      entityType: "OutreachJourney",
      entityId: j.id,
      summary: j.zoomLink
        ? `Set the Zoom link for ${before?.lead.name ?? "this prospect"}`
        : `Cleared the Zoom link for ${before?.lead.name ?? "this prospect"}`,
      meta: diff,
    });
  }

  revalidatePath(PATH);
  return { ok: true };
}

// ─────────────────────────────── Admin ───────────────────────────────

/** "Run the engine now" — the same entry point the cron hits. */
export async function runOutreachNow(): Promise<ActionResult> {
  const session = await requireAdmin();
  const run = await runDueOutreach();

  // A disabled engine returns early having written nothing — that is a no-op, not an action taken.
  if (run.enabled) {
    await logActivity(session, {
      action: "outreach.engine.run",
      section: "outreach",
      entityType: "OutreachConfig",
      entityId: "outreachConfig",
      summary: `Ran the outreach engine — ${run.scanned} scanned, ${run.autoSent} sent, ${run.materialised} steps raised`,
      meta: {
        scanned: run.scanned, materialised: run.materialised, superseded: run.superseded,
        autoSent: run.autoSent, autoFailed: run.autoFailed, phaseChanges: run.phaseChanges,
      },
    });
  }

  revalidatePath(PATH);
  return { ok: true };
}

/**
 * Outreach settings. Admin-only: these toggles decide whether messages leave the building, and
 * the SLA windows are the SOP's contract with the team.
 */
const CONFIG_FIELD_LABELS: Record<string, string> = {
  enabled: "Engine on/off", autoSend: "Auto-send steps", sla: "SLA windows",
  defaultSpecialistName: "Default specialist", maxPerRun: "Max per run",
};

export async function saveOutreachConfig(form: FormData): Promise<ActionResult> {
  const session = await requireAdmin();

  const num = (k: string, fallback: number) => {
    const raw = form.get(k);
    const n = Number(raw);
    return raw !== null && raw !== "" && Number.isFinite(n) && n > 0 ? n : fallback;
  };

  const current = await readOutreachConfig();
  const autoSend: Record<string, boolean> = {};
  for (const [k, v] of form.entries()) {
    if (k.startsWith("auto:") && v === "on") autoSend[k.slice(5) as OutreachStep] = true;
  }

  const cfg = coerceOutreachConfig({
    enabled: form.get("enabled") === "on",
    autoSend,
    defaultSpecialistName: String(form.get("defaultSpecialistName") ?? current.defaultSpecialistName),
    maxPerRun: num("maxPerRun", current.maxPerRun),
    sla: {
      reactionMinutes: num("reactionMinutes", DEFAULT_SLA.reactionMinutes),
      check1Hours: num("check1Hours", DEFAULT_SLA.check1Hours),
      check2Hours: num("check2Hours", DEFAULT_SLA.check2Hours),
      finalCheckHours: num("finalCheckHours", DEFAULT_SLA.finalCheckHours),
      discoConfirm1LeadHours: num("discoConfirm1LeadHours", DEFAULT_SLA.discoConfirm1LeadHours),
      discoConfirm2LeadHours: num("discoConfirm2LeadHours", DEFAULT_SLA.discoConfirm2LeadHours),
      discoCancelLeadHours: num("discoCancelLeadHours", DEFAULT_SLA.discoCancelLeadHours),
      sssConfirm1LeadHours: num("sssConfirm1LeadHours", DEFAULT_SLA.sssConfirm1LeadHours),
      sssConfirm2LeadHours: num("sssConfirm2LeadHours", DEFAULT_SLA.sssConfirm2LeadHours),
      sssCancelLeadHours: num("sssCancelLeadHours", DEFAULT_SLA.sssCancelLeadHours),
    },
  });

  await writeOutreachConfig(cfg);

  const diff = diffFields(current, cfg);
  if (diff.changed.length) {
    const changed = diff.changed.map((k) => CONFIG_FIELD_LABELS[k] ?? k).join(", ");
    await logActivity(session, {
      action: "outreach.config.update",
      section: "outreach",
      entityType: "AppSetting",
      entityId: "outreachConfig",
      summary: `Changed the outreach settings — ${changed}${cfg.enabled === current.enabled ? "" : cfg.enabled ? " (engine ON)" : " (engine OFF)"}`,
      meta: diff,
    });
  }

  revalidatePath(PATH);
  return { ok: true };
}

/**
 * Backfill journeys for leads captured before the SOP engine existed. Idempotent (ensureJourney
 * is keyed on leadId), so it is safe to press twice.
 */
export async function backfillJourneys(): Promise<ActionResult> {
  const session = await requireAdmin();
  const leads = await prisma.lead.findMany({
    where: { outreachJourney: { is: null } },
    select: { id: true, createdAt: true },
    take: 1000,
    orderBy: { createdAt: "desc" },
  });
  let created = 0;
  for (const l of leads) {
    const row = await prisma.outreachJourney
      .create({ data: { leadId: l.id, optInAt: l.createdAt } })
      .catch(() => null);
    if (row) created++;
  }

  if (created) {
    await logActivity(session, {
      action: "outreach.journeys.create",
      section: "outreach",
      entityType: "OutreachJourney",
      entityId: "backfill",
      summary: `Backfilled ${created} outreach journey${created === 1 ? "" : "s"} for leads captured before the SOP engine`,
      meta: { created, scanned: leads.length },
    });
  }

  revalidatePath(PATH);
  return { ok: true };
}

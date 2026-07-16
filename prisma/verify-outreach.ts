/**
 * Outreach SOP — end-to-end scenario verification.
 *
 * Drives the five journeys the QA checklist's Step 6 names, against the REAL database and the
 * REAL engine (no mocks below the engine's `now` parameter). Complements the pure unit tests in
 * src/lib/__tests__: those prove the ladder's arithmetic, this proves the wiring — that a lead
 * landing in the DB actually produces the right rows, phases and terminal states.
 *
 * Safe to re-run: every fixture is namespaced by RUN_TAG and torn down at the end.
 *
 * Run: npm run verify:outreach
 */

import { PrismaClient, type OutreachStep } from "@prisma/client";
import { planJourney, type JourneyState } from "../src/lib/outreach-engine";
import { DEFAULT_SLA, qualifiedFromBant } from "../src/lib/outreach-sop";

const prisma = new PrismaClient();
const RUN_TAG = `sop-verify-${Date.now()}`;
const HR = 3_600_000;
const MIN = 60_000;

let passed = 0;
let failed = 0;

function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

/**
 * Walk a journey the way the cron does, but with an injectable clock so a multi-day SOP can be
 * verified in milliseconds. Mirrors runDueOutreach's materialise/supersede/phase loop.
 */
async function tick(journeyId: string, now: Date) {
  const row = await prisma.outreachJourney.findUnique({
    where: { id: journeyId },
    include: { steps: true, booking: { include: { slot: true } } },
  });
  if (!row) throw new Error("journey vanished");

  const steps: JourneyState["steps"] = {};
  for (const s of row.steps) {
    steps[s.step] = { status: s.status, dueAt: s.dueAt, actedAt: s.actedAt, outcome: s.outcome };
  }
  const state: JourneyState = {
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

  const plan = planJourney(state, now, DEFAULT_SLA);
  for (const m of plan.materialise) {
    const channel =
      m.step.includes("CALL") && !m.step.includes("CANCEL")
        ? "CALL"
        : m.step.startsWith("CHECK") || m.step.includes("FINAL") || m.step.includes("BANT") || m.step.includes("KEY_METRICS") || m.step.endsWith("_CANCEL")
          ? "SYSTEM"
          : "WHATSAPP";
    await prisma.outreachStepLog
      .create({ data: { journeyId, step: m.step, dueAt: m.dueAt, channel } })
      .catch(() => null);
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
  return plan;
}

/** Act on a step, as the specialist would. */
async function act(journeyId: string, step: OutreachStep, at: Date, outcome: string | null = null) {
  await prisma.outreachStepLog.updateMany({
    where: { journeyId, step, status: "DUE" },
    data: { status: "SENT", actedAt: at, outcome },
  });
}

async function phaseOf(journeyId: string) {
  return (await prisma.outreachJourney.findUniqueOrThrow({ where: { id: journeyId } })).phase;
}

async function stepStatus(journeyId: string, step: OutreachStep) {
  const s = await prisma.outreachStepLog.findUnique({ where: { journeyId_step: { journeyId, step } } });
  return s?.status ?? null;
}

async function makeLead(name: string, phone: string, email: string) {
  const lead = await prisma.lead.create({
    data: {
      name,
      phone,
      email,
      leadSource: "OTHER",
      dateIn: new Date(),
      source: "MANUAL",
      externalRef: `${RUN_TAG}-${phone}`,
      notes: RUN_TAG,
    },
  });
  const journey = await prisma.outreachJourney.create({
    data: { leadId: lead.id, optInAt: new Date() },
  });
  return { lead, journey };
}

async function makeBooking(leadId: string, email: string, phone: string, startsAt: Date, bantAvg: number) {
  const slot = await prisma.appointmentSlot.create({ data: { startsAt, status: "BOOKED" } });
  return prisma.bookingRequest.create({
    data: {
      slotId: slot.id,
      leadId,
      name: RUN_TAG,
      email,
      phone,
      bantAvg,
      bantScore: Math.round(bantAvg),
      bantVerdict: bantAvg > 3 ? "CONFIRM" : bantAvg >= 2 ? "DOUBT" : "CANCEL",
      externalRef: `${RUN_TAG}-b-${phone}`,
    },
  });
}

// ═══════════════════════════════════════════════════════════════════

async function scenarioGoldenPath() {
  console.log("\n1. Golden path — opt-in → contacted in 3 min → books → BANT YES → confirms → SSS confirmed");
  const t0 = new Date();
  const { lead, journey } = await makeLead("Golden Path", "+919000000001", "golden@example.com");
  const jid = journey.id;

  await tick(jid, t0);
  check("intro materialised", (await stepStatus(jid, "INTRO_WHATSAPP")) === "DUE");

  await prisma.outreachJourney.update({ where: { id: jid }, data: { contactedAt: new Date(t0.getTime() + 3 * MIN) } });
  await act(jid, "INTRO_WHATSAPP", new Date(t0.getTime() + 3 * MIN));

  // Books before check 1 would even fire.
  const discoAt = new Date(t0.getTime() + 100 * HR);
  const booking = await makeBooking(lead.id, "GOLDEN@Example.com ", "+919000000001", discoAt, 4.2);
  await prisma.outreachJourney.update({ where: { id: jid }, data: { bookingId: booking.id } });

  await tick(jid, new Date(t0.getTime() + 10 * MIN));
  check("phase → QUALIFICATION on booking", (await phaseOf(jid)) === "QUALIFICATION");
  check("BANT step materialised", (await stepStatus(jid, "BANT_QUALIFICATION")) === "DUE");

  const verdict = qualifiedFromBant(4.2);
  check("BANT 4.2 → Qualified YES", verdict === "YES");
  await prisma.outreachJourney.update({ where: { id: jid }, data: { qualified: verdict, bantScoreAtQual: 4.2 } });
  await act(jid, "BANT_QUALIFICATION", new Date(t0.getTime() + 11 * MIN));
  await tick(jid, new Date(t0.getTime() + 12 * MIN));
  await act(jid, "KEY_METRICS_TRANSFER", new Date(t0.getTime() + 12 * MIN));
  await tick(jid, new Date(t0.getTime() + 13 * MIN));

  check("Step 13 disco welcome materialised", (await stepStatus(jid, "DISCO_WELCOME")) === "DUE");
  check("phase → DISCO_CONFIRMATION", (await phaseOf(jid)) === "DISCO_CONFIRMATION");

  await act(jid, "DISCO_WELCOME", new Date(t0.getTime() + 14 * MIN));
  await tick(jid, new Date(t0.getTime() + 15 * MIN));

  const c1 = await prisma.outreachStepLog.findUnique({ where: { journeyId_step: { journeyId: jid, step: "DISCO_CONFIRM_1" } } });
  check(
    "Step 14 due exactly 36h before the call",
    c1 !== null && Math.abs(c1.dueAt.getTime() - (discoAt.getTime() - 36 * HR)) < 1000,
    c1 ? `due ${c1.dueAt.toISOString()}` : "missing",
  );

  // Prospect confirms after Step 14.
  await act(jid, "DISCO_CONFIRM_1", new Date(discoAt.getTime() - 36 * HR));
  await prisma.outreachJourney.update({
    where: { id: jid },
    data: { whatsappSent: true, whatsappConfirmed: true, whatsappConfirmedAt: new Date() },
  });
  await tick(jid, new Date(discoAt.getTime() - 30 * HR));

  check("phase → AWAITING_DISCO once confirmed", (await phaseOf(jid)) === "AWAITING_DISCO");
  check("Step 15 never fires after confirmation", (await stepStatus(jid, "DISCO_CONFIRM_2")) === null);

  // Discovery says highly qualified; SSS booked.
  const sssAt = new Date(discoAt.getTime() + 48 * HR);
  await prisma.outreachJourney.update({
    where: { id: jid },
    data: { highlyQualified: true, highlyQualifiedAt: new Date(), sssAt },
  });
  await tick(jid, new Date(discoAt.getTime() + 1 * HR));
  check("phase → SSS_CONFIRMATION on HQ=YES", (await phaseOf(jid)) === "SSS_CONFIRMATION");

  const s1 = await prisma.outreachStepLog.findUnique({ where: { journeyId_step: { journeyId: jid, step: "SSS_CONFIRM_1" } } });
  check(
    "Step 19 due exactly 24h before the SSS",
    s1 !== null && Math.abs(s1.dueAt.getTime() - (sssAt.getTime() - 24 * HR)) < 1000,
  );

  await act(jid, "SSS_CONFIRM_1", new Date(sssAt.getTime() - 24 * HR));
  await prisma.outreachJourney.update({ where: { id: jid }, data: { salesCallConfirmed: true, salesCallConfirmedAt: new Date() } });
  await tick(jid, new Date(sssAt.getTime() - 20 * HR));
  check("phase → COMPLETED on Sales Call Confirmed", (await phaseOf(jid)) === "COMPLETED");
}

async function scenarioSlowReply() {
  console.log("\n2. Slow reply — contacted at 8 min → never books → all 3 checks → IGNORE");
  const t0 = new Date();
  const { journey } = await makeLead("Slow Reply", "+919000000002", "slow@example.com");
  const jid = journey.id;

  // Nobody contacted them inside 5 minutes.
  await tick(jid, new Date(t0.getTime() + 8 * MIN));
  check("intro SKIPPED on the >5-min branch", (await stepStatus(jid, "INTRO_WHATSAPP")) === null);
  check("jumps straight to the Step 10 check", (await stepStatus(jid, "CHECK_1")) === "DUE");

  await act(jid, "CHECK_1", new Date(t0.getTime() + 9 * MIN), "NOT_BOOKED");
  await tick(jid, new Date(t0.getTime() + 10 * MIN));
  check("Step 6 follow-up materialised", (await stepStatus(jid, "FOLLOWUP_WHATSAPP")) === "DUE");

  await act(jid, "FOLLOWUP_WHATSAPP", new Date(t0.getTime() + 11 * MIN));
  await tick(jid, new Date(t0.getTime() + 12 * MIN));
  const c2 = await prisma.outreachStepLog.findUniqueOrThrow({ where: { journeyId_step: { journeyId: jid, step: "CHECK_2" } } });
  check(
    "Check 2 due 1h after the follow-up",
    Math.abs(c2.dueAt.getTime() - (t0.getTime() + 11 * MIN + 1 * HR)) < 1000,
  );

  await act(jid, "CHECK_2", new Date(t0.getTime() + 71 * MIN), "NOT_BOOKED");
  await tick(jid, new Date(t0.getTime() + 72 * MIN));
  await act(jid, "FOLLOWUP_CALL", new Date(t0.getTime() + 73 * MIN), "NO_ANSWER");
  await tick(jid, new Date(t0.getTime() + 74 * MIN));

  const fc = await prisma.outreachStepLog.findUniqueOrThrow({ where: { journeyId_step: { journeyId: jid, step: "FINAL_CHECK" } } });
  check("Final check due 2h after Step 8", Math.abs(fc.dueAt.getTime() - (t0.getTime() + 73 * MIN + 2 * HR)) < 1000);

  await act(jid, "FINAL_CHECK", new Date(t0.getTime() + 194 * MIN), "NOT_BOOKED");
  await tick(jid, new Date(t0.getTime() + 195 * MIN));
  check("phase → IGNORED", (await phaseOf(jid)) === "IGNORED");

  const lead = await prisma.lead.findFirst({ where: { phone: "+919000000002" } });
  check("lead is NOT deleted — stays in records (§I)", lead !== null);
}

async function scenarioGhost() {
  console.log("\n3. Ghost prospect — books → never confirms through 14/15/16 → cancelled + RED");
  const t0 = new Date();
  const { lead, journey } = await makeLead("Ghost Prospect", "+919000000003", "ghost@example.com");
  const jid = journey.id;
  const discoAt = new Date(t0.getTime() + 100 * HR);

  const booking = await makeBooking(lead.id, "ghost@example.com", "+919000000003", discoAt, 3.5);
  await prisma.outreachJourney.update({
    where: { id: jid },
    data: { bookingId: booking.id, qualified: "YES", zoomLink: "https://zoom.us/j/verify" },
  });
  await tick(jid, t0);
  await act(jid, "BANT_QUALIFICATION", t0);
  await tick(jid, t0);
  await act(jid, "KEY_METRICS_TRANSFER", t0);
  await tick(jid, t0);
  await act(jid, "DISCO_WELCOME", t0);
  await tick(jid, t0);

  await act(jid, "DISCO_CONFIRM_1", new Date(discoAt.getTime() - 36 * HR));
  await tick(jid, new Date(discoAt.getTime() - 36 * HR));
  await act(jid, "DISCO_CONFIRM_2", new Date(discoAt.getTime() - 24 * HR));
  await tick(jid, new Date(discoAt.getTime() - 24 * HR));

  check("call attempt 1 materialised", (await stepStatus(jid, "DISCO_CONFIRM_CALL_1")) === "DUE");
  check(
    "cancellation LOCKED until both calls are logged",
    (await stepStatus(jid, "DISCO_CANCEL_MSG")) === null,
  );

  await act(jid, "DISCO_CONFIRM_CALL_1", new Date(discoAt.getTime() - 23 * HR), "NO_ANSWER");
  await tick(jid, new Date(discoAt.getTime() - 23 * HR));
  check("still locked after only ONE call", (await stepStatus(jid, "DISCO_CANCEL_MSG")) === null);

  await act(jid, "DISCO_CONFIRM_CALL_2", new Date(discoAt.getTime() - 22 * HR), "NO_ANSWER");
  await tick(jid, new Date(discoAt.getTime() - 22 * HR));

  const cm = await prisma.outreachStepLog.findUnique({ where: { journeyId_step: { journeyId: jid, step: "DISCO_CANCEL_MSG" } } });
  check("cancellation unlocks after BOTH calls", cm !== null);
  check(
    "cancellation due exactly 12h before the call",
    cm !== null && Math.abs(cm.dueAt.getTime() - (discoAt.getTime() - 12 * HR)) < 1000,
  );

  await act(jid, "DISCO_CANCEL_MSG", new Date(discoAt.getTime() - 12 * HR));
  await prisma.outreachJourney.update({
    where: { id: jid },
    data: { whatsappConfirmed: false, redFlag: true, redFlagReason: "No confirmation for the Discovery call (Step 16)" },
  });
  await tick(jid, new Date(discoAt.getTime() - 11 * HR));
  await act(jid, "DISCO_CANCEL", new Date(discoAt.getTime() - 11 * HR));
  await tick(jid, new Date(discoAt.getTime() - 10 * HR));

  const j = await prisma.outreachJourney.findUniqueOrThrow({ where: { id: jid } });
  check("phase → CANCELLED", j.phase === "CANCELLED");
  check("row marked RED", j.redFlag === true);
  check("RED did not clobber other status fields", j.qualified === "YES" && j.bookingId === booking.id);
}

async function scenarioNotQualified() {
  console.log("\n4. Not qualified — BANT NO → straight to Step 17, skips Disco welcome entirely");
  const t0 = new Date();
  const { lead, journey } = await makeLead("Not Qualified", "+919000000004", "nq@example.com");
  const jid = journey.id;
  const discoAt = new Date(t0.getTime() + 100 * HR);

  const booking = await makeBooking(lead.id, "nq@example.com", "+919000000004", discoAt, 1.2);
  const verdict = qualifiedFromBant(1.2);
  check("BANT 1.2 → Qualified NO", verdict === "NO");

  await prisma.outreachJourney.update({ where: { id: jid }, data: { bookingId: booking.id, qualified: verdict } });
  await tick(jid, t0);
  await act(jid, "BANT_QUALIFICATION", t0);
  await tick(jid, t0);
  await act(jid, "KEY_METRICS_TRANSFER", t0);
  await tick(jid, t0);

  check("Step 13 disco welcome NEVER materialises", (await stepStatus(jid, "DISCO_WELCOME")) === null);
  check("Step 17 cancellation materialised", (await stepStatus(jid, "DISCO_CANCEL")) === "DUE");
  check("no confirmation ladder", (await stepStatus(jid, "DISCO_CONFIRM_1")) === null);

  await act(jid, "DISCO_CANCEL", new Date(t0.getTime() + 1 * MIN));
  await tick(jid, new Date(t0.getTime() + 2 * MIN));
  check("phase → CANCELLED", (await phaseOf(jid)) === "CANCELLED");
}

async function scenarioDiscoverySaysNo() {
  console.log("\n5. Discovery says no — HQ = NO → terminates, no SSS message ever fires");
  const t0 = new Date();
  const { lead, journey } = await makeLead("Discovery No", "+919000000005", "dno@example.com");
  const jid = journey.id;
  const discoAt = new Date(t0.getTime() + 10 * HR);

  const booking = await makeBooking(lead.id, "dno@example.com", "+919000000005", discoAt, 4.0);
  await prisma.outreachJourney.update({
    where: { id: jid },
    data: { bookingId: booking.id, qualified: "YES", whatsappConfirmed: true, whatsappConfirmedAt: new Date() },
  });
  await tick(jid, t0);
  await act(jid, "BANT_QUALIFICATION", t0);
  await tick(jid, t0);
  await act(jid, "KEY_METRICS_TRANSFER", t0);
  await tick(jid, t0);

  // Discovery Specialist's verdict: not highly qualified. Note an SSS time is even present —
  // the gate must be the verdict, not the absence of a date.
  await prisma.outreachJourney.update({
    where: { id: jid },
    data: { highlyQualified: false, highlyQualifiedAt: new Date(), sssAt: new Date(t0.getTime() + 100 * HR) },
  });
  const plan = await tick(jid, new Date(t0.getTime() + 12 * HR));

  check("phase → CLOSED_NOT_HQ", (await phaseOf(jid)) === "CLOSED_NOT_HQ");
  check(
    "no SSS step is ever planned",
    plan.materialise.every((m) => !m.step.startsWith("SSS_")),
    plan.materialise.map((m) => m.step).join(","),
  );
  const sssRows = await prisma.outreachStepLog.count({
    where: { journeyId: jid, step: { in: ["SSS_CONFIRM_1", "SSS_CONFIRM_2", "SSS_CANCEL_MSG", "SSS_CANCEL"] } },
  });
  check("no SSS rows exist in the database", sssRows === 0);
}

async function scenarioIdempotency() {
  console.log("\n6. Idempotency — the cron running twice must not double-anything");
  const t0 = new Date();
  const { journey } = await makeLead("Idempotent", "+919000000006", "idem@example.com");
  const jid = journey.id;

  await tick(jid, t0);
  const after1 = await prisma.outreachStepLog.count({ where: { journeyId: jid } });
  await tick(jid, t0);
  await tick(jid, t0);
  const after3 = await prisma.outreachStepLog.count({ where: { journeyId: jid } });
  check("three ticks produce the same rows as one", after1 === after3, `${after1} vs ${after3}`);

  // The DB constraint, not just the engine's own check.
  let blocked = false;
  try {
    await prisma.outreachStepLog.create({
      data: { journeyId: jid, step: "INTRO_WHATSAPP", dueAt: t0, channel: "WHATSAPP" },
    });
  } catch {
    blocked = true;
  }
  check("@@unique([journeyId, step]) blocks a duplicate at the DB level", blocked);
}

async function cleanup() {
  const leads = await prisma.lead.findMany({ where: { notes: RUN_TAG }, select: { id: true } });
  const ids = leads.map((l) => l.id);
  // Journeys + step logs cascade from Lead; bookings/slots need explicit removal.
  const bookings = await prisma.bookingRequest.findMany({
    where: { name: RUN_TAG },
    select: { id: true, slotId: true },
  });
  await prisma.outreachJourney.deleteMany({ where: { leadId: { in: ids } } });
  await prisma.bookingRequest.deleteMany({ where: { name: RUN_TAG } });
  await prisma.appointmentSlot.deleteMany({
    where: { id: { in: bookings.map((b) => b.slotId).filter((x): x is string => x !== null) } },
  });
  await prisma.leadStageHistory.deleteMany({ where: { leadId: { in: ids } } });
  await prisma.lead.deleteMany({ where: { id: { in: ids } } });
}

async function main() {
  console.log(`Outreach SOP — end-to-end verification (${RUN_TAG})`);
  try {
    await scenarioGoldenPath();
    await scenarioSlowReply();
    await scenarioGhost();
    await scenarioNotQualified();
    await scenarioDiscoverySaysNo();
    await scenarioIdempotency();
  } finally {
    await cleanup();
    await prisma.$disconnect();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch(async (e) => {
  console.error(e);
  await cleanup().catch(() => {});
  await prisma.$disconnect();
  process.exit(1);
});

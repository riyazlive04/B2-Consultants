import "server-only";
import { prisma } from "@/lib/prisma";
import { istToday } from "@/lib/dates";
import { ACTIVE } from "@/lib/soft-delete";
import { formatDate, formatInrMinor } from "@/lib/format";
import { aggInrMinor } from "@/lib/money";
import { stageFor, channelFor, daysPastDue, dunningCopy, type DunningStage } from "@/lib/dunning-ladder";
import { getDunningConfig } from "./founder-config";
import { sendEmailMessage } from "./messaging";
import { sendPaymentReminderFor } from "./whatsapp";
import { logSystemActivity, SYSTEM_ACTORS } from "./activity-log";
import { captureException } from "@/lib/observability";

/**
 * The dunning ladder — the engine.
 *
 * REPLACES `payment-email-reminders.ts`, which sent ONE message, deduped by string-matching its
 * own subject line against the Message table, and had no concept of escalation. All of the
 * "which rung" judgement now lives in lib/dunning-ladder.ts (pure, unit-tested); this file
 * queries, sends and records.
 *
 * FOUR SAFETY PROPERTIES, in the order they matter:
 *
 *  1. SHIPS OFF. This talks to paying students — the highest-consequence outbound in the app.
 *  2. PER-RUN CAP. The first armed run meets the entire standing backlog at once. Uncapped that
 *     is a mailbomb with the founders' name on it; capped it is a queue that drains over days,
 *     which is also how a person would have done it.
 *  3. RE-CHECKS PAYMENT IMMEDIATELY BEFORE SENDING. Chasing someone who has already paid is
 *     worse than not chasing at all.
 *  4. RECORDS THE RUNG EVEN WHEN THE SEND FAILED. A Resend outage must not queue up a burst for
 *     when service returns.
 */

export type DunningRun = {
  enabled: boolean;
  ranAt: string;
  /** Instalments whose ladder said a stage was due. */
  due: number;
  sent: number;
  skipped: number;
  failed: number;
  /** Had a stage due but no usable contact details. */
  noContact: number;
  /** Left for the next run because the per-run cap was hit. */
  deferred: number;
  byStage: Record<DunningStage, number>;
  reason?: string;
};

function emptyRun(enabled: boolean, reason?: string): DunningRun {
  return {
    enabled,
    ranAt: new Date().toISOString(),
    due: 0, sent: 0, skipped: 0, failed: 0, noContact: 0, deferred: 0,
    byStage: { UPCOMING: 0, MISSED: 0, FINAL: 0 },
    reason,
  };
}

export async function runDunning(): Promise<DunningRun> {
  const config = await getDunningConfig();
  if (!config.enabled) return emptyRun(false, "The dunning ladder is switched off");

  const today = istToday();

  // The candidate window. Bounded on BOTH sides:
  //   - the earliest enabled offset, so an instalment not yet worth mentioning isn't fetched;
  //   - 180 days past due, because an instalment overdue for half a year has exhausted the
  //     ladder and belongs to a human, not to an engine that keeps emailing about it.
  const offsets = [
    config.stages.upcoming.enabled ? config.stages.upcoming.dayOffset : null,
    config.stages.missed.enabled ? config.stages.missed.dayOffset : null,
    config.stages.final.enabled ? config.stages.final.dayOffset : null,
  ].filter((n): n is number => n !== null);
  if (offsets.length === 0) return emptyRun(true, "Every stage is disabled");

  const earliest = Math.min(...offsets);
  const windowEnd = new Date(today.getTime() - earliest * 86_400_000); // -3 offset → 3 days ahead
  const windowStart = new Date(today.getTime() - 180 * 86_400_000);

  const candidates = await prisma.instalment.findMany({
    where: {
      // Paid instalments are excluded at the query, and re-checked again before each send.
      status: { in: ["DUE", "OVERDUE"] },
      dueDate: { gte: windowStart, lte: windowEnd },
      pendingPayment: {
        ...ACTIVE,
        status: { in: ["ACTIVE", "OVERDUE"] },
      },
    },
    select: {
      id: true,
      seq: true,
      dueDate: true,
      amountInrMinor: true,
      amountEurMinor: true,
      fxRateUsed: true,
      status: true,
      pendingPayment: {
        select: {
          id: true,
          studentName: true,
          student: { select: { id: true, fullName: true, email: true, phone: true, code: true } },
        },
      },
      dunningEvents: { select: { stage: true } },
    },
    orderBy: { dueDate: "asc" }, // oldest first — the most overdue gets the scarce cap slots
    take: 500,
  });

  const run = emptyRun(true);

  for (const inst of candidates) {
    const sentStages = inst.dunningEvents.map((e) => e.stage as DunningStage);
    const stage = stageFor({ dueDate: inst.dueDate, today, sent: sentStages }, config);
    if (!stage) continue;

    run.due++;

    if (run.sent + run.failed + run.noContact >= config.perRunCap) {
      run.deferred++;
      continue;
    }

    const student = inst.pendingPayment.student;
    const firstName = (student?.fullName ?? inst.pendingPayment.studentName).split(" ")[0] ?? "there";
    const amountLabel = formatInrMinor(
      aggInrMinor(inst.amountInrMinor, inst.amountEurMinor, inst.fxRateUsed as never),
    );

    const channel = channelFor(stage, config);
    const wantsEmail = channel === "EMAIL" || channel === "BOTH";
    const wantsWhatsApp = channel === "WHATSAPP" || channel === "BOTH";

    const email = student?.email?.trim() ?? "";
    const phone = student?.phone?.trim() ?? "";

    if ((wantsEmail && !email) && (wantsWhatsApp ? !phone : true)) {
      // No usable channel. NOT recorded as a sent stage — the moment contact details are added,
      // this instalment should still be chaseable rather than silently skipped forever.
      run.noContact++;
      continue;
    }

    // Last look before we talk to a paying customer. The candidate list was built at the top of
    // the run; a payment recorded since then must win.
    const fresh = await prisma.instalment.findUnique({
      where: { id: inst.id },
      select: { status: true, paidDate: true },
    });
    if (!fresh || fresh.status === "PAID" || fresh.paidDate) {
      run.skipped++;
      continue;
    }

    const copy = dunningCopy({
      stage,
      firstName,
      amountLabel,
      dueDateLabel: formatDate(inst.dueDate),
      daysPastDue: daysPastDue(inst.dueDate, today),
      studentCode: student?.code ?? null,
    });

    let delivered = false;
    let messageId: string | null = null;
    let note: string | null = null;
    // "The channel is switched off" is not a failure — it is the keys-off default doing its job,
    // and it is what a founder sees on a dry run before arming anything. Tracked separately so
    // the run summary doesn't report a wall of failures for a correctly-disabled channel.
    let channelOff = false;

    try {
      if (wantsEmail && email) {
        const body = [
          ...copy.lines,
          "",
          student?.code ? `Student ID: ${student.code}` : "",
          "",
          "Thank you,",
          "B2 Consultants",
        ]
          .filter((l, i, arr) => !(l === "" && arr[i - 1] === ""))
          .join("\n");

        const out = await sendEmailMessage({
          to: email,
          subject: copy.subject,
          // The founder CC is on the FINAL rung only. Copying them on every nudge would make the
          // escalation invisible by burying it in routine traffic.
          body: stage === "FINAL" && config.founderCc ? `${body}\n\n(cc: ${config.founderCc})` : body,
        });
        if (out.status === "SENT") {
          delivered = true;
        } else if (out.status === "SKIPPED") {
          channelOff = true;
          note = "Email channel is off";
        } else {
          note = out.message;
        }
      }

      if (wantsWhatsApp && phone) {
        // Reuses the approved payment-reminder template rather than free text. WATI requires a
        // pre-approved template for business-initiated messages, so a bespoke per-stage WhatsApp
        // body would simply be rejected — the escalation lives in the email copy until the
        // per-stage templates clear approval.
        // NOTE: whatsapp.ts's SendOutcome is a different shape from messaging.ts's — `sent` /
        // `error` / `messageId` rather than `status` / `message`. Same name, different type.
        const out = await sendPaymentReminderFor(inst.pendingPayment.id, null);
        if (out.sent) {
          delivered = true;
          messageId ??= out.messageId;
        } else if (out.skipped) {
          channelOff = true;
          note ??= "WhatsApp channel is off";
        } else {
          note ??= out.error ?? "WhatsApp send failed";
        }
      }

      // Copy the founder on the final notice, as a separate email. Separate rather than a real
      // CC header because `sendEmailMessage` logs one Message row per recipient — and the
      // founder's copy showing up in the student's conversation thread would be wrong.
      if (stage === "FINAL" && config.founderCc) {
        await sendEmailMessage({
          to: config.founderCc,
          subject: `[Escalation] ${copy.subject} — ${student?.fullName ?? inst.pendingPayment.studentName}`,
          body: [
            `Final notice sent to ${student?.fullName ?? inst.pendingPayment.studentName}.`,
            "",
            `Amount: ${amountLabel}`,
            `Due: ${formatDate(inst.dueDate)} (${daysPastDue(inst.dueDate, today)} days ago)`,
            `Instalment: #${inst.seq}`,
            "",
            "The automated ladder ends here — this one needs a person.",
          ].join("\n"),
        });
      }
    } catch (err) {
      await captureException(err, {
        where: "dunning:send",
        extra: { instalmentId: inst.id, stage },
      });
      note = err instanceof Error ? err.message : String(err);
    }

    if (channelOff && !delivered) {
      // The channel is switched off, so nothing was attempted. DO NOT record the stage: burning
      // a rung here would mean that when the founders finally arm email, every instalment the
      // dry runs walked past is silently un-chaseable. The ladder must stay exactly where it is.
      //
      // Replaying it later is safe precisely because the ladder is non-skipping — an instalment
      // that has drifted 20 days overdue in the meantime gets the FINAL notice only, not a burst
      // of stale nudges about dates long past.
      run.skipped++;
      continue;
    }

    // Recorded whatever happened, INCLUDING a genuine send failure. `delivered: false` still
    // blocks a re-send: retrying on a provider outage would flood the student the moment
    // service came back, and a stage that half-went is not a reason to climb the same rung
    // twice. The `note` is what tells a human it needs looking at.
    await prisma.dunningEvent.create({
      data: { instalmentId: inst.id, stage, channel, delivered, messageId, note },
    });

    if (delivered) {
      run.sent++;
      run.byStage[stage]++;
    } else {
      run.failed++;
    }
  }

  if (run.due > 0) {
    await logSystemActivity(SYSTEM_ACTORS.dunning, {
      action: "dunning.run",
      section: "finance",
      entityType: "AppSetting",
      entityId: "dunning",
      summary: `Dunning: ${run.sent} sent, ${run.skipped} skipped, ${run.failed} failed${run.deferred ? `, ${run.deferred} held for the next run` : ""}`,
      meta: { ...run.byStage, due: run.due, deferred: run.deferred, cap: config.perRunCap },
    });
  }

  return run;
}

/**
 * What the ladder WOULD do, without sending anything.
 *
 * Nobody is going to arm an engine that emails paying students on the strength of a description.
 * This answers "show me exactly who gets what tomorrow" — the same read path as the real run,
 * minus every side effect.
 */
export async function previewDunning(): Promise<
  {
    instalmentId: string;
    studentName: string;
    stage: DunningStage;
    amountLabel: string;
    dueDateLabel: string;
    daysPastDue: number;
    channel: string;
    hasEmail: boolean;
    hasPhone: boolean;
  }[]
> {
  const config = await getDunningConfig();
  const today = istToday();

  const candidates = await prisma.instalment.findMany({
    where: {
      status: { in: ["DUE", "OVERDUE"] },
      pendingPayment: { ...ACTIVE, status: { in: ["ACTIVE", "OVERDUE"] } },
    },
    select: {
      id: true,
      dueDate: true,
      amountInrMinor: true,
      amountEurMinor: true,
      fxRateUsed: true,
      pendingPayment: {
        select: {
          studentName: true,
          student: { select: { fullName: true, email: true, phone: true } },
        },
      },
      dunningEvents: { select: { stage: true } },
    },
    orderBy: { dueDate: "asc" },
    take: 500,
  });

  const rows = [];
  for (const inst of candidates) {
    const stage = stageFor(
      { dueDate: inst.dueDate, today, sent: inst.dunningEvents.map((e) => e.stage as DunningStage) },
      config,
    );
    if (!stage) continue;
    const student = inst.pendingPayment.student;
    rows.push({
      instalmentId: inst.id,
      studentName: student?.fullName ?? inst.pendingPayment.studentName,
      stage,
      amountLabel: formatInrMinor(
        aggInrMinor(inst.amountInrMinor, inst.amountEurMinor, inst.fxRateUsed as never),
      ),
      dueDateLabel: formatDate(inst.dueDate),
      daysPastDue: daysPastDue(inst.dueDate, today),
      channel: channelFor(stage, config),
      hasEmail: !!student?.email?.trim(),
      hasPhone: !!student?.phone?.trim(),
    });
  }
  return rows;
}

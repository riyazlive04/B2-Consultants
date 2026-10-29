"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { capabilityCheck, requireSession } from "@/lib/rbac";
import { takeToken } from "@/lib/rate-limit";
import { ACTIVE } from "@/lib/soft-delete";
import {
  IMPROVEMENT_KIND_SHORT,
  IMPROVEMENT_STATUSES,
  IMPROVEMENT_STATUS_LABELS,
  IMPROVEMENT_KINDS,
  ANSWER_MAX,
  TITLE_MAX,
  answersSchema,
  canTransition,
  improvementKindLabel,
  submitImprovementSchema,
  suggestTitle,
  type ImprovementKind,
  type ImprovementStatus,
} from "@/lib/improvement";
import { logActivity } from "./activity-log";
import { afterResponse } from "./after-response";
import { appVersion, captureImprovementContext } from "./improvement-context";
import { nextImprovementRef } from "./improvement-ref";
import { notifyDeveloper } from "./improvement-notify";
import { getResolvedSections } from "./founder-config";
import type { ActionResult } from "./finance-actions";

/**
 * FILING AND TRIAGING AN IMPROVEMENT REPORT.
 *
 * Two fences, and they are different on purpose:
 *
 *   `submitImprovement`  guarded by nothing more than having a session. EVERY role may report - admin,
 *                  head, telecaller, student, tutor, coach. A student or a tutor is the person
 *                  most likely to hit a dead end and the least likely to have any other way of
 *                  telling anyone, so a capability check here would silence exactly the reports
 *                  worth having.
 *   everything else  guarded by `improvements.triage`. Deciding what happens to a report is a
 *                  different job from filing one.
 *
 * Every export is `async`. `tsc` does not catch a non-async export in a `"use server"` module -
 * only `next build` does, at the very end of a long build (the audit in the 24 Oct changelog had
 * to be run as a source scan for this reason).
 */

// ─────────────────────────────── filing one ───────────────────────────────

/**
 * How many reports one person can file before the brake bites.
 *
 * Generous on purpose: somebody walking a broken screen may legitimately file four in five
 * minutes, and refusing the fourth is how you teach them to stop. The cap is here to bound a
 * stuck client re-posting in a loop, not to police a reporter - the same reasoning the lead
 * webhook's limit carries.
 */
const SUBMIT_RULE = { capacity: 12, refillPerSec: 12 / 1800 } as const;

export async function submitImprovement(
  input: unknown,
): Promise<ActionResult & { ref?: string; id?: string }> {
  const session = await requireSession();

  const gate = takeToken(`improvement:${session.user.id}`, SUBMIT_RULE);
  if (!gate.ok) {
    return {
      ok: false,
      error: "That is a lot of reports in a short time. Give it a few minutes, then carry on.",
    };
  }

  const parsed = submitImprovementSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "That report could not be read" };
  }
  const d = parsed.data;

  // The answers are validated against the kind's OWN question list, so a payload carrying another
  // kind's fields (or extra keys) is narrowed to what this kind actually asks.
  // `recorded` relaxes the required questions: somebody who walked through the problem on camera
  // has already answered them. See `answersSchema` for why the declared flag is good enough here.
  const answers = answersSchema(d.kind, { recorded: !!d.recordingKind }).safeParse(d.answers);
  if (!answers.success) {
    return { ok: false, error: answers.error.issues[0]?.message ?? "Please fill in the questions" };
  }

  /**
   * The section key is RESOLVED HERE, from the catalogue, and the client's suggestion is only ever
   * used to look it up. A free-text section key from a POST would be written into a column the
   * triage screen groups by, which is how "which screen generates the most reports" stops meaning
   * anything.
   */
  const sectionKey = await resolveSectionKey(d.sectionKey ?? null, d.route);

  const hdrs = await Promise.resolve(headers());
  const context = await captureImprovementContext(session, {
    sectionKey,
    userAgent: hdrs.get("user-agent"),
  });

  /**
   * A recorded report may carry no words at all, so the title falls back to naming the recording
   * and the screen. "Broken" twenty times over is not a queue anybody can read.
   */
  const recordingFallback = d.recordingKind
    ? `${d.recordingKind === "SCREEN" ? "screen recording" : "voice note"} on ${context.sectionLabel ?? d.route}`
    : undefined;
  const title = (
    d.title?.trim() || suggestTitle(d.kind, answers.data, recordingFallback)
  ).slice(0, TITLE_MAX);

  // One transaction, because the ref is drawn inside it: Postgres row-locks the counter until the
  // report is written, so two reporters pressing Send together queue rather than colliding, and a
  // rolled-back insert gives its number back.
  const report = await prisma.$transaction(async (tx) => {
    const ref = await nextImprovementRef(tx);
    return tx.improvement.create({
      data: {
        ref,
        kind: d.kind,
        severity: d.severity,
        title,
        answers: answers.data,
        reporterNote: d.note?.slice(0, ANSWER_MAX) || null,
        route: d.route,
        routeParams: d.routeParams && Object.keys(d.routeParams).length ? d.routeParams : undefined,
        sectionKey,
        elementTag: d.elementTag ?? undefined,
        breadcrumbs: d.breadcrumbs?.length ? d.breadcrumbs : undefined,
        screenWidth: d.screenWidth ?? null,
        screenHeight: d.screenHeight ?? null,
        context: context as unknown as object,
        clientDigest: d.clientDigest ?? null,
        appVersion: appVersion(),
        reporterId: session.user.id,
        reporterRole: session.role,
      },
      select: { id: true, ref: true, kind: true, severity: true, title: true, route: true },
    });
  });

  /**
   * The notification runs AFTER the response, like the activity log.
   *
   * A Resend round trip is ~1s. Making the reporter wait for it would mean the person telling us
   * the app is slow waits a second longer to be told it worked - and a bounced email would
   * otherwise be indistinguishable from a failed report. The row is already saved; announcing it
   * is not something anyone is waiting on.
   */
  afterResponse("improvement:notify", async () => {
    const outcome = await notifyDeveloper({
      id: report.id,
      ref: report.ref,
      kind: d.kind,
      severity: d.severity,
      title,
      route: d.route,
      sectionLabel: context.sectionLabel,
      reporterName: session.user.name,
      reporterRole: session.role,
      answers: answers.data,
      note: d.note?.trim() || null,
      recordingSeconds: d.recordingSeconds ?? null,
      recordingKind: d.recordingKind ?? null,
      context,
    });
    if (outcome.sent) {
      await prisma.improvement.update({
        where: { id: report.id },
        data: { notifiedAt: new Date() },
      });
    }
  });

  await logActivity(session, {
    action: "improvement.report",
    section: "improvements",
    entityType: "Improvement",
    entityId: report.id,
    // The ANSWERS are not in the summary. A report can describe a student's money or a personal
    // reason for missing a class, and an activity feed line is the wrong place for it to surface
    // in passing - the same rule `submitAbsenceReason` follows.
    summary: `Reported ${IMPROVEMENT_KIND_SHORT[d.kind].toLowerCase()} on ${context.sectionLabel ?? d.route} - ${report.ref}`,
    meta: {
      ref: report.ref,
      kind: d.kind,
      severity: d.severity,
      route: d.route,
      sectionKey,
      enginesOff: context.enginesOff.map((e) => e.key),
    },
  });

  revalidatePath("/improvements");
  /**
   * The `id` rides back alongside the ref so the form can attach a voice note to the row it just
   * created. The clip cannot travel in this action at all - Next caps an action body at 1 MB and
   * a two-minute recording can beat that - so it is posted to `/api/improvements/[id]/voice`
   * afterwards. The ref is for the person; the id is for that one follow-up request.
   */
  return { ok: true, ref: report.ref, id: report.id };
}

/**
 * The catalogue's key for this screen, or null.
 *
 * Falls back to matching the route against the catalogue when the client sends nothing, so a
 * report from the crash screen (which has no idea which section it broke in) still groups.
 */
async function resolveSectionKey(suggested: string | null, route: string): Promise<string | null> {
  const sections = await getResolvedSections().catch(() => []);
  if (suggested && sections.some((s) => s.key === suggested)) return suggested;
  // Longest matching href wins, so `/batches/plans` prefers `batches` over `/`.
  const match = sections
    .filter((s) => s.href !== "/" && (route === s.href || route.startsWith(`${s.href}/`)))
    .sort((a, b) => b.href.length - a.href.length)[0];
  return match?.key ?? null;
}

// ─────────────────────────────── triage ───────────────────────────────

const statusSchema = z.object({
  id: z.string().min(1),
  to: z.enum(IMPROVEMENT_STATUSES),
  /** Shown to the reporter on FIXED / DECLINED - the only words they will see. */
  resolution: z.string().trim().max(ANSWER_MAX).optional(),
  duplicateOfRef: z.string().trim().max(40).optional(),
});

/**
 * ESCALATE, OR STAND DOWN - the head coach's one lever on this queue.
 *
 * Behind `improvements.escalate` (ADMIN + HEAD), NOT `improvements.triage`. The head coach is
 * not deciding whether something is a duplicate or writing developer notes; they are saying
 * "this one matters now" about a problem their coaches and students keep hitting, and that is
 * the only thing this action does.
 *
 * ── WHY IT DOES NOT TOUCH `severity` ───────────────────────────────────────────────────────
 * Severity is the REPORTER's own answer to "how much is this holding you up", and it is the only
 * honest signal of impact this module collects. A manager overwriting it to mark something
 * urgent would destroy that answer permanently and make the question worth asking exactly once.
 * So escalation is its own flag, and the queue sorts on it ahead of both status and severity.
 *
 * Who escalated and when is recorded by `logActivity`, which is where every other
 * who-did-what-when in this app already lives - no new event kind, no second audit trail.
 */
const urgentSchema = z.object({ id: z.string().min(1), urgent: z.boolean() });

export async function setImprovementUrgent(input: unknown): Promise<ActionResult> {
  const { allowed, denied, session } = await capabilityCheck("improvements.escalate");
  if (!allowed) return denied;

  const parsed = urgentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const { id, urgent } = parsed.data;

  const report = await prisma.improvement.findFirst({
    where: { id, ...ACTIVE },
    select: { id: true, ref: true, title: true, urgent: true },
  });
  if (!report) return { ok: false, error: "That report is not here any more." };
  // Idempotent: two people pressing Escalate is not an error, and neither is a stale screen.
  if (report.urgent === urgent) return { ok: true };

  await prisma.improvement.update({ where: { id }, data: { urgent } });

  await logActivity(session, {
    action: urgent ? "improvement.escalate" : "improvement.deescalate",
    section: "improvements",
    entityType: "Improvement",
    entityId: id,
    // The TITLE is safe here - it is already the queue's own label - but never the answers, which
    // can describe a student's money. Same rule `submitImprovement` follows.
    summary: `${urgent ? "Escalated" : "Stood down"} ${report.ref} - ${report.title}`,
    meta: { ref: report.ref, urgent },
  });

  revalidatePath("/improvements");
  return { ok: true };
}

export async function setImprovementStatus(input: unknown): Promise<ActionResult> {
  const { allowed, denied, session } = await capabilityCheck("improvements.triage");
  if (!allowed) return denied;

  const parsed = statusSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const { id, to } = parsed.data;

  const report = await prisma.improvement.findFirst({
    where: { id, ...ACTIVE },
    select: { id: true, ref: true, status: true, title: true, firstTriagedAt: true },
  });
  if (!report) return { ok: false, error: "That report is not here any more." };

  const from = report.status as ImprovementStatus;
  if (from === to) return { ok: true };
  /**
   * The same table the buttons are rendered from refuses anything else. The UI never offers an
   * illegal move, so this fires only for a stale screen or a crafted POST - and in both cases the
   * answer is the same: say what the state is now rather than silently applying it.
   */
  if (!canTransition(from, to)) {
    return {
      ok: false,
      error: `${report.ref} is ${IMPROVEMENT_STATUS_LABELS[from]} - it cannot go straight to ${IMPROVEMENT_STATUS_LABELS[to]}.`,
    };
  }

  // A duplicate has to name what it duplicates, or the link is just a dead end for the reporter.
  let duplicateOfId: string | null = null;
  if (to === "DUPLICATE") {
    const ref = parsed.data.duplicateOfRef?.toUpperCase();
    if (!ref) return { ok: false, error: "Name the report this duplicates (e.g. IMP-0004)." };
    const target = await prisma.improvement.findFirst({
      where: { ref, ...ACTIVE },
      select: { id: true },
    });
    if (!target) return { ok: false, error: `There is no report ${ref}.` };
    if (target.id === id) return { ok: false, error: "A report cannot duplicate itself." };
    duplicateOfId = target.id;
  }

  const now = new Date();
  await prisma.$transaction([
    prisma.improvement.update({
      where: { id },
      data: {
        status: to,
        duplicateOfId: to === "DUPLICATE" ? duplicateOfId : null,
        resolution: parsed.data.resolution?.trim() || undefined,
        // Stamped once, so "how long until somebody looked at it" stays answerable after a report
        // has been round the houses.
        firstTriagedAt: report.firstTriagedAt ?? (to === "NEW" ? null : now),
        fixedAt: to === "FIXED" ? now : to === "IN_PROGRESS" ? null : undefined,
        closedAt: to === "CLOSED" || to === "DECLINED" ? now : to === "IN_PROGRESS" ? null : undefined,
      },
    }),
    prisma.improvementEvent.create({
      data: {
        reportId: id,
        kind: "STATUS",
        fromValue: from,
        toValue: to,
        body: parsed.data.resolution?.trim() || null,
        // The resolution is written FOR the reporter, so it is visible to them. A status move with
        // no words attached is not worth showing them.
        visibleToReporter: Boolean(parsed.data.resolution?.trim()),
        actorId: session.user.id,
      },
    }),
  ]);

  await logActivity(session, {
    action: "improvement.status.update",
    section: "improvements",
    entityType: "Improvement",
    entityId: id,
    summary: `${report.ref} moved from ${IMPROVEMENT_STATUS_LABELS[from]} to ${IMPROVEMENT_STATUS_LABELS[to]}`,
    meta: { ref: report.ref, from, to },
  });

  revalidatePath("/improvements");
  return { ok: true };
}

const rekindSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(IMPROVEMENT_KINDS),
});

/**
 * Re-file a report under the kind it actually is.
 *
 * Recorded as an event rather than quietly overwritten, because the rate of re-kinding is the
 * only honest measure of whether the picker's seven options match how people think. If
 * "I cannot tell what to do here" keeps becoming "Something is broken", the hint text is wrong.
 */
export async function rekindImprovement(input: unknown): Promise<ActionResult> {
  const { allowed, denied, session } = await capabilityCheck("improvements.triage");
  if (!allowed) return denied;

  const parsed = rekindSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };

  const report = await prisma.improvement.findFirst({
    where: { id: parsed.data.id, ...ACTIVE },
    select: { id: true, ref: true, kind: true },
  });
  if (!report) return { ok: false, error: "That report is not here any more." };
  if (report.kind === parsed.data.kind) return { ok: true };

  await prisma.$transaction([
    prisma.improvement.update({ where: { id: report.id }, data: { kind: parsed.data.kind } }),
    prisma.improvementEvent.create({
      data: {
        reportId: report.id,
        kind: "REKIND",
        fromValue: report.kind,
        toValue: parsed.data.kind,
        actorId: session.user.id,
      },
    }),
  ]);

  await logActivity(session, {
    action: "improvement.rekind",
    section: "improvements",
    entityType: "Improvement",
    entityId: report.id,
    summary: `${report.ref} re-filed as "${improvementKindLabel(parsed.data.kind as ImprovementKind)}"`,
    meta: { ref: report.ref, from: report.kind, to: parsed.data.kind },
  });

  revalidatePath("/improvements");
  return { ok: true };
}

const commentSchema = z.object({
  id: z.string().min(1),
  body: z.string().trim().min(2, "Write something first").max(ANSWER_MAX),
  /** Off by default: a triage note is for the developer, and most of them are not for the reporter. */
  visibleToReporter: z.boolean().optional(),
});

export async function commentOnImprovement(input: unknown): Promise<ActionResult> {
  const { allowed, denied, session } = await capabilityCheck("improvements.triage");
  if (!allowed) return denied;

  const parsed = commentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const report = await prisma.improvement.findFirst({
    where: { id: parsed.data.id, ...ACTIVE },
    select: { id: true, ref: true },
  });
  if (!report) return { ok: false, error: "That report is not here any more." };

  await prisma.improvementEvent.create({
    data: {
      reportId: report.id,
      kind: "COMMENT",
      body: parsed.data.body,
      visibleToReporter: parsed.data.visibleToReporter ?? false,
      actorId: session.user.id,
    },
  });

  await logActivity(session, {
    action: "improvement.comment",
    section: "improvements",
    entityType: "Improvement",
    entityId: report.id,
    summary: `Commented on ${report.ref}`,
    meta: { ref: report.ref, visibleToReporter: parsed.data.visibleToReporter ?? false },
  });

  revalidatePath("/improvements");
  return { ok: true };
}

const devNoteSchema = z.object({
  id: z.string().min(1),
  devNote: z.string().trim().max(ANSWER_MAX),
});

export async function saveImprovementDevNote(input: unknown): Promise<ActionResult> {
  const { allowed, denied, session } = await capabilityCheck("improvements.triage");
  if (!allowed) return denied;

  const parsed = devNoteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };

  const report = await prisma.improvement.findFirst({
    where: { id: parsed.data.id, ...ACTIVE },
    select: { id: true, ref: true },
  });
  if (!report) return { ok: false, error: "That report is not here any more." };

  await prisma.improvement.update({
    where: { id: report.id },
    data: { devNote: parsed.data.devNote || null },
  });

  await logActivity(session, {
    action: "improvement.note.update",
    section: "improvements",
    entityType: "Improvement",
    entityId: report.id,
    summary: `Updated the working notes on ${report.ref}`,
    meta: { ref: report.ref },
  });

  revalidatePath("/improvements");
  return { ok: true };
}

const archiveSchema = z.object({ id: z.string().min(1) });

/**
 * Archive, never delete - including a declined report.
 *
 * "We decided not to do this, and here is why" is the most valuable row in this table six months
 * later, when the same thing is proposed again. The row leaves every list and stays readable in
 * the archive, exactly like the other nine soft-deleted models.
 */
export async function archiveImprovement(input: unknown): Promise<ActionResult> {
  const { allowed, denied, session } = await capabilityCheck("improvements.triage");
  if (!allowed) return denied;

  const parsed = archiveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };

  const report = await prisma.improvement.findFirst({
    where: { id: parsed.data.id, ...ACTIVE },
    select: { id: true, ref: true },
  });
  if (!report) return { ok: true };

  await prisma.improvement.update({
    where: { id: report.id },
    data: { deletedAt: new Date(), deletedById: session.user.id },
  });

  await logActivity(session, {
    action: "improvement.archive",
    section: "improvements",
    entityType: "Improvement",
    entityId: report.id,
    summary: `Archived ${report.ref}`,
    meta: { ref: report.ref },
  });

  revalidatePath("/improvements");
  return { ok: true };
}

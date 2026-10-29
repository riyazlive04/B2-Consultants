import "server-only";
import { prisma } from "@/lib/prisma";
import { istToday } from "@/lib/dates";
import { getImprovementsForDigest } from "./improvements";
import { sendImprovementDigest } from "./improvement-notify";
import { logSystemActivity, SYSTEM_ACTORS } from "./activity-log";
import type { ImprovementKind, ImprovementSeverity } from "@/lib/improvement";

/**
 * The once-a-day summary of what people reported.
 *
 * ── Why this rides the EXISTING daily tick ─────────────────────────────────────────────────
 * A cron route of its own would need a matching entry in `docker/cron/entrypoint.sh` AND an
 * explicit `STALE_AFTER_MINUTES` row in `server/uptime.ts` - `lib/__tests__/cron-stale-thresholds.test.ts`
 * fails the suite for any job that rides the default. That test exists because the `agreements`
 * job shipped without a threshold and read STALE for 21 hours out of every 24 while working
 * perfectly. Folding into `daily` avoids the whole class of mistake, and this is housekeeping -
 * nothing here needs its own clock.
 *
 * ── Why the cursor is a stored timestamp and not "24 hours ago" ────────────────────────────
 * The daily job ticks hourly. A fixed look-back would re-send the same reports every hour, or
 * silently drop a report filed in the gap if the look-back were short. The cursor moves only when
 * a digest is actually accepted, so a day the email was paused does not lose its reports: the
 * next successful send covers them.
 */

const CURSOR_KEY = "improvementDigest.lastSent";
const RAN_KEY = "improvementDigest.lastRun";

export type ImprovementDigestRun =
  | { sent: false; reason: string }
  | { sent: true; count: number };

export async function runImprovementDigest(): Promise<ImprovementDigestRun> {
  // Once per IST day. The tick is hourly and a digest is, by definition, daily.
  const today = istToday().toISOString().slice(0, 10);
  const ran = await prisma.appSetting.findUnique({ where: { key: RAN_KEY } });
  if (ran?.value === today) return { sent: false, reason: "Already ran today" };

  const cursor = await prisma.appSetting.findUnique({ where: { key: CURSOR_KEY } });
  const since =
    typeof cursor?.value === "string" && !Number.isNaN(Date.parse(cursor.value))
      ? new Date(cursor.value)
      : // First run: a day's worth, so arming this does not mail out a month of history.
        new Date(Date.now() - 86_400_000);

  const rows = await getImprovementsForDigest(since);
  const outcome = await sendImprovementDigest(
    rows.map((r) => ({
      ref: r.ref,
      kind: r.kind as ImprovementKind,
      severity: r.severity as ImprovementSeverity,
      title: r.title,
      route: r.route,
      sectionLabel: sectionLabelFrom(r.context),
      reporterName: r.reporter.name,
    })),
  );

  // The day marker is stamped whatever happened, so a blank day or a paused mailer does not
  // retry every hour. The CURSOR only moves on a real send, so nothing is skipped.
  await prisma.appSetting.upsert({
    where: { key: RAN_KEY },
    create: { key: RAN_KEY, value: today },
    update: { value: today },
  });

  if (!outcome.sent) return { sent: false, reason: outcome.reason };

  const now = new Date().toISOString();
  await prisma.appSetting.upsert({
    where: { key: CURSOR_KEY },
    create: { key: CURSOR_KEY, value: now },
    update: { value: now },
  });

  await logSystemActivity(SYSTEM_ACTORS.alerts, {
    action: "improvement.digest.send",
    section: "improvements",
    entityType: "AppSetting",
    entityId: CURSOR_KEY,
    summary: `Emailed the developer ${rows.length} new improvement report${rows.length === 1 ? "" : "s"}`,
    meta: { count: rows.length, refs: rows.map((r) => r.ref) },
  });

  return { sent: true, count: rows.length };
}

/** The screen's label out of the stored context, defensively - see `enginesOffFrom` in improvements.ts. */
function sectionLabelFrom(context: unknown): string | null {
  if (!context || typeof context !== "object") return null;
  const label = (context as { sectionLabel?: unknown }).sectionLabel;
  return typeof label === "string" ? label : null;
}

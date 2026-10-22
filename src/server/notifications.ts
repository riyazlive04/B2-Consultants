import "server-only";
import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { istMinutesOfDay, istMonthRange, istToday } from "@/lib/dates";
import { formatIstMinutes } from "@/lib/config-schema";
import { getDailyLogEod } from "./founder-config";
import { formatDate } from "@/lib/format";
import type { NotificationAmount } from "@/lib/notification-text";
import { getTodayInrPerEur } from "@/lib/fx";
import type { AppRole } from "@/lib/rbac";
import { aggEurMinor, aggInrMinor } from "@/lib/money";
import { ACTIVE } from "@/lib/soft-delete";
import { parseMentions } from "@/lib/gn-mentions";
import {
  IN_APP_CLASS_ALERT_MINUTES,
  alertCountdown,
  formatClassTime,
  isClassAlertOpen,
} from "@/lib/class-reminder";
import { getPendingRows } from "./finance-metrics";
import { getRunwaySnapshot } from "./cash-metrics";
import { getTeamGame } from "./gamification";
import { getMyStudentPortal } from "./student-portal";
import { getMyOpenCheckIns } from "./attendance-checkin";
import { getMyCatchUp } from "./catch-up";
import { getAttendanceConfig } from "./founder-config";
import { getAgreementTaskCounts } from "./agreement-state";
import { deliveryNotifications } from "./delivery-health";
import { MILESTONE_LABELS } from "@/lib/labels";

/**
 * IN-APP notification centre. Server-computed on load + light polling - the same
 * "live badge" model the PRDs allow. This centre stays in-app only (no email here).
 * Outbound WhatsApp lives in a separate, opt-in WATI layer (Wave-2: src/server/whatsapp.ts),
 * not here - these items are stateless status alerts that appear while a condition holds
 * and disappear when it's resolved.
 */

export type Notification = {
  id: string;
  severity: "risk" | "watch" | "info" | "win";
  /**
   * A person deliberately raised this for the founder - a head coach red-flagging a student
   * with a note, not a threshold the system tripped on its own (§2.8). Escalations sort ABOVE
   * everything else, because a human asking for attention outranks any automated alert.
   */
  escalated?: boolean;
  title: string;
  body: string;
  href: string;
  /**
   * Amounts referenced from `title`/`body` as `{m0}`, `{m1}`… - money is NOT baked into the
   * string here.
   *
   * These lines are read on a page with a ₹/€ toggle, and a notification that said "₹3,25,500"
   * while every figure beside it said euros was simply wrong. Formatting cannot happen on the
   * server (it has no access to the reader's currency), so the amount travels as both aggregates
   * and `renderNotificationText` (lib/notification-text - isomorphic, because both readers of a
   * notification are client components) substitutes it at render time.
   */
  amounts?: NotificationAmount[];
};

function istHourNow(): number {
  return parseInt(
    new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", hour12: false }).format(new Date()),
    10,
  );
}

/**
 * German Note community engagement (Skool-style): recent replies, likes and
 * @mentions on the viewer's own posts/comments. Derived like every other
 * notification here - surfaces while it's "recent" (last 3 days), no read-state.
 */
/**
 * What a coach is late on: registers not taken, and sprint check-ins whose week has closed.
 *
 * Deliberately only two counts rather than a full read of the teaching desk - this runs on
 * every page load for every coach, and the desk itself is one click away for the detail.
 */
async function coachNotifications(userId: string, today: Date): Promise<Notification[]> {
  const items: Notification[] = [];
  const [unmarked, checkIns] = await Promise.all([
    prisma.classSession.count({
      where: {
        batch: { tutorId: userId, status: "ACTIVE" },
        delivery: "LIVE",
        // `now`, not `today`: `today` is IST midnight, so a class taught this morning would not
        // have shown up as needing a register until the following day - which is precisely when
        // the reminder stops being useful.
        startsAt: { lt: new Date() },
        attendance: { none: {} },
      },
    }),
    prisma.sprintWeek.count({
      where: { enrollment: { coachId: userId, status: "ACTIVE" }, status: "PENDING", weekEnd: { lt: today } },
    }),
  ]);

  if (unmarked > 0) {
    items.push({
      id: "coach-registers",
      severity: "watch",
      title: `${unmarked} register${unmarked > 1 ? "s" : ""} still to take`,
      body: "Classes you have taught but not yet marked. Attendance is what the drop-risk signal reads.",
      // Tabs are addressed by index - 1 is "To mark" on the teaching desk.
      href: "/coaching?tab=1",
    });
  }
  if (checkIns > 0) {
    items.push({
      id: "coach-sprint",
      severity: "watch",
      title: `${checkIns} sprint check-in${checkIns > 1 ? "s" : ""} overdue`,
      body: "The week has closed and the actual has not been recorded.",
      href: "/coaching?tab=3",
    });
  }
  return items;
}

async function gnEngagementNotifications(userId: string, today: Date): Promise<Notification[]> {
  const since = new Date(today.getTime() - 3 * 86400000);
  const [replies, postLikes, commentLikes, mentionPosts, mentionComments] = await Promise.all([
    prisma.gnComment.count({ where: { post: { authorId: userId }, authorId: { not: userId }, createdAt: { gte: since } } }),
    prisma.gnLike.count({ where: { post: { authorId: userId }, userId: { not: userId }, createdAt: { gte: since } } }),
    prisma.gnCommentLike.count({ where: { comment: { authorId: userId }, userId: { not: userId }, createdAt: { gte: since } } }),
    prisma.gnPost.count({ where: { mentionedUserIds: { has: userId }, authorId: { not: userId }, createdAt: { gte: since } } }),
    prisma.gnComment.count({ where: { mentionedUserIds: { has: userId }, authorId: { not: userId }, createdAt: { gte: since } } }),
  ]);
  const items: Notification[] = [];
  const mentions = mentionPosts + mentionComments;
  if (mentions > 0) {
    items.push({
      id: "gn-mention",
      severity: "info",
      title: `You were mentioned ${mentions} time${mentions > 1 ? "s" : ""} in the community`,
      body: "Someone tagged you in German Note - jump in and reply.",
      href: "/german-note",
    });
  }
  if (replies > 0) {
    items.push({
      id: "gn-replies",
      severity: "info",
      title: `${replies} new repl${replies > 1 ? "ies" : "y"} to your posts`,
      body: "Your German Note community posts got new comments.",
      href: "/german-note",
    });
  }
  const likes = postLikes + commentLikes;
  if (likes > 0) {
    items.push({
      id: "gn-likes",
      severity: "win",
      title: `${likes} new like${likes > 1 ? "s" : ""} in the community`,
      body: "People are liking your German Note posts - that's community points toward your level.",
      href: "/german-note",
    });
  }
  return items;
}

/**
 * ContactNote @mentions (BUILD_CHECKLIST.md §3), ported from the GN mention pattern above.
 * GnPost/GnComment can filter mentions in SQL (`mentionedUserIds: { has: userId }`) because they
 * have that column; ContactNote doesn't and the schema is frozen this round, so this re-parses
 * each recent note's body against the same @Name matcher `contacts-actions.ts` uses at write
 * time. Same recency window (3 days), same in-app-only, never-persisted delivery as
 * gnEngagementNotifications - the note author gets no push, the mentioned person sees it purely
 * because THEIR OWN next bell load/poll happens to re-run this query and find their name.
 */
async function contactNoteMentionNotifications(userId: string, today: Date): Promise<Notification[]> {
  const since = new Date(today.getTime() - 3 * 86400000);
  const [notes, candidates] = await Promise.all([
    prisma.contactNote.findMany({
      where: { createdAt: { gte: since }, createdById: { not: userId } },
      select: { id: true, body: true, leadId: true },
      take: 500, // recent-note volume is small; this is a safety cap, not a real limit
    }),
    prisma.user.findMany({ where: { status: "ACTIVE" }, select: { id: true, name: true } }),
  ]);
  const mentions = notes.filter((n) => parseMentions(n.body, candidates).includes(userId));
  if (mentions.length === 0) return [];
  return [
    {
      id: "contact-note-mention",
      severity: "info",
      title: `You were mentioned ${mentions.length} time${mentions.length > 1 ? "s" : ""} in a contact note`,
      body: "Someone tagged you in a CRM note - open the contact to see it.",
      href: mentions.length === 1 ? `/contacts/${mentions[0].leadId}` : "/contacts",
    },
  ];
}

/**
 * Two cache layers:
 *  - React.cache: the layout, home page and bell in ONE request share one run.
 *  - a module-level TTL memo: the bell's 2-minute poll (per tab!) and every
 *    navigation re-hit this path; the underlying joins (pending payments, runway,
 *    the whole gamification engine) are the most expensive queries in the app and
 *    none of the conditions need sub-minute freshness.
 * Mutations don't need to invalidate: 45s staleness on a status feed is invisible,
 * and the per-request layer still guarantees intra-request consistency.
 */
const NOTIF_TTL_MS = 45_000;
const notifMemo = new Map<string, { at: number; items: Notification[] }>();

export const computeNotifications = cache(async (role: AppRole, userId: string) => {
  const key = `${role}:${userId}`;
  const hit = notifMemo.get(key);
  if (hit && Date.now() - hit.at < NOTIF_TTL_MS) return hit.items;
  const items = await _computeNotifications(role, userId);
  notifMemo.set(key, { at: Date.now(), items });
  if (notifMemo.size > 500) {
    // tiny user base; a hard cap just guards against unbounded growth
    for (const [k, v] of notifMemo) if (Date.now() - v.at >= NOTIF_TTL_MS) notifMemo.delete(k);
  }
  return items;
});

/**
 * "Your class starts in 25 minutes" - the in-app half of the class reminder.
 *
 * DERIVED, never stored. An in-app alert has no delivery to prove and no duplicate to avoid:
 * the bell is recomputed on every page load, so a row recording that we "showed" it would be a
 * second source of truth free to disagree with the screen. Only the WhatsApp ladder needs a
 * memory, because a message cannot be un-sent.
 *
 * One function for both audiences because the fact is the same fact - a class is about to start
 * - and only the scope and the wording differ: a student sees the classes they are seated in, a
 * coach or tutor sees the ones they are about to teach.
 */
async function classAlertNotifications(
  audience: { kind: "student"; userId: string } | { kind: "staff"; userId: string },
): Promise<Notification[]> {
  const now = new Date();
  // Look up over the alert window only, and never backwards past a class that has finished:
  // `isClassAlertOpen` makes the final call, this just keeps the query small.
  const from = new Date(now.getTime() - 4 * 60 * 60_000);
  const to = new Date(now.getTime() + IN_APP_CLASS_ALERT_MINUTES * 60_000);

  const where =
    audience.kind === "student"
      ? {
          // Both seating routes - a German Note learner has a BatchMember row and no enrollment.
          batch: {
            status: "ACTIVE" as const,
            OR: [
              { members: { some: { student: { userId: audience.userId } } } },
              { enrollments: { some: { student: { userId: audience.userId }, status: "ACTIVE" as const } } },
            ],
          },
        }
      : { batch: { status: "ACTIVE" as const, tutorId: audience.userId } };

  const sessions = await prisma.classSession.findMany({
    where: { delivery: "LIVE", startsAt: { gte: from, lte: to }, ...where },
    orderBy: { startsAt: "asc" },
    take: 5,
    select: {
      id: true, title: true, startsAt: true, durationMins: true, joinUrl: true, delivery: true,
      batch: { select: { name: true, line: true, id: true } },
    },
  });

  const items: Notification[] = [];
  for (const s of sessions) {
    if (!isClassAlertOpen({ ...s, delivery: "LIVE" }, now, IN_APP_CLASS_ALERT_MINUTES)) continue;
    const when = alertCountdown(s.startsAt, now);
    const starting = s.startsAt.getTime() - now.getTime() <= 30 * 60_000;
    items.push({
      id: `class-${s.id}`,
      // "watch" only once it is imminent. An hour out this is information, not a problem,
      // and colouring it amber for two hours would teach people to ignore the colour.
      severity: starting ? "watch" : "info",
      title:
        audience.kind === "student"
          ? `${s.title} ${when}`
          : `You are teaching ${s.title} - ${when}`,
      body:
        audience.kind === "student"
          ? `${formatClassTime(s.startsAt)}${s.joinUrl ? " - the join link is on your classroom." : " - your coach will share the link."}`
          : `${s.batch.name} - ${formatClassTime(s.startsAt)}.`,
      href: audience.kind === "student" ? "/classroom" : "/coaching",
    });
  }
  return items;
}

/**
 * "Attendance is open - tap to check in" - the bell's copy of the check-in window.
 *
 * The card on the dashboard is the real control; this exists for the student who is on some
 * other page when their coach opens the register. A window lasts minutes, so the bell is the
 * only thing that can reach someone mid-navigation.
 *
 * It disappears on its own, because `getMyOpenCheckIns` only ever returns windows that are
 * still open - and once the student has checked in it changes wording rather than vanishing,
 * so the press has a visible consequence in the place that prompted it.
 */
async function openCheckInNotifications(userId: string): Promise<Notification[]> {
  const open = await getMyOpenCheckIns(userId);
  return open.map((c) => ({
    id: `checkin-${c.sessionId}`,
    severity: c.checkedIn ? ("win" as const) : ("watch" as const),
    title: c.checkedIn ? `You are marked present for ${c.title}` : `Attendance is open for ${c.title}`,
    body: c.checkedIn
      ? `${c.batchName} - nothing more to do.`
      : `${c.batchName} - tap to mark yourself present before the window closes.`,
    href: "/dashboard",
  }));
}

/**
 * "You were marked absent from X" and "you still have not watched the recording".
 *
 * ── Why these fire on PUBLICATION, not on marking ───────────────────────────────────────
 * `getMyCatchUp` only returns sessions whose register has been published, so this cannot tell
 * a student about a mark their own classroom is simultaneously hiding from them. That ordering
 * is the whole reason the publish switch exists: until a coach shows the register, the verdict
 * is not yet the student's business, and a notification about an unviewable fact is one they
 * can neither check nor dispute.
 *
 * ── Derived, like every other student alert here ────────────────────────────────────────
 * No row records that this was shown. The bell is recomputed on each load, so it appears while
 * the condition holds and disappears when the student watches the recording - which is the
 * behaviour you want from a nudge and the opposite of what a stored "sent" flag would give.
 * Only the WhatsApp half needs a memory, because a message cannot be un-sent.
 *
 * `IN_GRACE` is included and that is deliberate: reaching someone BEFORE the deadline is the
 * point of telling them at all.
 */
async function catchUpNotifications(userId: string): Promise<Notification[]> {
  const config = await getAttendanceConfig();
  if (!config.absenceAlertEnabled && !config.catchUpAlertEnabled) return [];

  const rows = await getMyCatchUp(userId);
  const items: Notification[] = [];
  for (const r of rows) {
    const overdue = r.state === "OVERDUE";
    // Two switches, one list. Before the grace runs out this is the absence notice; after it,
    // it is the catch-up chase. A founder may want one without the other.
    if (overdue && !config.catchUpAlertEnabled) continue;
    if (!overdue && !config.absenceAlertEnabled) continue;

    items.push({
      id: `catchup-${r.sessionId}`,
      // "watch" once it is late, "info" while there is still time - the same restraint as the
      // class alert. Colouring a two-day-old absence amber for a week teaches people to ignore
      // the colour.
      severity: overdue ? "watch" : "info",
      title: overdue
        ? `Still to watch: ${r.sessionTitle}`
        : `You were marked absent from ${r.sessionTitle}`,
      body: r.recordingId
        ? `${formatDate(r.classDateYmd)} - the recording is in your classroom. ${r.accessLabel}.${
            r.watchedPct > 0 ? ` You are ${r.watchedPct}% through it.` : ""
          }`
        : `${formatDate(r.classDateYmd)} - ${r.accessLabel}.`,
      href: "/classroom",
    });
  }
  return items;
}

async function _computeNotifications(role: AppRole, userId: string): Promise<Notification[]> {
  const items: Notification[] = [];
  const today = istToday();

  // ── STUDENT portal: their own journey only - nothing about the business ──
  if (role === "STUDENT") {
    const portal = await getMyStudentPortal(userId);
    const e = portal?.primary;
    // The class alert comes FIRST and on both exits of this branch. A German Note learner has
    // no B2 enrollment and returns early below - they still have classes, and the first draft
    // of this gave them community likes but not the lesson starting in ten minutes.
    items.push(...(await classAlertNotifications({ kind: "student", userId })));
    // Above the class alert in urgency: a class starting in an hour can be joined later, a
    // check-in window cannot.
    items.push(...(await openCheckInNotifications(userId)));
    // Below the live window (which expires in minutes) and above everything else: a missed
    // class with a recording still open is the one thing here with a closing door.
    items.push(...(await catchUpNotifications(userId)));
    // German Note learners have no B2 enrollment - still get community engagement.
    if (!e) {
      items.push(...(await gnEngagementNotifications(userId, today)));
      const order = { risk: 0, watch: 1, win: 2, info: 3 };
      return items.sort(
        (a, b) => Number(!!b.escalated) - Number(!!a.escalated) || order[a.severity] - order[b.severity],
      );
    }

    // milestone reached in the last 3 days → celebrate
    const threeDaysAgo = new Date(today.getTime() - 3 * 86400000);
    const recent = [...e.milestoneTimeline].reverse().find((l) => new Date(l.date) >= threeDaysAgo);
    if (recent) {
      const big = recent.newMilestone === "OFFER_RECEIVED" || recent.newMilestone === "COMPLETED";
      items.push({
        id: "milestone-reached",
        severity: "win",
        title: big
          ? `${MILESTONE_LABELS[recent.newMilestone]} - congratulations! 🎉`
          : `Milestone reached: ${MILESTONE_LABELS[recent.newMilestone]}`,
        body: "Your journey bar just moved - see what this stage unlocks.",
        href: "/my-journey",
      });
    }

    // upcoming check-in (today .. +2 days)
    if (e.nextCheckInDate) {
      const checkIn = new Date(e.nextCheckInDate);
      const diff = Math.floor((checkIn.getTime() - today.getTime()) / 86400000);
      if (diff >= 0 && diff <= 2) {
        items.push({
          id: "checkin-soon",
          severity: "info",
          title: diff === 0 ? "Coaching check-in today" : `Coaching check-in ${formatDate(e.nextCheckInDate)}`,
          body: "Bring your updates - sessions and applications move your XP.",
          href: "/my-journey",
        });
      }
    }

    // momentum dropping → nudge, framed as coaching not surveillance
    if (e.status === "ACTIVE" && (e.journey.momentum === "COOLING" || e.journey.momentum === "STALLED")) {
      items.push({
        id: "momentum",
        severity: "watch",
        title: e.journey.momentum === "STALLED" ? "Your journey has stalled" : "Momentum is cooling",
        body: "Book a session or log progress with your coach to get the bar moving again.",
        href: "/my-journey",
      });
    }

    // final sprint: program ends soon and interviews not yet reached
    if (e.status === "ACTIVE" && e.daysLeft !== null && e.daysLeft <= 21 && e.journey.stageIndex < 4) {
      items.push({
        id: "final-sprint",
        severity: "watch",
        title: `${e.daysLeft} days left in your program`,
        body: "Final sprint - focus on applications and interview prep this week.",
        href: "/my-journey",
      });
    }

    items.push(...(await gnEngagementNotifications(userId, today)));
    const order = { risk: 0, watch: 1, win: 2, info: 3 };
    return items.sort(
      (a, b) => Number(!!b.escalated) - Number(!!a.escalated) || order[a.severity] - order[b.severity],
    );
  }

  // ── COACH: their own teaching only. Explicitly branched rather than falling through to the
  //    ADMIN/HEAD/USER block below, which would hand them CRM @mention alerts for a Contacts
  //    screen they cannot open. ──
  if (role === "COACH") {
    items.push(...(await classAlertNotifications({ kind: "staff", userId })));
    items.push(...(await coachNotifications(userId, today)));
    const order = { risk: 0, watch: 1, win: 2, info: 3 };
    return items.sort(
      (a, b) => Number(!!b.escalated) - Number(!!a.escalated) || order[a.severity] - order[b.severity],
    );
  }

  // ── TUTOR: German Note only - community engagement, plus the registers they owe ──
  if (role === "TUTOR") {
    items.push(...(await classAlertNotifications({ kind: "staff", userId })));
    items.push(...(await gnEngagementNotifications(userId, today)));
    items.push(...(await coachNotifications(userId, today)));
    const order = { risk: 0, watch: 1, win: 2, info: 3 };
    return items.sort(
      (a, b) => Number(!!b.escalated) - Number(!!a.escalated) || order[a.severity] - order[b.severity],
    );
  }

  // ── ADMIN/HEAD/USER: CRM @mentions on contact notes. Coarse role gate, matching every other
  // check in this function (own-log, badges, radar, …) - none of them thread the founder's
  // per-user section-override JSON in here either, so a HEAD granted Contacts access via an
  // override still sees this the same as everyone else at this role tier. ──
  items.push(...(await contactNoteMentionNotifications(userId, today)));

  // ── Everyone with a daily-log duty: own log reminder ──
  if (role !== "ADMIN") {
    const [profile, todayLog, eod] = await Promise.all([
      prisma.teamProfile.findUnique({ where: { userId } }),
      prisma.dailyLog.findUnique({ where: { userId_date: { userId, date: today } } }),
      getDailyLogEod(),
    ]);
    const cutoffLabel = formatIstMinutes(eod.cutoffMinutes);
    const nowMinutes = istMinutesOfDay(new Date());

    if (profile && profile.status === "ACTIVE" && !todayLog) {
      if (eod.enabled) {
        // The founder's cutoff is the deadline, and the nudge time is when we start saying so.
        const pastCutoff = nowMinutes >= eod.cutoffMinutes;
        const nudging = nowMinutes >= eod.nudgeMinutes;
        items.push({
          id: "own-log",
          severity: nudging ? "watch" : "info",
          title: pastCutoff
            ? "Daily log missed"
            : nudging
              ? "Daily log overdue"
              : "Daily log not submitted yet",
          body: pastCutoff
            ? eod.autoSave
              ? `The ${cutoffLabel} cutoff has passed. Your numbers will be auto-saved from your activity - amend them to add what activity can't see.`
              : `The ${cutoffLabel} cutoff has passed - today's log is closed. Contact Admin to make changes.`
            : `Log today's numbers before the ${cutoffLabel} cutoff.`,
          href: "/daily-log",
        });
      } else {
        // Pre-EOD-engine behaviour, unchanged: a 7PM convention, no deadline.
        const late = istHourNow() >= 19;
        items.push({
          id: "own-log",
          severity: late ? "watch" : "info",
          title: late ? "Daily log overdue" : "Daily log not submitted yet",
          body: late ? "The 7:00 PM mark has passed - log today's numbers now." : "Log today's numbers before 7:00 PM.",
          href: "/daily-log",
        });
      }
    }

    // Auto-saved on their behalf → ask them to amend it while they still can. This matters for
    // money: auto-capture can't see followUpMessagesSent, so an unamended row reads LOW on the
    // Bonus & Commission board. The window is short, so this is a "watch", not an "info".
    if (
      profile?.status === "ACTIVE" &&
      todayLog?.source === "EOD_AUTO" &&
      eod.enabled &&
      eod.amendWindowDays > 0
    ) {
      items.push({
        id: "auto-log-amend",
        severity: "watch",
        title: "Today's log was auto-saved",
        body: "It only has what your activity showed. Check it and add the rest before the amend window closes.",
        href: "/daily-log",
      });
    }

    // ── Arena: badge unlocks, near-complete quests, weekly crown (in-app only, like everything) ──
    const game = await getTeamGame();
    const me = game.players.find((p) => p.userId === userId);
    if (me) {
      const threeDaysAgo = new Date(today.getTime() - 3 * 86400000).toISOString().slice(0, 10);
      const fresh = me.badges.filter((b) => b.unlockedAt && b.unlockedAt >= threeDaysAgo);
      if (fresh.length > 0) {
        items.push({
          id: "badge-unlocked",
          severity: "win",
          title: `Badge unlocked: ${fresh.map((b) => `${b.icon} ${b.name}`).join(", ")}`,
          body: "New hardware in your trophy case - see it in the Arena.",
          href: "/arena",
        });
      }
      // Thu onwards: nudge quests that are close but not done
      const dow = today.getUTCDay(); // istToday() is IST-midnight-as-UTC, so this is the IST weekday (0=Sun)
      const near = me.quests.filter((q) => !q.done && q.pct >= 60);
      if (near.length > 0 && (dow >= 4 || dow === 0)) {
        const q = near.sort((a, b) => b.pct - a.pct)[0];
        items.push({
          id: "quest-near",
          severity: "info",
          title: `Quest almost done: ${q.icon} ${q.title} (${q.value}/${q.target})`,
          body: `${q.target - q.value} to go before Sunday for +${q.xp} XP.`,
          href: "/arena",
        });
      }
      if (me.rankWeek === 1 && game.players.length >= 2 && me.xpWeek > 0) {
        items.push({
          id: "weekly-leader",
          severity: "win",
          title: "You lead the Arena this week 🥇",
          body: `${me.xpWeek.toLocaleString("en-IN")} XP and counting - keep the crown.`,
          href: "/arena",
        });
      }
    }
  }

  // ── Head + Admin: student signals + early-warning radar ──
  if (role === "ADMIN" || role === "HEAD") {
    const fourteenDaysAgo = new Date(today.getTime() - 14 * 86400000);

    /**
     * An armed outbound channel that has stopped delivering (docs/ROAD_TO_10.md §6.1).
     *
     * This is the card that was missing in October 2026: WhatsApp was on, every send was being
     * refused, and the only screen that would have said so was one nobody had reason to open.
     * Admin/Head only - a telecaller cannot fix a revoked token, and an alarm you cannot act on
     * is an alarm you learn to ignore. One AppSetting read, behind this function's existing memo.
     */
    for (const d of await deliveryNotifications()) {
      items.push({ id: d.key, severity: d.severity, title: d.title, body: d.body, href: d.href });
    }

    /**
     * Weekend sprint check-ins waiting on a coach (portal issue 12).
     *
     * The student's form asks "Anything in the way? Blockers, questions for your coach…".
     * Until now the answer landed in a SprintWeek row and an activity-log line, and nothing
     * told anybody it was there - it surfaced only if someone happened to open that student's
     * record. A prompt for a blocker that nobody is paged about is worse than not asking.
     *
     * Two states are worth raising, and they are different kinds of thing:
     *   · answered-but-unjudged (PENDING with an `actual`) - a verdict is owed, because the
     *     target was prose and the arithmetic deliberately declined to guess;
     *   · MISSED in the last fortnight - the student said they fell short, which is the
     *     earliest honest signal of a student slipping.
     */
    const [awaitingReview, missedRecently] = await Promise.all([
      prisma.sprintWeek.count({
        where: { status: "PENDING", actual: { not: null }, enrollment: { status: "ACTIVE" } },
      }),
      prisma.sprintWeek.count({
        where: {
          status: "MISSED",
          weekEnd: { gte: fourteenDaysAgo },
          enrollment: { status: "ACTIVE" },
        },
      }),
    ]);
    if (awaitingReview > 0) {
      items.push({
        id: "sprint-awaiting-review",
        severity: "watch",
        title: `${awaitingReview} sprint check-in${awaitingReview === 1 ? "" : "s"} waiting on you`,
        body: "A student has said what they got done; the week still needs your verdict.",
        href: "/students",
      });
    }
    if (missedRecently > 0) {
      items.push({
        id: "sprint-missed",
        severity: "risk",
        title: `${missedRecently} missed sprint week${missedRecently === 1 ? "" : "s"} in the last fortnight`,
        body: "Students who told us they fell short of their target - worth a conversation.",
        href: "/students",
      });
    }

    /**
     * Prospects the intake auto-disqualified in the last 24h (Error Log L8).
     *
     * A BANT "CANCEL" at submission cancels the booking and emails the prospect a rejection -
     * but NOBODY internally was told. A caller who had been working that prospect found out
     * when the prospect asked why, which is the "awkward" the client reported. The spec's own
     * remedy is "notify the caller before the cancellation fires"; the cancellation is
     * synchronous at intake, so the honest version is to surface it the moment it happens.
     *
     * Counted from the CANCELLED booking rather than the lead's stage: a lead can reach LOST
     * for many reasons, and only this one owes somebody an explanation.
     */
    const autoDisqualified = await prisma.bookingRequest.count({
      where: {
        status: "CANCELLED",
        slotId: null, // the auto-disqualify path never claims a slot
        createdAt: { gte: new Date(Date.now() - 86400000) },
        lead: { is: { stage: "LOST" } },
      },
    });
    if (autoDisqualified > 0) {
      items.push({
        id: "auto-disqualified",
        severity: "watch",
        title: `${autoDisqualified} prospect${autoDisqualified === 1 ? "" : "s"} auto-disqualified at intake`,
        body:
          autoDisqualified === 1
            ? "A booking was declined automatically on its BANT score and the prospect has been emailed. Check it was the right call before they ask."
            : "Bookings were declined automatically on their BANT score and those prospects have been emailed. Check they were the right calls before they ask.",
        href: "/bookings",
      });
    }

    const [redCount, checkInsDue, radarCount] = await Promise.all([
      prisma.enrollment.count({ where: { status: "ACTIVE", signalColour: "RED" } }),
      prisma.enrollment.count({ where: { status: "ACTIVE", nextCheckInDate: { lte: today } } }),
      prisma.enrollment.count({
        where: {
          status: "ACTIVE",
          programLevel: { in: ["GUIDED", "ELITE"] },
          signalColour: { not: "RED" }, // already-red students are covered by the red alert
          OR: [
            { lastSessionDate: { lt: fourteenDaysAgo } },
            { lastTaskCompleted: "NO" },
          ],
        },
      }),
    ]);
    if (radarCount > 0) {
      items.push({
        id: "radar",
        severity: "watch",
        title: `Early-warning radar: ${radarCount} student${radarCount > 1 ? "s" : ""} drifting`,
        body: "Long session gaps or undone tasks - review before they turn red.",
        href: "/students",
      });
    }
    if (redCount > 0) {
      items.push({
        id: "red-students",
        severity: "risk",
        title: `${redCount} student${redCount > 1 ? "s" : ""} on red signal`,
        body: "Open the tracker sorted red-first and act on them.",
        href: "/students",
      });
    }

    // §2.8 - head-coach escalations to the very top. A red signal WITH a written note is a
    // coach deliberately raising a case for the founder, not just a threshold tripping; each
    // gets its own row that sorts above every automated alert. Capped so a bad week can't bury
    // the rest of the band; the "+N more" pointer and the tracker carry the tail.
    const escalated = await prisma.enrollment.findMany({
      where: { status: "ACTIVE", signalColour: "RED", signalNotes: { not: null } },
      orderBy: { statusChangedAt: "desc" },
      take: 3,
      select: { studentId: true, signalNotes: true, student: { select: { fullName: true, code: true } } },
    });
    for (const e of escalated) {
      const note = (e.signalNotes ?? "").trim();
      items.push({
        id: `escalation-${e.studentId}`,
        severity: "risk",
        escalated: true,
        title: `Coach flagged ${e.student.fullName}${e.student.code ? ` (${e.student.code})` : ""}`,
        body: note.length > 90 ? `${note.slice(0, 90)}…` : note || "A coach marked this student red - review the note.",
        href: `/students/${e.studentId}`,
      });
    }
    if (checkInsDue > 0) {
      items.push({
        id: "checkins-due",
        severity: "watch",
        title: `${checkInsDue} check-in${checkInsDue > 1 ? "s" : ""} due`,
        body: "Next check-in date is today or has passed.",
        href: "/students",
      });
    }
  }

  if (role !== "ADMIN") return items;

  // ── Admin-only: money + team health ──
  const month = istMonthRange(today);
  // Today's rate, for the few figures the database only holds in rupees (the monthly target,
  // payables). Everything income- or receivable-derived carries a real EUR aggregate instead.
  const fx = await getTodayInrPerEur();
  const fxRate = Number(fx.rate);
  const inrOnlyPair = (inr: number) => ({ inr, eur: fxRate > 0 ? inr / fxRate : 0 });
  /**
   * The follow-up window for a scheduled instalment: 10 days before it falls due, OR from the
   * first of the month it falls in, whichever arrives first. The two rules exist for different
   * habits - a rolling 10 days catches a date wherever it lands, and "everything due this month"
   * is the one planning sweep on the 1st - so the horizon is simply the later of the two edges,
   * and an instalment enters the list the moment either rule starts pointing at it.
   */
  const upcomingHorizon = new Date(
    Math.max(
      today.getTime() + 10 * 86_400_000,
      // `month.end` is exclusive, so step back a day to land on the last of this month.
      month.end.getTime() - 86_400_000,
    ),
  );

  const [pendingRows, runway, missingLoggers, monthIncomes, target, payablesDueSoon, weekSnapshot, instalmentsDueSoon] =
    await Promise.all([
      getPendingRows(),
      getRunwaySnapshot(),
      (async () => {
        // The founder's EOD summary. When EOD rules are on, the cutoff is the moment this
        // becomes news; otherwise keep the 7PM convention the app shipped with.
        const eod = await getDailyLogEod();
        const due = eod.enabled
          ? istMinutesOfDay(new Date()) >= eod.cutoffMinutes
          : istHourNow() >= 19;
        if (!due || (eod.enabled && !eod.founderSummary)) {
          return { missing: [] as string[], auto: [] as string[], cutoffLabel: "", enabled: eod.enabled };
        }
        const [profiles, todayLogs] = await Promise.all([
          prisma.teamProfile.findMany({ where: { status: "ACTIVE", dashboardRole: { not: "ADMIN" }, userId: { not: null } } }),
          prisma.dailyLog.findMany({ where: { date: today }, select: { userId: true, source: true } }),
        ]);
        const sourceByUser = new Map(todayLogs.map((l) => [l.userId, l.source]));
        return {
          // Nobody logged AND the job didn't cover them (auto-save off, or cron not ticking).
          missing: profiles.filter((p) => !sourceByUser.has(p.userId!)).map((p) => p.fullName),
          // Covered by the job - a row exists, but no human stood behind these numbers yet.
          auto: profiles.filter((p) => sourceByUser.get(p.userId!) === "EOD_AUTO").map((p) => p.fullName),
          cutoffLabel: formatIstMinutes(eod.cutoffMinutes),
          enabled: eod.enabled,
        };
      })(),
      prisma.income.findMany({
        where: { ...ACTIVE, date: { gte: month.start, lt: month.end } },
        select: { amountInrMinor: true, amountEurMinor: true, fxRateUsed: true },
      }),
      prisma.monthlyTarget.findUnique({ where: { month: month.start } }),
      prisma.payable.findMany({
        where: {
          status: "ACTIVE",
          nextDueDate: { gte: today, lte: new Date(today.getTime() + 7 * 86400000) },
        },
      }),
      prisma.weeklyFunnelSnapshot.findFirst({
        where: { weekStart: { gte: new Date(today.getTime() - 7 * 86400000) } },
      }),
      // Instalments still to come. `gte: today` deliberately excludes anything already past due -
      // those are the overdue receivable's business, and a date cannot be both "follow this up
      // before it lands" and "this one got away".
      prisma.instalment.findMany({
        where: {
          status: { in: ["DUE", "OVERDUE"] },
          dueDate: { gte: today, lte: upcomingHorizon },
          pendingPayment: { ...ACTIVE, status: { in: ["ACTIVE", "OVERDUE"] } },
        },
        select: {
          dueDate: true,
          amountInrMinor: true,
          amountEurMinor: true,
          fxRateUsed: true,
          pendingPayment: { select: { studentName: true } },
        },
        orderBy: { dueDate: "asc" },
        take: 100,
      }),
    ]);

  const overdue = pendingRows.filter((p) => p.overdue && p.balance.inr > 0);
  if (overdue.length > 0) {
    // Both aggregates - every receivable already carries its EUR balance from its own stamped
    // rate, so this figure is exact in either currency rather than converted on read.
    const total = overdue.reduce(
      (a, p) => ({ inr: a.inr + p.balance.inr, eur: a.eur + p.balance.eur }),
      { inr: 0, eur: 0 },
    );
    items.push({
      id: "overdue-receivables",
      severity: "risk",
      title: `${overdue.length} overdue payment${overdue.length > 1 ? "s" : ""} - {m0}`,
      body: `${overdue[0].studentName}${overdue.length > 1 ? ` and ${overdue.length - 1} more` : ""} past the due date.`,
      href: "/finance",
      amounts: [total],
    });
  }

  /**
   * Instalments worth chasing BEFORE they are missed - the whole point of writing the due dates
   * down on the income entry. `watch`, not `risk`: nothing has gone wrong yet, and colouring an
   * on-time plan red is how a founder learns to ignore the band.
   *
   * Each instalment carries its own EUR figure from the rate stamped when the plan was agreed,
   * so this total is exact in both currencies rather than converted at read time.
   */
  if (instalmentsDueSoon.length > 0) {
    const total = instalmentsDueSoon.reduce(
      (a, i) => ({
        inr: a.inr + Number(aggInrMinor(i.amountInrMinor, i.amountEurMinor, i.fxRateUsed)),
        eur: a.eur + Number(aggEurMinor(i.amountInrMinor, i.amountEurMinor, i.fxRateUsed)),
      }),
      { inr: 0, eur: 0 },
    );
    const first = instalmentsDueSoon[0];
    const others = instalmentsDueSoon.length - 1;
    items.push({
      id: "instalments-due-soon",
      severity: "watch",
      title: `${instalmentsDueSoon.length} instalment${instalmentsDueSoon.length > 1 ? "s" : ""} due soon - {m0}`,
      body: `${first.pendingPayment.studentName} on ${formatDate(first.dueDate)}${
        others > 0 ? ` and ${others} more` : ""
      }. Follow up before the date, not after it.`,
      href: "/finance",
      amounts: [total],
    });
  }

  if (runway.runwayMonths !== null && runway.runwayMonths < 6) {
    items.push({
      id: "runway",
      severity: runway.runwayMonths < 3 ? "risk" : "watch",
      title: `Runway ${runway.runwayMonths} months`,
      body: runway.runwayMonths < 3 ? "Urgent: increase revenue or cut costs immediately." : "Monitor closely - reduce non-essential spending.",
      href: "/cash",
    });
  }
  if (runway.cashStale) {
    items.push({
      id: "cash-stale",
      severity: "watch",
      title: "Bank balance entry overdue",
      body: "The weekly Monday cash position is more than 7 days old.",
      href: "/cash",
    });
  }

  if (missingLoggers.missing.length > 0) {
    items.push({
      id: "missing-logs",
      severity: "watch",
      title: `Missing daily logs: ${missingLoggers.missing.join(", ")}`,
      body: missingLoggers.enabled
        ? `No log submitted by the ${missingLoggers.cutoffLabel} IST cutoff, and nothing auto-saved for them.`
        : "No log submitted by 7:00 PM IST.",
      href: "/people",
    });
  }

  // Auto-saved days are reported SEPARATELY from missing ones, and never as a win: a row exists,
  // but it's the machine's account of the day, not the person's, and it's incomplete by
  // construction. Folding these into "logged" would let unamended numbers reach the pay board
  // looking like someone had reported them.
  if (missingLoggers.auto.length > 0) {
    items.push({
      id: "auto-saved-logs",
      severity: "info",
      title: `Auto-saved at cutoff: ${missingLoggers.auto.join(", ")}`,
      body: "Derived from activity because no log was submitted - incomplete until they amend it. Don't judge pay on these yet.",
      href: "/people",
    });
  }

  // Target progress: worry after mid-month, celebrate at 100%
  const revenueInr = monthIncomes.reduce(
    (a, i) => a + Number(aggInrMinor(i.amountInrMinor, i.amountEurMinor, i.fxRateUsed)),
    0,
  );
  const revenueEur = monthIncomes.reduce(
    (a, i) => a + Number(aggEurMinor(i.amountInrMinor, i.amountEurMinor, i.fxRateUsed)),
    0,
  );
  const targetInr = Number(target?.targetInrMinor ?? BigInt(80000000));
  const pct = targetInr > 0 ? (revenueInr / targetInr) * 100 : 0;
  if (pct >= 100) {
    items.push({
      id: "target-hit",
      severity: "win",
      title: "Monthly revenue target hit 🎉",
      body: `{m0} of {m1} - new high score.`,
      href: "/pipeline",
      // Revenue is exact in both; the target is rupee-only, so its euro side is today's rate.
      amounts: [{ inr: revenueInr, eur: revenueEur }, inrOnlyPair(targetInr)],
    });
  } else if (today.getUTCDate() > 15 && pct < 50) {
    items.push({
      id: "target-behind",
      severity: "risk",
      title: `Revenue at ${Math.round(pct)}% of target past mid-month`,
      body: "The target bar is red - review the pipeline forecast.",
      href: "/pipeline",
    });
  }

  if (payablesDueSoon.length > 0) {
    const total = payablesDueSoon.reduce((a, p) => a + Number(p.amountInrMinor), 0);
    items.push({
      id: "payables-due",
      severity: "info",
      title: `${payablesDueSoon.length} payable${payablesDueSoon.length > 1 ? "s" : ""} due within 7 days`,
      body: `{m0} committed - ${payablesDueSoon.map((p) => p.name).join(", ")}.`,
      href: "/cash",
      // Payables are recorded in rupees only - euro side at today's rate.
      amounts: [inrOnlyPair(total)],
    });
  }

  // Deal-risk: open deals that haven't moved (report §3.A) - updatedAt as movement proxy
  const tenDaysAgo = new Date(Date.now() - 10 * 86400000);
  const stalledDeals = await prisma.lead.count({
    where: {
      ...ACTIVE,
      stage: {
        in: [
          "DISCO_BOOKED", "DISCO_NOT_BOOKED", "DISCO_COMPLETED", "SSS_BOOKED", "SSS_COMPLETED",
          "PROPOSAL_SENT", "SENT_TO_WORKSHOP", "WORKSHOP_FOLLOWUP", "OFFER_FOLLOWUP", "DEPOSIT_FOLLOWUP",
        ],
      },
      updatedAt: { lt: tenDaysAgo },
    },
  });
  if (stalledDeals > 0) {
    items.push({
      id: "stalled-deals",
      severity: "watch",
      title: `${stalledDeals} deal${stalledDeals > 1 ? "s" : ""} stalled in the pipeline`,
      body: "No movement in 10+ days - see “Deals at risk” on the Pipeline page.",
      href: "/pipeline",
    });
  }

  // ── Agreements: the founder should never have to remember who is waiting on a contract.
  // Every one of these is derived (see lib/agreement-state.ts) - it appears while the condition
  // holds and disappears the moment it's acted on, exactly like the rest of this feed.
  const agreements = await getAgreementTaskCounts();
  if (agreements.readyToSend > 0) {
    items.push({
      id: "agreements-ready",
      severity: "watch",
      title: `${agreements.readyToSend} agreement${agreements.readyToSend > 1 ? "s" : ""} ready to send`,
      body: "These clients are past the point where the agreement should go out - generate and send.",
      href: "/agreements/new",
    });
  }
  if (agreements.expired > 0) {
    items.push({
      id: "agreements-expired",
      severity: "watch",
      title: `${agreements.expired} signing link${agreements.expired > 1 ? "s" : ""} expired unsigned`,
      body: "The 14-day window lapsed. Void and re-issue so the deal isn't lost to a dead link.",
      href: "/agreements",
    });
  }
  if (agreements.signedNoCopy > 0) {
    items.push({
      id: "agreements-copy",
      severity: "watch",
      title: `${agreements.signedNoCopy} signed agreement${agreements.signedNoCopy > 1 ? "s" : ""} without a delivered copy`,
      body: "The student signed but never received their countersigned copy.",
      href: "/agreements",
    });
  }
  if (agreements.awaitingSignature > 0) {
    items.push({
      id: "agreements-awaiting",
      severity: "info",
      title: `${agreements.awaitingSignature} agreement${agreements.awaitingSignature > 1 ? "s" : ""} awaiting signature`,
      body: "Issued and still unsigned - a reminder is one click away.",
      href: "/agreements",
    });
  }

  if (!weekSnapshot && today.getUTCDay() >= 3) {
    items.push({
      id: "snapshot-missing",
      severity: "info",
      title: "This week's funnel snapshot is missing",
      body: "Enter the weekly numbers so the funnel stays honest.",
      href: "/funnel",
    });
  }

  // Admin also posts in the German Note community (e.g. the pinned welcome).
  items.push(...(await gnEngagementNotifications(userId, today)));

  const order = { risk: 0, watch: 1, win: 2, info: 3 };
  // Escalations (a human raised it) always sort above the severity ladder (§2.8).
  return items.sort(
    (a, b) => Number(!!b.escalated) - Number(!!a.escalated) || order[a.severity] - order[b.severity],
  );
}

/** Consecutive-day streak of daily logs ending today (or yesterday if today pending). */
export async function getLogStreak(userId: string): Promise<{ streak: number; loggedToday: boolean }> {
  const logs = await prisma.dailyLog.findMany({
    where: { userId },
    orderBy: { date: "desc" },
    take: 120,
    select: { date: true },
  });
  const days = new Set(logs.map((l) => l.date.toISOString().slice(0, 10)));
  const today = istToday();
  const key = (d: Date) => d.toISOString().slice(0, 10);
  const loggedToday = days.has(key(today));

  let cursor = new Date(today);
  if (!loggedToday) cursor.setUTCDate(cursor.getUTCDate() - 1); // streak survives until tonight
  let streak = 0;
  while (days.has(key(cursor))) {
    streak++;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return { streak, loggedToday };
}

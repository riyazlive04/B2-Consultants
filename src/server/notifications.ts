import "server-only";
import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { istMinutesOfDay, istMonthRange, istToday } from "@/lib/dates";
import { formatIstMinutes } from "@/lib/config-schema";
import { getDailyLogEod } from "./founder-config";
import { formatDate, formatInrMinor } from "@/lib/format";
import type { AppRole } from "@/lib/rbac";
import { aggInrMinor } from "@/lib/money";
import { ACTIVE } from "@/lib/soft-delete";
import { parseMentions } from "@/lib/gn-mentions";
import { getPendingRows } from "./finance-metrics";
import { getRunwaySnapshot } from "./cash-metrics";
import { getTeamGame } from "./gamification";
import { getMyStudentPortal } from "./student-portal";
import { getAgreementTaskCounts } from "./agreement-state";
import { MILESTONE_LABELS } from "@/lib/labels";

/**
 * IN-APP notification centre. Server-computed on load + light polling - the same
 * "live badge" model the PRDs allow. This centre stays in-app only (no email here).
 * Outbound WhatsApp lives in a separate, opt-in WATI layer (Wave-2: src/server/whatsapp.ts),
 * not here — these items are stateless status alerts that appear while a condition holds
 * and disappear when it's resolved.
 */

export type Notification = {
  id: string;
  severity: "risk" | "watch" | "info" | "win";
  /**
   * A person deliberately raised this for the founder — a head coach red-flagging a student
   * with a note, not a threshold the system tripped on its own (§2.8). Escalations sort ABOVE
   * everything else, because a human asking for attention outranks any automated alert.
   */
  escalated?: boolean;
  title: string;
  body: string;
  href: string;
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
 * notification here — surfaces while it's "recent" (last 3 days), no read-state.
 */
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
      body: "Someone tagged you in German Note — jump in and reply.",
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
      body: "People are liking your German Note posts — that's community points toward your level.",
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
 * gnEngagementNotifications — the note author gets no push, the mentioned person sees it purely
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
      body: "Someone tagged you in a CRM note — open the contact to see it.",
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

async function _computeNotifications(role: AppRole, userId: string): Promise<Notification[]> {
  const items: Notification[] = [];
  const today = istToday();

  // ── STUDENT portal: their own journey only — nothing about the business ──
  if (role === "STUDENT") {
    const portal = await getMyStudentPortal(userId);
    const e = portal?.primary;
    // German Note learners have no B2 enrollment — still get community engagement.
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
          ? `${MILESTONE_LABELS[recent.newMilestone]} — congratulations! 🎉`
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

  // ── TUTOR: German Note only — community engagement, no business notifications ──
  if (role === "TUTOR") {
    items.push(...(await gnEngagementNotifications(userId, today)));
    const order = { risk: 0, watch: 1, win: 2, info: 3 };
    return items.sort(
      (a, b) => Number(!!b.escalated) - Number(!!a.escalated) || order[a.severity] - order[b.severity],
    );
  }

  // ── ADMIN/HEAD/USER: CRM @mentions on contact notes. Coarse role gate, matching every other
  // check in this function (own-log, badges, radar, …) — none of them thread the founder's
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
              ? `The ${cutoffLabel} cutoff has passed. Your numbers will be auto-saved from your activity — amend them to add what activity can't see.`
              : `The ${cutoffLabel} cutoff has passed — today's log is closed. Contact Admin to make changes.`
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
    // Telecaller Pay board. The window is short, so this is a "watch", not an "info".
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

    // §2.8 — head-coach escalations to the very top. A red signal WITH a written note is a
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
        body: note.length > 90 ? `${note.slice(0, 90)}…` : note || "A coach marked this student red — review the note.",
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
  const [pendingRows, runway, missingLoggers, monthIncomes, target, payablesDueSoon, weekSnapshot] =
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
          // Covered by the job — a row exists, but no human stood behind these numbers yet.
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
    ]);

  const overdue = pendingRows.filter((p) => p.overdue && p.balance.inr > 0);
  if (overdue.length > 0) {
    const total = overdue.reduce((a, p) => a + p.balance.inr, 0);
    items.push({
      id: "overdue-receivables",
      severity: "risk",
      title: `${overdue.length} overdue payment${overdue.length > 1 ? "s" : ""} - ${formatInrMinor(total, { compact: true })}`,
      body: `${overdue[0].studentName}${overdue.length > 1 ? ` and ${overdue.length - 1} more` : ""} past the due date.`,
      href: "/finance",
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
      body: "Derived from activity because no log was submitted — incomplete until they amend it. Don't judge pay on these yet.",
      href: "/people",
    });
  }

  // Target progress: worry after mid-month, celebrate at 100%
  const revenueInr = monthIncomes.reduce(
    (a, i) => a + Number(aggInrMinor(i.amountInrMinor, i.amountEurMinor, i.fxRateUsed)),
    0,
  );
  const targetInr = Number(target?.targetInrMinor ?? BigInt(80000000));
  const pct = targetInr > 0 ? (revenueInr / targetInr) * 100 : 0;
  if (pct >= 100) {
    items.push({
      id: "target-hit",
      severity: "win",
      title: "Monthly revenue target hit 🎉",
      body: `${formatInrMinor(revenueInr, { compact: true })} of ${formatInrMinor(targetInr, { compact: true })} - new high score.`,
      href: "/pipeline",
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
      body: `${formatInrMinor(total, { compact: true })} committed - ${payablesDueSoon.map((p) => p.name).join(", ")}.`,
      href: "/cash",
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
  // Every one of these is derived (see lib/agreement-state.ts) — it appears while the condition
  // holds and disappears the moment it's acted on, exactly like the rest of this feed.
  const agreements = await getAgreementTaskCounts();
  if (agreements.readyToSend > 0) {
    items.push({
      id: "agreements-ready",
      severity: "watch",
      title: `${agreements.readyToSend} agreement${agreements.readyToSend > 1 ? "s" : ""} ready to send`,
      body: "These clients are past the point where the agreement should go out — generate and send.",
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
      body: "Issued and still unsigned — a reminder is one click away.",
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

import "server-only";
import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { istMonthRange, istToday } from "@/lib/dates";
import { formatDate, formatInrMinor } from "@/lib/format";
import type { AppRole } from "@/lib/rbac";
import { aggInrMinor } from "@/lib/money";
import { getPendingRows } from "./finance-metrics";
import { getRunwaySnapshot } from "./cash-metrics";
import { getTeamGame } from "./gamification";
import { getMyStudentPortal } from "./student-portal";
import { MILESTONE_LABELS } from "@/lib/labels";

/**
 * IN-APP notification centre. Server-computed on load + light polling - the same
 * "live badge" model the PRDs allow. Deliberately NO email / NO WhatsApp (every
 * PRD excludes outbound alerts). Items are stateless status alerts: they appear
 * while a condition holds and disappear when it's resolved.
 */

export type Notification = {
  id: string;
  severity: "risk" | "watch" | "info" | "win";
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
 * Wrapped in React.cache so the layout, the home page and the notification bell
 * that all run in one request share ONE computation instead of re-querying the
 * (heavy) pending / runway / gamification joins 2–3× per navigation.
 */
export const computeNotifications = cache(_computeNotifications);

async function _computeNotifications(role: AppRole, userId: string): Promise<Notification[]> {
  const items: Notification[] = [];
  const today = istToday();

  // ── STUDENT portal: their own journey only — nothing about the business ──
  if (role === "STUDENT") {
    const portal = await getMyStudentPortal(userId);
    const e = portal?.primary;
    if (!e) return items;

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

    const order = { risk: 0, watch: 1, win: 2, info: 3 };
    return items.sort((a, b) => order[a.severity] - order[b.severity]);
  }

  // ── Everyone with a daily-log duty: own log reminder ──
  if (role !== "ADMIN") {
    const [profile, todayLog] = await Promise.all([
      prisma.teamProfile.findUnique({ where: { userId } }),
      prisma.dailyLog.findUnique({ where: { userId_date: { userId, date: today } } }),
    ]);
    if (profile && profile.status === "ACTIVE" && !todayLog) {
      const late = istHourNow() >= 19;
      items.push({
        id: "own-log",
        severity: late ? "watch" : "info",
        title: late ? "Daily log overdue" : "Daily log not submitted yet",
        body: late ? "The 7:00 PM mark has passed - log today's numbers now." : "Log today's numbers before 7:00 PM.",
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
        if (istHourNow() < 19) return [] as string[];
        const [profiles, todayLogs] = await Promise.all([
          prisma.teamProfile.findMany({ where: { status: "ACTIVE", dashboardRole: { not: "ADMIN" }, userId: { not: null } } }),
          prisma.dailyLog.findMany({ where: { date: today }, select: { userId: true } }),
        ]);
        const submitted = new Set(todayLogs.map((l) => l.userId));
        return profiles.filter((p) => !submitted.has(p.userId!)).map((p) => p.fullName);
      })(),
      prisma.income.findMany({
        where: { date: { gte: month.start, lt: month.end } },
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

  if (missingLoggers.length > 0) {
    items.push({
      id: "missing-logs",
      severity: "watch",
      title: `Missing daily logs: ${missingLoggers.join(", ")}`,
      body: "No log submitted by 7:00 PM IST.",
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

  if (!weekSnapshot && today.getUTCDay() >= 3) {
    items.push({
      id: "snapshot-missing",
      severity: "info",
      title: "This week's funnel snapshot is missing",
      body: "Enter the weekly numbers so the funnel stays honest.",
      href: "/funnel",
    });
  }

  const order = { risk: 0, watch: 1, win: 2, info: 3 };
  return items.sort((a, b) => order[a.severity] - order[b.severity]);
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

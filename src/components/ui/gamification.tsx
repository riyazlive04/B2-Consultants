"use client";

import type { ReactNode } from "react";
import type {
  BadgeTier, LevelInfo, Momentum, QuestProgress, UnlockedBadge,
} from "@/lib/gamification";
import { MOMENTUM_META } from "@/lib/gamification";
import { formatDate } from "@/lib/format";

/**
 * Gamification UI kit — level rings, XP bars, badge chips, quest cards, podium.
 * Pure presentation over lib/gamification.ts data; matches the app's card
 * language (rounded-card / border-line / shadow-card) and the primary blue.
 */

// ── tier styling: emoji medallion in a tiered ring. Bronze/silver/gold are
// medal materials; legend is the brand blue (one accent hue, DESIGN_SYSTEM §9). ──
const TIER_RING: Record<BadgeTier, string> = {
  bronze: "linear-gradient(135deg, #d2a679, #a05a2c)",
  silver: "linear-gradient(135deg, #e9edf2, #9aa7b5)",
  gold: "linear-gradient(135deg, #ffe08a, #d99a06)",
  legend: "linear-gradient(135deg, var(--primary-tint), var(--primary-strong))",
};

export const TIER_LABELS: Record<BadgeTier, string> = {
  bronze: "Bronze", silver: "Silver", gold: "Gold", legend: "Legend",
};

/** Circular level ring with the level number at the centre. */
export function LevelRing({ level, size = 72 }: { level: LevelInfo; size?: number }) {
  const R = size / 2 - 6;
  const C = 2 * Math.PI * R;
  return (
    <div className="relative grid flex-none place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={R} fill="none" stroke="var(--surface-2)" strokeWidth="7" />
        <circle
          cx={size / 2} cy={size / 2} r={R} fill="none"
          stroke="var(--accent)" strokeWidth="7" strokeLinecap="round"
          strokeDasharray={C} strokeDashoffset={C * (1 - level.progressPct / 100)}
          style={{ transition: "stroke-dashoffset 600ms ease" }}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center leading-none">
        <div>
          <p className="text-[9px] font-semibold uppercase tracking-wide text-muted">Lv</p>
          <p className="font-display text-xl font-bold tabular-nums">{level.level}</p>
        </div>
      </div>
    </div>
  );
}

/** XP progress bar towards the next level, with the numbers spelled out. */
export function XpBar({ xp, level }: { xp: number; level: LevelInfo }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm font-semibold">
          {level.title}
          <span className="ml-2 tnum text-xs font-medium text-muted">{xp.toLocaleString("en-IN")} XP</span>
        </p>
        {level.nextMinXp !== null ? (
          <p className="tnum text-xs text-muted">{(level.nextMinXp - xp).toLocaleString("en-IN")} XP to Lv {level.level + 1}</p>
        ) : (
          <p className="text-xs font-semibold text-accent">Max level</p>
        )}
      </div>
      <div className="mt-1.5 h-2.5 w-full overflow-hidden rounded-full bg-surface-2">
        <div
          className="xp-fill h-full rounded-full"
          style={{ width: `${Math.max(2, level.progressPct)}%` }}
        />
      </div>
    </div>
  );
}

/** A single badge medallion. Locked badges are greyed with the unlock hint in the tooltip. */
export function BadgeChip({ badge, size = "md" }: { badge: UnlockedBadge; size?: "sm" | "md" }) {
  const unlocked = !!badge.unlockedAt;
  const dim = size === "sm" ? "h-9 w-9 text-base" : "h-12 w-12 text-xl";
  return (
    <div
      className="flex w-16 flex-col items-center gap-1 text-center"
      title={`${badge.name} (${TIER_LABELS[badge.tier]}) — ${badge.description}${
        unlocked ? ` Unlocked ${formatDate(badge.unlockedAt!)}.` : " Locked."
      }`}
    >
      <span
        className={`grid ${dim} place-items-center rounded-full ${unlocked ? "badge-shine" : ""}`}
        style={
          unlocked
            ? { background: TIER_RING[badge.tier], boxShadow: "0 2px 6px rgba(20,22,27,0.18)" }
            : { background: "var(--surface-2)", filter: "grayscale(1)", opacity: 0.45 }
        }
      >
        <span aria-hidden>{badge.icon}</span>
      </span>
      <span className={`w-full truncate text-[10px] leading-tight ${unlocked ? "font-semibold" : "text-muted"}`}>
        {badge.name}
      </span>
    </div>
  );
}

/** Horizontal strip of the earned badges only (compact contexts). */
export function BadgeStrip({ badges, max = 8 }: { badges: UnlockedBadge[]; max?: number }) {
  const earned = badges.filter((b) => b.unlockedAt);
  if (!earned.length) return <p className="text-xs text-muted">No badges yet — they unlock as the work lands.</p>;
  return (
    <div className="flex flex-wrap gap-2">
      {earned.slice(0, max).map((b) => (
        <span
          key={b.key}
          title={`${b.name} — ${b.description}`}
          className="badge-shine grid h-8 w-8 place-items-center rounded-full text-sm"
          style={{ background: TIER_RING[b.tier] }}
        >
          {b.icon}
        </span>
      ))}
      {earned.length > max && (
        <span className="grid h-8 place-items-center rounded-full bg-surface-2 px-2 text-xs font-semibold text-muted">
          +{earned.length - max}
        </span>
      )}
    </div>
  );
}

/** One weekly quest with live progress. */
export function QuestCard({ quest }: { quest: QuestProgress }) {
  return (
    <div
      className={`rounded-card border p-4 shadow-card transition-colors ${
        quest.done ? "border-transparent bg-accent-soft" : "border-line bg-surface"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="flex items-center gap-2 text-sm font-semibold">
          <span className="text-lg" aria-hidden>{quest.icon}</span>
          {quest.title}
        </p>
        <span
          className={`flex-none rounded-full px-2 py-0.5 text-[11px] font-bold ${
            quest.done ? "bg-accent text-white" : "bg-surface-2 text-muted"
          }`}
        >
          {quest.done ? "✓ done" : `+${quest.xp} XP`}
        </span>
      </div>
      <p className="mt-1 text-xs text-muted">{quest.description}</p>
      <div className="mt-3 flex items-center gap-2">
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-2">
          <div
            className="h-full rounded-full transition-all"
            style={{ width: `${Math.max(quest.value > 0 ? 4 : 0, quest.pct)}%`, background: quest.done ? "var(--ok)" : "var(--accent)" }}
          />
        </div>
        <span className="tnum text-xs font-semibold">
          {quest.value}/{quest.target}
        </span>
      </div>
    </div>
  );
}

/** Top-3 podium for the leaderboard. Order passed in = ranks 1..3. */
export function Podium({
  entries,
}: {
  entries: Array<{ name: string; detail: string; value: string; badge?: ReactNode }>;
}) {
  if (!entries.length) return null;
  const medals = ["🥇", "🥈", "🥉"];
  const heights = ["h-24", "h-16", "h-12"];
  const display = [entries[1], entries[0], entries[2]].filter(Boolean) as typeof entries; // silver · gold · bronze
  const rankOf = (e: (typeof entries)[number]) => entries.indexOf(e);
  return (
    <div className="flex items-end justify-center gap-3 sm:gap-6">
      {display.map((e) => {
        const rank = rankOf(e);
        return (
          <div key={e.name} className="flex w-28 flex-col items-center gap-1.5 sm:w-36">
            <span className={rank === 0 ? "text-3xl" : "text-2xl"} aria-hidden>
              {medals[rank]}
            </span>
            <p className="w-full truncate text-center text-sm font-bold">{e.name}</p>
            <p className="tnum text-xs font-semibold text-accent">{e.value}</p>
            <p className="w-full truncate text-center text-[11px] text-muted">{e.detail}</p>
            {e.badge}
            <div
              className={`w-full rounded-t-xl border border-b-0 border-line ${heights[rank]}`}
              style={{
                background:
                  rank === 0
                    ? "linear-gradient(180deg, var(--primary-soft), var(--bg-surface))"
                    : "linear-gradient(180deg, var(--bg-surface-2), var(--bg-surface))",
              }}
            />
          </div>
        );
      })}
    </div>
  );
}

/** Student momentum chip: hot / steady / cooling / stalled. */
export function MomentumChip({ momentum, size = "md" }: { momentum: Momentum; size?: "sm" | "md" }) {
  const meta = MOMENTUM_META[momentum];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full font-semibold ${
        size === "sm" ? "px-2 py-0.5 text-[11px]" : "px-2.5 py-1 text-xs"
      }`}
      style={{ background: meta.soft, color: meta.color }}
      title={`Momentum: ${meta.label}`}
    >
      <span aria-hidden>{meta.icon}</span>
      {meta.label}
    </span>
  );
}

/** Journey ring for a student (percent of the 7-milestone path covered). */
export function JourneyRing({ pct, stageIndex, size = 64 }: { pct: number; stageIndex: number; size?: number }) {
  const R = size / 2 - 5;
  const C = 2 * Math.PI * R;
  const done = pct >= 100;
  return (
    <div className="relative grid flex-none place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={R} fill="none" stroke="var(--surface-2)" strokeWidth="6" />
        <circle
          cx={size / 2} cy={size / 2} r={R} fill="none"
          stroke={done ? "var(--ok)" : "var(--accent)"} strokeWidth="6" strokeLinecap="round"
          strokeDasharray={C} strokeDashoffset={C * (1 - Math.min(100, pct) / 100)}
          style={{ transition: "stroke-dashoffset 600ms ease" }}
        />
      </svg>
      <span className="absolute font-display text-sm font-bold tabular-nums">
        {done ? "🎓" : `${Math.round(pct)}%`}
      </span>
      <span className="sr-only">Journey stage {stageIndex + 1} of 7</span>
    </div>
  );
}

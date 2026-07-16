"use client";

import { useState } from "react";
import { Flame, Info, ListOrdered, Medal, ScrollText, Swords } from "lucide-react";
import type { RankedPlayer } from "@/server/gamification";
import type { Ruleset, XpEvent } from "@/lib/gamification";
import { STAGE_LABELS_SHORT } from "@/lib/gamification";
import {
  BadgeChip, BadgeStrip, LevelRing, Podium, QuestCard, XpBar,
} from "@/components/ui/gamification";
import { Card, CardTitle } from "@/components/ui/kit";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { formatDate } from "@/lib/format";

type Player = Omit<RankedPlayer, "events" | "counters" | "logDays" | "levelUps">;
type Period = "week" | "month" | "all";

const PERIODS: Array<{ key: Period; label: string }> = [
  { key: "week", label: "This week" },
  { key: "month", label: "This month" },
  { key: "all", label: "All time" },
];

const xpFor = (p: Player, period: Period) =>
  period === "week" ? p.xpWeek : period === "month" ? p.xpMonth : p.xpTotal;

export function ArenaClient({
  players,
  feed,
  meUserId,
  isAdmin,
  weekStart,
  ruleset,
}: {
  players: Player[];
  feed: Array<XpEvent & { name: string }>;
  meUserId: string;
  isAdmin: boolean;
  weekStart: string;
  /** the rules in force today — the panel below is generated from them, never hardcoded */
  ruleset: Ruleset;
}) {
  const [period, setPeriod] = useState<Period>("week");
  const me = players.find((p) => p.userId === meUserId) ?? null;
  const [galleryFor, setGalleryFor] = useState<string | null>(me?.userId ?? players[0]?.userId ?? null);

  const ranked = [...players]
    .sort((a, b) => xpFor(b, period) - xpFor(a, period) || b.xpTotal - a.xpTotal)
    .map((p, i) => ({ ...p, rank: i + 1 }));
  const galleryPlayer = players.find((p) => p.userId === galleryFor) ?? null;

  const leaderboardColumns: Column<(typeof ranked)[number]>[] = [
    {
      key: "rank", header: "#",
      cell: (p) => ["🥇", "🥈", "🥉"][p.rank - 1] ?? p.rank,
      value: (p) => p.rank,
    },
    {
      key: "player", header: "Player",
      cell: (p) => (
        <>
          {p.name}
          {p.userId === meUserId && <span className="ml-1.5 text-xs text-accent">(you)</span>}
          <span className="block text-xs font-normal text-muted">{p.roleTitle}</span>
        </>
      ),
      value: (p) => p.name,
    },
    {
      key: "level", header: "Level",
      cell: (p) => <>Lv {p.level.level} <span className="text-xs text-muted">{p.level.title}</span></>,
      value: (p) => p.level.level,
    },
    {
      key: "xp", header: `XP (${PERIODS.find((p) => p.key === period)!.label.toLowerCase()})`, align: "right",
      cell: (p) => xpFor(p, period).toLocaleString("en-IN"),
      value: (p) => xpFor(p, period),
    },
    {
      key: "streak", header: "Streak", align: "right",
      cell: (p) => (p.streak > 0 ? `🔥 ${p.streak}d` : "—"),
      value: (p) => p.streak,
    },
    {
      key: "badges", header: "Badges", align: "right",
      cell: (p) => p.unlockedCount,
      value: (p) => p.unlockedCount,
    },
  ];

  if (players.length === 0) {
    return (
      <div className="rounded-card border border-line bg-surface p-6 text-sm text-muted shadow-card">
        No players yet — the Arena lights up once team profiles exist and daily work is logged.
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* ── My card ── */}
      {me && (
        <Card className="rise-in">
          <div className="flex flex-wrap items-center gap-5">
            <LevelRing level={me.level} size={84} />
            <div className="min-w-56 flex-1">
              <XpBar xp={me.xpTotal} level={me.level} />
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                <span className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2.5 py-1 font-semibold">
                  <Flame size={13} className="text-watch" /> {me.streak}-day streak
                </span>
                <span className="rounded-full bg-surface-2 px-2.5 py-1 font-semibold">
                  #{me.rankWeek} this week
                </span>
                <span className="rounded-full bg-surface-2 px-2.5 py-1 font-semibold">
                  {me.unlockedCount}/{me.badges.length} badges
                </span>
                <span className="tnum rounded-full bg-accent-soft px-2.5 py-1 font-semibold text-accent">
                  +{me.xpWeek.toLocaleString("en-IN")} XP this week
                </span>
              </div>
            </div>
            <div className="w-full sm:w-auto">
              <BadgeStrip badges={me.badges} max={6} />
            </div>
          </div>
        </Card>
      )}

      {/* ── Leaderboard ── */}
      <Card
        title={<CardTitle icon={<ListOrdered size={18} />}>Leaderboard</CardTitle>}
        actions={
          <div className="flex rounded-full border border-line bg-surface-2 p-0.5">
            {PERIODS.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => setPeriod(p.key)}
                className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                  period === p.key ? "bg-ink text-surface" : "text-muted hover:text-ink"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        }
      >
        <Podium
          entries={ranked.slice(0, 3).map((p) => ({
            name: p.name.split(" ")[0],
            detail: `Lv ${p.level.level} · ${p.level.title}`,
            value: `${xpFor(p, period).toLocaleString("en-IN")} XP`,
          }))}
        />

        <div className="mt-5">
          <DataTable
            rows={ranked}
            columns={leaderboardColumns}
            rowClassName={(p) => `${p.rank === 1 ? "leader-row" : ""} ${p.userId === meUserId ? "font-semibold" : ""}`}
            filterPlaceholder="Filter players…"
          />
        </div>
        <p className="mt-2 text-caption text-muted">Week starts Monday ({formatDate(weekStart)}).</p>
      </Card>

      {/* ── Weekly quests ── */}
      <section>
        <h2 className="mb-3 flex items-center gap-2 font-display text-h2 font-semibold">
          <Swords size={18} /> Weekly quests
        </h2>
        {me ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {me.quests.map((q) => <QuestCard key={q.key} quest={q} />)}
          </div>
        ) : (
          // Admin view: every player's quest board at a glance
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {players.map((p) => (
              <div key={p.userId} className="rounded-card border border-line bg-surface p-4 shadow-card">
                <p className="text-sm font-semibold">
                  {p.name}
                  <span className="ml-2 text-xs font-normal text-muted">
                    {p.quests.filter((q) => q.done).length}/{p.quests.length} quests done
                  </span>
                </p>
                <div className="mt-3 space-y-2">
                  {p.quests.map((q) => (
                    <div key={q.key} className="flex items-center gap-2 text-xs">
                      <span className="w-5 text-center" aria-hidden>{q.icon}</span>
                      <span className="w-32 truncate">{q.title}</span>
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${q.pct}%`, background: q.done ? "var(--ok)" : "var(--accent)" }}
                        />
                      </div>
                      <span className="tnum w-12 text-right font-semibold">{q.value}/{q.target}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── Badge gallery ── */}
      <Card
        title={<CardTitle icon={<Medal size={18} />}>Badge gallery</CardTitle>}
        actions={
          isAdmin || players.length > 1 ? (
            <div className="flex flex-wrap gap-1.5">
              {players.map((p) => (
                <button
                  key={p.userId}
                  type="button"
                  onClick={() => setGalleryFor(p.userId)}
                  className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                    galleryFor === p.userId ? "bg-ink text-surface" : "bg-surface-2 text-muted hover:text-ink"
                  }`}
                >
                  {p.name.split(" ")[0]} · {p.unlockedCount}
                </button>
              ))}
            </div>
          ) : undefined
        }
      >
        {galleryPlayer && (
          <div className="flex flex-wrap gap-x-3 gap-y-4">
            {galleryPlayer.badges.map((b) => <BadgeChip key={b.key} badge={b} />)}
          </div>
        )}
      </Card>

      {/* ── XP feed ── */}
      <Card title={<CardTitle icon={<ScrollText size={18} />}>Recent XP</CardTitle>}>
        {feed.length ? (
          <ul className="space-y-1.5 text-sm">
            {feed.map((e, i) => (
              <li key={`${e.userId}-${e.dateKey}-${e.kind}-${i}`} className="flex items-baseline gap-2">
                <span className="tnum flex-none text-xs text-muted">{formatDate(e.dateKey)}</span>
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-semibold">{e.name.split(" ")[0]}</span>{" "}
                  <span className="text-muted">·</span> {e.label}
                </span>
                <span className="tnum flex-none font-semibold text-accent">+{e.xp}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">No XP yet — it starts flowing with the first daily log.</p>
        )}
      </Card>

      {/* ── How XP works — generated from the live ruleset, so it can never lie ── */}
      <XpRulesPanel ruleset={ruleset} />
    </div>
  );
}

/** Every number here is read off the ruleset the engine is actually scoring with. */
function XpRulesPanel({ ruleset }: { ruleset: Ruleset }) {
  const { xpRules: r, levels, quests } = ruleset;
  const Xp = ({ n }: { n: number }) => <b className="text-ink">+{n}</b>;

  const streaks = Object.entries(r.STREAK_BONUS)
    .map(([days, bonus]) => [Number(days), bonus] as const)
    .sort((a, b) => a[0] - b[0]);
  const stages = Object.entries(r.STAGE_MOVED)
    .filter(([, xp]) => xp > 0)
    .sort((a, b) => b[1] - a[1]);
  const activeQuests = quests.filter((q) => q.enabled);
  const questXp = activeQuests.map((q) => q.xp);

  return (
    <section className="rounded-card border border-line bg-surface-2 p-5">
      <h2 className="flex items-center gap-2 font-display text-base font-semibold">
        <Info size={16} /> How XP works
      </h2>
      <div className="mt-3 grid grid-cols-1 gap-x-8 gap-y-1.5 text-xs text-muted sm:grid-cols-2">
        <p>Daily log submitted <Xp n={r.LOG_SUBMITTED} /></p>
        {streaks.length > 0 && (
          <p>
            Streak bonuses at {streaks.map(([d]) => d).join("/")} days{" "}
            <b className="text-ink">
              +{streaks[0][1]}
              {streaks.length > 1 && ` → +${streaks[streaks.length - 1][1]}`}
            </b>
          </p>
        )}
        <p>Call outcome logged <Xp n={r.OUTCOME_LOGGED} /> (Highly Qualified <Xp n={r.OUTCOME_LOGGED + r.OUTCOME_HQ_BONUS} />)</p>
        <p>Student milestone advanced <Xp n={r.MILESTONE_ADVANCED} /> (offer <Xp n={r.MILESTONE_ADVANCED + r.MILESTONE_OFFER_BONUS} />)</p>
        <p>Red student turned green <Xp n={r.STUDENT_RESCUED} /></p>
        <p>OKR hit at 100% <Xp n={r.OKR_HIT} /> · closed ≥80% <Xp n={r.OKR_NEAR} /></p>
        {activeQuests.length > 0 && (
          <p>
            Weekly quests{" "}
            <b className="text-ink">
              +{Math.min(...questXp)}
              {Math.min(...questXp) !== Math.max(...questXp) && ` to +${Math.max(...questXp)}`}
            </b>{" "}
            each
          </p>
        )}
        <p className="sm:col-span-2">
          Levels: {[...levels].sort((a, b) => a.minXp - b.minXp).map((l) => l.title).join(" → ")}
        </p>
      </div>

      {stages.length > 0 && (
        <div className="mt-3 border-t border-line pt-3">
          <p className="text-caption font-semibold uppercase tracking-wide text-ink-3">Pipeline moves</p>
          <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
            {stages.map(([stage, xp]) => (
              <span key={stage}>
                {STAGE_LABELS_SHORT[stage] ?? stage} <Xp n={xp} />
              </span>
            ))}
          </div>
        </div>
      )}

      <p className="mt-3 text-caption text-muted">
        Everything is computed from the audited history — daily logs, pipeline stage changes,
        milestone logs, signal changes and OKRs. Corrections and backward moves earn nothing.
        Work is scored by the rules that were in force on the day it happened, so tuning a rule
        never re-prices what someone already earned.
      </p>
    </section>
  );
}

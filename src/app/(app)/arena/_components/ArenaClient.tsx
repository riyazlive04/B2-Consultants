"use client";

import { useState } from "react";
import { Flame, Info, ListOrdered, Medal, ScrollText, Swords } from "lucide-react";
import type { RankedPlayer } from "@/server/gamification";
import type { XpEvent } from "@/lib/gamification";
import { XP_RULES, LEVELS } from "@/lib/gamification";
import {
  BadgeChip, BadgeStrip, LevelRing, Podium, QuestCard, XpBar,
} from "@/components/ui/gamification";
import { formatDate } from "@/lib/format";

type Player = Omit<RankedPlayer, "events">;
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
}: {
  players: Player[];
  feed: Array<XpEvent & { name: string }>;
  meUserId: string;
  isAdmin: boolean;
  weekStart: string;
}) {
  const [period, setPeriod] = useState<Period>("week");
  const me = players.find((p) => p.userId === meUserId) ?? null;
  const [galleryFor, setGalleryFor] = useState<string | null>(me?.userId ?? players[0]?.userId ?? null);

  const ranked = [...players].sort((a, b) => xpFor(b, period) - xpFor(a, period) || b.xpTotal - a.xpTotal);
  const galleryPlayer = players.find((p) => p.userId === galleryFor) ?? null;

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
        <section className="rise-in rounded-card border border-line bg-surface p-5 shadow-card">
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
        </section>
      )}

      {/* ── Leaderboard ── */}
      <section className="rounded-card border border-line bg-surface p-5 shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 font-display text-lg font-semibold">
            <ListOrdered size={18} /> Leaderboard
          </h2>
          <div className="flex rounded-full border border-line bg-surface-2 p-0.5">
            {PERIODS.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => setPeriod(p.key)}
                className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                  period === p.key ? "bg-ink text-white" : "text-muted hover:text-ink"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-6">
          <Podium
            entries={ranked.slice(0, 3).map((p) => ({
              name: p.name.split(" ")[0],
              detail: `Lv ${p.level.level} · ${p.level.title}`,
              value: `${xpFor(p, period).toLocaleString("en-IN")} XP`,
            }))}
          />
        </div>

        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                <th className="py-2 pr-2 font-semibold">#</th>
                <th className="py-2 pr-2 font-semibold">Player</th>
                <th className="py-2 pr-2 font-semibold">Level</th>
                <th className="py-2 pr-2 text-right font-semibold">XP ({PERIODS.find((p) => p.key === period)!.label.toLowerCase()})</th>
                <th className="py-2 pr-2 text-right font-semibold">Streak</th>
                <th className="py-2 text-right font-semibold">Badges</th>
              </tr>
            </thead>
            <tbody>
              {ranked.map((p, i) => (
                <tr
                  key={p.userId}
                  className={`border-b border-line last:border-b-0 ${i === 0 ? "leader-row" : ""} ${
                    p.userId === meUserId ? "font-semibold" : ""
                  }`}
                >
                  <td className="py-2.5 pr-2 tnum">{["🥇", "🥈", "🥉"][i] ?? i + 1}</td>
                  <td className="py-2.5 pr-2">
                    {p.name}
                    {p.userId === meUserId && <span className="ml-1.5 text-xs text-accent">(you)</span>}
                    <span className="block text-xs font-normal text-muted">{p.roleTitle}</span>
                  </td>
                  <td className="py-2.5 pr-2">
                    Lv {p.level.level} <span className="text-xs text-muted">{p.level.title}</span>
                  </td>
                  <td className="py-2.5 pr-2 text-right tnum">{xpFor(p, period).toLocaleString("en-IN")}</td>
                  <td className="py-2.5 pr-2 text-right tnum">{p.streak > 0 ? `🔥 ${p.streak}d` : "—"}</td>
                  <td className="py-2.5 text-right tnum">{p.unlockedCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[11px] text-muted">Week starts Monday ({formatDate(weekStart)}).</p>
      </section>

      {/* ── Weekly quests ── */}
      <section>
        <h2 className="mb-3 flex items-center gap-2 font-display text-lg font-semibold">
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
      <section className="rounded-card border border-line bg-surface p-5 shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 font-display text-lg font-semibold">
            <Medal size={18} /> Badge gallery
          </h2>
          {(isAdmin || players.length > 1) && (
            <div className="flex flex-wrap gap-1.5">
              {players.map((p) => (
                <button
                  key={p.userId}
                  type="button"
                  onClick={() => setGalleryFor(p.userId)}
                  className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                    galleryFor === p.userId ? "bg-ink text-white" : "bg-surface-2 text-muted hover:text-ink"
                  }`}
                >
                  {p.name.split(" ")[0]} · {p.unlockedCount}
                </button>
              ))}
            </div>
          )}
        </div>
        {galleryPlayer && (
          <div className="mt-4 flex flex-wrap gap-x-3 gap-y-4">
            {galleryPlayer.badges.map((b) => <BadgeChip key={b.key} badge={b} />)}
          </div>
        )}
      </section>

      {/* ── XP feed ── */}
      <section className="rounded-card border border-line bg-surface p-5 shadow-card">
        <h2 className="flex items-center gap-2 font-display text-lg font-semibold">
          <ScrollText size={18} /> Recent XP
        </h2>
        {feed.length ? (
          <ul className="mt-3 space-y-1.5 text-sm">
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
          <p className="mt-2 text-sm text-muted">No XP yet — it starts flowing with the first daily log.</p>
        )}
      </section>

      {/* ── How XP works ── */}
      <section className="rounded-card border border-line bg-surface-2 p-5">
        <h2 className="flex items-center gap-2 font-display text-base font-semibold">
          <Info size={16} /> How XP works
        </h2>
        <div className="mt-3 grid grid-cols-1 gap-x-8 gap-y-1.5 text-xs text-muted sm:grid-cols-2">
          <p>Daily log submitted <b className="text-ink">+{XP_RULES.LOG_SUBMITTED}</b></p>
          <p>Streak bonuses at 7/14/30/60/90 days <b className="text-ink">+40 → +700</b></p>
          <p>Discovery/SSS call booked <b className="text-ink">+10/+15</b> · proposal sent <b className="text-ink">+{XP_RULES.STAGE_MOVED.PROPOSAL_SENT}</b></p>
          <p>Deal won <b className="text-ink">+{XP_RULES.STAGE_MOVED.WON}</b> 🎉</p>
          <p>Call outcome logged <b className="text-ink">+{XP_RULES.OUTCOME_LOGGED}</b> (Highly Qualified <b className="text-ink">+{XP_RULES.OUTCOME_LOGGED + XP_RULES.OUTCOME_HQ_BONUS}</b>)</p>
          <p>Student milestone advanced <b className="text-ink">+{XP_RULES.MILESTONE_ADVANCED}</b> (offer <b className="text-ink">+{XP_RULES.MILESTONE_ADVANCED + XP_RULES.MILESTONE_OFFER_BONUS}</b>)</p>
          <p>Red student turned green <b className="text-ink">+{XP_RULES.STUDENT_RESCUED}</b></p>
          <p>OKR hit at 100% <b className="text-ink">+{XP_RULES.OKR_HIT}</b> · closed ≥80% <b className="text-ink">+{XP_RULES.OKR_NEAR}</b></p>
          <p>Weekly quests <b className="text-ink">+60 to +80</b> each</p>
          <p>Levels: {LEVELS.map((l) => l.title).join(" → ")}</p>
        </div>
        <p className="mt-3 text-[11px] text-muted">
          Everything is computed from the audited history — daily logs, pipeline stage changes,
          milestone logs, signal changes and OKRs. Corrections and backward moves earn nothing.
        </p>
      </section>
    </div>
  );
}

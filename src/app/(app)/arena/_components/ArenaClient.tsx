"use client";

import { useState } from "react";
import { Flame, Info, ListOrdered, Medal, ScrollText, Swords } from "lucide-react";
import type { RankedPlayer } from "@/server/gamification";
import type { Ruleset, XpEvent } from "@/lib/gamification";
import { STAGE_LABELS_SHORT } from "@/lib/gamification";
import {
  BadgeChip, BadgeStrip, LevelRing, Podium, QuestCard, XpBar,
} from "@/components/ui/gamification";
import { Card, CardTitle, EmptyState, SectionHeading } from "@/components/ui/kit";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Tabs } from "@/components/ui/Tabs";
import { formatDate } from "@/lib/format";

/**
 * The Arena.
 *
 * ── What was wrong with the old layout ──────────────────────────────────────────
 * Five full-width blocks in one long scroll - my card, leaderboard, quests, badge gallery, XP
 * feed, then a 70-line prose panel explaining the rules - using THREE different control idioms
 * for the same job: a pill group for the leaderboard period, a free-floating chip row for the
 * badge-gallery person picker, and nothing at all for quests. The leaderboard, which is what
 * people open the page for, started below a full-width hero. The longest block on the page was
 * reference material sitting under live data.
 *
 * ── What this is instead ────────────────────────────────────────────────────────
 *   1. Two columns above the fold: my card beside the leaderboard.
 *   2. ONE period control, at the top, driving the leaderboard, the XP feed and the header -
 *      so "this week" means the same thing everywhere on the screen.
 *   3. The badge-gallery person picker is the shared `Tabs` component, not a third idiom.
 *   4. The admin quest board uses `QuestCard compact`, not its own hand-rolled bars.
 *   5. "How XP works" is a closed disclosure - reference, on request.
 *   6. Per-section empty states. With one call log and no bookings on live, most of this page is
 *      empty, and it should say why rather than render blank cards.
 */

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
  weekStart,
  ruleset,
}: {
  players: Player[];
  feed: Array<XpEvent & { name: string }>;
  meUserId: string;
  /** Monday of the current scoring week, resolved server-side - the client clock may be wrong. */
  weekStart: string;
  /** the rules in force today - the panel below is generated from them, never hardcoded */
  ruleset: Ruleset;
}) {
  const [period, setPeriod] = useState<Period>("week");
  const me = players.find((p) => p.userId === meUserId) ?? null;

  const ranked = [...players]
    .sort((a, b) => xpFor(b, period) - xpFor(a, period) || b.xpTotal - a.xpTotal)
    .map((p, i) => ({ ...p, rank: i + 1 }));

  const periodLabel = PERIODS.find((p) => p.key === period)!.label.toLowerCase();

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
      key: "xp", header: `XP (${periodLabel})`, align: "right",
      cell: (p) => xpFor(p, period).toLocaleString("en-IN"),
      value: (p) => xpFor(p, period),
    },
    {
      key: "streak", header: "Streak", align: "right",
      cell: (p) => (p.streak > 0 ? `🔥 ${p.streak}d` : "-"),
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
      <EmptyState
        title="The Arena is empty"
        body="It lights up once team profiles exist and daily work is logged - XP is derived from work already recorded elsewhere, so there is nothing to enter here."
      />
    );
  }

  /** THE page's period control. One control, one meaning, top of the screen. */
  const periodToggle = (
    <div className="flex rounded-full border border-line bg-surface-2 p-0.5">
      {PERIODS.map((p) => (
        <button
          key={p.key}
          type="button"
          aria-pressed={period === p.key}
          onClick={() => setPeriod(p.key)}
          className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
            period === p.key ? "bg-ink text-surface" : "text-muted hover:text-ink"
          }`}
        >
          {p.label}
        </button>
      ))}
    </div>
  );

  return (
    <div className="space-y-8">
      {/* ── Above the fold: me, and the board ─────────────────────────────────────────
          Two columns. The leaderboard is what the page is FOR, and it used to start below a
          full-width hero - on a laptop you had to scroll to see whether you were winning. */}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
        {me ? (
          <Card className="rise-in">
            <div className="flex flex-wrap items-center gap-4">
              <LevelRing level={me.level} size={76} />
              <div className="min-w-40 flex-1">
                <p className="font-display text-h3 text-ink">{me.name.split(" ")[0]}</p>
                <p className="text-caption text-muted">{me.roleTitle}</p>
              </div>
            </div>
            <div className="mt-4">
              <XpBar xp={me.xpTotal} level={me.level} />
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
              <span className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2.5 py-1 font-semibold">
                <Flame size={13} className="text-watch" /> {me.streak}-day streak
              </span>
              <span className="rounded-full bg-surface-2 px-2.5 py-1 font-semibold">#{me.rankWeek} this week</span>
              <span className="rounded-full bg-surface-2 px-2.5 py-1 font-semibold">
                {me.unlockedCount}/{me.badges.length} badges
              </span>
              <span className="tnum rounded-full bg-accent-soft px-2.5 py-1 font-semibold text-accent">
                +{xpFor(me, period).toLocaleString("en-IN")} XP {periodLabel}
              </span>
            </div>
            <div className="mt-4 border-t border-line pt-4">
              <BadgeStrip badges={me.badges} max={6} />
            </div>
          </Card>
        ) : (
          <Card>
            <p className="text-sm text-muted">
              You have no player card - the Arena scores work logged against a team profile, and
              your login is not linked to one. Everyone else&apos;s standing is on the right.
            </p>
          </Card>
        )}

        <Card
          title={<CardTitle icon={<ListOrdered size={18} />}>Leaderboard</CardTitle>}
          actions={periodToggle}
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
      </div>

      {/* ── Weekly quests ── */}
      <section className="space-y-4">
        <SectionHeading
          icon={<Swords size={18} />}
          title="Weekly quests"
          description={
            me
              ? `${me.quests.filter((q) => q.done).length} of ${me.quests.length} done this week`
              : "Every player's board at a glance"
          }
        />
        {me ? (
          me.quests.length === 0 ? (
            <EmptyState
              title="No quests are configured"
              body="Add weekly quests at Console → Gamification. They are the short-term goals the Arena scores on top of the daily XP."
            />
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {me.quests.map((q) => <QuestCard key={q.key} quest={q} />)}
            </div>
          )
        ) : (
          // Admin view: every player's quest board. `compact`, not a second hand-rolled bar.
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {players.map((p) => (
              <Card key={p.userId}>
                <p className="text-sm font-semibold">
                  {p.name}
                  <span className="ml-2 text-xs font-normal text-muted">
                    {p.quests.filter((q) => q.done).length}/{p.quests.length} quests done
                  </span>
                </p>
                <div className="mt-3 space-y-2">
                  {p.quests.map((q) => <QuestCard key={q.key} quest={q} compact />)}
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>

      {/* ── Badges + XP feed, side by side ───────────────────────────────────────────
          The gallery's person picker is `Tabs` - the app's own idiom - rather than the third
          bespoke chip row this page used to carry. */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card title={<CardTitle icon={<Medal size={18} />}>Badge gallery</CardTitle>}>
          {players.length === 1 ? (
            <div className="flex flex-wrap gap-x-3 gap-y-4">
              {players[0].badges.map((b) => <BadgeChip key={b.key} badge={b} />)}
            </div>
          ) : (
            <Tabs
              variant="underline"
              tabs={[
                // Your own first - the common case is checking your own shelf.
                ...(me ? [me] : []),
                ...players.filter((p) => p.userId !== meUserId),
              ].map((p) => ({
                label: `${p.name.split(" ")[0]} · ${p.unlockedCount}`,
                content: (
                  <div className="flex flex-wrap gap-x-3 gap-y-4">
                    {p.badges.map((b) => <BadgeChip key={b.key} badge={b} />)}
                  </div>
                ),
              }))}
            />
          )}
        </Card>

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
            <p className="text-sm text-muted">
              No XP yet. It starts flowing with the first daily log, call outcome or pipeline move
              - everything here is derived from work recorded elsewhere.
            </p>
          )}
        </Card>
      </div>

      {/* Reference material, on request - not 70 lines of prose under the live data. */}
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
    <details className="group rounded-card border border-line bg-surface-2">
      <summary className="flex cursor-pointer list-none items-center gap-2 p-4 font-display text-base font-semibold">
        <Info size={16} /> How XP works
        <span className="ml-auto text-caption font-normal text-muted group-open:hidden">Show</span>
        <span className="ml-auto hidden text-caption font-normal text-muted group-open:inline">Hide</span>
      </summary>

      <div className="border-t border-line px-5 pb-5 pt-4">
        <div className="grid grid-cols-1 gap-x-8 gap-y-1.5 text-xs text-muted sm:grid-cols-2">
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
          Everything is computed from the audited history - daily logs, pipeline stage changes,
          milestone logs, signal changes and OKRs. Corrections and backward moves earn nothing.
          Work is scored by the rules that were in force on the day it happened, so tuning a rule
          never re-prices what someone already earned.
        </p>
      </div>
    </details>
  );
}

"use client";

import { useState } from "react";
import { Trophy } from "lucide-react";
import type { GnLeaderboard, GnLeaderRow, GnLeaderWindow } from "@/server/german-note-metrics";

/** Skool-style community leaderboard: 7-day / 30-day / all-time, ranked by likes received. */
export function Leaderboard({ data }: { data: GnLeaderboard }) {
  const [tab, setTab] = useState<"sevenDay" | "thirtyDay" | "allTime">("sevenDay");
  const windows: Record<typeof tab, { label: string; w: GnLeaderWindow }> = {
    sevenDay: { label: "7-day", w: data.sevenDay },
    thirtyDay: { label: "30-day", w: data.thirtyDay },
    allTime: { label: "All-time", w: data.allTime },
  };
  const active = windows[tab].w;
  const meInTop = active.me && active.rows.some((r) => r.isMe);

  return (
    <div className="rounded-card border border-line bg-surface p-4 shadow-card">
      <h3 className="flex items-center gap-2 font-display text-[15px] font-semibold">
        <Trophy size={15} className="text-[var(--lvl-gn)]" /> Leaderboard
      </h3>
      <div className="mt-3 flex gap-1 rounded-field bg-surface-2 p-1">
        {(Object.keys(windows) as (typeof tab)[]).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k)}
            className={`flex-1 rounded-[7px] px-2 py-1 text-xs font-medium transition-colors ${
              tab === k ? "bg-accent text-on-accent shadow-sm" : "text-muted hover:text-ink"
            }`}
          >
            {windows[k].label}
          </button>
        ))}
      </div>

      <ol className="mt-3 space-y-1">
        {active.rows.length === 0 && (
          <li className="px-1 py-3 text-center text-xs text-muted">No points earned yet — likes score points.</li>
        )}
        {active.rows.map((r) => (
          <Row key={r.userId} r={r} />
        ))}
      </ol>

      {active.me && !meInTop && (
        <>
          <div className="my-2 border-t border-dashed border-line" />
          <Row r={active.me} />
        </>
      )}
      <p className="mt-3 text-caption text-muted">Points = likes your posts and comments receive.</p>
    </div>
  );
}

function medal(rank: number): string | null {
  return rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : null;
}

function Row({ r }: { r: GnLeaderRow }) {
  const initials = (r.name ?? "?").split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  return (
    <li
      className={`flex items-center gap-2.5 rounded-field px-2 py-1.5 ${
        r.isMe ? "bg-[#3fc0b714] ring-1 ring-[var(--lvl-gn)]" : ""
      }`}
    >
      <span className="w-6 flex-none text-center text-sm font-bold tabular-nums text-muted">
        {medal(r.rank) ?? r.rank}
      </span>
      <span className="relative flex-none">
        {r.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={r.image} alt="" className="h-7 w-7 rounded-full object-cover" />
        ) : (
          <span className="grid h-7 w-7 place-items-center rounded-full bg-lvl-gn/10 text-caption font-bold text-ink">
            {initials}
          </span>
        )}
        <span className="absolute -bottom-1 -right-1 grid h-[15px] w-[15px] place-items-center rounded-full bg-primary text-caption font-bold leading-none text-on-accent ring-2 ring-[var(--surface)]">
          {r.level}
        </span>
      </span>
      <span className="min-w-0 flex-1 truncate text-sm font-medium">
        {r.name ?? "Former member"}
        {r.isMe && <span className="ml-1 text-xs text-muted">(you)</span>}
      </span>
      <span className="flex-none text-xs font-semibold tabular-nums text-ink-2">{r.points}</span>
    </li>
  );
}

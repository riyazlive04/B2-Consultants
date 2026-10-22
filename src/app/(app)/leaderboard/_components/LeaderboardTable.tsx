"use client";

import { Fragment, useState } from "react";
import { ChevronDown, Medal } from "lucide-react";
import type { LeaderboardView } from "@/server/leaderboard";
import { ordinal } from "@/lib/leaderboard";
import { Card, Pill, TableShell, Td, Th, Tr } from "@/components/ui/kit";

/**
 * The board.
 *
 * ── The reader's own row is the point of the screen ────────────────────────────────────
 * It is highlighted, and it is always present even when `topN` cut the list short - a student
 * outside the top ten still needs to know where they stand, and a board that silently omits
 * you is worse than one that ranks you last.
 *
 * ── Only your own breakdown expands ────────────────────────────────────────────────────
 * Tapping your row shows how the total was built, metric by metric. A classmate's row does
 * not expand, because the server did not send their lines: the total is the board, but the
 * working behind it is theirs, and on a named board publishing it would amount to publishing
 * their application count.
 */

const MEDAL_TONE: Record<number, "good" | "warn" | "neutral"> = { 1: "good", 2: "warn", 3: "neutral" };

export function LeaderboardTable({
  view,
  isStudent,
}: {
  view: LeaderboardView;
  isStudent: boolean;
}) {
  const [open, setOpen] = useState<string | null>(null);

  return (
    <Card
      flush
      title="Standings"
      subtitle={
        view.config.topN > 0
          ? `Top ${view.config.topN}${view.me ? ", plus your own place" : ""}`
          : undefined
      }
    >
      <TableShell
        minWidth={520}
        head={
          <>
            <Th>#</Th>
            <Th>Student</Th>
            <Th align="right">Points</Th>
            <Th />
          </>
        }
      >
          {view.rows.map((r, i) => {
            const expandable = r.breakdown.lines.length > 0;
            const isOpen = open === `${r.rank}-${i}`;
            return (
              <Fragment key={`${r.rank}-${i}-${r.name}`}>
                <Tr className={r.isMe ? "bg-primary-tint/40" : undefined}>
                  <Td>
                    <span className="flex items-center gap-1.5 tabular-nums">
                      {r.rank <= 3 && r.total > 0 ? (
                        <Pill tone={MEDAL_TONE[r.rank]}>
                          <Medal size={12} aria-hidden /> {ordinal(r.rank)}
                        </Pill>
                      ) : (
                        <span className="font-semibold text-ink-2">{ordinal(r.rank)}</span>
                      )}
                    </span>
                  </Td>
                  <Td>
                    <span className="font-medium text-ink">{r.name}</span>
                    {r.isMe && <span className="ml-1.5 text-caption font-semibold text-primary">you</span>}
                    {r.code && <span className="ml-1.5 text-caption tabular-nums text-muted">{r.code}</span>}
                  </Td>
                  <Td align="right">
                    <span className="font-display text-[15px] font-semibold tabular-nums text-ink">
                      {r.total.toLocaleString("en-IN")}
                    </span>
                  </Td>
                  <Td align="right">
                    {expandable && (
                      <button
                        type="button"
                        aria-expanded={isOpen}
                        onClick={() => setOpen(isOpen ? null : `${r.rank}-${i}`)}
                        className="press inline-flex h-8 items-center gap-1 rounded-field px-2 text-caption font-semibold text-primary hover:bg-surface-2"
                      >
                        {isOpen ? "Hide" : "How"}
                        <ChevronDown
                          size={13}
                          className={isOpen ? "rotate-180 transition-transform" : "transition-transform"}
                          aria-hidden
                        />
                      </button>
                    )}
                  </Td>
                </Tr>
                {isOpen && (
                  <Tr>
                    <Td />
                    <Td>
                      <ul className="space-y-1 py-1">
                        {r.breakdown.lines
                          .filter((l) => l.count > 0)
                          .map((l) => (
                            <li key={l.key} className="flex flex-wrap items-baseline gap-x-2 text-sm">
                              <span className="text-ink-2">{l.label}</span>
                              <span className="tabular-nums text-ink">
                                {/*
                                  When a cap bit, BOTH numbers are shown. Quietly scoring 25 of
                                  300 would read as a bug to the student who logged them, and
                                  the honest version is also the one that explains the cap.
                                */}
                                {l.counted < l.count ? `${l.counted} of ${l.count}` : l.count}
                              </span>
                              <span className="ml-auto font-semibold tabular-nums text-ink">
                                +{l.points.toLocaleString("en-IN")}
                              </span>
                            </li>
                          ))}
                        {r.breakdown.lines.every((l) => l.count === 0) && (
                          <li className="text-sm text-muted">
                            Nothing counted yet in this period.
                          </li>
                        )}
                      </ul>
                      {r.breakdown.capped && (
                        <p className="pb-2 text-caption text-muted">
                          Some of these hit a weekly limit set by your coach. The rest counts next
                          week - nothing is lost.
                        </p>
                      )}
                    </Td>
                    <Td />
                    <Td />
                  </Tr>
                )}
              </Fragment>
            );
          })}
      </TableShell>

      {isStudent && view.config.visibility === "ANONYMISED" && (
        <p className="border-t border-line px-6 py-3 text-caption text-muted">
          Your classmates are shown as letters. Your coach sees the full board.
        </p>
      )}
    </Card>
  );
}

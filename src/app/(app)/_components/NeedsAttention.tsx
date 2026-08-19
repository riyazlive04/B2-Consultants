"use client";

import { useState } from "react";
import Link from "next/link";
import { BellRing, CheckCircle2, Pin, Sparkles } from "lucide-react";
import { SelectMenu } from "@/components/ui/SelectMenu";
import { useCcy } from "@/components/ui/CurrencyToggle";
import { money } from "@/lib/money-display";
import { renderNotificationText } from "@/lib/notification-text";
import type { Notification } from "@/server/notifications";

/**
 * The dashboard's actionable-first band. Everything that needs a human decision -
 * overdue money, red students, stalled deals - is lifted out of the bell and the
 * hero and put at the very top of the page, because that is the first question the
 * person is here to answer: "is there anything I have to act on right now?"
 *
 * Concise by design: the top `max` items as scannable rows, the rest rolled into a
 * "+N more in the bell" pointer rather than an endless list. `showWins` appends a
 * quiet "good news" footer (used for Head/User, who have no dedicated wins section).
 *
 * Client-side only for the sort control (Error Log C8) - the rows themselves are still
 * plain server data handed down from the home page.
 */

const SEVERITY: Record<Notification["severity"], { dot: string; label: string; soft: string }> = {
  // §7 / WCAG 1.4.1: severity is spoken in words, never carried by the dot colour alone.
  risk: { dot: "var(--bad)", label: "Act now", soft: "var(--bad-bg)" },
  watch: { dot: "var(--warn)", label: "Watch", soft: "var(--warn-bg)" },
  info: { dot: "var(--primary)", label: "FYI", soft: "var(--primary-soft)" },
  win: { dot: "var(--good)", label: "Win", soft: "var(--good-bg)" },
};

/**
 * Error Log C8: the order used to be whatever the server computed, take it or leave it.
 * Two axes are all the underlying data honestly supports - a notification here is a derived,
 * stateless condition with no raised-at timestamp, so "newest first" is a sort nobody could
 * keep. "Priority" is the shipped order and stays the default; "by area" regroups the same
 * rows by the page they send you to, for clearing one screen in one trip.
 */
type SortMode = "priority" | "area";

const SORT_OPTIONS: { value: SortMode; label: string }[] = [
  { value: "priority", label: "Priority" },
  { value: "area", label: "By area" },
];

/** The destination a row lands on - "/students/42" and "/students" are the same trip. */
function areaOf(href: string): string {
  return href.split("?")[0].split("/")[1] ?? "";
}

export function NeedsAttention({
  notifications,
  max = 4,
  showWins = false,
}: {
  notifications: Notification[];
  max?: number;
  showWins?: boolean;
}) {
  const [sort, setSort] = useState<SortMode>("priority");
  // Notifications ship their amounts as `{m0}` tokens rather than formatted rupees, so a row
  // saying "4 overdue payments - ₹3,25,500" can't sit under a toggle set to euros.
  const { ccy } = useCcy();
  const text = (s: string, n: Notification) =>
    renderNotificationText(s, n.amounts, (m) => money(m, ccy, { compact: true }));

  const actionable = notifications.filter((n) => n.severity !== "win");
  // §2.8: a person deliberately raised these, so they outrank every automated alert no matter
  // what the reader sorts by - pinned above the list and never traded against `max`. A coach
  // asking for the founder's attention must not end up inside "+N more in the bell", which is
  // exactly how these went unseen (C8); an extra row is the cheaper price.
  const escalations = actionable.filter((n) => n.escalated);
  const rest = actionable.filter((n) => !n.escalated);
  // Stable sort, so priority order survives inside each area rather than being reshuffled.
  // "priority" is a no-op: computeNotifications already returns the list risk-first.
  const sorted = sort === "area" ? [...rest].sort((a, b) => areaOf(a.href).localeCompare(areaOf(b.href))) : rest;
  const shown = [...escalations, ...sorted.slice(0, Math.max(0, max - escalations.length))];
  const more = actionable.length - shown.length;
  const wins = showWins ? notifications.filter((n) => n.severity === "win").slice(0, 2) : [];

  const hasRisk = actionable.some((n) => n.severity === "risk");
  const allClear = actionable.length === 0;

  return (
    <section
      className="rise-in overflow-hidden rounded-card border bg-surface shadow-card"
      style={{ borderColor: hasRisk ? "var(--bad)" : "var(--border)" }}
      aria-label="Needs attention"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3.5">
        <p className="flex items-center gap-2 text-body-strong text-ink">
          <BellRing size={16} className="text-primary" />
          Needs attention
          {!allClear && (
            <span className="tnum rounded-full bg-surface-2 px-2 py-0.5 text-caption font-semibold text-ink-2">
              {actionable.length}
            </span>
          )}
        </p>
        {allClear ? (
          <span className="inline-flex items-center gap-1.5 text-caption font-semibold text-good">
            <CheckCircle2 size={15} /> All clear
          </span>
        ) : (
          // Nothing to re-order below two sortable rows, so the control stays out of the way.
          rest.length > 1 && (
            <span className="inline-flex items-center gap-2">
              <span aria-hidden className="text-caption text-ink-3">
                Sort
              </span>
              <span className="w-32">
                <SelectMenu
                  size="sm"
                  aria-label="Sort needs attention"
                  value={sort}
                  onChange={(e) => setSort(e.target.value as SortMode)}
                  options={SORT_OPTIONS}
                />
              </span>
            </span>
          )
        )}
      </div>

      {allClear ? (
        <p className="px-5 py-4 text-sm text-muted">
          Nothing needs you right now - you&apos;re on top of it.
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {shown.map((n) => {
            const s = SEVERITY[n.severity];
            // §2.8: a coach's escalation is labelled as such, and the pin says out loud that it
            // is sitting at the top on purpose rather than by today's sort.
            const label = n.escalated ? "Escalated" : s.label;
            return (
              <li key={n.id}>
                <Link
                  href={n.href}
                  className="group flex items-center gap-3 px-5 py-3 transition-colors hover:bg-surface-2"
                >
                  <span
                    className="inline-flex flex-none items-center gap-1.5 rounded-full px-2 py-0.5 text-caption font-semibold"
                    style={{ background: s.soft, color: s.dot }}
                  >
                    {n.escalated ? (
                      <Pin size={11} aria-hidden className="flex-none" />
                    ) : (
                      <span aria-hidden className="h-1.5 w-1.5 flex-none rounded-full" style={{ background: s.dot }} />
                    )}
                    {label}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-ink">{text(n.title, n)}</span>
                    <span className="block truncate text-caption text-muted">{text(n.body, n)}</span>
                  </span>
                  <span
                    aria-hidden
                    className="flex-none text-ink-3 transition-transform group-hover:translate-x-0.5"
                  >
                    →
                  </span>
                </Link>
              </li>
            );
          })}
          {more > 0 && (
            <li className="px-5 py-2.5 text-caption text-ink-3">
              +{more} more in the bell{" "}
              <span aria-hidden className="align-middle">
                ↑
              </span>
            </li>
          )}
        </ul>
      )}

      {wins.length > 0 && (
        <ul className="divide-y divide-line border-t border-line bg-surface-2">
          {wins.map((w) => (
            <li key={w.id}>
              <Link
                href={w.href}
                className="flex items-center gap-3 px-5 py-2.5 transition-colors hover:bg-surface-2"
              >
                <Sparkles size={15} className="flex-none text-good" />
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink-2">{text(w.title, w)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

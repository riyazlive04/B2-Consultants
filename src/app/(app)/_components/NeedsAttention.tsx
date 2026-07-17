import Link from "next/link";
import { BellRing, CheckCircle2, Sparkles } from "lucide-react";
import type { Notification } from "@/server/notifications";

/**
 * The dashboard's actionable-first band. Everything that needs a human decision —
 * overdue money, red students, stalled deals — is lifted out of the bell and the
 * hero and put at the very top of the page, because that is the first question the
 * person is here to answer: "is there anything I have to act on right now?"
 *
 * Concise by design: the top `max` items as scannable rows, the rest rolled into a
 * "+N more in the bell" pointer rather than an endless list. `showWins` appends a
 * quiet "good news" footer (used for Head/User, who have no dedicated wins section).
 */

const SEVERITY: Record<Notification["severity"], { dot: string; label: string; soft: string }> = {
  // §7 / WCAG 1.4.1: severity is spoken in words, never carried by the dot colour alone.
  risk: { dot: "var(--bad)", label: "Act now", soft: "var(--bad-bg)" },
  watch: { dot: "var(--warn)", label: "Watch", soft: "var(--warn-bg)" },
  info: { dot: "var(--primary)", label: "FYI", soft: "var(--primary-soft)" },
  win: { dot: "var(--good)", label: "Win", soft: "var(--good-bg)" },
};

export function NeedsAttention({
  notifications,
  max = 4,
  showWins = false,
}: {
  notifications: Notification[];
  max?: number;
  showWins?: boolean;
}) {
  // computeNotifications already sorts risk-first, so a plain slice keeps priority order.
  const actionable = notifications.filter((n) => n.severity !== "win");
  const shown = actionable.slice(0, max);
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
        {allClear && (
          <span className="inline-flex items-center gap-1.5 text-caption font-semibold text-good">
            <CheckCircle2 size={15} /> All clear
          </span>
        )}
      </div>

      {allClear ? (
        <p className="px-5 py-4 text-sm text-muted">
          Nothing needs you right now — you&apos;re on top of it.
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {shown.map((n) => {
            const s = SEVERITY[n.severity];
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
                    <span aria-hidden className="h-1.5 w-1.5 flex-none rounded-full" style={{ background: s.dot }} />
                    {s.label}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-ink">{n.title}</span>
                    <span className="block truncate text-caption text-muted">{n.body}</span>
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
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink-2">{w.title}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

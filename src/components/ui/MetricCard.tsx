"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowUpRight, Maximize2 } from "lucide-react";
import { SIGNAL_META, type SignalLevel } from "@/lib/signals";
import { Sparkline } from "./Sparkline";
import { Modal } from "./Modal";
import { useCanNavigate } from "@/components/shell/SectionAccess";

/**
 * §5.3's delta chip. `positiveIsGood` exists because a rise is not always a win:
 * revenue up is green, expenses up is red. Colour must follow the *decision*, not
 * the arithmetic sign (§1.2).
 */
export type Delta = {
  pct: number;
  caption?: string; // e.g. "vs last month"
  positiveIsGood?: boolean;
};

function DeltaChip({ pct, caption, positiveIsGood = true }: Delta) {
  const up = pct >= 0;
  const good = up === positiveIsGood;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span
        className={`inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-caption font-semibold ${
          good ? "bg-ok-soft text-ok" : "bg-risk-soft text-risk"
        }`}
      >
        {/* the arrow is decorative; the direction is spoken instead (§7: never colour alone) */}
        <span aria-hidden>{up ? "▲" : "▼"}</span>
        <span className="sr-only">{up ? "up" : "down"} </span>
        <span className="tnum">{Math.abs(pct).toFixed(1)}%</span>
      </span>
      {caption && <span className="text-caption text-ink-3">{caption}</span>}
    </div>
  );
}

/**
 * Optional richer breakdown a card can hand its expand popup. Without it, the popup still
 * opens and shows the card's own detail (big value, explanation, comparison, trend).
 */
export type MetricDetail = {
  title?: string;
  rows?: Array<{ label: string; value: ReactNode }>;
  body?: ReactNode;
  note?: string;
};

/**
 * Signal-aware metric card (calories/weight style): a header with an optional
 * tinted icon chip, a label and an optional right-aligned `target`, a big tabular
 * number, an optional `progress` bar and/or mini sparkline, plus an optional
 * footer breakdown.
 *
 * INTERACTION (in priority order):
 *   - `href`    → the whole card is a link (navigates).
 *   - `onClick` → the whole card is a button calling that handler (the caller owns what
 *                 happens — e.g. FinanceKpis opens its own currency-aware popup).
 *   - otherwise → the whole card is a button that opens a built-in DETAIL POPUP: the value,
 *                 its plain-English explanation (`tooltip`), the comparison (`target`), the
 *                 trend (`delta`/`spark`), and any richer `detail` the caller passes. This is
 *                 what makes every card in the app click-to-expand.
 */
export function MetricCard({
  label,
  value,
  secondary,
  signal,
  spark,
  tooltip,
  footer,
  icon,
  href,
  onClick,
  detail,
  target,
  progress,
  delta,
}: {
  label: string;
  value: ReactNode;
  secondary?: ReactNode; // e.g. the EUR aggregate under the INR number
  signal?: SignalLevel;
  spark?: number[];
  tooltip?: string; // plain-English explainer (Gross/Net profit info icon)
  footer?: ReactNode;
  icon?: ReactNode; // optional line icon shown in a soft tinted chip
  href?: string; // when set, the whole card links here
  onClick?: () => void; // when set (and no href), the caller owns the click (its own popup)
  detail?: MetricDetail; // richer breakdown for the built-in expand popup
  target?: ReactNode; // right-aligned goal / secondary figure in the header
  progress?: number; // 0-1 → renders a progress bar coloured by the signal/accent
  delta?: Delta; // §5.3 change-vs-previous chip
}) {
  const [open, setOpen] = useState(false);
  // O2: a card pointing into a section this viewer cannot open keeps its NUMBER (the figure is
  // still true and still worth seeing) but loses the link, falling back to the built-in detail
  // popup instead of bouncing to /?denied=.
  const linkable = useCanNavigate(href) ? href : undefined;
  const tint = signal ? SIGNAL_META[signal] : undefined;
  const barColor = tint ? tint.color : "var(--primary)";
  const className =
    "group rise-in card-hover relative flex h-full min-w-0 flex-col gap-2 overflow-hidden rounded-card border border-line bg-surface p-6 shadow-card";

  // Built-in expand applies only when the card isn't a link and the caller hasn't taken the click.
  const selfExpand = !linkable && !onClick;

  const inner = (
    <>
      {tint && (
        <span aria-hidden className="absolute inset-x-0 top-0 h-1" style={{ background: tint.color }} />
      )}
      {/* header: icon chip + label (left) · target / arrow / expand hint (right) */}
      <div className="relative flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {icon && (
            <span
              aria-hidden
              className="grid h-9 w-9 flex-none place-items-center rounded-btn"
              style={{ background: tint ? tint.soft : "var(--primary-soft)", color: barColor }}
            >
              {icon}
            </span>
          )}
          {/* The label WRAPS to a second line rather than truncating.
              A 4-up KPI row on an iPad in landscape gives each card ~200px, which turned
              "Total active students" into "TOTAL ACTI…" and "Top paying student" into
              "TOP PAYING…" — a KPI whose name you cannot read is not a KPI. Two lines is the cap
              (`line-clamp-2`), so a pathological label still can't push the figure out of sight,
              and grid rows equalise height anyway so the row just gets a few pixels taller. */}
          <span className="flex min-w-0 items-start gap-1.5 text-label uppercase text-ink-3">
            <span className="line-clamp-2 min-w-0">{label}</span>
            {tooltip && (
              // keyboard- and touch-reachable (§5.9): the definition shows on
              // hover AND focus, not only via the mouse-only title attribute
              <span className="group/tip relative inline-flex" tabIndex={0} aria-label={tooltip}>
                <span
                  aria-hidden
                  className="inline-flex h-4 w-4 flex-none cursor-help items-center justify-center rounded-full border border-line bg-surface-2 text-caption leading-none text-muted"
                >
                  i
                </span>
                <span
                  role="tooltip"
                  // `text-surface`, not `text-white`: --ink is near-white in the dark
                  // theme, so a hardcoded white label rendered white-on-white there.
                  // Pinned to the bottom gutters on phones, centred bubble from `sm` — see InfoHint
                  // for why (a 224px bubble does not fit either side of a chip on a 390px screen).
                  className="pointer-events-none fixed inset-x-4 bottom-4 z-30 w-auto translate-x-0 whitespace-normal rounded-field bg-ink px-3 py-2 text-left text-caption font-normal normal-case leading-snug tracking-normal text-surface opacity-0 shadow-pop transition-opacity group-hover/tip:opacity-100 group-focus-visible/tip:opacity-100 sm:absolute sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-full sm:z-20 sm:mt-1.5 sm:w-56 sm:-translate-x-1/2 sm:px-2.5 sm:py-1.5 sm:shadow-soft"
                >
                  {tooltip}
                </span>
              </span>
            )}
          </span>
        </div>
        {linkable ? (
          <ArrowUpRight
            size={18}
            className="flex-none text-muted transition-all group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-accent"
          />
        ) : target != null ? (
          <span className="flex-none text-xs font-medium text-muted tnum">{target}</span>
        ) : selfExpand ? (
          // subtle affordance so the card reads as "there's more behind this"
          <Maximize2
            size={15}
            aria-hidden
            className="flex-none text-ink-3 opacity-0 transition-opacity group-hover:opacity-100"
          />
        ) : null}
      </div>

      {/* §2.1 `metric` (28/34, Jakarta 700, tabular) — the token existed but was never used */}
      <div className="font-display tnum truncate text-metric tracking-tight">{value}</div>
      {secondary && <div className="tnum truncate text-sm text-muted">{secondary}</div>}
      {delta && <DeltaChip {...delta} />}

      {typeof progress === "number" && (
        <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-surface-2">
          <div
            className="h-full rounded-full transition-all"
            style={{ width: `${Math.max(0, Math.min(1, progress)) * 100}%`, background: barColor }}
          />
        </div>
      )}

      {spark && spark.length > 1 && (
        <div className="mt-auto pt-1" style={{ color: barColor }}>
          <Sparkline data={spark} />
        </div>
      )}
      {footer}
    </>
  );

  if (linkable) {
    return (
      <Link href={linkable} className={className}>
        {inner}
      </Link>
    );
  }

  const cardButton = (
    <button
      type="button"
      onClick={onClick ?? (() => setOpen(true))}
      className={`${className} w-full cursor-pointer text-left`}
    >
      {inner}
    </button>
  );

  // Caller-managed click (e.g. FinanceKpis' currency-aware popup) — no built-in modal.
  if (onClick) return cardButton;

  // Built-in expand popup: every other card is click-to-expand.
  return (
    <>
      {cardButton}
      <Modal open={open} onClose={() => setOpen(false)} title={detail?.title ?? label} subtitle={detail?.title ? label : undefined} size="md">
        <div className="space-y-4">
          <div className="rounded-card border border-line bg-surface-2 p-4">
            <div className="font-display text-3xl font-bold tabular-nums text-ink">{value}</div>
            {secondary && <div className="mt-0.5 text-sm text-muted tabular-nums">{secondary}</div>}
            {target != null && <div className="mt-1 text-xs text-muted tnum">{target}</div>}
          </div>

          {tooltip && <p className="text-sm text-ink-2">{tooltip}</p>}
          {delta && <DeltaChip {...delta} />}

          {detail?.rows && detail.rows.length > 0 && (
            <ul className="divide-y divide-line">
              {detail.rows.map((r, i) => (
                <li key={i} className="flex items-baseline justify-between gap-3 py-2.5">
                  <span className="text-sm text-ink-2">{r.label}</span>
                  <span className="text-right text-sm font-semibold tabular-nums text-ink">{r.value}</span>
                </li>
              ))}
            </ul>
          )}

          {detail?.body}

          {spark && spark.length > 1 && (
            <div style={{ color: barColor }}>
              <Sparkline data={spark} />
            </div>
          )}

          {footer && <div className="border-t border-line pt-3">{footer}</div>}
          {detail?.note && <p className="text-caption text-muted">{detail.note}</p>}
        </div>
      </Modal>
    </>
  );
}

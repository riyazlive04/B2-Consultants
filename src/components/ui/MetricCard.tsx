import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { SIGNAL_META, type SignalLevel } from "@/lib/signals";
import { Sparkline } from "./Sparkline";

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
 * Signal-aware metric card (calories/weight style): a header with an optional
 * tinted icon chip, a label and an optional right-aligned `target`, a big tabular
 * number, an optional `progress` bar and/or mini sparkline, plus an optional
 * footer breakdown. Pass `href` to make the whole card a clickable link.
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
  target?: ReactNode; // right-aligned goal / secondary figure in the header
  progress?: number; // 0-1 → renders a progress bar coloured by the signal/accent
  delta?: Delta; // §5.3 change-vs-previous chip
}) {
  const tint = signal ? SIGNAL_META[signal] : undefined;
  const barColor = tint ? tint.color : "var(--primary)";
  const className =
    "group rise-in card-hover relative flex h-full min-w-0 flex-col gap-2 overflow-hidden rounded-card border border-line bg-surface p-6 shadow-card";

  const inner = (
    <>
      {tint && (
        <span aria-hidden className="absolute inset-x-0 top-0 h-1" style={{ background: tint.color }} />
      )}
      {/* header: icon chip + label (left) · target or arrow (right) */}
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
          <span className="flex items-center gap-1.5 truncate text-label uppercase text-ink-3">
            <span className="truncate">{label}</span>
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
                  className="pointer-events-none absolute left-1/2 top-full z-20 mt-1.5 w-56 -translate-x-1/2 whitespace-normal rounded-field bg-ink px-2.5 py-1.5 text-left text-caption font-normal normal-case leading-snug tracking-normal text-surface opacity-0 shadow-soft transition-opacity group-hover/tip:opacity-100 group-focus-visible/tip:opacity-100"
                >
                  {tooltip}
                </span>
              </span>
            )}
          </span>
        </div>
        {href ? (
          <ArrowUpRight
            size={18}
            className="flex-none text-muted transition-all group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-accent"
          />
        ) : (
          target != null && <span className="flex-none text-xs font-medium text-muted tnum">{target}</span>
        )}
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

  return href ? (
    <Link href={href} className={className}>
      {inner}
    </Link>
  ) : (
    <div className={className}>{inner}</div>
  );
}

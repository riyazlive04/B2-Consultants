import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { SIGNAL_META, type SignalLevel } from "@/lib/signals";
import { Sparkline } from "./Sparkline";

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
}) {
  const tint = signal ? SIGNAL_META[signal] : undefined;
  const barColor = tint ? tint.color : "var(--primary)";
  const className =
    "group rise-in card-hover relative flex h-full min-w-0 flex-col gap-2 overflow-hidden rounded-card border border-line bg-surface p-5 shadow-card";

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
          <span className="flex items-center gap-1.5 truncate text-xs font-medium uppercase tracking-[0.04em] text-ink-3">
            <span className="truncate">{label}</span>
            {tooltip && (
              // keyboard- and touch-reachable (§5.9): the definition shows on
              // hover AND focus, not only via the mouse-only title attribute
              <span className="group/tip relative inline-flex" tabIndex={0} aria-label={tooltip}>
                <span
                  aria-hidden
                  className="inline-flex h-4 w-4 flex-none cursor-help items-center justify-center rounded-full border border-line bg-surface-2 text-[11px] leading-none text-muted"
                >
                  i
                </span>
                <span
                  role="tooltip"
                  className="pointer-events-none absolute left-1/2 top-full z-20 mt-1.5 w-56 -translate-x-1/2 whitespace-normal rounded-field bg-ink px-2.5 py-1.5 text-left text-[11px] font-normal normal-case leading-snug tracking-normal text-white opacity-0 shadow-soft transition-opacity group-hover/tip:opacity-100 group-focus-visible/tip:opacity-100"
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

      <div className="font-display truncate text-2xl font-bold leading-tight tracking-tight sm:text-3xl">
        {value}
      </div>
      {secondary && <div className="tnum truncate text-sm text-muted">{secondary}</div>}

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

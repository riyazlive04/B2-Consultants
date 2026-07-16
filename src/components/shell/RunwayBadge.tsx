import Link from "next/link";
import { Gauge } from "lucide-react";
import { SIGNAL_META, signalForRunway } from "@/lib/signals";

/**
 * Top-bar runway indicator (PRD3 §5): "Runway: 4.2 months" in signal colour, on
 * every screen. Admin-only - Cash Health data never renders for other roles.
 */
export function RunwayBadge({ months }: { months: number | null }) {
  if (months === null) {
    return (
      <Link
        href="/cash"
        className="inline-flex h-10 items-center gap-1.5 rounded-full border border-line bg-surface-2 px-3 text-caption font-medium text-muted hover:border-primary"
        title="Enter a weekly bank balance in Cash Health to compute runway"
      >
        <Gauge size={13} aria-hidden />
        Runway: —
      </Link>
    );
  }
  const meta = SIGNAL_META[signalForRunway(months)];
  return (
    <Link
      href="/cash"
      className="inline-flex h-10 items-center gap-1.5 rounded-full px-3 text-caption font-semibold"
      style={{ background: meta.soft, color: meta.color }}
      title="Cash ÷ average monthly burn (last 3 months)"
    >
      <Gauge size={13} aria-hidden />
      {/* §3: runway carries 1 decimal, always. `4` must read "4.0 months", never "4 mo".
          Below `sm` only the "Runway:" *label* drops — the gauge icon already says what it
          is, and the value keeps its decimal and full "months" unit. This is what stops the
          top-bar cluster overflowing a phone (§9.4 still wants the pill on every screen). */}
      <span className="tnum">
        <span className="hidden sm:inline">Runway: </span>
        {months.toFixed(1)} months
      </span>
    </Link>
  );
}

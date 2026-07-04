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
        className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface-2 px-3 py-1.5 text-xs font-medium text-muted hover:border-accent"
        title="Enter a weekly bank balance in Cash Health to compute runway"
      >
        <Gauge size={13} />
        Runway: -
      </Link>
    );
  }
  const meta = SIGNAL_META[signalForRunway(months)];
  return (
    <Link
      href="/cash"
      className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold"
      style={{ background: meta.soft, color: meta.color }}
      title="Cash ÷ average monthly burn (last 3 months)"
    >
      <Gauge size={13} />
      <span className="hidden sm:inline">Runway: </span>{months} mo
    </Link>
  );
}

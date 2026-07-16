import Link from "next/link";
import { KPI_RANGE_OPTIONS, type KpiRangeKey } from "@/lib/dates";

/**
 * Home KPI grid's date-range control (This Month / Last Month / QTD, BUILD_CHECKLIST §2).
 * Plain `<Link>`s to `?range=…`, not client state — the choice is a URL search param that
 * the home page (a server component) reads and re-renders with, so this needs no JS at all.
 * Visually mirrors `SegmentedControl` (controls.tsx) for consistency with the rest of the kit.
 */
export function KpiRangeSwitch({ active }: { active: KpiRangeKey }) {
  return (
    <div role="group" aria-label="KPI date range" className="flex flex-wrap gap-2">
      {KPI_RANGE_OPTIONS.map((o) => {
        const isActive = o.value === active;
        return (
          <Link
            key={o.value}
            href={`/?range=${o.value}`}
            aria-pressed={isActive}
            className={`inline-flex h-10 items-center rounded-field border px-3 text-sm font-semibold transition-colors ${
              isActive
                ? "border-primary bg-primary-soft text-primary-strong"
                : "border-line bg-surface text-ink-2 hover:bg-surface-2"
            }`}
          >
            {o.label}
          </Link>
        );
      })}
    </div>
  );
}

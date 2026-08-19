import Link from "next/link";
import { CASH_PERIOD_OPTIONS, type CashPeriodKey } from "@/lib/dates";

/**
 * Window control for the cash chart (Error Log F6) - the chart was fixed at 12 weeks, so
 * "how has cash moved this year" had no answer on this page.
 *
 * Plain `<Link>`s to `?period=…`, mirroring `KpiRangeSwitch`: the choice is a URL search param
 * the server component re-renders from, so it needs no client JS and can be linked to someone.
 */
export function CashPeriodSwitch({ active }: { active: CashPeriodKey }) {
  return (
    <div role="group" aria-label="Cash chart period" className="flex flex-wrap gap-1.5">
      {CASH_PERIOD_OPTIONS.map((o) => {
        const isActive = o.value === active;
        return (
          <Link
            key={o.value}
            href={o.value === "12w" ? "/cash" : `/cash?period=${o.value}`}
            aria-pressed={isActive}
            className={`inline-flex h-8 items-center rounded-field border px-2.5 text-caption font-semibold transition-colors ${
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

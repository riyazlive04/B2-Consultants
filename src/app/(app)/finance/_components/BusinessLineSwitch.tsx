import Link from "next/link";
import { Building2 } from "lucide-react";
import { BUSINESS_LINE_LABELS, type BusinessLineView } from "@/lib/business-line";
import { formatInrMinor } from "@/lib/format";

/**
 * B2 · German Note · Combined (§1.1).
 *
 * URL-driven (`?line=`) rather than client state, for three reasons: every server-rendered
 * card on the page switches together with no prop-drilling, the choice survives a reload,
 * and a particular view can be linked to someone. Same pattern as the Reports pivot.
 *
 * Each button carries its own revenue so the split is legible without switching at all —
 * §1.2 asked to SEE the split (B2 ₹2,00,000 + German Note ₹47,000 = ₹2,47,000), not merely
 * to be able to filter to it.
 */
export function BusinessLineSwitch({
  active,
  totals,
}: {
  active: BusinessLineView;
  totals: Record<BusinessLineView, number>;
}) {
  const views: BusinessLineView[] = ["ALL", "B2", "GERMAN_NOTE"];

  return (
    <div className="flex flex-wrap items-center gap-3">
      <p className="flex items-center gap-1.5 text-caption text-muted">
        <Building2 size={13} /> Business line
      </p>
      <div
        className="flex flex-wrap items-center gap-0.5 rounded-full border border-line-strong bg-surface-2 p-0.5"
        role="group"
        aria-label="Filter finance by business line"
      >
        {views.map((v) => {
          const on = v === active;
          return (
            <Link
              key={v}
              href={v === "ALL" ? "/finance" : `/finance?line=${v}`}
              aria-current={on ? "page" : undefined}
              className={`press flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold transition-colors ${
                on ? "bg-primary text-on-accent" : "text-ink-2 hover:text-ink"
              }`}
            >
              {BUSINESS_LINE_LABELS[v]}
              <span className={`tnum text-caption font-medium ${on ? "opacity-80" : "text-muted"}`}>
                {formatInrMinor(totals[v], { compact: true })}
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

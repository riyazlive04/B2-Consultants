"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Building2 } from "lucide-react";
import { BUSINESS_LINE_LABELS, type BusinessLineView } from "@/lib/business-line";
import { setBusinessLineView } from "@/server/business-line-view";

/**
 * B2 · German Note · Combined — the app-wide segment control (Error Log E1/E4).
 *
 * ONE component for every screen. It began as a Finance-only widget with the revenue split
 * baked into it; `totals` is now optional so Finance keeps that richer rendering (E2 asked to
 * SEE the split — B2 ₹2,00,000 + GN ₹47,000 — not merely to filter by it) while other screens
 * get the same control without inventing figures they don't have.
 *
 * Buttons writing a cookie, not links: the selection has to persist across navigation, and a
 * `<Link href="?line=">` can only change the page it is on. `router.refresh()` after the write
 * re-renders the server components with the new segment, so the numbers move without a
 * full reload and without any client-side data duplication.
 */
export function SegmentToggle({
  active,
  totals,
  label = "Business line",
  onSelect,
}: {
  active: BusinessLineView;
  /** Optional per-line figure rendered inside each button, already formatted. */
  totals?: Partial<Record<BusinessLineView, string>>;
  label?: string;
  /**
   * Take over the switch. Given, the caller owns the change and this control does NOT
   * re-render from the server — used by the home dashboard, where every view is already
   * in the DOM so switching is instant. Omitted, the default server round-trip applies,
   * which is right for Finance where each line is a genuinely different query.
   */
  onSelect?: (v: BusinessLineView) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const views: BusinessLineView[] = ["ALL", "B2", "GERMAN_NOTE"];

  const choose = (v: BusinessLineView) => {
    if (v === active) return;
    if (onSelect) return onSelect(v);
    startTransition(async () => {
      await setBusinessLineView(v);
      router.refresh();
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-3">
      <p className="flex items-center gap-1.5 text-caption text-muted">
        <Building2 size={13} /> {label}
      </p>
      <div
        className="flex flex-wrap items-center gap-0.5 rounded-full border border-line-strong bg-surface-2 p-0.5"
        role="group"
        aria-label="Filter by business line"
      >
        {views.map((v) => {
          const on = v === active;
          return (
            <button
              key={v}
              type="button"
              onClick={() => choose(v)}
              // `aria-pressed`, not `aria-current`: these are toggle buttons now, not
              // navigation links, and a screen reader should announce the pressed state.
              aria-pressed={on}
              disabled={pending}
              className={`press flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold transition-colors disabled:opacity-60 ${
                on ? "bg-primary text-on-accent" : "text-ink-2 hover:text-ink"
              }`}
            >
              {BUSINESS_LINE_LABELS[v]}
              {totals?.[v] && (
                <span className={`tnum text-caption font-medium ${on ? "opacity-80" : "text-muted"}`}>
                  {totals[v]}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

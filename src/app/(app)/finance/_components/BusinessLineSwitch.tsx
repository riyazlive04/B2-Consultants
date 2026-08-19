"use client";

import { BUSINESS_LINE_LABELS, type BusinessLineView } from "@/lib/business-line";
import { formatEurMinor, formatInrMinor } from "@/lib/format";
import { SegmentToggle } from "@/components/ui/SegmentToggle";
import { useFinanceCcy } from "./FinanceCurrency";

/**
 * Finance's segment control - the shared `SegmentToggle` with each line's revenue printed
 * inside its button.
 *
 * A wrapper rather than props on the shared component because those totals follow the page's
 * ₹/€ toggle, which lives in a client context (`useFinanceCcy`). Only Finance has that
 * context, so only Finance can format the figures; every other screen renders the plain control.
 *
 * The split is shown WITHOUT switching (Error Log E2): the ask was to see
 * B2 ₹2,00,000 + German Note ₹47,000 = ₹2,47,000 at a glance, not merely to filter to each.
 *
 * It used to be `<Link href="?line=">`, which reset the moment you navigated away. The
 * selection is now a cookie written by the shared toggle, so it follows you across the app
 * (E1/E4) - while an explicit `?line=` still wins on arrival, keeping shared links working
 * (see server/business-line-view.ts).
 */
export function BusinessLineSwitch({
  active,
  totalsInr,
  totalsEur,
}: {
  active: BusinessLineView;
  totalsInr: Record<BusinessLineView, number>;
  totalsEur: Record<BusinessLineView, number>;
}) {
  const { ccy } = useFinanceCcy();
  const money = (v: BusinessLineView) =>
    ccy === "INR"
      ? formatInrMinor(totalsInr[v], { compact: true })
      : formatEurMinor(totalsEur[v], { compact: true });

  const totals = Object.fromEntries(
    (Object.keys(BUSINESS_LINE_LABELS) as BusinessLineView[]).map((v) => [v, money(v)]),
  ) as Partial<Record<BusinessLineView, string>>;

  return <SegmentToggle active={active} totals={totals} />;
}

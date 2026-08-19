"use client";

import { useState, type ReactNode } from "react";
import type { BusinessLineView } from "@/lib/business-line";
import { setBusinessLineView } from "@/server/business-line-view";
import { SegmentToggle } from "@/components/ui/SegmentToggle";

/**
 * Switches the home dashboard between the businesses - instantly (Error Log E1/E3/E4).
 *
 * ALL THREE VIEWS ARE ALREADY RENDERED. The server builds Combined, B2 and German Note in one
 * pass and hands them here as children; switching only changes which is visible, so it costs a
 * single React render and no network round-trip. That matters more here than anywhere else in
 * the app: on Supabase a dashboard round-trip is measured in seconds, so a server-driven toggle
 * would feel broken exactly where the founder switches most often.
 *
 * The trade is one extra set of queries per load. It is a good trade - the money hero's own
 * reads are small and the heavier shared reads (`getPendingRows`, `getPipelineSnapshot`,
 * `getActiveLevels`, the GN stats) are all React-cached, so building three views does NOT cost
 * three times one view.
 *
 * The choice still persists: `setBusinessLineView` writes the same cookie the server reads on
 * the next visit, fired WITHOUT await so the UI never waits on it. If that write fails the only
 * consequence is the next page load opens on the previous view - the switch itself already
 * happened locally, so nothing the person just did is lost.
 *
 * `hidden` rather than unmounting: the inactive views keep their DOM, so switching back is free
 * and any scroll position inside them survives. `hidden` also removes them from the
 * accessibility tree, so a screen reader never reads three dashboards at once.
 */
export function DashboardSwitcher({
  initial,
  combined,
  b2,
  shared,
  germanNote,
}: {
  initial: BusinessLineView;
  /** Money hero for the combined view. */
  combined: ReactNode;
  /** Money hero for B2 only. */
  b2: ReactNode;
  /**
   * Sections that belong to the B2 side and do NOT change between Combined and B2 - pipeline,
   * cash, wins. Passed separately so they render ONCE rather than being duplicated into both
   * views, which would run their queries twice for identical output.
   */
  shared: ReactNode;
  germanNote: ReactNode;
}) {
  const [view, setView] = useState<BusinessLineView>(initial);
  const onGermanNote = view === "GERMAN_NOTE";

  const choose = (next: BusinessLineView) => {
    setView(next); // instant - everything is already on the page
    void setBusinessLineView(next).catch(() => {
      /* persistence only; the visible switch has already happened */
    });
  };

  return (
    <div className="space-y-8">
      <SegmentToggle active={view} onSelect={choose} label="Business" />
      <div hidden={view !== "ALL"}>{combined}</div>
      <div hidden={view !== "B2"}>{b2}</div>
      {/* Pipeline, cash and wins are B2 concepts - German Note has no sales pipeline, so they
          are hidden rather than shown empty against a business they do not describe. */}
      <div hidden={onGermanNote} className="space-y-8">{shared}</div>
      <div hidden={!onGermanNote}>{germanNote}</div>
    </div>
  );
}

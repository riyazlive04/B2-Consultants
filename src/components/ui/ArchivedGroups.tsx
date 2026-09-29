"use client";

import { Archive } from "lucide-react";
import { EmptyState } from "@/components/ui/kit";
import { ArchivedPanel } from "@/components/ui/ArchivedPanel";
import type { ArchivedRow } from "@/server/archive-metrics";
import { RETENTION_DAYS } from "@/lib/soft-delete";

type ActionResult = { ok: true } | { ok: false; error: string };
type Action = (id: string) => Promise<ActionResult>;

export type ArchivedGroup = {
  label: string;
  noun: string;
  rows: ArchivedRow[];
  restore: Action;
  purge: Action;
};

/**
 * A section's "Archived" tab. Renders one labelled <ArchivedPanel> per record type the section
 * owns (Finance → income/expense/pending; Contacts → contacts/companies/tasks; …). Server-action
 * pairs are passed in from the page, so this stays generic. Shows a single empty state when the
 * whole section has nothing archived.
 */
export function ArchivedGroups({ groups, canPurge }: { groups: ArchivedGroup[]; canPurge: boolean }) {
  const nonEmpty = groups.filter((g) => g.rows.length > 0);
  if (!nonEmpty.length) {
    return (
      <EmptyState
        icon={<Archive size={20} />}
        title="Nothing archived"
        body={`Deleted records in this section land here, ready to restore or delete for good. Anything left here is purged automatically after ${RETENTION_DAYS} days.`}
      />
    );
  }
  return (
    <div className="space-y-6">
      {/* K5: the retention rule was real but invisible - a 90-day purge cron has been running
          with nothing on screen saying so, which means "archived" read as "kept forever".
          Stated once, above the lists, so it is seen before something is relied upon. */}
      <p className="text-caption text-muted">
        Archived records are kept for {RETENTION_DAYS} days, then permanently deleted. Restore
        anything you still need before then.
      </p>
      {nonEmpty.map((g) => (
        <section key={g.label}>
          <h3 className="mb-2 text-sm font-semibold text-ink-2">
            {g.label} <span className="text-ink-3">({g.rows.length})</span>
          </h3>
          <ArchivedPanel rows={g.rows} restore={g.restore} purge={g.purge} canPurge={canPurge} noun={g.noun} />
        </section>
      ))}
    </div>
  );
}

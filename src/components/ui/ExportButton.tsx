"use client";

import { useSearchParams } from "next/navigation";
import { Download } from "lucide-react";

/**
 * "Export CSV" that downloads what the SCREEN IS SHOWING - every row of it.
 *
 * It forwards the page's whole query string to `/api/export/[entity]`, which re-runs the same
 * `where` clause server-side with no page cap. That is the difference from `DataTable`'s own
 * export button, which serialises the rows already rendered: on Contacts that is a paginated
 * slice, so the old "export" of 23,545 leads produced a few hundred and said nothing about it.
 *
 * A plain `<a download>` rather than a fetch: the browser streams it straight to disk, so a
 * 50,000-row file never has to exist in a JS string, and a slow export shows the browser's own
 * download progress instead of a frozen button.
 */
export function ExportButton({
  entity,
  label = "Export CSV",
}: {
  /** Must match a key in the export route's `EXPORTS` map. */
  entity: "leads" | "income" | "expenses";
  label?: string;
}) {
  const searchParams = useSearchParams();
  // `cursor` is this page's scroll position, not a filter - carrying it into an export that is
  // deliberately unpaginated would be meaningless at best.
  const params = new URLSearchParams(searchParams.toString());
  params.delete("cursor");
  const qs = params.toString();

  return (
    <a
      href={`/api/export/${entity}${qs ? `?${qs}` : ""}`}
      // No `target="_blank"`: a download response never navigates, so a new tab would open and
      // immediately sit blank.
      className="inline-flex h-9 flex-none items-center gap-1.5 rounded-field border border-line bg-surface px-3 text-xs font-semibold text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
      title="Download every row matching the current filters"
    >
      <Download size={14} /> {label}
    </a>
  );
}

"use client";

import { useMemo, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

/**
 * One pager for every table in the app.
 *
 * `DataTable` grew a pager first, which left every hand-rolled `<table>` - the pipeline board, the
 * German Note panels, the agreements list, the tutor ledger - rendering its whole result set in one
 * go. On this data that is a 23,000-row page: slow to paint, impossible to read, and the reason the
 * same complaint ("paginate the tables") kept coming back per screen. So the paging state and its
 * controls live here, and `DataTable` is one more caller rather than the only place it exists.
 *
 * Two ways in:
 *   `usePaged(rows)`   - a client component that owns its rows (most of them). Returns the slice to
 *                        render plus the state the control needs.
 *   `<PagedTable>`     - a SERVER component that has already rendered its `<tr>`s. It passes them as
 *                        an array of nodes; only the slicing is client-side, so the rows stay server
 *                        rendered and no data crosses into the bundle.
 *
 * Page sizes are shared deliberately: a reader who learns "100" on one screen should not meet a
 * different ladder on the next.
 */

/** Page sizes offered under every table. The first is both the default and the floor for showing the pager. */
export const PAGE_SIZES = [25, 50, 100] as const;
export const SMALLEST_PAGE = PAGE_SIZES[0];

export type PagerState = {
  readonly page: number;
  readonly pageCount: number;
  readonly pageSize: number;
  readonly setPage: (n: number) => void;
  readonly setPageSize: (n: number) => void;
  /** 1-based index of the first row on screen; 0 when there are none. */
  readonly firstOnPage: number;
  readonly lastOnPage: number;
  readonly total: number;
  /** False while everything fits on one page - the control would say nothing. */
  readonly show: boolean;
};

/**
 * Slices `rows` into pages. The row array may be rebuilt on every render (a `.filter()` in the
 * caller is the normal case), so the slice is memoised on length and bounds rather than identity.
 */
export function usePaged<T>(rows: readonly T[], opts?: { initialSize?: number }): {
  paged: T[];
  pager: PagerState;
} {
  const [page, setPage] = useState(0);
  const [pageSize, setSize] = useState<number>(opts?.initialSize ?? SMALLEST_PAGE);

  const total = rows.length;
  const size = Math.max(1, pageSize);
  const pageCount = Math.max(1, Math.ceil(total / size));
  // Clamped rather than stored: filtering 400 rows down to 10 while on page 7 must not blank the
  // table. The caller never has to reset the page when its data changes.
  const safePage = Math.min(Math.max(0, page), pageCount - 1);
  const paged = useMemo(
    () => rows.slice(safePage * size, (safePage + 1) * size),
    [rows, safePage, size],
  );

  return {
    paged,
    pager: {
      page: safePage,
      pageCount,
      pageSize,
      setPage,
      setPageSize: (n: number) => { setSize(n); setPage(0); },
      firstOnPage: total === 0 ? 0 : safePage * size + 1,
      lastOnPage: Math.min(total, (safePage + 1) * size),
      total,
      /**
       * Visible once the rows are actually split, or once there is more than one default page's
       * worth. The second clause is why choosing "100" does not make the control that chose it
       * disappear; the first is why a table opened at a SMALLER size than the default still gets
       * a pager - without it, a caller passing `initialSize: 10` would hide rows 11+ behind no
       * control at all.
       */
      show: total > Math.min(SMALLEST_PAGE, size),
    },
  };
}

/**
 * The control itself. Says WHICH rows are on screen, not just which page: "26-32 of 32" answers the
 * question "page 2 of 2" leaves you counting. The size picker sits beside it because the honest
 * answer to "this is tedious to page through" is often "show me more at once".
 */
export function TablePager({
  page, pageCount, pageSize, setPage, setPageSize, firstOnPage, lastOnPage, total, show,
  /** Border above the control. Off when the caller already draws one. */
  bordered = true,
}: PagerState & { bordered?: boolean }) {
  if (!show) return null;
  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 text-sm ${
        bordered ? "border-t border-line" : ""
      }`}
    >
      <label className="flex items-center gap-2 text-xs text-muted">
        Rows per page
        <select
          value={pageSize}
          onChange={(e) => setPageSize(Number(e.target.value))}
          className="h-9 rounded-btn border border-line bg-surface px-2 text-sm text-ink outline-none focus:border-primary focus:ring-2 focus:ring-primary-soft"
        >
          {PAGE_SIZES.map((n) => (
            <option key={n} value={n}>{n}</option>
          ))}
          <option value={Math.max(1, total)}>All</option>
        </select>
      </label>
      <span className="tnum text-xs text-muted" aria-live="polite">
        {firstOnPage}-{lastOnPage} of {total}
      </span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={page === 0}
          onClick={() => setPage(page - 1)}
          className="inline-flex h-10 items-center gap-1 rounded-btn border border-line px-3 text-sm hover:bg-surface-2 disabled:bg-surface-2 disabled:text-ink-disabled disabled:hover:bg-surface-2"
        >
          <ChevronLeft size={15} /> Prev
        </button>
        <span className="tnum whitespace-nowrap text-xs text-muted">
          Page {page + 1} of {pageCount}
        </span>
        <button
          type="button"
          disabled={page >= pageCount - 1}
          onClick={() => setPage(page + 1)}
          className="inline-flex h-10 items-center gap-1 rounded-btn border border-line px-3 text-sm hover:bg-surface-2 disabled:bg-surface-2 disabled:text-ink-disabled disabled:hover:bg-surface-2"
        >
          Next <ChevronRight size={15} />
        </button>
      </div>
    </div>
  );
}

/**
 * A whole table for a SERVER component: it hands over its already-rendered `<tr>` elements and this
 * pages them. Each node needs its own `key`, exactly as it would inside a `<tbody>`.
 *
 * The rows are rendered on the server and arrive as part of the RSC payload, so nothing about the
 * data - amounts, names, ids - is shipped as client state. Only the page index is.
 */
export function PagedTable({
  head,
  rows,
  foot,
  minWidth,
  initialSize,
  className = "",
  bodyClassName = "",
}: {
  head: ReactNode;
  rows: ReactNode[];
  /** Totals row. Kept outside the paging: a total that changed with the page would be a lie. */
  foot?: ReactNode;
  /** Horizontal scroll floor, matching the hand-rolled tables this replaces. */
  minWidth?: number;
  initialSize?: number;
  /** Extra classes for the `<table>` itself. */
  className?: string;
  /** Extra classes for `<tbody>` - e.g. `divide-y divide-line` where the rows carry no border. */
  bodyClassName?: string;
}) {
  const { paged, pager } = usePaged(rows, { initialSize });
  return (
    <>
      <div className="overflow-x-auto">
        <table
          className={`w-full text-sm ${className}`}
          style={minWidth ? { minWidth } : undefined}
        >
          <thead>{head}</thead>
          <tbody className={bodyClassName}>{paged}</tbody>
          {foot ? <tfoot>{foot}</tfoot> : null}
        </table>
      </div>
      <TablePager {...pager} />
    </>
  );
}

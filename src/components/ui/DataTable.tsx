"use client";

import { useDeferredValue, useMemo, useState, type ReactNode } from "react";
import { Search, Download, ChevronLeft, ChevronRight, ArrowUp, ArrowDown, Inbox, SearchX } from "lucide-react";
import { EmptyState } from "./kit";
import { Btn } from "./controls";

export type Column<T> = {
  key: string;
  header: string;
  /** Rendered cell. */
  cell: (row: T) => ReactNode;
  /** Raw value used for sorting + CSV export. Falls back to cell text. */
  value?: (row: T) => string | number | null;
  sortable?: boolean;
  align?: "left" | "right";
};

/**
 * Optional multi-select. Pass all four and the table grows a checkbox column plus a
 * header checkbox; the selection itself is owned by the caller (it drives a bulk-action
 * bar that lives outside the table). Header checkbox scope is the *filtered* rows, not
 * the current page — "select all" after a search means the search, which is what the
 * count next to it says.
 */
export type Selection<T> = {
  rowKey: (row: T) => string;
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
  /** Rows the caller won't allow selecting (omit = all selectable). */
  selectable?: (row: T) => boolean;
};

/**
 * Shared table (CONTEXT §6): client-side sort + text filter, CSV export button
 * (Admin-only - pass `csvName` only when the viewer may export), signal-aware
 * row highlighting via `rowClassName` (e.g. overdue rows in risk-soft), and
 * optional multi-select via `selection`.
 */
export function DataTable<T>({
  rows,
  columns,
  csvName,
  rowClassName,
  emptyMessage = "No records yet.",
  filterPlaceholder = "Filter…",
  selection,
  toolbarExtra,
  hideFilter = false,
}: {
  rows: T[];
  columns: Column<T>[];
  csvName?: string;
  rowClassName?: (row: T) => string | undefined;
  emptyMessage?: string;
  filterPlaceholder?: string;
  selection?: Selection<T>;
  /** Rendered in the toolbar, left of Export CSV (e.g. a bulk-action bar). */
  toolbarExtra?: ReactNode;
  /**
   * Hide the built-in per-page filter box. Pass when the caller already provides a
   * server-side search (e.g. Contacts' filter bar) — otherwise the two search boxes
   * on one screen search different scopes and users type in the wrong one.
   */
  hideFilter?: boolean;
}) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [filter, setFilter] = useState("");
  // The heavy filter+sort runs on a DEFERRED copy of the query, so typing stays smooth
  // even over a few thousand in-memory rows (INP): the input updates every keystroke
  // while `visible` recomputes at React's leisure.
  const deferredFilter = useDeferredValue(filter);
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 25;

  const raw = (row: T, col: Column<T>): string | number | null => {
    if (col.value) return col.value(row);
    const c = col.cell(row);
    return typeof c === "string" || typeof c === "number" ? c : null;
  };

  const visible = useMemo(() => {
    let out = rows;
    if (deferredFilter.trim()) {
      const q = deferredFilter.trim().toLowerCase();
      out = out.filter((row) =>
        columns.some((col) => String(raw(row, col) ?? "").toLowerCase().includes(q)),
      );
    }
    if (sortKey) {
      const col = columns.find((c) => c.key === sortKey);
      if (col) {
        out = [...out].sort((a, b) => {
          const va = raw(a, col);
          const vb = raw(b, col);
          if (va === null || va === undefined) return 1;
          if (vb === null || vb === undefined) return -1;
          const cmp =
            typeof va === "number" && typeof vb === "number"
              ? va - vb
              : String(va).localeCompare(String(vb));
          return sortDir === "asc" ? cmp : -cmp;
        });
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, columns, deferredFilter, sortKey, sortDir]);

  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const paged = visible.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  // Select-all spans every filtered row, not just this page — see Selection's doc.
  const selectableVisible = useMemo(
    () => (selection ? visible.filter((r) => selection.selectable?.(r) ?? true) : []),
    [visible, selection],
  );
  const isSelected = (row: T) => !!selection && selection.selected.has(selection.rowKey(row));
  const allSelected = selectableVisible.length > 0 && selectableVisible.every(isSelected);
  const someSelected = selectableVisible.some(isSelected);

  const toggleAll = () => {
    if (!selection) return;
    const next = new Set(selection.selected);
    for (const row of selectableVisible) {
      const key = selection.rowKey(row);
      if (allSelected) next.delete(key);
      else next.add(key);
    }
    selection.onChange(next);
  };

  const toggleRow = (row: T) => {
    if (!selection) return;
    const key = selection.rowKey(row);
    const next = new Set(selection.selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    selection.onChange(next);
  };

  const checkboxCls = "h-4 w-4 cursor-pointer accent-primary disabled:cursor-not-allowed disabled:opacity-40";
  const colCount = columns.length + (selection ? 1 : 0);

  const toggleSort = (key: string) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("desc");
    }
    setPage(0);
  };

  // CSV formula-injection guard: a cell starting with = + - @ (or a tab/CR) is
  // executed as a formula by Excel/Sheets. Lead names/notes are attacker-supplied
  // (public booking form, webhooks), so neutralise them with a leading apostrophe.
  const csvSafe = (v: string | number | null): string | number => {
    if (typeof v !== "string") return v ?? "";
    return /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  };

  const exportCsv = async () => {
    // Load papaparse only when the viewer actually exports - keeps it out of the
    // bundle of every table-bearing page (it's only used here, on a click).
    const Papa = (await import("papaparse")).default;
    const data = visible.map((row) =>
      Object.fromEntries(columns.map((col) => [col.header, csvSafe(raw(row, col))])),
    );
    const csv = Papa.unparse(data);
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${csvName ?? "export"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // A filtered-to-nothing table is a different state from a truly-empty one: it needs
  // the query echoed back and an escape hatch, not "No records yet." (which reads as a
  // bug when the records plainly exist).
  const isFiltered = !hideFilter && filter.trim().length > 0;
  const emptyNode = isFiltered ? (
    <EmptyState
      icon={<SearchX size={22} />}
      title="No matches"
      body={<>Nothing matches “{filter.trim()}”.</>}
      action={
        <Btn variant="soft" size="sm" onClick={() => { setFilter(""); setPage(0); }}>
          Clear filter
        </Btn>
      }
    />
  ) : (
    <EmptyState icon={<Inbox size={22} />} title={emptyMessage} />
  );

  return (
    <div className="overflow-hidden rounded-card border border-line bg-surface shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
        <div className="flex flex-1 items-center gap-3">
          {!hideFilter && (
            <div className="relative w-full max-w-64">
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" size={15} />
              <input
                value={filter}
                onChange={(e) => { setFilter(e.target.value); setPage(0); }}
                placeholder={filterPlaceholder}
                aria-label={filterPlaceholder}
                className="h-10 w-full rounded-field border border-line-strong bg-surface-2 pl-9 pr-3 text-sm outline-none transition-colors focus:border-primary focus:bg-surface focus:ring-2 focus:ring-primary-soft"
              />
            </div>
          )}
          <span className="whitespace-nowrap text-xs text-muted tnum">
            {visible.length === rows.length
              ? `${rows.length} record${rows.length === 1 ? "" : "s"}`
              : `${visible.length} of ${rows.length}`}
          </span>
        </div>
        {toolbarExtra}
        {csvName && (
          <button
            type="button"
            onClick={exportCsv}
            className="inline-flex h-10 items-center gap-2 rounded-btn border border-line bg-surface px-3 text-sm font-medium text-ink hover:bg-surface-2"
          >
            <Download size={14} />
            Export CSV
          </button>
        )}
      </div>
      {/* Below 720px a wide table becomes a horizontal-scroll trap, so §7 replaces it
          with stacked key-value cards. The <table> is hidden there, not shrunk. */}
      <div className="hidden overflow-x-auto tab:block">
        <table className="w-full text-sm">
          {/* header typography matches kit.tsx <Th> so a DataTable and a hand-built
              TableShell read as the same component on screen */}
          <thead className="sticky top-0 z-10 bg-surface-2">
            <tr className="border-b border-line text-left text-label font-semibold uppercase text-ink-2">
              {selection && (
                <th className="w-10 px-5 py-3">
                  <input
                    type="checkbox"
                    className={checkboxCls}
                    checked={allSelected}
                    // Mixed state can't be expressed declaratively in React — it's a DOM property.
                    ref={(el) => { if (el) el.indeterminate = someSelected && !allSelected; }}
                    disabled={selectableVisible.length === 0}
                    onChange={toggleAll}
                    aria-label={allSelected ? "Clear selection" : `Select all ${selectableVisible.length}`}
                  />
                </th>
              )}
              {columns.map((col) => (
                <th
                  key={col.key}
                  aria-sort={
                    col.sortable === false || sortKey !== col.key
                      ? undefined
                      : sortDir === "asc"
                        ? "ascending"
                        : "descending"
                  }
                  className={`px-5 py-3 ${col.align === "right" ? "text-right" : ""}`}
                >
                  {col.sortable === false ? (
                    col.header
                  ) : (
                    <button
                      type="button"
                      onClick={() => toggleSort(col.key)}
                      aria-label={`Sort by ${col.header}`}
                      className={`inline-flex items-center gap-1 transition-colors hover:text-ink ${col.align === "right" ? "flex-row-reverse" : ""}`}
                    >
                      {col.header}
                      {sortKey === col.key &&
                        (sortDir === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
                    </button>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td colSpan={colCount} className="p-6">
                  {emptyNode}
                </td>
              </tr>
            ) : (
              paged.map((row, i) => (
                <tr
                  key={selection ? selection.rowKey(row) : i}
                  className={`border-b border-line last:border-b-0 ${isSelected(row) ? "bg-primary-soft/40" : ""} ${rowClassName?.(row) ?? ""}`}
                >
                  {selection && (
                    <td className="px-5 py-4">
                      <input
                        type="checkbox"
                        className={checkboxCls}
                        checked={isSelected(row)}
                        disabled={!(selection.selectable?.(row) ?? true)}
                        onChange={() => toggleRow(row)}
                        aria-label="Select row"
                      />
                    </td>
                  )}
                  {columns.map((col) => (
                    // §5.6: 52px rows (py-4), not 48 (py-3.5)
                    <td key={col.key} className={`px-5 py-4 ${col.align === "right" ? "tnum text-right" : ""}`}>
                      {col.cell(row)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* <720px: one card per record, each cell a labelled key-value row (§7) */}
      <div className="tab:hidden">
        {visible.length === 0 ? (
          <div className="p-4">{emptyNode}</div>
        ) : (
          <ul className="divide-y divide-line">
            {paged.map((row, i) => (
              <li
                key={selection ? selection.rowKey(row) : i}
                className={`space-y-2 p-4 ${isSelected(row) ? "bg-primary-soft/40" : ""} ${rowClassName?.(row) ?? ""}`}
              >
                {selection && (
                  <label className="flex items-center gap-2 text-label uppercase text-ink-2">
                    <input
                      type="checkbox"
                      className={checkboxCls}
                      checked={isSelected(row)}
                      disabled={!(selection.selectable?.(row) ?? true)}
                      onChange={() => toggleRow(row)}
                    />
                    Select
                  </label>
                )}
                {columns.map((col) => (
                  <div key={col.key} className="flex items-baseline justify-between gap-4">
                    <span className="flex-none text-label uppercase text-ink-2">{col.header}</span>
                    <span className={`min-w-0 text-sm ${col.align === "right" ? "tnum text-right" : ""}`}>
                      {col.cell(row)}
                    </span>
                  </div>
                ))}
              </li>
            ))}
          </ul>
        )}
      </div>
      {pageCount > 1 && (
        <div className="flex items-center justify-between border-t border-line px-4 py-2.5 text-sm">
          <button
            type="button"
            disabled={safePage === 0}
            onClick={() => setPage(safePage - 1)}
            className="inline-flex h-10 items-center gap-1 rounded-btn border border-line px-3 text-sm hover:bg-surface-2 disabled:bg-surface-2 disabled:text-ink-disabled disabled:hover:bg-surface-2"
          >
            <ChevronLeft size={15} /> Prev
          </button>
          <span className="text-xs text-muted tnum">
            Page {safePage + 1} of {pageCount}
          </span>
          <button
            type="button"
            disabled={safePage >= pageCount - 1}
            onClick={() => setPage(safePage + 1)}
            className="inline-flex h-10 items-center gap-1 rounded-btn border border-line px-3 text-sm hover:bg-surface-2 disabled:bg-surface-2 disabled:text-ink-disabled disabled:hover:bg-surface-2"
          >
            Next <ChevronRight size={15} />
          </button>
        </div>
      )}
    </div>
  );
}

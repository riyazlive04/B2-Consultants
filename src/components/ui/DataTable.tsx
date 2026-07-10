"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Search, Download, ChevronLeft, ChevronRight, ArrowUp, ArrowDown } from "lucide-react";

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
 * Shared table (CONTEXT §6): client-side sort + text filter, CSV export button
 * (Admin-only - pass `csvName` only when the viewer may export), signal-aware
 * row highlighting via `rowClassName` (e.g. overdue rows in risk-soft).
 */
export function DataTable<T>({
  rows,
  columns,
  csvName,
  rowClassName,
  emptyMessage = "No records yet.",
  filterPlaceholder = "Filter…",
}: {
  rows: T[];
  columns: Column<T>[];
  csvName?: string;
  rowClassName?: (row: T) => string | undefined;
  emptyMessage?: string;
  filterPlaceholder?: string;
}) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [filter, setFilter] = useState("");
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 25;

  const raw = (row: T, col: Column<T>): string | number | null => {
    if (col.value) return col.value(row);
    const c = col.cell(row);
    return typeof c === "string" || typeof c === "number" ? c : null;
  };

  const visible = useMemo(() => {
    let out = rows;
    if (filter.trim()) {
      const q = filter.trim().toLowerCase();
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
  }, [rows, columns, filter, sortKey, sortDir]);

  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const paged = visible.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

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

  return (
    <div className="overflow-hidden rounded-card border border-line bg-surface shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
        <div className="flex flex-1 items-center gap-3">
          <div className="relative w-full max-w-64">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" size={15} />
            <input
              value={filter}
              onChange={(e) => { setFilter(e.target.value); setPage(0); }}
              placeholder={filterPlaceholder}
              aria-label={filterPlaceholder}
              className="w-full rounded-field border border-line bg-surface-2 py-1.5 pl-9 pr-3 text-sm outline-none transition-colors focus:border-primary focus:bg-surface focus:ring-2 focus:ring-primary-soft"
            />
          </div>
          <span className="whitespace-nowrap text-xs text-muted tnum">
            {visible.length === rows.length
              ? `${rows.length} record${rows.length === 1 ? "" : "s"}`
              : `${visible.length} of ${rows.length}`}
          </span>
        </div>
        {csvName && (
          <button
            type="button"
            onClick={exportCsv}
            className="inline-flex items-center gap-1.5 rounded-field border border-line bg-surface px-3 py-1.5 text-sm font-medium text-ink hover:bg-surface-2"
          >
            <Download size={14} />
            Export CSV
          </button>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          {/* header typography matches kit.tsx <Th> so a DataTable and a hand-built
              TableShell read as the same component on screen */}
          <thead className="sticky top-0 z-10 bg-surface-2">
            <tr className="border-b border-line text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-3">
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
                <td colSpan={columns.length} className="px-4 py-10 text-center text-muted">
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              paged.map((row, i) => (
                <tr key={i} className={`border-b border-line last:border-b-0 ${rowClassName?.(row) ?? ""}`}>
                  {columns.map((col) => (
                    <td key={col.key} className={`px-5 py-3.5 ${col.align === "right" ? "tnum text-right" : ""}`}>
                      {col.cell(row)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {pageCount > 1 && (
        <div className="flex items-center justify-between border-t border-line px-4 py-2.5 text-sm">
          <button
            type="button"
            disabled={safePage === 0}
            onClick={() => setPage(safePage - 1)}
            className="inline-flex items-center gap-1 rounded-field border border-line px-3 py-1.5 text-sm hover:bg-surface-2 disabled:opacity-40 disabled:hover:bg-transparent"
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
            className="inline-flex items-center gap-1 rounded-field border border-line px-3 py-1.5 text-sm hover:bg-surface-2 disabled:opacity-40 disabled:hover:bg-transparent"
          >
            Next <ChevronRight size={15} />
          </button>
        </div>
      )}
    </div>
  );
}

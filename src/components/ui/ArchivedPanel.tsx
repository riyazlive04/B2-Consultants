"use client";

import { useState, useTransition } from "react";
import { RotateCcw, Trash2, Archive } from "lucide-react";
import { IconButton } from "@/components/ui/controls";
import { EmptyState } from "@/components/ui/kit";
import { askConfirm, toast } from "@/components/ui/feedback";
import type { ArchivedRow } from "@/server/archive-metrics";

type ActionResult = { ok: true } | { ok: false; error: string };

/**
 * The per-section "Archived" tab. One component renders every record type (all archived getters
 * return the same `ArchivedRow` shape). Restore and permanent-delete are optimistic: the row
 * leaves the list immediately and slides back with an error toast if the server rejects it.
 * `purge` is only wired when `canPurge` (admin) — the same two-step guard as Automation's trash.
 */
export function ArchivedPanel({
  rows: initialRows,
  restore,
  purge,
  canPurge,
  noun,
}: {
  rows: ArchivedRow[];
  restore: (id: string) => Promise<ActionResult>;
  purge: (id: string) => Promise<ActionResult>;
  canPurge: boolean;
  /** Singular label for copy, e.g. "contact", "income entry", "invoice". */
  noun: string;
}) {
  const [rows, setRows] = useState(initialRows);
  const [pending, start] = useTransition();

  const drop = (id: string) => setRows((r) => r.filter((x) => x.id !== id));

  const doRestore = (row: ArchivedRow) => {
    const prev = rows;
    drop(row.id); // optimistic
    start(async () => {
      const res = await restore(row.id);
      if (!res.ok) {
        setRows(prev);
        toast(res.error, "error");
        return;
      }
      toast(`Restored ${row.primary}`);
    });
  };

  const doPurge = async (row: ArchivedRow) => {
    const ok = await askConfirm({
      title: `Permanently delete this ${noun}?`,
      body: `"${row.primary}" will be gone for good — this cannot be undone.`,
      confirmLabel: "Delete permanently",
      danger: true,
    });
    if (!ok) return;
    const prev = rows;
    drop(row.id); // optimistic
    start(async () => {
      const res = await purge(row.id);
      if (!res.ok) {
        setRows(prev);
        toast(res.error, "error");
        return;
      }
      toast(`Permanently deleted ${row.primary}`);
    });
  };

  if (!rows.length) {
    return (
      <EmptyState
        icon={<Archive size={20} />}
        title="Nothing archived"
        body={`Deleted ${noun}s land here. Restore them, or delete them for good.`}
      />
    );
  }

  return (
    <ul className="overflow-hidden rounded-card border border-line bg-surface">
      {rows.map((row, i) => (
        <li
          key={row.id}
          className={`flex items-center gap-3 px-4 py-3 ${i > 0 ? "border-t border-line" : ""}`}
        >
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="truncate font-medium text-ink">{row.primary}</span>
              {row.detail && <span className="shrink-0 text-xs text-ink-3">{row.detail}</span>}
            </div>
            <div className="mt-0.5 text-xs text-ink-2">
              {row.secondary ? <span>{row.secondary} · </span> : null}
              <span className="text-ink-3">
                Archived{row.archivedOn ? ` ${row.archivedOn}` : ""}
                {row.archivedByName ? ` by ${row.archivedByName}` : ""}
              </span>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <IconButton
              label={`Restore ${row.primary}`}
              tone="neutral"
              size="sm"
              onClick={() => doRestore(row)}
              disabled={pending}
            >
              <RotateCcw size={15} />
            </IconButton>
            {canPurge && (
              <IconButton
                label={`Delete ${row.primary} permanently`}
                tone="danger"
                size="sm"
                onClick={() => doPurge(row)}
                disabled={pending}
              >
                <Trash2 size={15} />
              </IconButton>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

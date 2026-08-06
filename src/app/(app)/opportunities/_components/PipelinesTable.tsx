"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { GripVertical, Plus, Search, MoreVertical, Pencil, Trash2, LayoutGrid } from "lucide-react";
import type { PipelineRow } from "@/server/opportunities-metrics";
import { createPipeline, renamePipeline, deletePipeline, reorderPipelines } from "@/server/opportunities-actions";
import { Btn } from "@/components/ui/controls";
import { Modal } from "@/components/ui/Modal";
import { Field, TextInput, SubmitButton, FormError } from "@/components/ui/form";
import { toast, askConfirm } from "@/components/ui/feedback";
import { Card, EmptyState, Pill } from "@/components/ui/kit";
import { DateText } from "@/components/ui/DateText";

/**
 * The Pipelines management list.
 *
 * ── Why the rows are reordered here and not by a drag library ────────────────────
 * The board already hand-rolls HTML5 drag-and-drop for its cards and stages, and this is the same
 * interaction over a much simpler list. Pulling in a drag dependency for one table would ship a
 * second way of doing something the codebase already does — and the two would drift.
 *
 * ── The default pipeline is pinned ──────────────────────────────────────────────
 * `listPipelines` (and the board's switcher) sort `isDefault` first no matter what `position`
 * says, so letting someone drag Sales into third place would produce a table whose order the
 * board silently ignores. It is rendered without a handle and dropped on rather than dragged.
 */
export function PipelinesTable({ rows, canConfigure }: { rows: PipelineRow[]; canConfigure: boolean }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<PipelineRow | null>(null);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);

  // Local order so a drag reads instantly; resynced whenever the server sends fresh rows.
  const [order, setOrder] = useState<string[]>(rows.map((r) => r.id));
  const [dragId, setDragId] = useState<string | null>(null);
  useEffect(() => setOrder(rows.map((r) => r.id)), [rows]);

  // One document-level listener rather than a backdrop element per row.
  useEffect(() => {
    if (!menuFor) return;
    const close = () => setMenuFor(null);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [menuFor]);

  const byId = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);
  const ordered = useMemo(
    () => order.map((id) => byId.get(id)).filter((r): r is PipelineRow => !!r),
    [order, byId],
  );
  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return needle ? ordered.filter((r) => r.name.toLowerCase().includes(needle)) : ordered;
  }, [ordered, q]);

  /** Drop `dragId` onto `overId`'s slot. Reordering the FULL list, never the filtered view. */
  function onDropRow(overId: string) {
    if (!dragId || dragId === overId) return setDragId(null);
    const target = byId.get(overId);
    if (target?.isDefault) return setDragId(null); // can't displace the pinned default

    const next = order.filter((id) => id !== dragId);
    const at = next.indexOf(overId);
    if (at === -1) return setDragId(null);
    next.splice(at, 0, dragId);
    setOrder(next);
    setDragId(null);

    void reorderPipelines(next).then((res) => {
      if (!res.ok) {
        toast(res.error);
        setOrder(rows.map((r) => r.id)); // put it back — the server refused
      } else {
        router.refresh();
      }
    });
  }

  async function add(form: FormData) {
    setAddError(null);
    const res = await createPipeline(form);
    if (!res.ok) return setAddError(res.error);
    setAddOpen(false);
    toast("Pipeline created");
    router.refresh();
  }

  async function saveRename(form: FormData) {
    if (!renaming) return;
    setRenameError(null);
    const res = await renamePipeline(renaming.id, String(form.get("name") ?? ""));
    if (!res.ok) return setRenameError(res.error);
    setRenaming(null);
    toast("Pipeline renamed");
    router.refresh();
  }

  async function remove(row: PipelineRow) {
    // The count is in the question on purpose: "delete" on a pipeline holding 8,000 cards should
    // not read the same as one holding none.
    const ok = await askConfirm({
      title: `Delete the ${row.name} pipeline?`,
      body:
        row.oppCount > 0
          ? `It holds ${row.oppCount.toLocaleString("en-IN")} opportunit${row.oppCount === 1 ? "y" : "ies"}, which will disappear from the board. This is recoverable by an admin, but not from this screen.`
          : "It has no opportunities. This is recoverable by an admin, but not from this screen.",
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    const res = await deletePipeline(row.id);
    if (!res.ok) return toast(res.error);
    toast("Pipeline deleted");
    router.refresh();
  }

  return (
    <div className="w-full space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-h2 text-ink">Pipelines</h1>
          <p className="mt-0.5 text-sm text-muted">
            Use pipelines to track opportunities and sales progress across stages.
          </p>
        </div>
        {canConfigure && (
          <Btn icon={<Plus size={16} />} onClick={() => { setAddError(null); setAddOpen(true); }}>
            Create pipeline
          </Btn>
        )}
      </div>

      <Card flush>
        <div className="border-b border-line p-3">
          <span className="relative block max-w-xs">
            <Search size={15} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search"
              aria-label="Search pipelines"
              className="h-9 w-full rounded-field border border-line bg-surface pl-9 pr-3 text-sm outline-none focus:border-primary"
            />
          </span>
        </div>

        {visible.length === 0 ? (
          <EmptyState title={q ? "No pipeline matches that search" : "No pipelines yet"} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[46rem] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-caption text-ink-3">
                  <th className="w-10 px-3 py-2" />
                  <th className="w-12 px-2 py-2 font-semibold">#</th>
                  <th className="px-2 py-2 font-semibold">Pipeline name</th>
                  <th className="w-32 px-2 py-2 text-right font-semibold">Total stages</th>
                  <th className="w-44 px-2 py-2 font-semibold">Updated on</th>
                  <th className="w-20 px-3 py-2 text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((row, i) => (
                  <tr
                    key={row.id}
                    // Drag targets are wired even while a search is narrowing the table, because
                    // the reorder above operates on the full order, not the filtered slice.
                    onDragOver={canConfigure ? (e) => e.preventDefault() : undefined}
                    onDrop={canConfigure ? () => onDropRow(row.id) : undefined}
                    className={`border-b border-line last:border-0 hover:bg-surface-2 ${dragId === row.id ? "opacity-40" : ""}`}
                  >
                    <td className="px-3 py-2.5">
                      {canConfigure && !row.isDefault ? (
                        <span
                          draggable
                          onDragStart={() => setDragId(row.id)}
                          onDragEnd={() => setDragId(null)}
                          title="Drag to reorder"
                          className="inline-flex cursor-grab text-ink-3 active:cursor-grabbing"
                        >
                          <GripVertical size={15} />
                        </span>
                      ) : (
                        <span className="inline-block w-[15px]" />
                      )}
                    </td>
                    <td className="px-2 py-2.5 tnum text-ink-3">{i + 1}</td>
                    <td className="px-2 py-2.5">
                      <Link
                        href={`/opportunities?pipeline=${row.id}`}
                        className="font-medium text-primary hover:underline"
                      >
                        {row.name}
                      </Link>
                      {row.isDefault && (
                        <span className="ml-2 align-middle">
                          <Pill tone="neutral" title="New leads are filed onto this board automatically">Default</Pill>
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-2.5 text-right tnum text-ink-2">{row.stageCount}</td>
                    <td className="px-2 py-2.5 text-ink-2"><DateText date={row.updatedAt} /></td>
                    <td className="px-3 py-2.5 text-right">
                      <span className="relative inline-block">
                        <button
                          type="button"
                          aria-label={`Actions for ${row.name}`}
                          aria-haspopup="menu"
                          aria-expanded={menuFor === row.id}
                          onClick={(e) => { e.stopPropagation(); setMenuFor(menuFor === row.id ? null : row.id); }}
                          className="rounded p-1 text-ink-3 hover:bg-surface-2 hover:text-ink"
                        >
                          <MoreVertical size={16} />
                        </button>
                        {menuFor === row.id && (
                          <div
                            role="menu"
                            onClick={(e) => e.stopPropagation()}
                            className="absolute right-0 z-20 mt-1 w-48 rounded-field border border-line bg-surface py-1 text-left shadow-card"
                          >
                            <MenuItem icon={<LayoutGrid size={14} />} onClick={() => router.push(`/opportunities?pipeline=${row.id}`)}>
                              Open board
                            </MenuItem>
                            {canConfigure && (
                              <MenuItem icon={<Pencil size={14} />} onClick={() => { setRenameError(null); setMenuFor(null); setRenaming(row); }}>
                                Rename
                              </MenuItem>
                            )}
                            {canConfigure && !row.isDefault && (
                              <MenuItem icon={<Trash2 size={14} />} danger onClick={() => { setMenuFor(null); void remove(row); }}>
                                Delete
                              </MenuItem>
                            )}
                          </div>
                        )}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Create pipeline" size="sm">
        <form action={add} className="space-y-4">
          <Field label="Pipeline name">
            <TextInput name="name" required autoFocus placeholder="e.g. Partnerships" />
          </Field>
          <p className="text-caption text-muted">It starts with one stage — add the rest from the board.</p>
          <FormError message={addError} />
          <SubmitButton>Create</SubmitButton>
        </form>
      </Modal>

      <Modal open={!!renaming} onClose={() => setRenaming(null)} title="Rename pipeline" size="sm">
        <form action={saveRename} className="space-y-4">
          <Field label="Pipeline name">
            <TextInput name="name" required autoFocus defaultValue={renaming?.name ?? ""} />
          </Field>
          <FormError message={renameError} />
          <SubmitButton>Save</SubmitButton>
        </form>
      </Modal>
    </div>
  );
}

function MenuItem({
  icon, children, onClick, danger = false,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={`flex w-full items-center gap-2 px-3 py-1.5 text-sm hover:bg-surface-2 ${danger ? "text-bad" : "text-ink-2"}`}
    >
      {icon}
      {children}
    </button>
  );
}

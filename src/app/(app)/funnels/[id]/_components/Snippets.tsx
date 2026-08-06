"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Library, Lock, Trash2 } from "lucide-react";
import type { Block } from "@/lib/sites-types";
import { withFreshIds } from "@/lib/page-tree";
import type { SnippetRow } from "@/server/snippets-metrics";
import { Modal } from "@/components/ui/Modal";
import { Btn, IconButton } from "@/components/ui/controls";
import { toast, askConfirm } from "@/components/ui/feedback";
import { deleteSnippet, saveSnippet } from "@/server/snippets-actions";
import SiteBlocks from "@/components/sites/SiteBlocks";

/**
 * The section library and page templates, as the builder sees them.
 *
 * One picker for both, keyed on `scope`, because they are the same thing at two sizes: a saved
 * fragment you drop into a page, and a saved page you start one from. Two components would have
 * meant two grids, two delete paths and two places to fix a preview.
 */

const inputCls = "h-9 w-full rounded-field border border-line bg-surface px-3 text-sm outline-none focus:border-primary";
const labelCls = "block text-caption font-semibold uppercase tracking-wide text-ink-3";

/**
 * A live thumbnail of what the snippet actually is.
 *
 * The real renderer at a third of the size, rather than an icon or a name in a list. A library of
 * fourteen entries called "Hero — headline and CTA" is a library nobody browses; what people
 * recognise is the shape of the band. `pointer-events-none` because this is a picture of a page,
 * not a page — a link inside it must not be clickable.
 */
function Thumb({ blocks }: { blocks: Block[] }) {
  return (
    <div className="pointer-events-none h-[132px] overflow-hidden rounded-t-[11px] border-b border-line bg-surface">
      <div className="w-[300%] origin-top-left scale-[.333]">
        <SiteBlocks blocks={blocks} forms={{}} />
      </div>
    </div>
  );
}

export function SnippetPicker({
  open,
  onClose,
  snippets,
  scope,
  onInsert,
}: {
  open: boolean;
  onClose: () => void;
  snippets: SnippetRow[];
  scope: "SECTION" | "PAGE";
  /** Receives blocks that have ALREADY been re-keyed — the caller can splice them in as they are. */
  onInsert: (blocks: Block[], snippet: SnippetRow) => void;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = snippets
      .filter((s) => s.scope === scope)
      .filter((s) => !q || s.name.toLowerCase().includes(q) || s.category.toLowerCase().includes(q));
    const byCategory = new Map<string, SnippetRow[]>();
    for (const r of rows) byCategory.set(r.category, [...(byCategory.get(r.category) ?? []), r]);
    return [...byCategory.entries()];
  }, [snippets, scope, query]);

  async function remove(s: SnippetRow) {
    if (!(await askConfirm({ title: `Delete "${s.name}" from the library?`, body: "Pages already using it keep their copy — only the saved original goes.", danger: true }))) return;
    const res = await deleteSnippet(s.id);
    if (res.ok) { toast("Removed from the library"); router.refresh(); } else toast(res.error, "error");
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={scope === "PAGE" ? "Start from a template" : "Section library"}
      subtitle={scope === "PAGE" ? "A whole page to build on. Everything in it stays editable." : "Drop a ready-made band into the page you're editing."}
    >
      <div className="space-y-4">
        <input className={inputCls} placeholder="Search the library…" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />

        {groups.length === 0 ? (
          <p className="py-8 text-center text-sm text-ink-3">
            {query ? "Nothing matches that." : scope === "PAGE" ? "No page templates saved yet." : "No saved sections yet — build a band, then use “Save as section”."}
          </p>
        ) : (
          groups.map(([category, rows]) => (
            <div key={category} className="space-y-2">
              <p className={labelCls}>{category}</p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {rows.map((s) => (
                  <div key={s.id} className="group overflow-hidden rounded-card border border-line bg-surface-2 transition-shadow hover:shadow-card">
                    <Thumb blocks={s.blocks} />
                    <div className="flex items-center gap-2 px-3 py-2.5">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-ink">{s.name}</p>
                        <p className="text-caption text-ink-3">
                          {s.nodeCount} {s.nodeCount === 1 ? "block" : "blocks"}
                          {s.builtIn && " · built-in"}
                        </p>
                      </div>
                      {s.builtIn ? (
                        <span title="Built-in — can't be deleted" className="text-ink-3"><Lock size={13} /></span>
                      ) : (
                        <IconButton label={`Delete ${s.name}`} onClick={() => remove(s)}><Trash2 size={13} /></IconButton>
                      )}
                      <Btn size="sm" onClick={() => { onInsert(withFreshIds(s.blocks), s); onClose(); }}>
                        {scope === "PAGE" ? "Use" : "Insert"}
                      </Btn>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </Modal>
  );
}

/**
 * Save a selection — one node, or a whole page — into the library.
 *
 * `category` is free text with the existing ones offered as a datalist rather than a fixed
 * dropdown: the team's own grouping ("Nurture", "Webinar") should not need a migration, and an
 * enum here would have guaranteed one within a month.
 */
export function SaveSnippetDialog({
  open,
  onClose,
  blocks,
  scope,
  defaultName,
  categories,
}: {
  open: boolean;
  onClose: () => void;
  blocks: Block[];
  scope: "SECTION" | "PAGE";
  defaultName: string;
  categories: string[];
}) {
  const router = useRouter();
  const [name, setName] = useState(defaultName);
  const [category, setCategory] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    const res = await saveSnippet({ name, category, scope, blocks });
    setBusy(false);
    if (!res.ok) return toast(res.error, "error");
    toast(scope === "PAGE" ? "Saved to templates" : "Saved to the section library");
    onClose();
    router.refresh();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title={scope === "PAGE" ? "Save this page as a template" : "Save this section"}
      subtitle="It becomes available in every funnel, for everyone."
    >
      <div className="space-y-3">
        <label className={labelCls}>
          Name
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="Hero with countdown" autoFocus />
        </label>
        <label className={labelCls}>
          Group
          <input className={inputCls} list="snippet-categories" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Hero, Social proof, Closing…" />
          <datalist id="snippet-categories">
            {categories.map((c) => <option key={c} value={c} />)}
          </datalist>
        </label>
        <p className="text-caption text-ink-3">
          {blocks.length} {blocks.length === 1 ? "block" : "blocks"} will be copied. The page you are editing is not affected.
        </p>
        <div className="flex justify-end gap-2 pt-1">
          <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
          <Btn icon={<Library size={15} />} onClick={submit} disabled={busy || !name.trim()}>Save</Btn>
        </div>
      </div>
    </Modal>
  );
}

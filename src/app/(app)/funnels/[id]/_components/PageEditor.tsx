"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Monitor, Smartphone, Undo2, Redo2, Plus, List, Library } from "lucide-react";
import type { Block, BlockType, NodeStyle } from "@/lib/sites-types";
import { blockLabel } from "@/lib/sites-types";
import {
  appendChild, cloneNode, findAncestors, findNode, insertAfter, makeNode, moveNode, nudge,
  removeNode, updateNode,
} from "@/lib/page-tree";
import type { SnippetRow } from "@/server/snippets-metrics";
import { Btn, IconButton } from "@/components/ui/controls";
import Canvas from "./Canvas";
import Inspector from "./Inspector";
import { SaveSnippetDialog, SnippetPicker } from "./Snippets";
import type { StepCalendars } from "@/server/booking-calendars";

/**
 * The page editor: a canvas of the real page, an inspector for the selected node, and the
 * history that makes experimenting safe.
 *
 * Replaces a 15,000-pixel form of nested textareas. The difference is not cosmetic — with the
 * form you edited a tree and imagined the page; here you point at the thing you want to change.
 *
 * ── History ────────────────────────────────────────────────────────────────────
 * Undo is a stack of whole previous roots, not a diff log. The trees are small (a big landing
 * page is ~100 nodes of plain JSON) and every operation in `page-tree` already returns a fresh
 * root, so snapshotting is free and cannot desynchronise the way replayed diffs can.
 *
 * Typing is COALESCED: a text edit that lands within a second of the previous one replaces the
 * top of the stack instead of pushing to it. Without that, undo walks back one keystroke at a
 * time and is useless for the thing people most want to undo.
 */

const PALETTE: BlockType[] = [
  "section", "row", "card",
  "heading", "subheading", "eyebrow", "text", "bullets", "stat", "pill", "avatar", "dot",
  "image", "video", "button", "form", "booking",
  "divider", "spacer", "html",
];

const COALESCE_MS = 1000;

export default function PageEditor({
  blocks,
  onChange,
  forms,
  calendars,
  snippets,
  snippetCategories,
  chromeBefore,
  chromeAfter,
}: {
  blocks: Block[];
  onChange: (b: Block[]) => void;
  forms: { id: string; name: string }[];
  /** Real open slots per booking-block owner, forwarded to the canvas. */
  calendars: StepCalendars;
  /** The section library. Empty is a valid state — the picker says so rather than hiding. */
  snippets: SnippetRow[];
  snippetCategories: string[];
  /** The funnel's global header/footer, drawn around the canvas as context. See Canvas. */
  chromeBefore?: Block[];
  chromeAfter?: Block[];
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [showPalette, setShowPalette] = useState(false);
  const [showLibrary, setShowLibrary] = useState(false);
  /** The subtree queued for "Save as section" — held here so the dialog survives a deselect. */
  const [saving, setSaving] = useState<Block[] | null>(null);
  const past = useRef<Block[][]>([]);
  const future = useRef<Block[][]>([]);
  const lastPush = useRef(0);

  /**
   * Commit a new tree.
   *
   * `coalesce` is passed by the text fields: consecutive keystrokes collapse into one history
   * entry. Anything structural (add, delete, move) always pushes, because those are exactly the
   * actions someone reaches for undo after.
   */
  const commit = useCallback(
    (next: Block[], coalesce = false) => {
      const now = Date.now();
      if (coalesce && now - lastPush.current < COALESCE_MS && past.current.length) {
        // Keep the snapshot already on the stack — it predates this burst of typing.
      } else {
        past.current.push(blocks);
        if (past.current.length > 100) past.current.shift();
      }
      lastPush.current = now;
      future.current = [];
      onChange(next);
    },
    [blocks, onChange],
  );

  const undo = useCallback(() => {
    const prev = past.current.pop();
    if (!prev) return;
    future.current.push(blocks);
    onChange(prev);
  }, [blocks, onChange]);

  const redo = useCallback(() => {
    const next = future.current.pop();
    if (!next) return;
    past.current.push(blocks);
    onChange(next);
  }, [blocks, onChange]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const k = e.key.toLowerCase();
      if (k === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
      else if ((k === "z" && e.shiftKey) || k === "y") { e.preventDefault(); redo(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  const selected = selectedId ? findNode(blocks, selectedId) : null;
  const ancestors = selectedId ? findAncestors(blocks, selectedId) ?? [] : [];

  /**
   * Where a new block lands: inside the selection if it can hold children, otherwise directly
   * after it, otherwise at the end of the page. Silently appending to the document end — which
   * is what the old builder did — meant scrolling to the bottom to find what you just added.
   */
  function addBlock(type: BlockType) {
    const node = makeNode(type);
    let next: Block[];
    if (selected && (selected.type === "section" || selected.type === "row" || selected.type === "column" || selected.type === "card")) {
      next = appendChild(blocks, selected.id, node);
    } else if (selected) {
      next = insertAfter(blocks, selected.id, node);
    } else {
      next = [...blocks, node];
    }
    commit(next);
    setSelectedId(node.id);
    setShowPalette(false);
  }

  /**
   * Drop a saved section in, following the same placement rule as a new block: into the selection
   * if it can hold children, otherwise after it, otherwise at the end.
   *
   * Ids are already fresh (`SnippetPicker` re-keys on the way out), so inserting the same section
   * twice gives two independent copies.
   */
  function insertSnippet(nodes: Block[]) {
    let next = blocks;
    if (selected && (selected.type === "section" || selected.type === "row" || selected.type === "column" || selected.type === "card")) {
      for (const n of nodes) next = appendChild(next, selected.id, n);
    } else if (selected) {
      // Reversed, because each node is inserted directly after the SAME anchor — walking forwards
      // would land the library's sections on the page in the opposite order to the preview.
      for (const n of [...nodes].reverse()) next = insertAfter(next, selected.id, n);
    } else {
      next = [...blocks, ...nodes];
    }
    commit(next);
    setSelectedId(nodes[0]?.id ?? null);
  }

  function patch(p: Partial<Block>, coalesce = false) {
    if (!selectedId) return;
    commit(updateNode(blocks, selectedId, p), coalesce);
  }

  function patchStyle(p: Partial<NodeStyle>) {
    if (!selected) return;
    const key = device === "mobile" ? "styleMobile" : "style";
    const merged = { ...(selected[key] ?? {}), ...p };
    // Drop keys set back to undefined so an unset override doesn't linger as `{fontSize:
    // undefined}` — which would serialise into the page JSON as noise forever.
    for (const k of Object.keys(merged) as (keyof NodeStyle)[]) if (merged[k] === undefined) delete merged[k];
    commit(updateNode(blocks, selected.id, { [key]: merged }));
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 rounded-card border border-line bg-surface px-2.5 py-2">
        <Btn size="sm" icon={<Plus size={14} />} onClick={() => setShowPalette((v) => !v)}>Add block</Btn>
        <Btn size="sm" variant="soft" icon={<Library size={14} />} onClick={() => setShowLibrary(true)}>Library</Btn>
        <span className="text-caption text-ink-3">
          {selected ? `Adding into: ${blockLabel(selected.type)}` : "Click anything on the page to edit it"}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <IconButton label="Undo (Ctrl+Z)" onClick={undo}><Undo2 size={15} /></IconButton>
          <IconButton label="Redo (Ctrl+Shift+Z)" onClick={redo}><Redo2 size={15} /></IconButton>
          <span className="mx-1 h-5 w-px bg-line" />
          <IconButton label="Desktop view" onClick={() => setDevice("desktop")}>
            <Monitor size={15} className={device === "desktop" ? "text-primary" : undefined} />
          </IconButton>
          <IconButton label="Phone view" onClick={() => setDevice("mobile")}>
            <Smartphone size={15} className={device === "mobile" ? "text-primary" : undefined} />
          </IconButton>
        </div>
      </div>

      {showPalette && (
        <div className="flex flex-wrap gap-1.5 rounded-card border border-line bg-surface-2 p-2.5">
          {PALETTE.map((t) => (
            <Btn key={t} size="sm" variant="ghost" icon={<Plus size={13} />} onClick={() => addBlock(t)}>
              {blockLabel(t)}
            </Btn>
          ))}
        </div>
      )}

      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <Canvas
            blocks={blocks}
            forms={{}}
            calendars={calendars}
            selectedId={selectedId}
            onSelect={setSelectedId}
            device={device}
            onMove={(dragId, targetId, mode) => commit(moveNode(blocks, dragId, targetId, mode))}
            // Typed straight into the page. Coalesced in history like the inspector's text field,
            // so one edit of a headline is one undo — not one per keystroke.
            onEditText={(id, text) => commit(updateNode(blocks, id, { text }), true)}
            chromeBefore={chromeBefore}
            chromeAfter={chromeAfter}
          />
        </div>

        {selected ? (
          <Inspector
            node={selected}
            device={device}
            forms={forms}
            breadcrumb={ancestors}
            onSelect={setSelectedId}
            onPatch={(p) => patch(p, typeof p.text === "string" || typeof p.html === "string")}
            onPatchStyle={patchStyle}
            onDuplicate={() => {
              const copy = cloneNode(selected);
              commit(insertAfter(blocks, selected.id, copy));
              setSelectedId(copy.id);
            }}
            onDelete={() => { commit(removeNode(blocks, selected.id)); setSelectedId(null); }}
            onNudge={(dir) => commit(nudge(blocks, selected.id, dir))}
            onClose={() => setSelectedId(null)}
            // The whole subtree, not just the node: a section is worth saving precisely because
            // of what is inside it.
            onSaveAsSection={() => setSaving([selected])}
          />
        ) : (
          <aside className="hidden w-[320px] flex-none rounded-card border border-dashed border-line p-4 text-sm text-ink-3 lg:block">
            <List size={18} className="mb-2 text-ink-3" />
            Click any part of the page to select it. The panel that opens here edits its content and
            styling, and has a separate set of values for the phone view.
          </aside>
        )}
      </div>

      <SnippetPicker
        open={showLibrary}
        onClose={() => setShowLibrary(false)}
        snippets={snippets}
        scope="SECTION"
        onInsert={insertSnippet}
      />
      <SaveSnippetDialog
        open={saving !== null}
        onClose={() => setSaving(null)}
        blocks={saving ?? []}
        scope="SECTION"
        defaultName={saving?.[0] ? blockLabel(saving[0].type) : "Section"}
        categories={snippetCategories}
      />
    </div>
  );
}

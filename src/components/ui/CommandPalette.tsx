"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, Loader2, Contact, GitBranch, Receipt, CornerDownLeft, ArrowRight } from "lucide-react";
import { useModKey } from "@/lib/use-mod-key";

/**
 * Global ⌘K / Ctrl+K command palette (BUILD_CHECKLIST.md §3) across Contacts, Opportunities and
 * Invoices. A lighter custom overlay rather than the shared `Modal` — Modal's focus-trap and
 * fixed title/subtitle header are built for entry forms, not a searchable list where arrow keys
 * need to move a selection and Enter needs to navigate rather than submit.
 *
 * Decoupled from its trigger the same way `feedback.tsx` decouples `toast()`/`askConfirm()` from
 * `<FeedbackHost />`: `openCommandPalette()` dispatches a window event, so AppShell's top-bar
 * button doesn't need to hold this component's state.
 */

export function openCommandPalette() {
  window.dispatchEvent(new Event("app:command-palette-open"));
}

type ItemType = "page" | "contact" | "opportunity" | "invoice";
type PaletteItem = { id: string; label: string; sublabel: string | null; type: ItemType; href: string };
export type PaletteSection = { label: string; href: string };

const TYPE_LABEL: Record<ItemType, string> = {
  page: "Go to",
  contact: "Contacts",
  opportunity: "Opportunities",
  invoice: "Invoices",
};
const TYPE_ICON: Record<ItemType, typeof Contact> = {
  page: ArrowRight,
  contact: Contact,
  opportunity: GitBranch,
  invoice: Receipt,
};
// Fixed render order so the same categories always land in the same place.
const TYPE_ORDER: ItemType[] = ["page", "contact", "opportunity", "invoice"];

/** Cheap fuzzy score: prefix match beats substring beats subsequence beats no match (-1). */
function score(item: PaletteItem, q: string): number {
  const label = item.label.toLowerCase();
  const sub = (item.sublabel ?? "").toLowerCase();
  if (label.startsWith(q)) return 100;
  if (label.includes(q)) return 80;
  if (sub.startsWith(q)) return 60;
  if (sub.includes(q)) return 50;
  let qi = 0;
  for (let i = 0; i < label.length && qi < q.length; i++) if (label[i] === q[qi]) qi++;
  return qi === q.length ? 20 : -1;
}

export function CommandPalette({ sections = [] }: { sections?: PaletteSection[] }) {
  const router = useRouter();
  const { modLabel } = useModKey();
  const [open, setOpen] = useState(false);
  // Navigable destinations — the sections this user can actually see. Local, so ⌘K can
  // jump anywhere the instant it opens, even before the record index has loaded.
  const sectionItems = useMemo<PaletteItem[]>(
    () =>
      sections.map((s) => ({ id: `page:${s.href}`, label: s.label, sublabel: null, type: "page", href: s.href })),
    [sections],
  );
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [items, setItems] = useState<PaletteItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Global trigger: Cmd/Ctrl+K toggles, Esc closes, plus the decoupled open event from AppShell.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    };
    const onOpenEvent = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("app:command-palette-open", onOpenEvent);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("app:command-palette-open", onOpenEvent);
    };
  }, []);

  // Refetch the summary list on EVERY open, not just the first: a rep who creates a
  // contact at 9am must be able to find it at 11am without a full page reload. The
  // previous `items` stay on screen during the refetch (no flash to empty), and the
  // request is cancelled if the palette closes before it resolves.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch("/api/command-palette")
      .then((r) => {
        if (!r.ok) throw new Error("request failed");
        return r.json();
      })
      .then((data: { items: PaletteItem[] }) => {
        if (!cancelled) setItems(data.items);
      })
      .catch(() => {
        if (!cancelled) setError("Couldn't load search results. Try again.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIndex(0);
      const t = setTimeout(() => inputRef.current?.focus(), 0);
      const prevOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        clearTimeout(t);
        document.body.style.overflow = prevOverflow;
      };
    }
  }, [open]);

  const results = useMemo(() => {
    // Nav sections are always available; record results merge in once fetched.
    const all = [...sectionItems, ...(items ?? [])];
    const q = query.trim().toLowerCase();
    if (!q) return all.slice(0, 50);
    return all
      .map((item) => ({ item, s: score(item, q) }))
      .filter((x) => x.s >= 0)
      .sort((a, b) => b.s - a.s || a.item.label.localeCompare(b.item.label))
      .slice(0, 50)
      .map((x) => x.item);
  }, [sectionItems, items, query]);

  useEffect(() => setActiveIndex(0), [query]);

  function go(item: PaletteItem) {
    setOpen(false);
    router.push(item.href);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = results[activeIndex];
      if (item) go(item);
    }
  }

  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  if (!open) return null;

  // Group by type, in a fixed, stable order — only render groups that have matches.
  const groups = TYPE_ORDER
    .map((type) => ({ type, rows: results.filter((r) => r.type === type) }))
    .filter((g) => g.rows.length > 0);

  let runningIndex = -1;

  return (
    <div className="fixed inset-0 z-[95] flex items-start justify-center p-4 pt-[12vh]" role="dialog" aria-modal="true" aria-label="Search">
      <div aria-hidden className="overlay-in glass-scrim absolute inset-0" onClick={() => setOpen(false)} />
      <div className="dialog-in glass-modal relative flex max-h-[70vh] w-full max-w-xl flex-col overflow-hidden rounded-card">
        <div className="flex items-center gap-2.5 border-b border-line px-4">
          <Search size={17} className="flex-none text-muted" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search contacts, opportunities, invoices…"
            aria-label="Search contacts, opportunities, invoices"
            aria-activedescendant={results[activeIndex] ? `cmdk-item-${activeIndex}` : undefined}
            role="combobox"
            aria-expanded
            aria-controls="cmdk-list"
            autoComplete="off"
            className="h-14 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-muted"
          />
          {loading && <Loader2 size={16} className="flex-none animate-spin text-muted" />}
        </div>
        <div id="cmdk-list" ref={listRef} className="flex-1 overflow-y-auto p-2">
          {error && <p className="px-3 py-4 text-sm text-risk">{error}</p>}
          {!error && !loading && results.length === 0 && query.trim() && (
            <p className="px-3 py-8 text-center text-sm text-muted">No matches for "{query}".</p>
          )}
          {groups.map((g) => {
            const Icon = TYPE_ICON[g.type];
            return (
              <div key={g.type} className="mb-1 last:mb-0">
                <p className="px-3 pb-1 pt-2 text-label font-semibold uppercase text-ink-3">{TYPE_LABEL[g.type]}</p>
                {g.rows.map((r) => {
                  runningIndex++;
                  const i = runningIndex;
                  const active = i === activeIndex;
                  return (
                    <button
                      key={r.id}
                      id={`cmdk-item-${i}`}
                      data-index={i}
                      type="button"
                      onMouseEnter={() => setActiveIndex(i)}
                      onClick={() => go(r)}
                      className={`flex w-full items-center gap-3 rounded-field px-3 py-2.5 text-left ${
                        active ? "bg-primary-soft text-primary-strong" : "text-ink hover:bg-surface-2"
                      }`}
                    >
                      <Icon size={16} className="flex-none text-ink-3" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{r.label}</span>
                        {r.sublabel && <span className="block truncate text-caption text-ink-3">{r.sublabel}</span>}
                      </span>
                      {active && <CornerDownLeft size={14} className="flex-none text-primary-strong" />}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
        <div className="flex items-center justify-between border-t border-line px-4 py-2 text-caption text-ink-3">
          <span>↑↓ navigate · Enter open · Esc close</span>
          <span>{modLabel}</span>
        </div>
      </div>
    </div>
  );
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Block } from "@/lib/sites-types";
import SiteBlocks from "@/components/sites/SiteBlocks";

/**
 * The editable page surface — the real page, clickable.
 *
 * ── Why this renders `SiteBlocks` rather than a preview of its own ──────────────
 * The whole complaint about the old builder was that you edited a form and hoped. A separate
 * "preview renderer" reintroduces that gap the moment the two drift, and they always drift. So
 * the canvas mounts the SAME component the public page mounts, with the same markup and the same
 * styles. What you click is what ships.
 *
 * That is possible because `SiteBlocks` has no server-only dependency (its one interactive child,
 * `PublicForm`, is already a client component), and because every node it emits carries
 * `data-n={id}`. Selection therefore needs no renderer changes at all: one delegated click
 * handler walks up from the click target to the nearest `[data-n]` and that is the node.
 *
 * ── Overlays are CSS, not wrapper elements ─────────────────────────────────────
 * Outlines are painted by a generated stylesheet keyed on `[data-n="…"]`, never by wrapping nodes
 * in extra divs. Wrapping would change the layout being edited — a flex row's children would gain
 * an intermediate box — so the page you style would not be the page you ship.
 */
/**
 * Node types whose whole content IS their `text`, and which therefore can be typed into directly.
 *
 * Everything else is excluded for a reason, not an oversight: a `bullets` node is a list of
 * items (editing it as one blob would need the newlines re-split, and a stray Enter would silently
 * create an item), a `button`'s visible words are its `label` alongside an `href`, and a `stat`
 * carries two separate strings. Those stay in the inspector, where the structure is explicit.
 */
const EDITABLE = new Set(["heading", "subheading", "eyebrow", "text"]);

export default function Canvas({
  blocks,
  forms,
  selectedId,
  onSelect,
  onMove,
  onEditText,
  device,
  chromeBefore,
  chromeAfter,
}: {
  blocks: Block[];
  forms: Record<string, never>;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onMove: (dragId: string, targetId: string, mode: "before" | "after" | "inside") => void;
  /** Commit inline-edited copy. Omit to make the canvas read-only. */
  onEditText?: (id: string, text: string) => void;
  device: "desktop" | "mobile";
  /**
   * The funnel's global header and footer, drawn around the page but NOT part of it.
   *
   * Shown because a page is composed against its chrome — a hero with 88px of top padding looks
   * wrong under a logo bar and right without one, and editing it in isolation means discovering
   * that only after publishing. They are inert: `pointer-events-none` means a click lands on the
   * sheet behind them, `idAt` returns null, and the selection clears. That is the correct
   * behaviour rather than a limitation — these nodes are not in `blocks`, so selecting one would
   * open an inspector onto a node no edit here could ever save.
   */
  chromeBefore?: Block[];
  chromeAfter?: Block[];
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropHint, setDropHint] = useState<{ id: string; mode: "before" | "after" | "inside" } | null>(null);

  /** The node id under a pointer event, or null when the click landed on the page background. */
  const idAt = useCallback((e: { target: EventTarget | null }): string | null => {
    const el = (e.target as HTMLElement | null)?.closest?.("[data-n]") as HTMLElement | null;
    return el?.dataset?.n ?? null;
  }, []);

  // Escape clears the selection — the standard way out of a canvas, and it costs one listener.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onSelect(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onSelect]);

  /**
   * Inline text editing — type on the page, as in Synamate.
   *
   * ── Why this reaches into the DOM instead of rendering `contentEditable` ───────
   * `SiteBlocks` is the production renderer and must stay free of editor concerns; threading an
   * `editing` prop through it would put builder logic on the public page. So the effect flips the
   * attribute on the selected node's element and takes it off again on deselect. Nothing about
   * the rendered output changes.
   *
   * ── Why it commits on BLUR, not on every keystroke ────────────────────────────
   * Committing per keypress re-renders the very element being typed into, and React replacing a
   * contentEditable's children drops the caret to position zero — you would type the first
   * letter, then watch every subsequent one land backwards. Committing on blur means no re-render
   * happens mid-edit, so the caret is React's business exactly never.
   *
   * `innerText`, not `textContent`: the former respects the line breaks a user actually pressed
   * Enter for, which is what the `whitespace-pre-wrap` paragraphs then render back.
   */
  useEffect(() => {
    if (!selectedId || !onEditText) return;
    const el = hostRef.current?.querySelector<HTMLElement>(`[data-n="${cssId(selectedId)}"]`);
    if (!el || !EDITABLE.has(el.dataset.t ?? "")) return;

    el.contentEditable = "true";
    el.spellcheck = false;
    el.style.cursor = "text";
    el.focus();

    const commit = () => onEditText(selectedId, el.innerText.trimEnd());
    // Enter inserts a line break; Escape abandons the edit by dropping focus.
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") el.blur(); };
    el.addEventListener("blur", commit);
    el.addEventListener("keydown", onKey);
    return () => {
      el.removeEventListener("blur", commit);
      el.removeEventListener("keydown", onKey);
      el.contentEditable = "false";
      el.style.cursor = "";
    };
  }, [selectedId, onEditText, blocks]);

  /**
   * Drop position from the pointer's place within the target.
   *
   * Top/bottom fifths mean "beside this node"; the middle means "inside it" but only for a
   * container — offering "inside" for a heading would promise a nesting the model cannot express.
   */
  function dropModeFor(el: HTMLElement, clientY: number, isContainerTarget: boolean): "before" | "after" | "inside" {
    const r = el.getBoundingClientRect();
    const edge = Math.max(8, r.height * 0.2);
    if (clientY < r.top + edge) return "before";
    if (clientY > r.bottom - edge) return "after";
    return isContainerTarget ? "inside" : clientY < r.top + r.height / 2 ? "before" : "after";
  }

  const overlayCss = [
    // Every node gets a hairline on hover of the canvas, so the structure is discoverable without
    // clicking blindly — this is what the form-based builder could never show.
    `[data-n]{outline-offset:-1px}`,
    hoverId && hoverId !== selectedId ? `[data-n="${cssId(hoverId)}"]{outline:1px dashed var(--primary)!important}` : "",
    selectedId ? `[data-n="${cssId(selectedId)}"]{outline:2px solid var(--primary)!important}` : "",
    dropHint?.mode === "inside" ? `[data-n="${cssId(dropHint.id)}"]{background:var(--primary-soft)!important}` : "",
    dropHint && dropHint.mode !== "inside"
      ? `[data-n="${cssId(dropHint.id)}"]{box-shadow:0 ${dropHint.mode === "before" ? "-3px" : "3px"} 0 0 var(--primary) inset!important}`
      : "",
    dragId ? `[data-n="${cssId(dragId)}"]{opacity:.4}` : "",
  ].filter(Boolean).join("");

  return (
    <div className="min-h-[60vh] overflow-auto rounded-card border border-line bg-app p-4">
      <div
        className="mx-auto bg-surface shadow-soft transition-[max-width] duration-200"
        style={{ maxWidth: device === "mobile" ? 390 : "100%" }}
      >
        <style dangerouslySetInnerHTML={{ __html: overlayCss }} />
        <div
          ref={hostRef}
          // The canvas is a click surface, not a control: nodes inside it are the interactive
          // things. A keyboard user reaches them through the layer panel, which IS focusable.
          onClickCapture={(e) => {
            // Capture phase, and prevented: a page's own links and form buttons must not navigate
            // or submit while being edited. Clicking a CTA should select it, not leave the builder.
            e.preventDefault();
            e.stopPropagation();
            onSelect(idAt(e));
          }}
          onMouseOver={(e) => setHoverId(idAt(e))}
          onMouseLeave={() => setHoverId(null)}
          onDragStart={(e) => {
            const id = idAt(e);
            if (!id) return;
            setDragId(id);
            e.dataTransfer.effectAllowed = "move";
            // Firefox refuses to start a drag without data on the transfer.
            e.dataTransfer.setData("text/plain", id);
          }}
          onDragOver={(e) => {
            if (!dragId) return;
            e.preventDefault();
            const el = (e.target as HTMLElement)?.closest?.("[data-n]") as HTMLElement | null;
            const id = el?.dataset?.n;
            if (!el || !id || id === dragId) return setDropHint(null);
            // Read the type straight off the DOM (data-t) rather than re-walking the block tree.
            const containerish = /^(section|row|column|card)$/.test(el.dataset.t ?? "");
            setDropHint({ id, mode: dropModeFor(el, e.clientY, containerish) });
          }}
          onDrop={(e) => {
            e.preventDefault();
            if (dragId && dropHint) onMove(dragId, dropHint.id, dropHint.mode);
            setDragId(null);
            setDropHint(null);
          }}
          onDragEnd={() => { setDragId(null); setDropHint(null); }}
        >
          <Chrome blocks={chromeBefore} label="Global header — edit it on the Header tab" />
          <SiteBlocks blocks={blocks} forms={forms} />
          <Chrome blocks={chromeAfter} label="Global footer — edit it on the Footer tab" />
        </div>
      </div>
    </div>
  );
}

/**
 * A band of the funnel's global chrome, drawn around the page being edited.
 *
 * Dimmed and captioned so it is unmistakably context rather than content. It renders the real
 * blocks through the real renderer — a sketched placeholder would be one more thing to drift out
 * of step with what actually ships.
 */
function Chrome({ blocks, label }: { blocks?: Block[]; label: string }) {
  if (!blocks?.length) return null;
  return (
    <div className="pointer-events-none relative select-none opacity-55 grayscale-[.35]">
      <span className="absolute right-2 top-2 z-10 rounded-full bg-ink/75 px-2 py-0.5 text-[11px] font-semibold text-surface">
        {label}
      </span>
      <SiteBlocks blocks={blocks} forms={{}} />
    </div>
  );
}

/** Ids come from stored page JSON; a quote or brace would let one close the selector. */
function cssId(id: string): string {
  return id.replace(/[^A-Za-z0-9_-]/g, "");
}

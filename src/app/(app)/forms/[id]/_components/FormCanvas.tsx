"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FormItem, FormSettings } from "@/lib/sites-types";
import type { PublicForm as PublicFormType } from "@/server/forms-metrics";
import PublicForm from "@/components/sites/PublicForm";

/**
 * The editable form surface — the real form, clickable.
 *
 * ── Why this mounts `PublicForm` rather than drawing a preview of its own ──────────────────────
 * The same argument as the page builder's canvas: a separate preview renderer reintroduces the
 * gap between what you edit and what ships the moment the two drift, and they always drift. So
 * the canvas mounts the SAME component the public page mounts, with the same markup, the same
 * validation and the same branching. What you click is what a respondent gets.
 *
 * That works because every question `PublicForm` emits carries `data-item`. Selection therefore
 * needs no renderer changes at all: one delegated click walks up from the target to the nearest
 * `[data-item]` and that is the field.
 *
 * ── Outlines are CSS, not wrapper elements ────────────────────────────────────────────────────
 * The selection ring is painted by a generated stylesheet keyed on `[data-item="…"]`, never by
 * wrapping fields in extra divs — wrapping would change the layout being edited.
 *
 * ── Clicks never reach the form ───────────────────────────────────────────────────────────────
 * Captured and prevented at the host: typing into a preview of a field, or submitting the form
 * from the builder, is never what an author meant by clicking it.
 */

export default function FormCanvas({
  items,
  settings,
  name,
  slug,
  selectedId,
  onSelect,
  device,
}: {
  items: FormItem[];
  settings: FormSettings;
  name: string;
  slug: string;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  device: "desktop" | "mobile";
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);

  const idAt = useCallback((e: { target: EventTarget | null }): string | null => {
    const el = (e.target as HTMLElement | null)?.closest?.("[data-item]") as HTMLElement | null;
    return el?.dataset?.item ?? null;
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onSelect(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onSelect]);

  /**
   * The form as the public renderer wants it.
   *
   * Rebuilt from the DRAFT on every keystroke, so the canvas reflects unsaved edits — a preview
   * that only updated on save would be a preview of the last thing you did, not the thing you
   * are doing.
   */
  const preview: PublicFormType = { id: "preview", name, slug, fields: items, settings };

  const css = [
    `[data-item]{outline-offset:2px;border-radius:8px}`,
    hoverId && hoverId !== selectedId ? `[data-item="${cssId(hoverId)}"]{outline:1px dashed var(--primary)}` : "",
    selectedId ? `[data-item="${cssId(selectedId)}"]{outline:2px solid var(--primary)}` : "",
    // Hidden, score and bot-protection fields render as nothing on the live form — correct there,
    // useless here, because an author cannot select what has no box. On the canvas they become a
    // labelled placeholder so the form's invisible machinery is visible to the person building it.
    `[data-item-type="hidden"],[data-item-type="score"],[data-item-type="captcha"]{display:block!important;`
      + `padding:8px 10px;border:1px dashed var(--line);background:var(--surface-2);border-radius:8px}`,
    `[data-item-type="hidden"]::after{content:"Hidden field — carried with the submission, never shown"}`,
    `[data-item-type="score"]::after{content:"Score — worked out from the answers when the form is sent"}`,
    `[data-item-type="captcha"]::after{content:"Bot protection — invisible trap and timing check"}`,
    `[data-item-type="hidden"]::after,[data-item-type="score"]::after,[data-item-type="captcha"]::after{`
      + `font-size:12px;color:var(--ink-3)}`,
    // Undo the sr-only clipping the live renderer applies to the captcha element.
    `[data-item-type="captcha"]{position:static!important;width:auto!important;height:auto!important;`
      + `clip:auto!important;white-space:normal!important}`,
  ].filter(Boolean).join("");

  return (
    <div className="min-h-full overflow-y-auto bg-app p-6">
      <div
        className="mx-auto transition-[max-width] duration-200"
        style={{ maxWidth: device === "mobile" ? 400 : 640 }}
      >
        <style dangerouslySetInnerHTML={{ __html: css }} />
        <div
          ref={hostRef}
          onClickCapture={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onSelect(idAt(e));
          }}
          onMouseOver={(e) => setHoverId(idAt(e))}
          onMouseLeave={() => setHoverId(null)}
        >
          {items.length === 0 ? (
            <div className="rounded-card border border-dashed border-line bg-surface p-10 text-center">
              <p className="text-sm font-medium text-ink-2">This form has no fields yet</p>
              <p className="mt-1 text-caption text-ink-3">Pick something from the Form Element panel on the left.</p>
            </div>
          ) : (
            // `preview` stops the submit button from doing anything, so a click on it in the
            // builder selects rather than posts a fake lead into the pipeline.
            <PublicForm form={preview} preview />
          )}
        </div>
      </div>
    </div>
  );
}

/** Ids come from stored form JSON; a quote or brace would let one close the selector. */
function cssId(id: string): string {
  return id.replace(/[^A-Za-z0-9_-]/g, "");
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  DEFAULT_FIELD_SIZE,
  FIELD_KIND_LABELS,
  SIGNER_LABELS,
  defaultFieldLabel,
  nextFieldId,
  placedBox,
  type DocField,
  type FieldKind,
  type SignerRole,
} from "@/lib/agreement-doc";
import { Btn } from "@/components/ui/controls";
import { Select } from "@/components/ui/form";

/**
 * Place signature boxes on the pages of an uploaded PDF - the Zoho-style half of the designer.
 *
 * ── WHY THE PAGES ARE RENDERED IN THE BROWSER ───────────────────────────────────────────────
 * There is no PDF rasteriser on the server (poppler/LibreOffice are not in the image, and sharp
 * does not decode PDF), so the pages are drawn with pdf.js on a canvas here. The worker is served
 * from `public/pdfjs/` - refresh it with `npm run pdfjs:worker` after a pdfjs-dist bump - and the
 * library itself is imported dynamically so its ~450KB only loads on this screen.
 *
 * ── COORDINATES ─────────────────────────────────────────────────────────────────────────────
 * Boxes are stored as FRACTIONS of the page, from its top-left - never pixels. The canvas is
 * responsive and the same template is marked up on a laptop and checked on a phone, so a pixel
 * would mean something different every time the window changed. `agreement-pdf-overlay` does the
 * one conversion back to PDF points at stamping time.
 *
 * Dragging and resizing use POINTER events with capture, like `SignaturePad`: without capture a
 * drag that leaves the page element mid-gesture silently stops, which feels like the box snapping
 * back for no reason.
 */

type Drag =
  | { mode: "move"; id: string; grabX: number; grabY: number }
  | { mode: "resize"; id: string };

export function PdfFieldCanvas({
  fileUrl,
  fields,
  onFields,
  selectedId,
  onSelect,
  disabled,
}: {
  /** The route serving the stored upload. Session-gated; never a public URL. */
  fileUrl: string;
  fields: DocField[];
  onFields: (next: DocField[]) => void;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  disabled?: boolean;
}) {
  const [pages, setPages] = useState<{ width: number; height: number }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const canvasRefs = useRef<(HTMLCanvasElement | null)[]>([]);

  // What a freshly dropped box is. Chosen once here rather than per click, so dropping several
  // boxes for the same party in a row does not mean re-picking the party every time.
  const [newKind, setNewKind] = useState<FieldKind>("SIGNATURE");
  const [newSigner, setNewSigner] = useState<SignerRole>("STUDENT");

  const drag = useRef<Drag | null>(null);
  const boxRefs = useRef<Record<string, HTMLDivElement | null>>({});

  /**
   * Bring the selected box into view.
   *
   * The field list sits beside a document that can be several pages long, and the fields are
   * commonly all on the LAST one - so clicking "Student signature" used to select a box the
   * founder could not see, on a page they had not scrolled to. Selection and visibility have to
   * be the same thing.
   *
   * `block: "center"` rather than "nearest": a box at the very top or bottom of a tall page is
   * technically in view while being impossible to work with.
   */
  useEffect(() => {
    if (!selectedId) return;
    const el = boxRefs.current[selectedId];
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [selectedId]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        setLoading(true);
        setError(null);
        // Dynamic import: pdf.js must not be in the bundle of any other screen.
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdfjs/pdf.worker.min.mjs";

        const res = await fetch(fileUrl, { cache: "no-store" });
        if (!res.ok) throw new Error(`The document could not be loaded (${res.status}).`);
        const buf = await res.arrayBuffer();
        const doc = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
        if (cancelled) return;

        const sizes: { width: number; height: number }[] = [];
        for (let n = 1; n <= doc.numPages; n++) {
          const page = await doc.getPage(n);
          if (cancelled) return;
          // A fixed render width keeps every page the same size on screen whatever its paper
          // size, and 900px is enough to read 9pt type without making the canvases enormous.
          const base = page.getViewport({ scale: 1 });
          const scale = 900 / base.width;
          const viewport = page.getViewport({ scale });
          sizes.push({ width: viewport.width, height: viewport.height });
          setPages([...sizes]);

          // The canvas for this page exists only after the state above has rendered.
          await new Promise((r) => requestAnimationFrame(() => r(null)));
          const canvas = canvasRefs.current[n - 1];
          if (!canvas) continue;
          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);
          const ctx = canvas.getContext("2d");
          if (!ctx) continue;
          await page.render({ canvas, canvasContext: ctx, viewport }).promise;
        }
        if (!cancelled) setLoading(false);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "The document could not be displayed.");
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [fileUrl]);

  const update = useCallback(
    (id: string, patch: Partial<DocField>) => {
      onFields(fields.map((f) => (f.id === id ? { ...f, ...patch } : f)));
    },
    [fields, onFields],
  );

  /** Click on blank page area → drop a new box, centred on the click. */
  const dropField = (pageNumber: number, event: React.MouseEvent<HTMLDivElement>) => {
    if (disabled) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const size = DEFAULT_FIELD_SIZE[newKind];
    const x = clamp((event.clientX - rect.left) / rect.width - size.w / 2, 0, 1 - size.w);
    const y = clamp((event.clientY - rect.top) / rect.height - size.h / 2, 0, 1 - size.h);
    const field: DocField = {
      id: nextFieldId(fields),
      kind: newKind,
      signer: newSigner,
      page: pageNumber,
      x,
      y,
      w: size.w,
      h: size.h,
    };
    onFields([...fields, field]);
    onSelect(field.id);
  };

  const onPointerDown = (
    id: string,
    mode: Drag["mode"],
    event: React.PointerEvent<HTMLElement>,
  ) => {
    if (disabled) return;
    event.stopPropagation();
    event.preventDefault();
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    onSelect(id);

    const field = fields.find((f) => f.id === id);
    const box = field ? placedBox(field) : null;
    if (!box) return;

    if (mode === "move") {
      const host = event.currentTarget.closest("[data-page]") as HTMLElement | null;
      const rect = host?.getBoundingClientRect();
      drag.current = {
        mode: "move",
        id,
        // Where inside the box the pointer grabbed it, so the box does not jump to the cursor.
        grabX: rect ? (event.clientX - rect.left) / rect.width - box.x : 0,
        grabY: rect ? (event.clientY - rect.top) / rect.height - box.y : 0,
      };
    } else {
      drag.current = { mode: "resize", id };
    }
  };

  const onPointerMove = (pageNumber: number, event: React.PointerEvent<HTMLDivElement>) => {
    const active = drag.current;
    if (!active) return;
    const field = fields.find((f) => f.id === active.id);
    const box = field ? placedBox(field) : null;
    if (!box || box.page !== pageNumber) return;

    const rect = event.currentTarget.getBoundingClientRect();
    const px = (event.clientX - rect.left) / rect.width;
    const py = (event.clientY - rect.top) / rect.height;

    if (active.mode === "move") {
      update(active.id, {
        x: clamp(px - active.grabX, 0, 1 - box.w),
        y: clamp(py - active.grabY, 0, 1 - box.h),
      });
    } else {
      // A minimum of 4% by 1.5% - small enough for a date, big enough to still be grabbable.
      update(active.id, {
        w: clamp(px - box.x, 0.04, 1 - box.x),
        h: clamp(py - box.y, 0.015, 1 - box.y),
      });
    }
  };

  const endDrag = () => {
    drag.current = null;
  };

  if (error) {
    return (
      <div className="rounded-field border border-risk/40 bg-risk-soft px-4 py-6 text-center text-sm text-risk">
        {error}
        <p className="mt-2 text-xs text-muted">
          You can still download the file and re-upload a fresh export from Word.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="sticky top-0 z-10 flex flex-wrap items-end gap-2 rounded-field border border-line bg-surface-2/95 p-3 backdrop-blur">
        <label className="text-xs font-semibold uppercase tracking-wide text-muted">
          Click a page to place
        </label>
        <Select
          size="sm"
          className="w-40"
          value={newKind}
          disabled={disabled}
          options={Object.entries(FIELD_KIND_LABELS).map(([value, label]) => ({ value, label }))}
          onChange={(e) => setNewKind(e.target.value as FieldKind)}
        />
        <Select
          size="sm"
          className="w-48"
          value={newSigner}
          disabled={disabled}
          options={Object.entries(SIGNER_LABELS).map(([value, label]) => ({ value, label }))}
          onChange={(e) => setNewSigner(e.target.value as SignerRole)}
        />
        {selectedId && (
          <Btn size="sm" variant="ghost" onClick={() => onSelect(null)}>
            Deselect
          </Btn>
        )}
      </div>

      {/*
        Where the boxes actually are. A fillable PDF usually declares every field on its signature
        page, so the designer opens on page 1 showing nothing - the counts and the jump buttons
        say where to look without scrolling to find out.
      */}
      {pages.length > 1 && (
        <nav aria-label="Pages" className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-muted">Jump to</span>
          {pages.map((_, i) => {
            const n = i + 1;
            const count = fields.filter((f) => placedBox(f)?.page === n).length;
            return (
              <button
                key={n}
                type="button"
                onClick={() =>
                  document
                    .getElementById(`agreement-page-${n}`)
                    ?.scrollIntoView({ behavior: "smooth", block: "start" })
                }
                className="inline-flex h-7 items-center gap-1.5 rounded-btn border border-line px-2.5 font-medium text-ink-2 transition-colors hover:border-primary hover:text-primary"
              >
                Page {n}
                <span
                  className={`rounded-full px-1.5 text-[10px] font-semibold ${
                    count > 0 ? "bg-primary-soft text-primary" : "bg-surface-2 text-faint"
                  }`}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </nav>
      )}

      {loading && pages.length === 0 && (
        <p className="flex items-center justify-center gap-2 rounded-field border border-line px-4 py-10 text-sm text-muted">
          <Loader2 size={15} className="animate-spin" /> Rendering the document…
        </p>
      )}

      {pages.map((page, index) => {
        const pageNumber = index + 1;
        return (
          <div key={pageNumber} id={`agreement-page-${pageNumber}`} className="space-y-1 scroll-mt-4">
            <p className="text-xs text-muted">
              Page {pageNumber}
              {(() => {
                const n = fields.filter((f) => placedBox(f)?.page === pageNumber).length;
                return n > 0 ? ` · ${n} field${n === 1 ? "" : "s"}` : " · no fields yet";
              })()}
            </p>
            <div
              data-page={pageNumber}
              className="relative mx-auto w-full max-w-[900px] cursor-crosshair overflow-hidden rounded-field border border-line bg-white shadow-card"
              style={{ aspectRatio: `${page.width} / ${page.height}` }}
              onClick={(e) => {
                // Only a click on the page itself places a box; a click on a box selects it.
                if (e.target === e.currentTarget || (e.target as HTMLElement).tagName === "CANVAS") {
                  dropField(pageNumber, e);
                }
              }}
              onPointerMove={(e) => onPointerMove(pageNumber, e)}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
            >
              <canvas
                ref={(el) => {
                  canvasRefs.current[index] = el;
                }}
                className="pointer-events-none absolute inset-0 h-full w-full"
              />

              {fields.map((field) => {
                const box = placedBox(field);
                if (!box || box.page !== pageNumber) return null;
                const selected = field.id === selectedId;
                return (
                  <div
                    key={field.id}
                    ref={(el) => {
                      boxRefs.current[field.id] = el;
                    }}
                    role="button"
                    tabIndex={0}
                    aria-label={`${field.label?.trim() || defaultFieldLabel(field.kind, field.signer)}, ${SIGNER_LABELS[field.signer]}, page ${box.page}. Arrow keys move it.`}
                    aria-pressed={selected}
                    onPointerDown={(e) => onPointerDown(field.id, "move", e)}
                    onKeyDown={(e) => nudge(e, field, box, update)}
                    className={`absolute flex touch-none select-none items-end justify-start rounded-[3px] border-2 text-[10px] font-semibold uppercase tracking-wide ${
                      selected
                        ? "border-primary bg-primary/20 text-primary"
                        : "border-primary/50 bg-primary/10 text-primary/80 hover:border-primary"
                    }`}
                    style={{
                      left: `${box.x * 100}%`,
                      top: `${box.y * 100}%`,
                      width: `${box.w * 100}%`,
                      height: `${box.h * 100}%`,
                    }}
                    title={`${field.label?.trim() || defaultFieldLabel(field.kind, field.signer)} · ${SIGNER_LABELS[field.signer]}`}
                  >
                    <span className="pointer-events-none max-w-full truncate px-1 pb-0.5">
                      {field.label?.trim() || defaultFieldLabel(field.kind, field.signer)}
                    </span>
                    {/* The resize grip. Its own pointer handler, so dragging it never moves the box. */}
                    <span
                      onPointerDown={(e) => onPointerDown(field.id, "resize", e)}
                      className="absolute -bottom-1 -right-1 h-3 w-3 cursor-nwse-resize rounded-[2px] border border-white bg-primary"
                      aria-hidden
                    />
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/**
 * Arrow keys move the selected box by a quarter of a percent.
 *
 * Not a nicety: a pointer drag cannot place a box to the precision a signature line wants, and
 * without keyboard nudging this whole screen is unusable without a mouse.
 */
function nudge(
  event: React.KeyboardEvent,
  field: DocField,
  box: { x: number; y: number; w: number; h: number },
  update: (id: string, patch: Partial<DocField>) => void,
) {
  const step = event.shiftKey ? 0.01 : 0.0025;
  const moves: Record<string, Partial<DocField>> = {
    ArrowLeft: { x: clamp(box.x - step, 0, 1 - box.w) },
    ArrowRight: { x: clamp(box.x + step, 0, 1 - box.w) },
    ArrowUp: { y: clamp(box.y - step, 0, 1 - box.h) },
    ArrowDown: { y: clamp(box.y + step, 0, 1 - box.h) },
  };
  const patch = moves[event.key];
  if (!patch) return;
  event.preventDefault();
  update(field.id, patch);
}

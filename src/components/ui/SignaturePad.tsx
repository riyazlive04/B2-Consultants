"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Eraser, Expand, Minimize2, PenLine, Undo2 } from "lucide-react";
import { collectReportedDevice, type CaptureMeta, type SigningDevice } from "@/lib/device";

/**
 * Draw-to-sign pad. Works with a finger, a stylus and a mouse, on a phone or a laptop.
 *
 * FOUR THINGS THAT ARE LOAD-BEARING:
 *
 * 1. COORDINATES ARE NORMALISED BY WIDTH (x/W, y/W), not stored in device pixels. A canvas that
 *    resizes — rotating a phone, opening full screen, a sidebar collapsing — would otherwise
 *    throw the signature away or distort it. Dividing BOTH axes by the width keeps the scaling
 *    uniform, so the aspect ratio of the ink survives whatever the box does. The pad holds a
 *    fixed 2:1 box, so ink can never clip.
 *
 * 2. STROKES ARE THE MODEL; THE CANVAS IS A VIEW. That is what makes Undo possible, what lets us
 *    re-render at print resolution on export instead of upscaling a blurry screen bitmap, and
 *    what produces the capture metadata the certificate prints (stroke count, duration, whether
 *    a stylus reported real pressure).
 *
 * 3. THE EXPORT IS CROPPED AND REDRAWN AT 3x. An untrimmed pad-sized PNG puts a small squiggle
 *    adrift in a large transparent box wherever the PDF places it; and a screen-DPI bitmap looks
 *    like a fax beside vector text. So we replay the strokes into an offscreen canvas sized to
 *    the ink's own bounding box.
 *
 * 4. `touch-action: none` PLUS pointer capture. Without the first, a finger drag scrolls the page
 *    instead of drawing. Without the second, a stroke that wanders off the canvas mid-signature is
 *    silently truncated.
 */

// ── Geometry. Both axes divide by width, so `y` runs 0..1/ASPECT. ──
const ASPECT = 2; // the pad is always twice as wide as it is tall
const EXPORT_WIDTH = 1200; // px across the full pad; the crop is a fraction of this

// Stroke width in normalised units, tuned so a ~700px-wide pad draws a ~2.4px line.
const BASE_WIDTH = 0.0034;
const PRESSURE_MIN = 0.55; // a stylus at zero pressure still leaves a line
const PRESSURE_RANGE = 0.95;
const SPEED_MAX = 0.004; // normalised units per ms — a fast flick
const SPEED_THIN = 0.55; // how much a fast stroke thins

// A stray tap is not a signature. Both thresholds must be cleared.
const MIN_INK_LENGTH = 0.35; // total path length, in pad widths
const MIN_INK_DIAGONAL = 0.1; // bounding-box diagonal

// The canvas API needs a literal. This ink is printed into a PDF, not themed, so it does not
// follow the light/dark tokens — it is always the document's near-navy.
const INK_COLOUR = "#16203A";

type Pt = { x: number; y: number; p: number; t: number };
type Stroke = { pts: Pt[]; pointerType: string };

export type SignatureValue = { dataUrl: string; device: SigningDevice };
export type SignatureProblem = "too-small";

// ───────────────────────────── Geometry helpers ─────────────────────────────

function widthFor(stroke: Stroke, a: Pt, b: Pt): number {
  if (stroke.pointerType === "pen" && b.p > 0) {
    return BASE_WIDTH * (PRESSURE_MIN + PRESSURE_RANGE * b.p);
  }
  // Nothing real to read from a finger or a mouse (both report a constant 0.5), so taper by
  // speed instead — which is what a physical pen does anyway.
  const dt = Math.max(1, b.t - a.t);
  const speed = Math.hypot(b.x - a.x, b.y - a.y) / dt;
  const fast = Math.min(1, speed / SPEED_MAX);
  return BASE_WIDTH * (1.15 - SPEED_THIN * fast);
}

/** Replay strokes onto a context, where 1 normalised unit = `scale` px. */
function renderStrokes(
  ctx: CanvasRenderingContext2D,
  strokes: Stroke[],
  scale: number,
  offX = 0,
  offY = 0,
) {
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = INK_COLOUR;
  ctx.fillStyle = INK_COLOUR;

  for (const stroke of strokes) {
    const pts = stroke.pts;
    if (pts.length === 1) {
      // A tap is a dot, not a dropped stroke.
      const p = pts[0]!;
      ctx.beginPath();
      ctx.arc(p.x * scale + offX, p.y * scale + offY, (BASE_WIDTH * scale) / 2, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]!;
      const b = pts[i]!;
      ctx.beginPath();
      ctx.lineWidth = Math.max(0.4, widthFor(stroke, a, b) * scale);
      ctx.moveTo(a.x * scale + offX, a.y * scale + offY);
      ctx.lineTo(b.x * scale + offX, b.y * scale + offY);
      ctx.stroke();
    }
  }
}

function inkBounds(strokes: Stroke[]) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let length = 0;
  let points = 0;
  for (const s of strokes) {
    for (let i = 0; i < s.pts.length; i++) {
      const p = s.pts[i]!;
      points++;
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
      if (i > 0) length += Math.hypot(p.x - s.pts[i - 1]!.x, p.y - s.pts[i - 1]!.y);
    }
  }
  if (!points) return null;
  return { minX, minY, maxX, maxY, length, points, w: maxX - minX, h: maxY - minY };
}

// ───────────────────────────── Component ─────────────────────────────

export function SignaturePad({
  onChange,
  disabled = false,
  allowFullScreen = true,
  caption = "Sign above the line",
}: {
  /** `null` means "not a usable signature yet"; `problem` says why, once they have tried. */
  onChange: (value: SignatureValue | null, problem?: SignatureProblem) => void;
  disabled?: boolean;
  allowFullScreen?: boolean;
  caption?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const strokes = useRef<Stroke[]>([]);
  const active = useRef<Stroke | null>(null);
  const startedAt = useRef(0);
  const pressureSeen = useRef(false);
  const widthRef = useRef(1);

  const [strokeCount, setStrokeCount] = useState(0);
  const [fullScreen, setFullScreen] = useState(false);
  const [problem, setProblem] = useState<SignatureProblem | null>(null);

  const hasInk = strokeCount > 0;

  /** Repaint the visible canvas from the model. Cheap: a signature is a few hundred points. */
  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.clientWidth;
    const cssH = canvas.clientHeight;
    if (!cssW || !cssH) return;
    const wantW = Math.round(cssW * dpr);
    const wantH = Math.round(cssH * dpr);
    if (canvas.width !== wantW || canvas.height !== wantH) {
      canvas.width = wantW;
      canvas.height = wantH;
    }
    widthRef.current = cssW;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    renderStrokes(ctx, strokes.current, cssW);
  }, []);

  // Repaint on mount, on resize, and whenever the pad enters or leaves full screen. Because the
  // model is normalised, none of these lose or distort a single point.
  useLayoutEffect(() => {
    redraw();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ro = new ResizeObserver(redraw);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [redraw, fullScreen]);

  useEffect(() => {
    if (!fullScreen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setFullScreen(false);
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [fullScreen]);

  /** Build the export plus its metadata, or explain why this isn't a signature yet. */
  const emit = useCallback(() => {
    const bounds = inkBounds(strokes.current);
    if (!bounds) {
      setProblem(null);
      onChange(null);
      return;
    }
    const diagonal = Math.hypot(bounds.w, bounds.h);
    if (bounds.length < MIN_INK_LENGTH || diagonal < MIN_INK_DIAGONAL) {
      setProblem("too-small");
      onChange(null, "too-small");
      return;
    }
    setProblem(null);

    const pad = 0.02;
    const x0 = Math.max(0, bounds.minX - pad);
    const y0 = Math.max(0, bounds.minY - pad);
    const x1 = Math.min(1, bounds.maxX + pad);
    const y1 = Math.min(1 / ASPECT, bounds.maxY + pad);

    const out = document.createElement("canvas");
    out.width = Math.max(8, Math.round((x1 - x0) * EXPORT_WIDTH));
    out.height = Math.max(8, Math.round((y1 - y0) * EXPORT_WIDTH));
    const octx = out.getContext("2d");
    if (!octx) return;
    renderStrokes(octx, strokes.current, EXPORT_WIDTH, -x0 * EXPORT_WIDTH, -y0 * EXPORT_WIDTH);

    const reported = collectReportedDevice();
    if (!reported) return;

    const kinds = new Set(strokes.current.map((s) => s.pointerType));
    const only = kinds.size === 1 ? [...kinds][0]! : "";
    const pointerType: CaptureMeta["pointerType"] =
      only === "mouse" || only === "pen" || only === "touch" ? only : "unknown";

    const W = widthRef.current;
    const last = strokes.current.at(-1)!.pts.at(-1)!;
    const capture: CaptureMeta = {
      pointerType,
      strokeCount: strokes.current.length,
      pointCount: bounds.points,
      durationMs: Math.max(0, Math.round(last.t - startedAt.current)),
      padSize: { w: Math.round(W), h: Math.round(W / ASPECT) },
      inkBox: { w: Math.round(bounds.w * W), h: Math.round(bounds.h * W) },
      pressureObserved: pressureSeen.current,
      fullScreen,
    };
    onChange({ dataUrl: out.toDataURL("image/png"), device: { reported, capture } });
  }, [fullScreen, onChange]);

  // ── Pointer plumbing ──

  const pointOf = (el: HTMLCanvasElement, ev: PointerEvent): Pt => {
    const rect = el.getBoundingClientRect();
    const W = rect.width || 1;
    return {
      x: (ev.clientX - rect.left) / W,
      y: (ev.clientY - rect.top) / W,
      p: ev.pressure ?? 0,
      t: performance.now(),
    };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (disabled) return;
    // A palm resting on a tablet fires touch events while the stylus draws. Only the primary
    // pointer gets to sign.
    if (!e.isPrimary) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    if (!strokes.current.length) startedAt.current = performance.now();
    if (e.pointerType === "pen" && e.pressure > 0) pressureSeen.current = true;
    const stroke: Stroke = {
      pts: [pointOf(e.currentTarget, e.nativeEvent)],
      pointerType: e.pointerType || "unknown",
    };
    active.current = stroke;
    strokes.current.push(stroke);
    setStrokeCount(strokes.current.length);
    redraw();
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!active.current || disabled || !e.isPrimary) return;
    e.preventDefault();
    // A 120Hz stylus outruns the event loop. `getCoalescedEvents` returns every sample the browser
    // buffered between frames — the difference between a smooth curve and a polygon.
    const native = e.nativeEvent;
    const coalesced =
      typeof native.getCoalescedEvents === "function" ? native.getCoalescedEvents() : [];
    const samples = coalesced.length ? coalesced : [native];
    for (const s of samples) {
      if (e.pointerType === "pen" && s.pressure > 0) pressureSeen.current = true;
      active.current.pts.push(pointOf(e.currentTarget, s));
    }
    redraw();
  };

  const finish = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!active.current) return;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* capture already released */
    }
    active.current = null;
    redraw();
    emit();
  };

  const undo = () => {
    strokes.current.pop();
    setStrokeCount(strokes.current.length);
    redraw();
    emit();
  };

  const clear = () => {
    strokes.current = [];
    active.current = null;
    pressureSeen.current = false;
    setStrokeCount(0);
    setProblem(null);
    redraw();
    onChange(null);
  };

  // ── Chrome ──

  const pad = (
    <div
      className={`relative w-full overflow-hidden rounded-card border bg-surface ${
        problem ? "border-bad" : "border-line-strong"
      }`}
      style={{ aspectRatio: `${ASPECT} / 1` }}
    >
      <canvas
        ref={canvasRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finish}
        onPointerCancel={finish}
        onPointerLeave={finish}
        aria-label="Signature drawing area"
        // `touch-none` is not decoration: without it, a finger drag scrolls instead of drawing.
        className="absolute inset-0 h-full w-full touch-none"
        style={{ cursor: disabled ? "not-allowed" : "crosshair" }}
      />

      {/* The line you sign on. Pointer-transparent, or it would swallow the first stroke. */}
      <div className="pointer-events-none absolute inset-x-[7%] bottom-[20%]">
        <div className="border-b border-dashed border-line-strong" />
        <p className="mt-2 text-center text-caption text-faint">{caption}</p>
      </div>

      {!hasInk && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <div className="flex flex-col items-center gap-2 text-faint">
            <PenLine size={22} />
            <p className="text-body">Draw your signature here</p>
          </div>
        </div>
      )}
    </div>
  );

  const toolbar = (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
      <p className="text-caption text-faint">
        {hasInk
          ? `${strokeCount} stroke${strokeCount === 1 ? "" : "s"}`
          : "Use a finger, stylus, mouse or trackpad."}
      </p>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={undo}
          disabled={!hasInk || disabled}
          className="inline-flex h-9 items-center gap-1.5 rounded-btn px-2.5 text-caption font-medium text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink disabled:cursor-not-allowed disabled:text-ink-disabled disabled:hover:bg-transparent"
        >
          <Undo2 size={14} /> Undo
        </button>
        <button
          type="button"
          onClick={clear}
          disabled={!hasInk || disabled}
          className="inline-flex h-9 items-center gap-1.5 rounded-btn px-2.5 text-caption font-semibold text-primary transition-colors hover:bg-primary-soft disabled:cursor-not-allowed disabled:text-ink-disabled disabled:hover:bg-transparent"
        >
          <Eraser size={14} /> Erase &amp; retry
        </button>
        {allowFullScreen && (
          <button
            type="button"
            onClick={() => setFullScreen((v) => !v)}
            disabled={disabled}
            className="inline-flex h-9 items-center gap-1.5 rounded-btn px-2.5 text-caption font-medium text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
          >
            {fullScreen ? <Minimize2 size={14} /> : <Expand size={14} />}
            {fullScreen ? "Exit" : "More room"}
          </button>
        )}
      </div>
    </div>
  );

  const problemNote = problem === "too-small" && (
    <p role="alert" className="mt-2 rounded-field bg-bad-soft px-3 py-2 text-caption font-medium text-bad">
      That mark is too small to be a signature. Sign across the line as you normally would.
    </p>
  );

  if (fullScreen) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col bg-canvas p-4 sm:p-6">
        <div className="mb-3">
          <h2 className="font-display text-h3 text-ink">Sign here</h2>
          {/* Turning the phone is the real fix for a cramped pad. Say so, rather than rotating the
              canvas with a CSS transform — that breaks pointer-coordinate mapping. */}
          <p className="text-caption text-faint sm:hidden">Turn your phone sideways for more room.</p>
          <p className="hidden text-caption text-faint sm:block">Press Esc to go back.</p>
        </div>
        <div className="flex flex-1 items-center">
          <div className="w-full">
            {pad}
            {toolbar}
            {problemNote}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      {pad}
      {toolbar}
      {problemNote}
    </div>
  );
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Eraser } from "lucide-react";

/**
 * Draw-to-sign canvas. Emits a trimmed PNG data URL, or null while empty.
 *
 * TWO THINGS THAT MATTER, both invisible until you look at the PDF:
 *
 *  - The canvas is backed at devicePixelRatio, so a signature drawn on a phone isn't a blurry
 *    smear when it lands in a print-resolution document.
 *  - The emitted PNG is cropped to the ink's bounding box. An untrimmed 600×180 canvas holding a
 *    small squiggle renders as a small squiggle floating in a large empty box, wherever the PDF
 *    places it. Cropping makes the signature sit on the line.
 */

const STROKE = "#0f172a";
const PAD = 8; // px of whitespace kept around the ink after cropping

export function SignaturePad({
  onChange,
  height = 170,
  disabled = false,
}: {
  onChange: (dataUrl: string | null) => void;
  height?: number;
  disabled?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const dirty = useRef(false);
  const [hasInk, setHasInk] = useState(false);

  /** Size the backing store to the CSS box × DPR. Re-runs on resize, which clears the drawing. */
  const resize = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = STROKE;
  }, []);

  useEffect(() => {
    resize();
    const ro = new ResizeObserver(resize);
    if (canvasRef.current) ro.observe(canvasRef.current);
    return () => ro.disconnect();
  }, [resize]);

  const pointFrom = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const start = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (disabled) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    drawing.current = true;
    const { x, y } = pointFrom(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
    // A tap with no drag is still a mark — draw a dot so the stroke isn't lost.
    ctx.lineTo(x + 0.01, y);
    ctx.stroke();
    dirty.current = true;
  };

  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current || disabled) return;
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const { x, y } = pointFrom(e);
    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const end = () => {
    if (!drawing.current) return;
    drawing.current = false;
    if (!dirty.current) return;
    setHasInk(true);
    onChange(exportTrimmed(canvasRef.current));
  };

  const clear = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
    dirty.current = false;
    setHasInk(false);
    onChange(null);
  };

  return (
    <div>
      <div
        className="relative rounded-field border border-dashed border-line-strong bg-surface"
        style={{ height }}
      >
        <canvas
          ref={canvasRef}
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerLeave={end}
          onPointerCancel={end}
          className="h-full w-full touch-none rounded-field"
          style={{ cursor: disabled ? "not-allowed" : "crosshair" }}
        />
        {!hasInk && (
          <span className="pointer-events-none absolute inset-0 grid place-items-center text-sm text-muted">
            Draw your signature here
          </span>
        )}
        {/* The line you sign on, so the mark lands where the PDF expects it. */}
        <span className="pointer-events-none absolute inset-x-6 bottom-8 border-b border-line" />
      </div>
      <div className="mt-2 flex items-center justify-between">
        <p className="text-xs text-muted">Use a finger, stylus or mouse.</p>
        <button
          type="button"
          onClick={clear}
          disabled={!hasInk || disabled}
          className="inline-flex items-center gap-1.5 rounded-btn px-2 py-1 text-xs font-medium text-muted transition-colors hover:text-ink disabled:opacity-40"
        >
          <Eraser size={13} /> Clear
        </button>
      </div>
    </div>
  );
}

/** Crop to the ink's bounding box (plus padding) and return a PNG data URL. */
function exportTrimmed(canvas: HTMLCanvasElement | null): string | null {
  if (!canvas) return null;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const { width, height } = canvas;
  const { data } = ctx.getImageData(0, 0, width, height);

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] === 0) continue; // transparent
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return null; // nothing drawn

  const dpr = window.devicePixelRatio || 1;
  const pad = Math.round(PAD * dpr);
  minX = Math.max(0, minX - pad);
  minY = Math.max(0, minY - pad);
  maxX = Math.min(width - 1, maxX + pad);
  maxY = Math.min(height - 1, maxY + pad);

  const out = document.createElement("canvas");
  out.width = maxX - minX + 1;
  out.height = maxY - minY + 1;
  const octx = out.getContext("2d");
  if (!octx) return null;
  octx.drawImage(canvas, minX, minY, out.width, out.height, 0, 0, out.width, out.height);
  return out.toDataURL("image/png");
}

"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import type { ReactNode, RefObject } from "react";

/**
 * Shared control base for the form kit. Lives in its own module so form.tsx,
 * DatePicker.tsx and SelectMenu.tsx can all read the Field context and the one
 * input-surface class set WITHOUT importing each other (form.tsx <-> DatePicker
 * would otherwise be a cycle).
 */

/** Field passes id / validity down to whichever control it wraps (see form.tsx Field). */
export type FieldCtx = { describedBy?: string; invalid?: boolean };
export const FieldContext = createContext<FieldCtx>({});

// One input surface for the whole app (§5.5): rounded, 1px border, surface bg, ink text.
// Height is applied per size so a dense table control and a full form field share
// everything BUT their height.
export const baseCls =
  "w-full rounded-field border bg-surface text-ink outline-none transition-colors disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-ink-disabled";
export const okCls = "border-line-strong focus:border-primary focus:ring-2 focus:ring-primary-soft";
export const errCls = "border-bad focus:border-bad focus:ring-2 focus:ring-risk-soft";

/** §5.5 hit-target floor is 40; `sm` is for dense table rows / filter bars only. */
export type ControlSize = "sm" | "md";
export const sizeCls: Record<ControlSize, string> = {
  sm: "h-8 px-2.5 text-xs",
  md: "h-10 px-3 text-sm",
};

export function useControlProps() {
  const { describedBy, invalid } = useContext(FieldContext);
  return {
    describedBy,
    invalid: !!invalid,
    "aria-describedby": describedBy,
    "aria-invalid": invalid || undefined,
    // height-agnostic surface; callers add sizeCls
    cls: `${baseCls} ${invalid ? errCls : okCls}`,
  };
}

/**
 * A button styled to look exactly like a text field — the closed state of both the
 * date picker and the select. `open` mirrors the focus ring so an open popover reads
 * as an active field.
 */
export function fieldButtonCls(size: ControlSize, invalid: boolean, open: boolean) {
  const state = invalid ? errCls : okCls;
  const openRing = open
    ? invalid
      ? "border-bad ring-2 ring-risk-soft"
      : "border-primary ring-2 ring-primary-soft"
    : "";
  return `${baseCls} ${state} ${sizeCls[size]} ${openRing} inline-flex cursor-pointer items-center justify-between gap-2 text-left`;
}

// ─────────────────── Popover ───────────────────

type Placement = { top: number; left: number; minWidth: number; placedAbove: boolean };

/**
 * Anchored popover positioning WITHOUT a dependency: fixed-positioned, flips above the
 * trigger when the viewport bottom is tight, and shifts left to stay on-screen. Recomputed
 * on scroll (capture, so it catches scrolling ancestors) and resize while open.
 */
function usePlacement(
  anchorRef: RefObject<HTMLElement>,
  panelRef: RefObject<HTMLElement>,
  open: boolean,
): Placement | null {
  const [pos, setPos] = useState<Placement | null>(null);

  const compute = useCallback(() => {
    const a = anchorRef.current;
    if (!a) return;
    const r = a.getBoundingClientRect();
    const gap = 6;
    const panelH = panelRef.current?.offsetHeight ?? 0;
    const panelW = panelRef.current?.offsetWidth ?? r.width;
    const spaceBelow = window.innerHeight - r.bottom;
    const placedAbove = spaceBelow < panelH + gap && r.top > spaceBelow;
    let left = r.left;
    // keep the panel within an 8px viewport gutter
    left = Math.max(8, Math.min(left, window.innerWidth - panelW - 8));
    const top = placedAbove ? r.top - gap - panelH : r.bottom + gap;
    setPos({ top, left, minWidth: r.width, placedAbove });
  }, [anchorRef, panelRef]);

  useLayoutEffect(() => {
    if (!open) return;
    compute();
    const onScroll = () => compute();
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [open, compute]);

  return pos;
}

/** Portal-rendered popover panel: positions itself under the anchor, closes on outside
 *  pointer-down and on Escape. Focus handling is left to each caller (grid vs listbox). */
export function Popover({
  anchorRef,
  open,
  onClose,
  children,
  labelledBy,
  role = "dialog",
  className = "",
}: {
  anchorRef: RefObject<HTMLElement>;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  labelledBy?: string;
  role?: "dialog" | "listbox";
  className?: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const pos = usePlacement(anchorRef, panelRef, open);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || anchorRef.current?.contains(t)) return;
      onClose();
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [open, onClose, anchorRef]);

  if (!open || !mounted) return null;

  return createPortal(
    <div
      ref={panelRef}
      role={role}
      aria-labelledby={labelledBy}
      style={{
        position: "fixed",
        top: pos?.top ?? -9999,
        left: pos?.left ?? -9999,
        minWidth: pos?.minWidth,
        // invisible until measured, so it never flashes at (0,0) before placement
        visibility: pos ? "visible" : "hidden",
        zIndex: 60,
      }}
      className={`rounded-field border border-line-strong bg-surface p-1 shadow-e-2 ${className}`}
    >
      {children}
    </div>,
    document.body,
  );
}

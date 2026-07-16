"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Overlay dialog for entry forms ("Add student" etc.): white panel, e-3 shadow,
 * ink scrim (§5.9). Esc / scrim click / ✕ all close; body scroll locks while open.
 * Focus management: initial focus moves into the panel, Tab is trapped inside,
 * and focus returns to the trigger on close.
 *
 * PORTALLED TO <body>, and it must stay that way. `position: fixed` is only relative
 * to the viewport while no ancestor has a transform/filter/perspective/will-change —
 * any one of those makes that ancestor the containing block instead (CSS Position §4).
 * Rendered in place, this dialog sat under `main > *`'s page-enter animation and
 * centred itself inside the page root, hanging off the bottom of short windows with
 * the submit button unreachable. The fill-modes that caused it are fixed in
 * globals.css, but a modal should not depend on every ancestor staying untransformed
 * forever — one `hover:scale` added upstream years from now would break it again.
 */
export function Modal({
  open,
  onClose,
  title,
  subtitle,
  size = "lg",
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  size?: "sm" | "md" | "lg";
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  // document doesn't exist during SSR, so the portal target is only known on the client
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const trigger = document.activeElement as HTMLElement | null;

    // initial focus: first field in the panel, else the close button
    const focusables = () =>
      Array.from(panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
    (focusables().find((el) => el.matches("input, select, textarea")) ?? focusables()[0])?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab") {
        // trap Tab inside the dialog
        const els = focusables();
        if (!els.length) return;
        const first = els[0];
        const last = els[els.length - 1];
        const active = document.activeElement;
        if (e.shiftKey && (active === first || !panelRef.current?.contains(active))) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && (active === last || !panelRef.current?.contains(active))) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
      trigger?.focus?.(); // hand focus back to whatever opened the dialog
    };
  }, [open, onClose]);

  if (!open || !mounted) return null;

  const maxW = { sm: "max-w-sm", md: "max-w-[560px]", lg: "max-w-[720px]" }[size];

  return createPortal(
    <div
      className="fixed inset-0 z-[90] flex items-end justify-center p-3 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <div aria-hidden className="overlay-in glass-scrim absolute inset-0" onClick={onClose} />
      <div
        ref={panelRef}
        className={`dialog-in glass-modal relative max-h-[88vh] w-full ${maxW} overflow-y-auto rounded-card p-5 sm:p-6`}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h3 id={titleId} className="font-display text-h2">
              {title}
            </h3>
            {subtitle && <p className="mt-1 text-caption text-muted">{subtitle}</p>}
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="grid h-10 w-10 flex-none place-items-center rounded-btn text-muted transition-colors hover:bg-surface-2 hover:text-ink"
          >
            <X size={17} />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

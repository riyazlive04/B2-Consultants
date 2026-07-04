"use client";

import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";

/**
 * Frosted-glass overlay dialog for entry forms ("Add student" etc.).
 * Page content stays visible behind the blurred scrim so the glass reads as depth.
 * Esc / scrim click / ✕ all close; body scroll locks while open.
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
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  const maxW = { sm: "max-w-sm", md: "max-w-xl", lg: "max-w-3xl" }[size];

  return (
    <div
      className="fixed inset-0 z-[90] flex items-end justify-center p-3 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="overlay-in glass-scrim absolute inset-0" onClick={onClose} />
      <div className={`dialog-in glass-modal relative max-h-[88vh] w-full ${maxW} overflow-y-auto rounded-card p-5 sm:p-6`}>
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h3 className="font-display text-lg font-semibold">{title}</h3>
            {subtitle && <p className="mt-1 text-xs text-muted">{subtitle}</p>}
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="grid h-8 w-8 flex-none place-items-center rounded-field text-muted transition-colors hover:bg-ink/5 hover:text-ink"
          >
            <X size={17} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

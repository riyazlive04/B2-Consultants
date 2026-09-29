"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { lockBodyScroll } from "@/lib/scroll-lock";
import type { PublicForm as PublicFormType } from "@/server/forms-metrics";
import PublicForm from "./PublicForm";

/**
 * A form raised in a dialog from a CTA - the pattern the live opt-in page uses, where the button
 * and the video still both open the same capture form instead of navigating anywhere.
 *
 * ── Why this is not `components/ui/Modal` ──────────────────────────────────────────────────────
 * Same reason `SitePageRenderer` is not `SiteBlocks`: that Modal is a DASHBOARD control. It wears
 * the app's frosted-glass treatment and a left-aligned `text-h2` header sized for an internal
 * entry form. This dialog is the single most important thing a cold visitor from a paid ad ever
 * sees, and it is a sales asset - a solid white card with a large centred promise on it. The two
 * will keep diverging, and coupling them would mean every change to the founder's "Add student"
 * dialog is also a change to the page the ad budget lands on.
 *
 * What is NOT duplicated is the behaviour that has to be right: scroll locking goes through the
 * shared counter in `lib/scroll-lock` (a private one strands the lock when overlays interleave),
 * and focus handling below is the same contract - focus in on open, Tab trapped, focus handed
 * back to the trigger on close.
 *
 * Portalled to <body> deliberately: `position: fixed` stops being viewport-relative as soon as any
 * ancestor has a transform, and this dialog opens from inside a page whose every node carries
 * author-controlled styling. Rendered in place, one `scale` on a section band would strand the
 * submit button off-screen.
 */

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function FormPopup({
  open,
  onClose,
  form,
  title,
  subtitle,
  utm,
}: {
  open: boolean;
  onClose: () => void;
  form: PublicFormType;
  title?: string;
  subtitle?: string;
  utm?: Record<string, string>;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Open/close lifecycle. Keyed on `open` alone - callers pass an inline `onClose`, whose identity
  // changes every render, and folding it in here would churn the scroll lock and yank focus back
  // to the trigger while someone is mid-way through typing their phone number.
  useEffect(() => {
    if (!open) return;
    const trigger = document.activeElement as HTMLElement | null;
    const releaseScroll = lockBodyScroll();

    const focusables = () => Array.from(panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
    // The first FIELD, not the close button: this dialog exists to be filled in.
    (focusables().find((el) => el.matches("input, select, textarea")) ?? focusables()[0])?.focus();

    return () => {
      releaseScroll();
      trigger?.focus?.();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") return onClose();
      if (e.key !== "Tab") return;
      const els = Array.from(panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
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
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || !mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center overflow-y-auto p-0 sm:items-center sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <div aria-hidden className="absolute inset-0 bg-black/55" onClick={onClose} />
      <div
        ref={panelRef}
        className="relative w-full max-w-[560px] rounded-t-2xl bg-white px-6 pb-8 pt-9 shadow-2xl sm:rounded-2xl sm:px-10"
      >
        {/* Sits ON the corner, as on the live page. `-top/-right` on desktop only: at the bottom
            of a phone screen a control hanging off the panel would be clipped by the viewport. */}
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-full bg-[#3f3f46] text-white transition-opacity hover:opacity-80 sm:-right-3 sm:-top-3"
        >
          <X size={16} />
        </button>

        <h2 id={titleId} className="text-center text-[26px] font-extrabold leading-tight text-[#111827] sm:text-[32px]">
          {title || form.name}
        </h2>
        {subtitle && <p className="mt-3 text-center text-base text-[#4b5563]">{subtitle}</p>}

        {/* The same PublicForm the page embeds. A second, dialog-flavoured renderer would be a
            second validator and a second submit path for the same lead. */}
        <div className="mt-6">
          <PublicForm form={form} utm={utm} bare />
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * The clickable thing plus the dialog it raises.
 *
 * Renders a real `<button>` around whatever the block draws, so the CTA is reachable by keyboard
 * and announced as opening a dialog. It is NOT an `<a href="#">` dressed up - a link that goes
 * nowhere is a broken link to a screen reader, and middle-clicking it would open a blank tab.
 */
export function FormPopupTrigger({
  form,
  title,
  subtitle,
  utm,
  className,
  ariaLabel,
  children,
}: {
  form: PublicFormType;
  title?: string;
  subtitle?: string;
  utm?: Record<string, string>;
  className?: string;
  ariaLabel?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" aria-haspopup="dialog" aria-label={ariaLabel} className={className} onClick={() => setOpen(true)}>
        {children}
      </button>
      <FormPopup open={open} onClose={() => setOpen(false)} form={form} title={title} subtitle={subtitle} utm={utm} />
    </>
  );
}

"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";

/**
 * App-wide feedback layer - one <FeedbackHost /> mounted in the shell provides:
 *   toast("Income added")            → bottom-right toast with a self-drawing ✓/✕
 *   askConfirm({ title, body, … })   → frosted-glass modal replacing window.confirm()
 *   celebrate()                      → confetti burst, reserved for real wins
 *                                      (payment recorded, student enrolled, streak milestone)
 * Event-based singletons: callable from any client component, no context threading.
 */

type ToastKind = "success" | "error";
type ToastMsg = { id: number; kind: ToastKind; text: string };

export function toast(text: string, kind: ToastKind = "success") {
  window.dispatchEvent(new CustomEvent("app:toast", { detail: { text, kind } }));
}

/** Confetti for milestone moments. No-ops under prefers-reduced-motion. */
export function celebrate() {
  window.dispatchEvent(new Event("app:celebrate"));
}

export type ConfirmOptions = {
  title: string;
  body?: string;
  confirmLabel?: string;
  danger?: boolean;
};

export function askConfirm(opts: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    window.dispatchEvent(new CustomEvent("app:confirm", { detail: { opts, resolve } }));
  });
}

/* piece geometry is randomised once per burst so re-renders don't reshuffle mid-fall */
type ConfettiPiece = {
  left: number; drift: number; spin: number; delay: number; dur: number;
  w: number; h: number; color: string;
};
type Burst = { id: number; pieces: ConfettiPiece[] };

const CONFETTI_COLORS = ["var(--viz-1)", "var(--viz-2)", "var(--viz-3)", "var(--viz-4)", "var(--viz-5)"];

function makeBurst(id: number): Burst {
  const pieces = Array.from({ length: 32 }, (_, i) => ({
    left: Math.random() * 100,
    drift: (Math.random() - 0.5) * 160,
    spin: 360 + Math.random() * 540,
    delay: Math.random() * 0.35,
    dur: 1.4 + Math.random() * 0.9,
    w: 6 + Math.random() * 5,
    h: 8 + Math.random() * 6,
    color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
  }));
  return { id, pieces };
}

/** ✓ / ✕ that draws itself on entry (stroke-dashoffset animation). */
function DrawnMark({ kind }: { kind: ToastKind }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden className="flex-none">
      <circle cx="12" cy="12" r="10.5" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.35" />
      {kind === "success" ? (
        <path
          d="M7 12.5l3.4 3.4L17 8.5"
          fill="none" stroke="currentColor" strokeWidth="2.4"
          strokeLinecap="round" strokeLinejoin="round" className="check-draw"
        />
      ) : (
        <path
          d="M8.5 8.5l7 7M15.5 8.5l-7 7"
          fill="none" stroke="currentColor" strokeWidth="2.4"
          strokeLinecap="round" className="check-draw"
        />
      )}
    </svg>
  );
}

const FOCUSABLE =
  'button:not([disabled]),[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export function FeedbackHost() {
  const [toasts, setToasts] = useState<ToastMsg[]>([]);
  const [bursts, setBursts] = useState<Burst[]>([]);
  const [confirm, setConfirm] = useState<{ opts: ConfirmOptions; resolve: (v: boolean) => void } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const bodyId = useId();

  useEffect(() => {
    let id = 0;
    let burstId = 0;
    const onToast = (e: Event) => {
      const { text, kind } = (e as CustomEvent).detail as { text: string; kind: ToastKind };
      const t = { id: ++id, text, kind };
      setToasts((prev) => [...prev.slice(-3), t]);
      setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== t.id)), 4000); // §5.9 auto-dismiss 4s
    };
    const onCelebrate = () => {
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      const b = makeBurst(++burstId);
      setBursts((prev) => [...prev.slice(-1), b]);
      setTimeout(() => setBursts((prev) => prev.filter((x) => x.id !== b.id)), 2800);
    };
    const onConfirm = (e: Event) => {
      setConfirm((e as CustomEvent).detail);
    };
    window.addEventListener("app:toast", onToast);
    window.addEventListener("app:celebrate", onCelebrate);
    window.addEventListener("app:confirm", onConfirm);
    return () => {
      window.removeEventListener("app:toast", onToast);
      window.removeEventListener("app:celebrate", onCelebrate);
      window.removeEventListener("app:confirm", onConfirm);
    };
  }, []);

  const answer = useCallback(
    (v: boolean) => {
      confirm?.resolve(v);
      setConfirm(null);
    },
    [confirm],
  );

  // While the dialog is open: lock the page behind it, and hand focus back to
  // whatever opened it on close (WCAG 2.4.3). Without this, dismissing a delete
  // confirm dropped focus to <body> and the keyboard user lost their place.
  useEffect(() => {
    if (!confirm) return;
    const opener = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
      opener?.focus?.();
    };
  }, [confirm]);

  // Esc always cancels. Enter only confirms NON-destructive dialogs — a stray
  // double-Enter after a form submit must never delete a record (§5.9).
  // Tab is trapped inside the panel: a modal that leaks focus to the page behind
  // its own scrim is not modal (WCAG 2.1.2).
  useEffect(() => {
    if (!confirm) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        answer(false);
        return;
      }
      if (e.key === "Enter" && !confirm.opts.danger) {
        answer(true);
        return;
      }
      if (e.key !== "Tab") return;

      const panel = panelRef.current;
      if (!panel) return;
      const nodes = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (nodes.length === 0) return;

      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const active = document.activeElement;
      const outside = !panel.contains(active);

      if (e.shiftKey && (active === first || outside)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || outside)) {
        e.preventDefault();
        first.focus();
      }
    };
    // capture phase: win before any page-level key handler sees the event
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [confirm, answer]);

  return (
    <>
      {/* Confetti — above everything, never intercepts the pointer */}
      {bursts.length > 0 && (
        <div aria-hidden className="pointer-events-none fixed inset-0 z-[110] overflow-hidden">
          {bursts.map((b) =>
            b.pieces.map((p, i) => (
              <span
                key={`${b.id}-${i}`}
                className="confetti-piece"
                style={{
                  left: `${p.left}%`,
                  width: p.w,
                  height: p.h,
                  background: p.color,
                  "--drift": `${p.drift}px`,
                  "--spin": `${p.spin}deg`,
                  "--delay": `${p.delay}s`,
                  "--dur": `${p.dur}s`,
                } as React.CSSProperties}
              />
            )),
          )}
        </div>
      )}

      {/* Toasts — white surface with a semantic tint */}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed bottom-5 right-5 z-[100] flex flex-col gap-2"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            // §5.9: r-md, e-2, and a signal-coloured left bar (not e-3 / r-sm)
            className={`toast-in pointer-events-auto flex items-center gap-2.5 rounded-btn border border-line border-l-4 bg-surface px-4 py-2.5 text-sm font-medium shadow-soft ${
              t.kind === "success" ? "border-l-ok text-ok" : "border-l-risk text-risk"
            }`}
          >
            <DrawnMark kind={t.kind} />
            <span className="text-ink">{t.text}</span>
          </div>
        ))}
      </div>

      {/* Confirm dialog — white panel over an ink scrim */}
      {confirm && (
        <div
          className="fixed inset-0 z-[99] flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={confirm.opts.body ? bodyId : undefined}
        >
          <div aria-hidden className="overlay-in glass-scrim absolute inset-0" onClick={() => answer(false)} />
          <div ref={panelRef} className="dialog-in glass-modal relative w-full max-w-sm rounded-card p-6">
            <p id={titleId} className="font-display text-h2">
              {confirm.opts.title}
            </p>
            {confirm.opts.body && (
              <p id={bodyId} className="mt-2 text-sm text-muted">
                {confirm.opts.body}
              </p>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                // destructive dialogs land focus on the SAFE choice
                autoFocus={confirm.opts.danger}
                onClick={() => answer(false)}
                className="h-10 rounded-btn border border-line bg-surface px-4 text-sm font-medium hover:bg-surface-2"
              >
                Cancel
              </button>
              <button
                type="button"
                autoFocus={!confirm.opts.danger}
                onClick={() => answer(true)}
                className={`h-10 rounded-btn px-4 text-sm font-semibold text-on-accent ${
                  confirm.opts.danger ? "bg-bad" : "bg-primary"
                }`}
              >
                {confirm.opts.confirmLabel ?? "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

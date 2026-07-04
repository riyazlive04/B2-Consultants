"use client";

import { useCallback, useEffect, useState } from "react";

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

const CONFETTI_COLORS = ["var(--accent)", "var(--ok)", "var(--watch)", "#ec4899", "#8b5cf6"];

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

export function FeedbackHost() {
  const [toasts, setToasts] = useState<ToastMsg[]>([]);
  const [bursts, setBursts] = useState<Burst[]>([]);
  const [confirm, setConfirm] = useState<{ opts: ConfirmOptions; resolve: (v: boolean) => void } | null>(null);

  useEffect(() => {
    let id = 0;
    let burstId = 0;
    const onToast = (e: Event) => {
      const { text, kind } = (e as CustomEvent).detail as { text: string; kind: ToastKind };
      const t = { id: ++id, text, kind };
      setToasts((prev) => [...prev.slice(-3), t]);
      setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== t.id)), 3500);
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

  // Esc closes the dialog as "cancel"
  useEffect(() => {
    if (!confirm) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") answer(false);
      if (e.key === "Enter") answer(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
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

      {/* Toasts — frosted glass with a semantic tint */}
      <div aria-live="polite" className="pointer-events-none fixed bottom-5 right-5 z-[100] flex flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className="toast-in glass-modal pointer-events-auto flex items-center gap-2.5 rounded-field px-4 py-2.5 text-sm font-medium"
            style={{ color: t.kind === "success" ? "var(--ok)" : "var(--risk)" }}
          >
            <DrawnMark kind={t.kind} />
            <span className="text-ink">{t.text}</span>
          </div>
        ))}
      </div>

      {/* Confirm dialog — frosted glass over a blurred scrim */}
      {confirm && (
        <div
          className="fixed inset-0 z-[99] flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label={confirm.opts.title}
        >
          <div className="overlay-in glass-scrim absolute inset-0" onClick={() => answer(false)} />
          <div className="dialog-in glass-modal relative w-full max-w-sm rounded-card p-6">
            <p className="font-display text-lg font-semibold">{confirm.opts.title}</p>
            {confirm.opts.body && <p className="mt-2 text-sm text-muted">{confirm.opts.body}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => answer(false)}
                className="rounded-field border border-line bg-surface/80 px-4 py-2 text-sm font-medium hover:bg-surface-2"
              >
                Cancel
              </button>
              <button
                type="button"
                autoFocus
                onClick={() => answer(true)}
                className="rounded-field px-4 py-2 text-sm font-semibold text-white shadow-sm"
                style={{ background: confirm.opts.danger ? "var(--risk)" : "var(--accent)" }}
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

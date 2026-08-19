"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * The one Call button.
 *
 * A `tel:` link is the whole dialling mechanism - on a phone it opens the dialler pre-filled, on a
 * laptop it hands off to whatever calling app is registered (FaceTime, Teams, a softphone). What
 * this adds is the part a bare link could never do: the INSTANT the button was pressed is
 * stamped, and a moment later `onDial` fires so the caller can open the outcome form with that
 * time attached. The setter finishes the call, finds the form already waiting, picks an outcome -
 * and the logged call time is when they dialled, not when they finished typing.
 *
 * Why a short delay rather than "when the user comes back to the tab": on a laptop the tab never
 * loses focus (the calling app opens beside it), and on a phone the return is unreliable to
 * detect. Opening the form right after the dialler hand-off is predictable on every device, and
 * the form is non-blocking - it simply sits there until the call is over.
 */
const OPEN_AFTER_MS = 700;

export function DialButton({
  phone,
  name,
  onDial,
  variant = "button",
  className = "",
  children,
}: {
  phone: string;
  name: string;
  /** Called shortly after the dial with the instant the button was pressed. */
  onDial: (calledAt: Date) => void;
  /** `button` = labelled primary button (desks); `icon` = bare icon for the board card. */
  variant?: "button" | "icon";
  className?: string;
  /** Icon / label content. Defaults suit the variant. */
  children?: ReactNode;
}) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const href = `tel:${phone.replace(/[^\d+]/g, "")}`;
  const cls =
    variant === "icon"
      ? `rounded p-1 text-ink-3 hover:bg-surface-2 hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${className}`
      : `inline-flex items-center gap-1.5 rounded-btn bg-primary px-3 py-1.5 text-sm font-semibold text-on-accent hover:bg-primary-strong ${className}`;

  return (
    <a
      href={href}
      aria-label={`Call ${name} on ${phone}`}
      title={`Call ${name}`}
      className={cls}
      onClick={(e) => {
        // Let the browser follow the tel: link, but never let the click bubble into a card's
        // own onClick (the board card opens its edit dialog on click).
        e.stopPropagation();
        const at = new Date();
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => onDial(at), OPEN_AFTER_MS);
      }}
    >
      {children ?? (variant === "icon" ? null : "Call")}
    </a>
  );
}

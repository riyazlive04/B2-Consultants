/**
 * A small "i" chip that reveals a plain-English definition on hover AND on keyboard
 * focus (§2.4/§2.5: several dashboard figures were unreadable because nothing said
 * what they were a percentage *of*, or how they were derived).
 *
 * Deliberately CSS-only — no state, no client boundary — so server components can
 * explain their own numbers. `tabIndex` + `aria-label` carry the same text to screen
 * readers and to keyboard users, who never get a :hover.
 */
export function InfoHint({ text, className = "" }: { text: string; className?: string }) {
  return (
    <span className={`group/tip relative inline-flex align-middle ${className}`} tabIndex={0} aria-label={text}>
      <span
        aria-hidden
        className="inline-flex h-4 w-4 flex-none cursor-help items-center justify-center rounded-full border border-line bg-surface-2 text-caption leading-none text-muted"
      >
        i
      </span>
      <span
        role="tooltip"
        // `text-surface`, not `text-white`: --ink is near-white in dark mode, so a
        // hardcoded white label would render white-on-white there.
        className="pointer-events-none absolute left-1/2 top-full z-30 mt-1.5 w-60 -translate-x-1/2 whitespace-normal rounded-field bg-ink px-2.5 py-1.5 text-left text-caption font-normal normal-case leading-snug tracking-normal text-surface opacity-0 shadow-soft transition-opacity group-hover/tip:opacity-100 group-focus-visible/tip:opacity-100"
      >
        {text}
      </span>
    </span>
  );
}

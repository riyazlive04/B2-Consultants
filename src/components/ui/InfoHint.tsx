/**
 * A small "i" chip that reveals a plain-English definition on hover AND on keyboard
 * focus (§2.4/§2.5: several dashboard figures were unreadable because nothing said
 * what they were a percentage *of*, or how they were derived).
 *
 * Deliberately CSS-only - no state, no client boundary - so server components can
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
        /* `text-surface`, not `text-white`: --ink is near-white in dark mode, so a
           hardcoded white label would render white-on-white there.

           PHONES GET A PINNED BAR, not a centred bubble. A 240px panel centred on a 16px "i" chip
           needs 120px of room each side; on a 390px screen most chips don't have it, so the hint
           rendered off the edge - unreadable, and (being absolute) it dragged the page's scroll
           width with it even while invisible. Fixed to the bottom gutters it is always fully on
           screen, and `fixed` boxes never join an ancestor's scrollable area. From `sm` up there is
           room for the bubble, so the original placement returns. */
        className="pointer-events-none fixed inset-x-4 bottom-4 z-30 w-auto translate-x-0 whitespace-normal rounded-field bg-ink px-3 py-2 text-left text-caption font-normal normal-case leading-snug tracking-normal text-surface opacity-0 shadow-pop transition-opacity group-hover/tip:opacity-100 group-focus-visible/tip:opacity-100 sm:absolute sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-full sm:mt-1.5 sm:w-60 sm:-translate-x-1/2 sm:px-2.5 sm:py-1.5 sm:shadow-soft"
      >
        {text}
      </span>
    </span>
  );
}

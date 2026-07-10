"use client";

import { useId, useRef, useState, type ReactNode } from "react";

/** Segmented tabs - full ARIA tab/tabpanel wiring with roving focus and
 *  left/right arrow-key navigation. */
export function Tabs({ tabs }: { tabs: { label: string; content: ReactNode }[] }) {
  const [active, setActive] = useState(0);
  const baseId = useId();
  const listRef = useRef<HTMLDivElement>(null);

  const focusTab = (i: number) => {
    const next = (i + tabs.length) % tabs.length;
    setActive(next);
    listRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent, i: number) => {
    if (e.key === "ArrowRight") { e.preventDefault(); focusTab(i + 1); }
    if (e.key === "ArrowLeft") { e.preventDefault(); focusTab(i - 1); }
    if (e.key === "Home") { e.preventDefault(); focusTab(0); }
    if (e.key === "End") { e.preventDefault(); focusTab(tabs.length - 1); }
  };

  return (
    <div>
      <div
        ref={listRef}
        role="tablist"
        aria-orientation="horizontal"
        className="flex flex-wrap gap-1 rounded-field bg-surface-2 p-1"
      >
        {tabs.map((t, i) => (
          <button
            key={t.label}
            role="tab"
            type="button"
            id={`${baseId}-tab-${i}`}
            aria-selected={i === active}
            aria-controls={`${baseId}-panel-${i}`}
            tabIndex={i === active ? 0 : -1}
            onClick={() => setActive(i)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={`rounded-[9px] px-3.5 py-1.5 text-sm font-medium transition-colors ${
              i === active
                ? "bg-accent text-white shadow-sm"
                : "text-muted hover:text-ink"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id={`${baseId}-panel-${active}`}
        aria-labelledby={`${baseId}-tab-${active}`}
        className="pt-5"
      >
        {tabs[active]?.content}
      </div>
    </div>
  );
}

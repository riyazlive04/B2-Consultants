"use client";

import { useState, type ReactNode } from "react";

export function Tabs({ tabs }: { tabs: { label: string; content: ReactNode }[] }) {
  const [active, setActive] = useState(0);
  return (
    <div>
      <div
        role="tablist"
        aria-orientation="horizontal"
        className="flex flex-wrap gap-1 rounded-field bg-surface-2 p-1"
      >
        {tabs.map((t, i) => (
          <button
            key={t.label}
            role="tab"
            type="button"
            aria-selected={i === active}
            onClick={() => setActive(i)}
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
      <div className="pt-5">{tabs[active]?.content}</div>
    </div>
  );
}

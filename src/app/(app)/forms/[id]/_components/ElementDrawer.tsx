"use client";

import { useState } from "react";
import * as Icons from "lucide-react";
import { ELEMENT_PALETTE, type PaletteItem } from "@/lib/sites-types";

/**
 * The "Form Element" drawer - the left rail of the builder.
 *
 * Two tabs, matching the tool the team already uses: QUICK ADD is the generic toolkit (a single
 * line, a dropdown, an image), ADD OBJECT FIELDS is the set that writes a KNOWN key on the contact
 * record - Full Name, Email, Phone, City. That split is not decoration: picking "Email" from the
 * second tab means the answer reaches the CRM as the contact's email, while a "Single Line"
 * question called "email" is just an answer. Making the author remember which keys are magic is
 * exactly the job a palette should be doing for them.
 *
 * Tiles are icon-over-caption at a fixed size so the eye scans the grid by shape, which is how
 * anyone who has used this drawer before already navigates it.
 */

/**
 * Resolve a Lucide icon by name.
 *
 * The palette lives in `lib/sites-types`, which is imported by the SERVER (validation, the submit
 * action) and must stay free of React - so it names its icons as strings and the lookup happens
 * here. `Square` is the fallback rather than throwing: a typo in the palette should cost a
 * generic tile, not a blank screen where the builder used to be.
 */
function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const map = Icons as unknown as Record<string, React.ComponentType<{ size?: number; className?: string }>>;
  const Cmp = map[name] ?? Icons.Square;
  return <Cmp size={size} className="text-ink-2" />;
}

export default function ElementDrawer({
  open,
  onClose,
  onAdd,
}: {
  open: boolean;
  onClose: () => void;
  onAdd: (item: PaletteItem) => void;
}) {
  const [tab, setTab] = useState<"quick" | "object">("quick");
  const groups = ELEMENT_PALETTE.filter((g) => (tab === "quick" ? g.quick : !g.quick));

  if (!open) return null;

  return (
    <aside className="w-[236px] flex-none overflow-y-auto border-r border-line bg-surface">
      <div className="flex items-center justify-between border-b border-line px-3 py-2.5">
        <p className="text-sm font-semibold text-ink">Form Element</p>
        <button type="button" onClick={onClose} aria-label="Close the element panel" className="text-ink-3 hover:text-ink">
          <Icons.X size={15} />
        </button>
      </div>

      <div role="tablist" aria-label="Element source" className="flex border-b border-line">
        {([
          { key: "quick", label: "Quick Add" },
          { key: "object", label: "Add Object Fields" },
        ] as const).map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={`flex-1 px-2 py-2 text-[12px] font-semibold ${
              tab === t.key ? "border-b-2 border-primary text-primary-strong" : "text-ink-3 hover:text-ink-2"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="space-y-4 p-3">
        {groups.map((g) => (
          <div key={g.group}>
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-3">{g.group}</p>
            <div className="grid grid-cols-3 gap-1.5">
              {g.items.map((it) => (
                <button
                  key={`${g.group}-${it.label}`}
                  type="button"
                  // Disabled, not hidden. The team knows this palette; a missing tile reads as
                  // "the tool can't do that", a greyed one reads as "not yet".
                  disabled={it.soon}
                  title={it.soon ? `${it.label} - not built yet` : `Add ${it.label}`}
                  onClick={() => onAdd(it)}
                  className={`flex h-[62px] flex-col items-center justify-center gap-1 rounded-field border border-line px-1 text-center transition-colors ${
                    it.soon ? "cursor-not-allowed opacity-40" : "hover:border-primary hover:bg-primary-soft"
                  }`}
                >
                  <Icon name={it.icon} />
                  <span className="line-clamp-2 text-[10px] font-medium leading-tight text-ink-2">{it.label}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
        {tab === "object" && (
          <p className="text-caption text-ink-3">
            These write a known key on the contact record, so the answer reaches the CRM as the person&apos;s
            name, email or phone rather than as a loose answer.
          </p>
        )}
      </div>
    </aside>
  );
}

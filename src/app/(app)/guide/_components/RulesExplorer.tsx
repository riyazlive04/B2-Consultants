"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { ROLE_NAMES, type GuideControl } from "@/lib/guide/manual-types";

type Row = GuideControl & {
  usedBy: { section: string; sectionLabel: string; feature: string; featureId: string }[];
};
type Group = { destination: string; href: string; rows: Row[] };

/**
 * The Rules map's list, with a filter. Client-side because the whole map is a few hundred rows of
 * text already on the page - a round trip per keystroke would be slower than the browser.
 */
export function RulesExplorer({ groups }: { groups: Group[] }) {
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();

  const shown = useMemo(() => {
    if (!needle) return groups;
    return groups
      .map((g) => ({
        ...g,
        rows: g.rows.filter((r) =>
          [g.destination, r.setting, r.effect, r.default ?? "", ...r.usedBy.map((u) => `${u.sectionLabel} ${u.feature}`)]
            .join(" ")
            .toLowerCase()
            .includes(needle),
        ),
      }))
      .filter((g) => g.rows.length > 0);
  }, [groups, needle]);

  return (
    <div className="space-y-6">
      <label className="flex h-11 max-w-xl items-center gap-2 rounded-full border border-line-strong bg-surface px-4 text-sm focus-within:ring-2 focus-within:ring-primary">
        <Search size={16} aria-hidden className="text-ink-3" />
        <span className="sr-only">Filter rules</span>
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Filter: commission, cutoff, WhatsApp, invoice…"
          className="h-full min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-ink-3"
        />
      </label>

      {shown.length === 0 && <p className="text-sm text-muted">No rule matches “{q}”.</p>}

      {shown.map((g) => (
        <section key={g.destination} className="overflow-hidden rounded-card border border-line bg-surface shadow-card">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-6 py-4">
            <h2 className="font-display text-h3 text-ink">{g.destination}</h2>
            <Link href={g.href} className="text-sm font-semibold text-accent hover:underline">
              Open →
            </Link>
          </div>
          <ul className="divide-y divide-line">
            {g.rows.map((r) => (
              <li key={r.setting} className="grid gap-3 px-6 py-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
                <div className="min-w-0 space-y-1">
                  <p className="font-medium text-ink">{r.setting}</p>
                  {r.default && (
                    <p className="text-caption text-ink-3">
                      Default: <span className="text-ink-2">{r.default}</span>
                    </p>
                  )}
                  <p className="text-caption text-ink-3">
                    Who: <span className="text-ink-2">{r.who.map((w) => ROLE_NAMES[w]).join(", ")}</span>
                  </p>
                </div>
                <div className="min-w-0 space-y-2 text-sm">
                  <p className="text-ink-2">{r.effect}</p>
                  {r.reset && <p className="text-ink-3">Reset: {r.reset}</p>}
                  <p className="flex flex-wrap items-center gap-1.5 text-caption text-ink-3">
                    Used by:
                    {r.usedBy.map((u) => (
                      <Link
                        key={`${u.section}-${u.featureId}`}
                        href={`/guide/${u.section}#${u.featureId}`}
                        className="rounded-field bg-surface-2 px-1.5 py-0.5 font-medium text-ink-2 hover:text-ink hover:underline"
                      >
                        {u.sectionLabel} › {u.feature}
                      </Link>
                    ))}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

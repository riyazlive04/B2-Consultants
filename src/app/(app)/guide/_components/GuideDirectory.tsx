"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowRight, Search } from "lucide-react";
import type { SectionIconName } from "@/lib/sections";
import { FallbackIcon, SECTION_ICONS } from "@/components/shell/section-icons";

export type DirectorySection = {
  key: string;
  label: string;
  icon: SectionIconName;
  what: string;
  features: { id: string; name: string; text: string }[];
};
export type DirectoryGroup = { group: string; sections: DirectorySection[] };

/**
 * Every manual the viewer can open, grouped exactly as their sidebar is - plus one search box over
 * all of them.
 *
 * Grouped like the rail because that is the map people already have in their heads: someone
 * looking for how subscriptions work knows it is "under Finance" long before they know it is a tab
 * of Payments. The search reaches past the section names into every tab's steps and rules, so
 * "surcharge" finds the instalment-plan rule without the reader knowing which screen owns it.
 */
export function GuideDirectory({ groups }: { groups: DirectoryGroup[] }) {
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();

  const hits = useMemo(() => {
    if (!needle) return [];
    const out: { href: string; title: string; context: string }[] = [];
    for (const g of groups) {
      for (const s of g.sections) {
        if (`${s.label} ${s.what}`.toLowerCase().includes(needle)) {
          out.push({ href: `/guide/${s.key}`, title: s.label, context: s.what });
        }
        for (const f of s.features) {
          if (`${f.name} ${f.text}`.toLowerCase().includes(needle)) {
            out.push({ href: `/guide/${s.key}#${f.id}`, title: `${s.label} › ${f.name}`, context: excerpt(f.text, needle) });
          }
        }
      }
    }
    return out.slice(0, 40);
  }, [groups, needle]);

  return (
    <div className="space-y-6">
      <label className="flex h-12 max-w-2xl items-center gap-2 rounded-full border border-line-strong bg-surface px-4 text-sm shadow-card focus-within:ring-2 focus-within:ring-primary">
        <Search size={17} aria-hidden className="text-ink-3" />
        <span className="sr-only">Search the guide</span>
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search every screen: subscriptions, commission, attendance, cutoff…"
          className="h-full min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-ink-3"
        />
      </label>

      {needle ? (
        <section aria-live="polite" className="space-y-2">
          <p className="text-caption text-ink-3">
            {hits.length === 0 ? `Nothing in the guide mentions “${q}”.` : `${hits.length}${hits.length === 40 ? "+" : ""} matches`}
          </p>
          <ul className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface shadow-card">
            {hits.map((h) => (
              <li key={h.href}>
                <Link href={h.href} className="block px-5 py-3 transition-colors hover:bg-surface-2">
                  <span className="font-medium text-ink">{h.title}</span>
                  <span className="mt-0.5 block text-sm text-ink-2">{h.context}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <div className="space-y-8">
          {groups.map((g) => (
            <section key={g.group} aria-labelledby={`guide-group-${slug(g.group)}`} className="space-y-3">
              <h2 id={`guide-group-${slug(g.group)}`} className="text-label font-semibold uppercase text-ink-3">
                {g.group}
              </h2>
              <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {g.sections.map((s) => {
                  const Icon = SECTION_ICONS[s.icon] ?? FallbackIcon;
                  return (
                    <li key={s.key}>
                      <Link
                        href={`/guide/${s.key}`}
                        className="group flex h-full flex-col rounded-card border border-line bg-surface p-4 shadow-card transition-colors hover:border-primary-tint"
                      >
                        <span className="flex items-center gap-2.5">
                          <span aria-hidden className="grid h-9 w-9 flex-none place-items-center rounded-field bg-primary-soft text-primary">
                            <Icon size={17} />
                          </span>
                          <span className="font-display text-h3 text-ink">{s.label}</span>
                        </span>
                        <span className="mt-2 line-clamp-2 text-sm text-ink-2">{s.what}</span>
                        <span className="mt-3 flex flex-wrap gap-1">
                          {s.features.slice(0, 6).map((f) => (
                            <span key={f.id} className="rounded-field bg-surface-2 px-1.5 py-0.5 text-caption text-ink-2">
                              {f.name}
                            </span>
                          ))}
                          {s.features.length > 6 && (
                            <span className="px-1 py-0.5 text-caption text-ink-3">+{s.features.length - 6} more</span>
                          )}
                        </span>
                        <span className="mt-auto inline-flex items-center gap-1 pt-3 text-sm font-semibold text-accent">
                          Read the manual <ArrowRight size={14} aria-hidden className="transition-transform group-hover:translate-x-0.5" />
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-");

/** The sentence around the match, so a result says WHY it matched. */
function excerpt(text: string, needle: string): string {
  const i = text.toLowerCase().indexOf(needle);
  if (i < 0) return text.slice(0, 160);
  const dot = text.lastIndexOf(". ", i);
  const start = dot < 0 ? 0 : dot + 2;
  const end = text.indexOf(". ", i + needle.length);
  const sentence = text.slice(start, end < 0 ? undefined : end + 1);
  return sentence.length > 220 ? `${sentence.slice(0, 217)}…` : sentence;
}

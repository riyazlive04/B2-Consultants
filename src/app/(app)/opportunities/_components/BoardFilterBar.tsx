"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search, X } from "lucide-react";
import { Select } from "@/components/ui/form";

/**
 * Search and filter for the Opportunities board.
 *
 * The board had none — while its own overflow message told the reader to "filter or split this
 * pipeline" at 300+ cards in a stage. That advice pointed at a control that did not exist, which
 * only went unnoticed because production held a single opportunity.
 *
 * Everything is written to the URL and re-queried on the SERVER (`getBoard`'s `cardWhere`).
 * Filtering in the browser would filter the already-capped 300-card slice, so searching for a
 * deal at position 400 would return "nothing found" for a deal that exists.
 */

const STATUSES = [
  { value: "", label: "Any status" },
  { value: "OPEN", label: "Open" },
  { value: "WON", label: "Won" },
  { value: "LOST", label: "Lost" },
  { value: "ABANDONED", label: "Abandoned" },
];

export function BoardFilterBar({
  owners,
  filtered,
}: {
  owners: { id: string; name: string }[];
  filtered: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const urlQ = searchParams.get("q") ?? "";
  const [q, setQ] = useState(urlQ);
  // Keep the box in step when the URL changes from somewhere else (Clear, back button) without
  // fighting the user mid-type.
  const typing = useRef(false);
  useEffect(() => {
    if (!typing.current) setQ(urlQ);
  }, [urlQ]);

  const push = (patch: Record<string, string>) => {
    const params = new URLSearchParams(searchParams.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) params.set(k, v);
      else params.delete(k);
    }
    router.push(`${pathname}?${params.toString()}`);
  };

  // Debounced into the URL 400ms after typing stops — a server round-trip per keystroke against
  // Supabase (~205ms each) would make the box feel broken.
  useEffect(() => {
    if (q === urlQ) return;
    typing.current = true;
    const id = setTimeout(() => {
      typing.current = false;
      push({ q });
    }, 400);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const clear = () => {
    const params = new URLSearchParams(searchParams.toString());
    for (const k of ["q", "owner", "status"]) params.delete(k);
    setQ("");
    router.push(`${pathname}?${params.toString()}`);
  };

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-card border border-line bg-surface px-3 py-2.5 shadow-card">
      <div className="relative min-w-48 flex-1">
        <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search deals, contacts, phone or email…"
          aria-label="Search opportunities"
          className="h-9 w-full rounded-field border border-line-strong bg-surface pl-9 pr-3 text-sm text-ink outline-none transition-colors focus:border-primary"
        />
      </div>

      <Select
        size="sm"
        aria-label="Filter by owner"
        value={searchParams.get("owner") ?? ""}
        onChange={(e) => push({ owner: e.target.value })}
        options={[{ value: "", label: "Any owner" }, ...owners.map((o) => ({ value: o.id, label: o.name }))]}
      />
      <Select
        size="sm"
        aria-label="Filter by status"
        value={searchParams.get("status") ?? ""}
        onChange={(e) => push({ status: e.target.value })}
        options={STATUSES}
      />

      {filtered && (
        <button
          type="button"
          onClick={clear}
          className="inline-flex h-9 items-center gap-1 rounded-field border border-line px-2.5 text-xs font-semibold text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
        >
          <X size={13} /> Clear
        </button>
      )}
    </div>
  );
}

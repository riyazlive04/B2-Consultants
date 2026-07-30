"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search, X } from "lucide-react";

/**
 * The Journal search box.
 *
 * It drives the `?q=` param the Ledger page reads and hands to `getJournal`, so the filter
 * runs in the database across EVERY entry — not just the 25 rendered on the current page —
 * and the matches are then paginated. Typing is debounced, and any new query jumps back to
 * page 1 so results can't sit past the end of a page the reader is no longer on.
 */
export function JournalSearch({ initialQuery }: { initialQuery: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [value, setValue] = useState(initialQuery);

  // Stay in sync if the URL changes from elsewhere (browser back, a cleared search).
  useEffect(() => {
    setValue(initialQuery);
  }, [initialQuery]);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const push = (next: string) => {
    const params = new URLSearchParams(searchParams);
    const q = next.trim();
    if (q) params.set("q", q);
    else params.delete("q");
    params.delete("page"); // a new search restarts at page 1
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  const onChange = (next: string) => {
    setValue(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => push(next), 300);
  };

  const clear = () => {
    setValue("");
    if (timer.current) clearTimeout(timer.current);
    push("");
  };

  return (
    <div className="relative w-full sm:w-72">
      <Search
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
        size={15}
      />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search journal…"
        aria-label="Search journal entries"
        className="h-10 w-full rounded-field border border-line bg-surface pl-9 pr-9 text-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary-soft"
      />
      {value && (
        <button
          type="button"
          onClick={clear}
          aria-label="Clear search"
          className="press absolute right-2 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-full text-muted transition-colors hover:bg-surface-2 hover:text-ink"
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}

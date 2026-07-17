"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronDown, Search, Users } from "lucide-react";
import { Popover, fieldButtonCls } from "@/components/ui/field-base";
import {
  AGREEMENT_GROUP_LABELS,
  AGREEMENT_GROUP_ORDER,
  type AgreementGroup,
  type AgreementWorkflowConfig,
} from "@/lib/agreement-state";
import type { AgreementCandidate } from "@/server/agreement-state";
import { AgreementStateBadge } from "./AgreementStateBadge";

/**
 * "Start from an existing record", rebuilt.
 *
 * The old version printed every won lead and every student as a flat wall of chips — unscannable
 * past a dozen rows, and it told you nothing about WHY you'd pick one. This is a filtered combobox:
 * type to search across name / phone / email / stage, filter to a bucket, and every row wears the
 * state that decides whether it needs you at all. Ready-to-send sorts to the top because that is
 * the only group the founder is usually here for.
 *
 * Selecting navigates to `?leadId=` / `?studentId=`, exactly as the chips did — the server page
 * re-renders with the prefill, so the form stays the single owner of what gets frozen.
 */

// Beyond this the list stops being a list. Search narrows long before you'd ever need to scroll it.
const MAX_ROWS = 80;

export function AgreementClientPicker({
  candidates,
  config,
}: {
  candidates: AgreementCandidate[];
  config: AgreementWorkflowConfig;
}) {
  const router = useRouter();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [groupFilter, setGroupFilter] = useState<AgreementGroup | null>(null);
  const [active, setActive] = useState(0);

  // Which buckets actually exist, with counts — the filter chips never offer an empty group.
  const groupCounts = useMemo(() => {
    const m = new Map<AgreementGroup, number>();
    for (const c of candidates) m.set(c.group, (m.get(c.group) ?? 0) + 1);
    return AGREEMENT_GROUP_ORDER.filter((g) => m.has(g)).map((g) => ({ group: g, count: m.get(g)! }));
  }, [candidates]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const match = (c: AgreementCandidate) =>
      (!groupFilter || c.group === groupFilter) &&
      (!q ||
        c.name.toLowerCase().includes(q) ||
        c.subtitle.toLowerCase().includes(q) ||
        (c.phone ?? "").toLowerCase().includes(q) ||
        (c.email ?? "").toLowerCase().includes(q));

    // Filter → cap → group, so a truncated list never shows a header with nothing under it.
    const hits: AgreementCandidate[] = [];
    for (const g of AGREEMENT_GROUP_ORDER) {
      for (const c of candidates) if (c.group === g && match(c)) hits.push(c);
    }
    const capped = hits.slice(0, MAX_ROWS);
    const groups = AGREEMENT_GROUP_ORDER.map((g) => ({
      group: g,
      rows: capped.filter((c) => c.group === g),
    })).filter((x) => x.rows.length > 0);
    return { groups, flat: capped, overflow: hits.length - capped.length };
  }, [candidates, query, groupFilter]);

  function commit(c: AgreementCandidate | undefined) {
    if (!c) return;
    setOpen(false);
    const param = c.kind === "lead" ? "leadId" : "studentId";
    router.push(`/agreements/new?${param}=${c.id}`);
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, shown.flat.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      commit(shown.flat[active]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    }
  }

  // Keep the highlighted row in view as the arrows walk past the fold.
  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          setOpen((o) => !o);
          setActive(0);
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={fieldButtonCls("md", false, open)}
      >
        <span className="flex min-w-0 items-center gap-2">
          <Users size={15} className="flex-none text-ink-3" />
          <span className="truncate text-ink-3">Search a client by name, phone, email or stage…</span>
        </span>
        <ChevronDown
          size={16}
          aria-hidden
          className={`flex-none text-ink-3 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      <Popover
        anchorRef={triggerRef}
        open={open}
        onClose={() => setOpen(false)}
        role="dialog"
        className="w-[min(34rem,calc(100vw-2rem))] p-0"
      >
        {/* Search */}
        <div className="flex items-center gap-2 border-b border-line px-3 py-2">
          <Search size={15} className="flex-none text-ink-3" aria-hidden />
          <input
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKey}
            role="combobox"
            aria-expanded={open}
            aria-controls="agreement-client-list"
            aria-activedescendant={shown.flat[active] ? `acl-${active}` : undefined}
            placeholder="Search clients…"
            className="h-8 w-full bg-transparent text-sm text-ink outline-none placeholder:text-ink-3"
          />
        </div>

        {/* Bucket filters */}
        {groupCounts.length > 1 && (
          <div className="flex flex-wrap gap-1.5 border-b border-line px-3 py-2">
            <FilterChip
              label="All"
              count={candidates.length}
              activeChip={groupFilter === null}
              onClick={() => {
                setGroupFilter(null);
                setActive(0);
              }}
            />
            {groupCounts.map(({ group, count }) => (
              <FilterChip
                key={group}
                label={AGREEMENT_GROUP_LABELS[group]}
                count={count}
                activeChip={groupFilter === group}
                onClick={() => {
                  setGroupFilter((g) => (g === group ? null : group));
                  setActive(0);
                }}
              />
            ))}
          </div>
        )}

        {/* Grouped results */}
        <div ref={listRef} id="agreement-client-list" role="listbox" className="max-h-80 overflow-auto py-1">
          {shown.flat.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-muted">
              No client matches “{query}”.
            </p>
          ) : (
            shown.groups.map((g) => (
              <div key={g.group}>
                <p className="sticky top-0 bg-surface px-3 py-1.5 text-caption font-semibold uppercase tracking-wide text-ink-3">
                  {AGREEMENT_GROUP_LABELS[g.group]}
                </p>
                {g.rows.map((c) => {
                  const i = shown.flat.indexOf(c);
                  const isActive = i === active;
                  return (
                    <div
                      key={`${c.kind}-${c.id}`}
                      id={`acl-${i}`}
                      data-idx={i}
                      role="option"
                      aria-selected={isActive}
                      onPointerEnter={() => setActive(i)}
                      onClick={() => commit(c)}
                      className={`mx-1 flex cursor-pointer items-center gap-3 rounded-btn px-2 py-2 ${
                        isActive ? "bg-surface-2" : ""
                      }`}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-ink">{c.name}</span>
                        <span className="block truncate text-caption text-muted">
                          {c.subtitle}
                          {c.phone ? ` · ${c.phone}` : ""}
                        </span>
                      </span>
                      <AgreementStateBadge state={c.state} config={config} size="sm" />
                      {isActive && <Check size={14} className="flex-none text-primary" aria-hidden />}
                    </div>
                  );
                })}
              </div>
            ))
          )}
          {shown.overflow > 0 && (
            <p className="px-3 py-2 text-center text-caption text-ink-3">
              +{shown.overflow} more — keep typing to narrow it down.
            </p>
          )}
        </div>
      </Popover>
    </>
  );
}

function FilterChip({
  label,
  count,
  activeChip,
  onClick,
}: {
  label: string;
  count: number;
  activeChip: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={activeChip}
      className={`rounded-full border px-2 py-0.5 text-caption font-medium transition-colors ${
        activeChip
          ? "border-primary bg-primary-soft text-primary"
          : "border-line text-ink-2 hover:border-primary hover:text-primary"
      }`}
    >
      {label} <span className="tabular-nums opacity-70">{count}</span>
    </button>
  );
}

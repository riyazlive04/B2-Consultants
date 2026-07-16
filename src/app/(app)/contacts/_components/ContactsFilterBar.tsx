"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Filter, X, Bookmark, Trash2, Search } from "lucide-react";
import { Btn } from "@/components/ui/controls";
import { Select } from "@/components/ui/form";
import { DatePicker } from "@/components/ui/DatePicker";
import type { ContactListFilters } from "@/server/contacts-metrics";

/**
 * Multi-field filter panel + saved views (BUILD_CHECKLIST.md §3) sitting above ContactsTable.
 * Every filter is a URL search param, so the Contacts page stays a plain server-rendered list —
 * this component only ever reads/writes the URL, `getContactsList` in page.tsx does the actual
 * filtering server-side (see contacts-metrics.ts).
 *
 * Saved views are `localStorage`-only, per the task's own guidance: a proper server-side store
 * would need a schema change (a per-user "saved view" table), which is off-limits this round.
 * `AppSetting` was considered as a founder-config-shaped alternative, but it's a single global
 * JSON blob the founder edits from /console — not a per-user list a telecaller adds to freely —
 * so it's the wrong shape for this. localStorage also means each device keeps its own views,
 * which is a real limitation (not synced across a user's laptop + phone) but avoids inventing a
 * new persistence layer for a Phase-2, non-schema pass.
 */

const STAGE_OPTS = [
  { value: "NEW_LEAD", label: "New Lead" },
  { value: "DISCO_BOOKED", label: "Disco Booked" },
  { value: "DISCO_NOT_BOOKED", label: "Disco Not Booked" },
  { value: "DISCO_COMPLETED", label: "Disco Completed" },
  { value: "SSS_BOOKED", label: "SSS Booked" },
  { value: "SSS_COMPLETED", label: "SSS Completed" },
  { value: "PROPOSAL_SENT", label: "Proposal Sent" },
  { value: "SENT_TO_WORKSHOP", label: "Sent To Workshop" },
  { value: "WORKSHOP_FOLLOWUP", label: "Workshop Followup" },
  { value: "OFFER_FOLLOWUP", label: "Offer Followup" },
  { value: "DEPOSIT_FOLLOWUP", label: "Deposit Followup" },
  { value: "DEPOSIT_PAID", label: "Deposit Paid" },
  { value: "WON", label: "Won" },
  { value: "LOST", label: "Lost" },
  { value: "NO_SHOW", label: "No Show" },
];

// Full LeadSource enum (not just the subset offered when manually adding a contact) — an
// existing lead can carry a webhook-ingested source (META_ADS / LANDING_PAGE) that the "Add
// contact" form never lets a human pick, so the filter must still be able to find it.
const SOURCE_OPTS = [
  { value: "INSTAGRAM", label: "Instagram" }, { value: "YOUTUBE", label: "YouTube" },
  { value: "LINKEDIN", label: "LinkedIn" }, { value: "WHATSAPP", label: "WhatsApp" },
  { value: "REFERRAL", label: "Referral" }, { value: "SUMMIT", label: "Summit" },
  { value: "WORKSHOP", label: "Workshop" }, { value: "META_ADS", label: "Meta Ads" },
  { value: "LANDING_PAGE", label: "Landing Page" }, { value: "GHOSTED_BLUEPRINT", label: "Ghosted Blueprint" },
  { value: "OTHER", label: "Other" },
];

const FILTER_KEYS = ["q", "owner", "stage", "source", "city", "from", "to", "tag"] as const;
type FilterKey = (typeof FILTER_KEYS)[number];

type SavedView = { id: string; name: string; params: Partial<Record<FilterKey, string>> };
const STORAGE_KEY = "b2-contacts-saved-views";

function readSavedViews(): SavedView[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function ContactsFilterBar({ filters }: { filters: ContactListFilters }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [panelOpen, setPanelOpen] = useState(false);
  const [viewsOpen, setViewsOpen] = useState(false);
  const [savedViews, setSavedViews] = useState<SavedView[]>([]);
  const [newViewName, setNewViewName] = useState("");

  // Local buffers for the two free-text fields so every keystroke doesn't force a navigation —
  // debounced into the URL 400ms after typing stops.
  const [qLocal, setQLocal] = useState(searchParams.get("q") ?? "");
  const [cityLocal, setCityLocal] = useState(searchParams.get("city") ?? "");

  useEffect(() => setSavedViews(readSavedViews()), []);
  useEffect(() => setQLocal(searchParams.get("q") ?? ""), [searchParams]);
  useEffect(() => setCityLocal(searchParams.get("city") ?? ""), [searchParams]);

  function currentParams(): Partial<Record<FilterKey, string>> {
    const out: Partial<Record<FilterKey, string>> = {};
    for (const k of FILTER_KEYS) {
      const v = searchParams.get(k);
      if (v) out[k] = v;
    }
    return out;
  }

  function navigate(next: Partial<Record<FilterKey, string>>) {
    const usp = new URLSearchParams();
    for (const k of FILTER_KEYS) {
      const v = next[k];
      if (v) usp.set(k, v);
    }
    // Any filter change starts back at page 1 — a stale cursor from the old filter set would
    // point into results the new `where` clause may not even contain.
    router.push(usp.toString() ? `${pathname}?${usp}` : pathname);
  }

  function setFilter(key: FilterKey, value: string) {
    const next = currentParams();
    if (value) next[key] = value;
    else delete next[key];
    navigate(next);
  }

  // Debounce the two free-text inputs into the URL.
  useEffect(() => {
    const handle = setTimeout(() => {
      if (qLocal !== (searchParams.get("q") ?? "")) setFilter("q", qLocal);
    }, 400);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qLocal]);
  useEffect(() => {
    const handle = setTimeout(() => {
      if (cityLocal !== (searchParams.get("city") ?? "")) setFilter("city", cityLocal);
    }, 400);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cityLocal]);

  const active = currentParams();
  const activeCount = Object.keys(active).length;

  function clearAll() {
    setQLocal("");
    setCityLocal("");
    navigate({});
  }

  function persistViews(next: SavedView[]) {
    setSavedViews(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* private browsing / storage full — the view just won't survive reload */
    }
  }

  function saveCurrentView() {
    const name = newViewName.trim();
    if (!name) return;
    const view: SavedView = { id: `${Date.now()}`, name, params: currentParams() };
    persistViews([...savedViews.filter((v) => v.name !== name), view]);
    setNewViewName("");
  }

  function loadView(v: SavedView) {
    setQLocal(v.params.q ?? "");
    setCityLocal(v.params.city ?? "");
    navigate(v.params);
    setViewsOpen(false);
  }

  function deleteView(id: string) {
    persistViews(savedViews.filter((v) => v.id !== id));
  }

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" size={15} />
          <input
            value={qLocal}
            onChange={(e) => setQLocal(e.target.value)}
            placeholder="Search contacts — name, phone, email…"
            aria-label="Search contacts"
            className="h-10 w-full rounded-field border border-line-strong bg-surface pl-9 pr-3 text-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary-soft"
          />
        </div>
        <button
          type="button"
          onClick={() => setPanelOpen((v) => !v)}
          className={`inline-flex h-10 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium ${
            panelOpen || activeCount > 0
              ? "border-primary-tint bg-primary-soft text-primary-strong"
              : "border-line-strong bg-surface text-ink-2 hover:bg-surface-2"
          }`}
        >
          <Filter size={14} /> Filters{activeCount ? ` · ${activeCount}` : ""}
        </button>
        {activeCount > 0 && (
          <button
            type="button"
            onClick={clearAll}
            className="inline-flex h-10 items-center gap-1 rounded-full px-2 text-sm font-medium text-ink-3 hover:text-bad"
          >
            <X size={14} /> Clear
          </button>
        )}
        <div className="relative ml-auto">
          <Btn size="sm" variant="ghost" icon={<Bookmark size={14} />} onClick={() => setViewsOpen((v) => !v)}>
            Saved views{savedViews.length ? ` (${savedViews.length})` : ""}
          </Btn>
          {viewsOpen && (
            <div className="absolute right-0 top-full z-20 mt-1.5 w-72 space-y-2 rounded-field border border-line bg-surface p-3 shadow-pop">
              {savedViews.length === 0 && <p className="text-xs text-ink-3">No saved views yet.</p>}
              {savedViews.map((v) => (
                <div key={v.id} className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => loadView(v)}
                    className="flex-1 truncate rounded-field px-2 py-1.5 text-left text-sm text-ink-2 hover:bg-surface-2 hover:text-ink"
                  >
                    {v.name}
                  </button>
                  <button
                    type="button"
                    aria-label={`Delete saved view "${v.name}"`}
                    onClick={() => deleteView(v.id)}
                    className="grid h-8 w-8 flex-none place-items-center rounded-field text-ink-3 hover:bg-risk-soft hover:text-risk"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
              <div className="flex items-center gap-1.5 border-t border-line pt-2">
                <input
                  value={newViewName}
                  onChange={(e) => setNewViewName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && saveCurrentView()}
                  placeholder="Name this filter combo…"
                  disabled={activeCount === 0}
                  className="h-9 flex-1 rounded-field border border-line bg-surface px-2.5 text-sm outline-none focus:border-primary disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-ink-disabled"
                />
                <Btn size="sm" disabled={activeCount === 0 || !newViewName.trim()} onClick={saveCurrentView}>
                  Save
                </Btn>
              </div>
              {activeCount === 0 && <p className="text-xs text-ink-3">Set at least one filter to save it as a view.</p>}
            </div>
          )}
        </div>
      </div>

      {panelOpen && (
        <div className="grid grid-cols-1 gap-2.5 rounded-field border border-line bg-surface-2 p-3 sm:grid-cols-2 lg:grid-cols-5">
          <Select
            aria-label="Owner"
            size="sm"
            value={active.owner ?? ""}
            onChange={(e) => setFilter("owner", e.target.value)}
            options={[{ value: "", label: "All owners" }, ...filters.owners.map((o) => ({ value: o.id, label: o.name }))]}
          />
          <Select
            aria-label="Stage"
            size="sm"
            value={active.stage ?? ""}
            onChange={(e) => setFilter("stage", e.target.value)}
            options={[{ value: "", label: "All stages" }, ...STAGE_OPTS]}
          />
          <Select
            aria-label="Source"
            size="sm"
            value={active.source ?? ""}
            onChange={(e) => setFilter("source", e.target.value)}
            options={[{ value: "", label: "All sources" }, ...SOURCE_OPTS]}
          />
          <input
            aria-label="City"
            value={cityLocal}
            onChange={(e) => setCityLocal(e.target.value)}
            placeholder="City"
            className="h-9 rounded-field border border-line bg-surface px-2.5 text-sm outline-none focus:border-primary"
          />
          <div className="flex items-center gap-1.5">
            <DatePicker
              size="sm"
              aria-label="Created from"
              className="min-w-0 flex-1"
              value={active.from ?? ""}
              onChange={(e) => setFilter("from", e.target.value)}
            />
            <span className="text-ink-3">–</span>
            <DatePicker
              size="sm"
              aria-label="Created to"
              className="min-w-0 flex-1"
              value={active.to ?? ""}
              onChange={(e) => setFilter("to", e.target.value)}
            />
          </div>

          {filters.tags.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 sm:col-span-2 lg:col-span-5">
              <span className="text-caption font-semibold uppercase text-ink-3">Tag</span>
              <button
                type="button"
                onClick={() => setFilter("tag", "")}
                className={`rounded-full px-2.5 py-0.5 text-caption font-semibold ${!active.tag ? "bg-primary text-on-accent" : "bg-surface text-ink-2"}`}
              >
                All
              </button>
              {filters.tags.slice(0, 24).map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setFilter("tag", active.tag === t.id ? "" : t.id)}
                  className={`rounded-full px-2.5 py-0.5 text-caption font-semibold ${active.tag === t.id ? "bg-primary text-on-accent" : "bg-surface text-ink-2"}`}
                >
                  {t.name} <span className="opacity-60">{t.count}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

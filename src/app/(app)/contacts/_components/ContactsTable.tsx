"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Plus, Tag as TagIcon, ChevronLeft, ChevronRight, Phone, Mail, MessageCircle } from "lucide-react";
import type { ContactRow, ContactListFilters, ContactsListResult } from "@/server/contacts-metrics";
import { Btn } from "@/components/ui/controls";
import { Modal } from "@/components/ui/Modal";
import { Field, TextInput, Select, SubmitButton, FormError } from "@/components/ui/form";
import { PhoneField } from "@/components/ui/PhoneField";
import { toast } from "@/components/ui/feedback";
import { Avatar, Chip, Pill } from "@/components/ui/kit";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { DateText } from "@/components/ui/DateText";
import { createContact, bulkAddTag } from "@/server/contacts-actions";
import { ContactsFilterBar } from "./ContactsFilterBar";

const SOURCE_OPTS = [
  { value: "INSTAGRAM", label: "Instagram" }, { value: "YOUTUBE", label: "YouTube" },
  { value: "LINKEDIN", label: "LinkedIn" }, { value: "WHATSAPP", label: "WhatsApp" },
  { value: "REFERRAL", label: "Referral" }, { value: "SUMMIT", label: "Summit" },
  { value: "WORKSHOP", label: "Workshop" }, { value: "GHOSTED_BLUEPRINT", label: "Ghosted Blueprint" },
  { value: "OTHER", label: "Other" },
];

/**
 * Functional quick-actions on a contact row (issue 7.9): call / mail / WhatsApp straight from the
 * list, instead of the phone being dead text. Anchor-based so they use the OS handlers (tel:,
 * mailto:) and open WhatsApp; stopPropagation so a click doesn't also open the contact.
 */
function QuickActions({ phone, email }: { phone: string | null; email: string | null }) {
  const wa = phone ? phone.replace(/[^\d]/g, "") : "";
  const cls =
    "grid h-8 w-8 place-items-center rounded-btn border border-line text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink";
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  return (
    <div className="flex items-center justify-end gap-1.5">
      {phone ? (
        <a href={`tel:${phone}`} onClick={stop} className={cls} title={`Call ${phone}`} aria-label="Call">
          <Phone size={15} />
        </a>
      ) : null}
      {email ? (
        <a href={`mailto:${email}`} onClick={stop} className={cls} title={`Email ${email}`} aria-label="Email">
          <Mail size={15} />
        </a>
      ) : null}
      {wa ? (
        <a
          href={`https://wa.me/${wa}`}
          target="_blank"
          rel="noreferrer"
          onClick={stop}
          className={cls}
          title="Open in WhatsApp"
          aria-label="WhatsApp"
        >
          <MessageCircle size={15} />
        </a>
      ) : null}
    </div>
  );
}

function prettyStage(s: string) {
  return s.toLowerCase().replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function ContactsTable({ page, filters }: { page: ContactsListResult; filters: ContactListFilters }) {
  const rows = page.rows;
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [addOpen, setAddOpen] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [bulkTag, setBulkTag] = useState("");
  const addForm = useRef<HTMLFormElement>(null);

  // Filtering (search text / owner / stage / source / city / date range / tag) is now a real
  // server-side query (contacts-metrics.ts) driven by URL params via ContactsFilterBar — `rows`
  // arrives already filtered AND already paginated (one server "page", see below). DataTable's
  // own search box still runs client-side, but only ever over this one page's rows now; it's a
  // fast "refine what's on screen" tool, not the real cross-dataset search (that's the box in
  // ContactsFilterBar, wired to the `q` param → getContactsList's `search`).
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));
  function toggle(id: string) { setSelected((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; }); }
  function toggleAll() { setSelected(() => (allSelected ? new Set() : new Set(rows.map((r) => r.id)))); }

  // ── Cursor pagination (BUILD_CHECKLIST.md §3: real cursor/take, not LIST_CAP=1000) ──
  // The current page's cursor lives in the URL (`?cursor=`), so any page is bookmarkable/
  // shareable. The "how do I get back" stack only lives in this component's memory: it's
  // accurate for every page reached by clicking Next this session, and safely resets to page 1
  // (rather than guessing wrong) if someone lands mid-pagination via a raw link. Any filter
  // change elsewhere (ContactsFilterBar) pushes a URL with no `cursor` at all, which this stack
  // also detects and clears — otherwise "Prev" after changing filters could try to reuse a
  // cursor id that belonged to the OLD filtered result set.
  const currentCursor = searchParams.get("cursor") ?? "";
  const [cursorStack, setCursorStack] = useState<string[]>([]);
  const filterSignature = (() => {
    const usp = new URLSearchParams(searchParams.toString());
    usp.delete("cursor");
    return usp.toString();
  })();
  const prevSignature = useRef(filterSignature);
  useEffect(() => {
    if (prevSignature.current !== filterSignature) {
      prevSignature.current = filterSignature;
      setCursorStack([]);
    }
  }, [filterSignature]);

  function goToPage(cursor: string) {
    const usp = new URLSearchParams(searchParams.toString());
    if (cursor) usp.set("cursor", cursor);
    else usp.delete("cursor");
    router.push(usp.toString() ? `${pathname}?${usp}` : pathname);
  }
  function goNext() {
    if (!page.nextCursor) return;
    setCursorStack((s) => [...s, currentCursor]);
    goToPage(page.nextCursor);
  }
  function goPrev() {
    if (cursorStack.length === 0) return goToPage(""); // no recorded history — page 1 is always correct
    const stack = [...cursorStack];
    const back = stack.pop() ?? "";
    setCursorStack(stack);
    goToPage(back);
  }
  const canPrev = currentCursor !== "";
  const canNext = page.hasMore;

  async function addContact(fd: FormData) {
    setAddError(null);
    const res = await createContact(fd);
    if (!res.ok) return setAddError(res.error);
    toast("Contact added"); setAddOpen(false); addForm.current?.reset();
  }
  async function applyBulkTag() {
    const name = bulkTag.trim(); if (!name) return;
    const res = await bulkAddTag([...selected], name);
    if (!res.ok) return toast(res.error, "error");
    toast(`Tagged ${selected.size} contact${selected.size === 1 ? "" : "s"} "${name}"`);
    setSelected(new Set()); setBulkTag("");
  }

  const columns: Column<ContactRow>[] = [
    {
      key: "select", header: "", sortable: false,
      cell: (r) => (
        <input
          type="checkbox"
          checked={selected.has(r.id)}
          onChange={() => toggle(r.id)}
          onClick={(e) => e.stopPropagation()}
          aria-label={`Select ${r.name}`}
          className="h-4 w-4 accent-[var(--primary)]"
        />
      ),
    },
    {
      key: "name", header: "Contact",
      cell: (r) => (
        <Link href={`/contacts/${r.id}`} className="flex items-center gap-3 group">
          <Avatar name={r.name} size={34} />
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-ink group-hover:text-primary">{r.name}</span>
            <span className="block truncate text-xs text-ink-3">{r.email ?? "—"}</span>
          </span>
        </Link>
      ),
      value: (r) => r.name,
    },
    { key: "phone", header: "Phone", cell: (r) => <span className="text-sm text-ink-2">{r.phone ?? "—"}</span>, value: (r) => r.phone },
    { key: "company", header: "Company", cell: (r) => <span className="text-sm text-ink-2">{r.company ?? "—"}</span>, value: (r) => r.company },
    { key: "stage", header: "Stage", cell: (r) => <Pill tone="info">{prettyStage(r.stage)}</Pill>, value: (r) => prettyStage(r.stage) },
    {
      key: "tags", header: "Tags", sortable: false,
      cell: (r) => (
        <div className="flex flex-wrap gap-1">
          {r.tags.length === 0 ? <span className="text-ink-3">—</span> : r.tags.slice(0, 3).map((t) => <Chip key={t.id}>{t.name}</Chip>)}
          {r.tags.length > 3 && <Chip>+{r.tags.length - 3}</Chip>}
        </div>
      ),
      value: (r) => r.tags.map((t) => t.name).join(", "),
    },
    { key: "owner", header: "Owner", cell: (r) => <span className="text-sm text-ink-2">{r.ownerName ?? "Unassigned"}</span>, value: (r) => r.ownerName ?? "Unassigned" },
    {
      key: "created", header: "Created", align: "right",
      cell: (r) => <span className="text-sm text-ink-3"><DateText date={r.createdAt} /></span>,
      value: (r) => r.createdAt.getTime(),
    },
    {
      key: "quick", header: "", sortable: false, align: "right",
      cell: (r) => <QuickActions phone={r.phone} email={r.email} />,
      value: () => null,
    },
  ];

  return (
    <div className="space-y-3">
      <ContactsFilterBar filters={filters} />

      {/* Toolbar: Select all (this page) · Add */}
      <div className="flex flex-wrap items-center gap-2.5">
        <button
          onClick={toggleAll}
          className="inline-flex h-9 items-center gap-1.5 rounded-full border border-line-strong bg-surface px-3.5 text-sm font-medium text-ink-2 hover:bg-surface-2"
        >
          {allSelected ? "Clear selection" : `Select all ${rows.length} (this page)`}
        </button>
        <div className="flex-1" />
        <Btn size="sm" icon={<Plus size={15} />} onClick={() => setAddOpen(true)}>Add contact</Btn>
      </div>

      {/* Bulk bar */}
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-field border border-primary-tint bg-primary-soft px-4 py-2.5">
          <span className="text-sm font-semibold text-primary-strong">{selected.size} selected</span>
          <div className="flex items-center gap-2">
            <TagIcon size={15} className="text-primary-strong" />
            <input value={bulkTag} onChange={(e) => setBulkTag(e.target.value)} placeholder="Tag name" className="h-9 rounded-field border border-line bg-surface px-3 text-sm outline-none focus:border-primary" onKeyDown={(e) => e.key === "Enter" && applyBulkTag()} />
            <Btn size="sm" onClick={applyBulkTag}>Add tag</Btn>
          </div>
          <button onClick={() => setSelected(new Set())} className="ml-auto text-caption text-ink-3 hover:text-ink">Clear</button>
        </div>
      )}

      {/* hideFilter: the real search is ContactsFilterBar above (server-side, whole dataset).
          DataTable's own box only ever filtered this one loaded page, so two near-identical
          search inputs sat on the same screen searching different scopes — users typed in the
          wrong one and got "no results" on data that exists. One search box now. */}
      <DataTable
        rows={rows}
        columns={columns}
        csvName="contacts"
        hideFilter
        emptyMessage="No contacts match. Try a different search or filter combination."
      />

      {/* Server-page pagination (BUILD_CHECKLIST.md §3) — separate from DataTable's own
          client-side pager, which only ever slices this one page's rows. */}
      <div className="flex items-center justify-between rounded-card border border-line bg-surface px-4 py-2.5 text-sm">
        <span className="text-xs text-muted tnum">
          {rows.length === 0
            ? "No matching contacts"
            : `Showing ${rows.length} of ${page.filteredTotal.toLocaleString("en-IN")} matching contact${page.filteredTotal === 1 ? "" : "s"}`}
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={!canPrev}
            onClick={goPrev}
            className="inline-flex h-9 items-center gap-1 rounded-btn border border-line px-3 text-sm hover:bg-surface-2 disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-ink-disabled disabled:hover:bg-surface-2"
          >
            <ChevronLeft size={15} /> Prev
          </button>
          <button
            type="button"
            disabled={!canNext}
            onClick={goNext}
            className="inline-flex h-9 items-center gap-1 rounded-btn border border-line px-3 text-sm hover:bg-surface-2 disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-ink-disabled disabled:hover:bg-surface-2"
          >
            Next <ChevronRight size={15} />
          </button>
        </div>
      </div>

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Add contact" subtitle="Create a new CRM contact" size="md">
        <form action={addContact} ref={addForm} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Name"><TextInput kind="name" name="name" required placeholder="Full name" /></Field>
            <Field label="Phone / WhatsApp"><PhoneField name="phone" required /></Field>
            <Field label="Email"><TextInput kind="email" name="email" placeholder="name@example.com" /></Field>
            <Field label="Lead source"><Select name="leadSource" options={SOURCE_OPTS} defaultValue="OTHER" /></Field>
            <Field label="City"><TextInput kind="city" name="city" placeholder="City" /></Field>
            <Field label="Industry"><TextInput name="industry" placeholder="Industry" /></Field>
            <Field label="Company">
              <Select name="companyId" options={[{ value: "", label: "— none —" }, ...filters.companies.map((c) => ({ value: c.id, label: c.name }))]} defaultValue="" />
            </Field>
          </div>
          <FormError message={addError} />
          <div className="flex justify-end gap-2 pt-1">
            <Btn variant="ghost" type="button" onClick={() => setAddOpen(false)}>Cancel</Btn>
            <SubmitButton>Add contact</SubmitButton>
          </div>
        </form>
      </Modal>
    </div>
  );
}

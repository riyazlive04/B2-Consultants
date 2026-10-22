"use client";

import { useState } from "react";
import { Plus, Package, Trash2, AlertCircle } from "lucide-react";
import { Btn, IconButton } from "@/components/ui/controls";
import { Modal } from "@/components/ui/Modal";
import { Field, TextInput, TextArea, Select, SubmitButton, FormError } from "@/components/ui/form";
import { toast, askConfirm } from "@/components/ui/feedback";
import { EmptyState, Pill, Hint } from "@/components/ui/kit";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { AmountPair } from "@/components/ui/AmountPair";
import { createProduct, updateProduct, deleteProduct } from "@/server/payments-actions";
import { safeAction } from "@/lib/action-guard";
import type { ProductRow, UnpricedProgramme } from "@/server/payments-metrics";

/**
 * Products = WHAT B2 CONSULTANTS AND GERMAN NOTE ACTUALLY SELL.
 *
 * This was a free-text list with nothing behind it, so an invoice line read "A1 course" only
 * because somebody typed those words: the catalogue of programmes already existed (Programs, and
 * German Note → Manage → Levels) and the thing that priced them did not know about it. Nothing
 * downstream could tell that an invoice was German Note's money, and the Income row a paid
 * invoice posted had to file itself under "Other".
 *
 * A product now names its programme, so the price belongs to the thing being sold, and the
 * programme travels onto the invoice line → the Income row → the GL account that level posts to.
 *
 * ── ONE-OFF PRODUCTS STILL EXIST ──────────────────────────────────────────────────
 * A book set, a single workshop seat, a re-sit fee: real things to invoice that are not a
 * programme. They are a deliberate second choice in the picker rather than the default, so the
 * easy path is the one that keeps the catalogue honest.
 *
 * ── THE UNPRICED LIST ─────────────────────────────────────────────────────────────
 * Programmes with no product are shown under the table rather than left out. A catalogue that
 * lists only what somebody has already got round to pricing cannot tell you the one that has
 * been forgotten.
 *
 * ── THE OTHER WAY IN ──────────────────────────────────────────────────────────────
 * A programme's price is also settable where the programme itself is created - Programs, and
 * German Note → Manage → Levels. Same `Product` row, edited from the screen whoever is adding
 * the course is already on; this board stays the place that sees every price at once, and the
 * only place a one-off item can be priced.
 */

const CUSTOM = "__custom__";

const INTERVAL_OPTS = [
  { value: "ONE_TIME", label: "One-time" }, { value: "MONTHLY", label: "Monthly" },
  { value: "QUARTERLY", label: "Quarterly" }, { value: "YEARLY", label: "Yearly" },
];

export default function ProductsTab({
  rows, unpriced, canDelete, fxRate, fxStale,
}: {
  rows: ProductRow[];
  unpriced: UnpricedProgramme[];
  canDelete: boolean;
  fxRate: number;
  fxStale?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ProductRow | null>(null);
  /** Which programme the open form is pricing - or CUSTOM for a one-off item. */
  const [levelCode, setLevelCode] = useState<string>(CUSTOM);
  const [error, setError] = useState<string | null>(null);

  /** Every programme the picker can offer: the ones already priced, plus the ones that aren't. */
  const programmeOptions = [
    ...unpriced.map((u) => ({ value: u.levelCode, label: `${u.levelLabel} · ${u.lineLabel}` })),
    ...rows
      .filter((r) => r.levelCode)
      .map((r) => ({ value: r.levelCode as string, label: `${r.levelLabel} · ${r.lineLabel ?? ""}`.trim() })),
  ].sort((a, b) => a.label.localeCompare(b.label));

  function openFor(row: ProductRow | null, programme?: string) {
    setEditing(row);
    setLevelCode(programme ?? row?.levelCode ?? (row ? CUSTOM : programmeOptions[0]?.value ?? CUSTOM));
    setError(null);
    setOpen(true);
  }

  async function submit(fd: FormData) {
    setError(null);
    // A one-off product sends no level at all; the server treats blank as "not a programme".
    if (levelCode === CUSTOM) fd.delete("levelCode");
    const res = await safeAction(() =>
      editing ? updateProduct(editing.id, fd) : createProduct(fd),
    );
    if (!res.ok) return setError(res.error);
    toast(editing ? "Product updated" : "Product added");
    setOpen(false);
  }

  async function remove(r: ProductRow) {
    // Archive, not delete (issue 26): the product is soft-deleted and any subscription still
    // pointing at it keeps resolving. Calling it "Delete" implied neither was true.
    if (!(await askConfirm({ title: `Archive "${r.name}"?`, body: "It stops being offered on new invoices. Existing ones keep it.", confirmLabel: "Archive", danger: true }))) return;
    const res = await safeAction(() => deleteProduct(r.id));
    toast(res.ok ? "Product archived" : res.error, res.ok ? "success" : "error");
  }

  const columns: Column<ProductRow>[] = [
    {
      key: "product", header: "Product",
      cell: (r) => (
        <>
          <button onClick={() => openFor(r)} className="text-left text-sm font-semibold text-ink hover:text-primary">{r.name}</button>
          {r.description && <span className="block text-xs text-ink-3">{r.description}</span>}
        </>
      ),
      value: (r) => r.name,
    },
    {
      key: "programme", header: "Programme",
      cell: (r) =>
        r.levelCode ? (
          <span className="flex flex-wrap items-center gap-1.5">
            <Pill tone="info">{r.levelLabel}</Pill>
            {r.lineLabel && <span className="text-xs text-ink-3">{r.lineLabel}</span>}
          </span>
        ) : (
          <span className="text-xs text-ink-3">One-off item</span>
        ),
      value: (r) => r.levelLabel ?? "",
    },
    {
      key: "price", header: "Price",
      cell: (r) => (
        <>
          <span className="block">{r.priceDisplay}</span>
          {r.priceEurDisplay && <span className="block text-xs text-ink-3">{r.priceEurDisplay}</span>}
        </>
      ),
      value: (r) => Number(r.priceInr),
    },
    { key: "billing", header: "Billing", cell: (r) => r.interval.replace("_", "-").toLowerCase(), value: (r) => r.interval },
    { key: "status", header: "Status", cell: (r) => <Pill tone={r.active ? "good" : "neutral"}>{r.active ? "Active" : "Inactive"}</Pill>, value: (r) => (r.active ? 1 : 0) },
    {
      key: "actions", header: "Actions", align: "right", sortable: false,
      cell: (r) => (
        <div className="flex items-center justify-end gap-1">
          <Btn size="sm" variant="ghost" onClick={() => openFor(r)}>Edit</Btn>
          {canDelete && <IconButton label="Archive product" onClick={() => remove(r)}><Trash2 size={16} /></IconButton>}
        </div>
      ),
    },
  ];

  const isCustom = levelCode === CUSTOM;

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Btn icon={<Plus size={16} />} onClick={() => openFor(null)}>New product</Btn>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={<Package size={20} />}
          title="Nothing priced yet"
          body="Put a price on a programme and it becomes invoiceable in one click."
        />
      ) : (
        <DataTable
          rows={rows}
          columns={columns}
          csvName="products"
          filterPlaceholder="Filter products…"
          emptyMessage="No products match."
        />
      )}

      {/* The gap, named. A programme nobody has priced cannot be invoiced from the catalogue. */}
      {unpriced.length > 0 && (
        <Hint>
          <span className="flex flex-wrap items-center gap-2">
            <AlertCircle size={14} className="text-warn" aria-hidden />
            <span>Not priced yet - click one to price it, or set it where the course is created:</span>
            {unpriced.map((u) => (
              <button
                key={u.levelCode}
                onClick={() => openFor(null, u.levelCode)}
                className="rounded-pill border border-line px-2 py-0.5 text-caption font-medium text-ink-2 hover:border-primary hover:text-primary"
              >
                {u.levelLabel} <span className="text-ink-3">· {u.lineLabel}</span>
              </button>
            ))}
          </span>
        </Hint>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title={editing ? "Edit product" : "New product"} size="sm">
        <form action={submit} key={editing?.id ?? `new-${levelCode}`} className="space-y-4">
          <Field label="Programme" hint="What this sells. Pick “One-off item” for a book set, a single seat or a re-sit fee.">
            <Select
              name="levelCode"
              value={levelCode}
              onChange={(e) => setLevelCode(e.target.value)}
              options={[...programmeOptions, { value: CUSTOM, label: "One-off item (not a programme)" }]}
            />
          </Field>

          {/* A programme's name is the catalogue's, not retyped here: two names for one
              programme is how a catalogue stops being a catalogue. */}
          {isCustom && (
            <Field label="Name">
              <TextInput kind="text" name="name" required defaultValue={editing?.levelCode ? "" : editing?.name ?? ""} />
            </Field>
          )}
          {!isCustom && (
            // The server names the row from the level, but the form still has to submit
            // something: `name` is required by the same schema a one-off product uses.
            <input type="hidden" name="name" value={programmeOptions.find((o) => o.value === levelCode)?.label ?? levelCode} />
          )}

          <Field label="Description"><TextArea kind="text" name="description" rows={2} defaultValue={editing?.description ?? ""} /></Field>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <AmountPair
              fxRate={fxRate}
              fxStale={fxStale}
              inrName="priceInr"
              eurName="priceEur"
              inrLabel="Price (₹)"
              eurLabel="Price (€)"
              baseHint="INR, EUR, or both"
              defaultInr={editing?.priceInr ?? ""}
              defaultEur={editing?.priceEur ?? ""}
            />
            <Field label="Billing"><Select name="interval" options={INTERVAL_OPTS} defaultValue={editing?.interval ?? "ONE_TIME"} /></Field>
          </div>
          <Field label="Status"><Select name="active" options={[{ value: "on", label: "Active" }, { value: "off", label: "Inactive" }]} defaultValue={editing ? (editing.active ? "on" : "off") : "on"} /></Field>
          <FormError message={error} />
          <div className="flex justify-end gap-2"><Btn variant="ghost" type="button" onClick={() => setOpen(false)}>Cancel</Btn><SubmitButton>{editing ? "Save" : "Add product"}</SubmitButton></div>
        </form>
      </Modal>
    </div>
  );
}

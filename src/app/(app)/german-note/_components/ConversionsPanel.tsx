"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus, Trash2 } from "lucide-react";
import type { GnWorkshopProduct } from "@prisma/client";
import {
  createConversion,
  deleteConversion,
  updateConversion,
} from "@/server/german-note-workshop-actions";
import type { GnConversionRow } from "@/server/german-note-workshops";
import { minorToMajorString } from "@/lib/format";
import { standardBooksCost, standardTutorCost } from "@/lib/gn-workshop-pricing";
import { askConfirm, toast } from "@/components/ui/feedback";
import { Btn, IconButton } from "@/components/ui/controls";
import { CheckboxField, Field, FormError, Select, SubmitButton, TextArea, TextInput } from "@/components/ui/form";
import { Modal } from "@/components/ui/Modal";
import {
  CONV_STATUS_OPTIONS,
  DAY_TYPE_LABELS,
  DAY_TYPE_OPTIONS,
  inr,
  PRODUCT_OPTIONS,
  pct,
  ProductChip,
  Signed,
  SOURCE_OPTIONS,
  SOURCE_LABELS,
  StatusChip,
} from "./workshopFormat";

/** paise number → "1234.56" for a money text input. */
const moneyInput = (minor: number) => minorToMajorString(BigInt(Math.round(minor)));

function MoneyField({ label, name, defaultValue, hint, placeholder = "0.00" }: { label: string; name: string; defaultValue?: number; hint?: string; placeholder?: string }) {
  return (
    <Field label={label} hint={hint}>
      <TextInput
        kind="money"
        name={name}
        placeholder={placeholder}
        defaultValue={defaultValue ? moneyInput(defaultValue) : undefined}
      />
    </Field>
  );
}

function ConversionFields({ c }: { c?: GnConversionRow }) {
  const batchFor = (level: "A1" | "A2" | "B1") => c?.batches.find((b) => b.level === level);
  // Product drives the derived cost model, so the override placeholders track it live.
  const [product, setProduct] = useState<GnWorkshopProduct>(c?.product ?? "A1");
  const modelBooks = inr(standardBooksCost(product));
  const modelTutor = inr(standardTutorCost(product));
  return (
    <div className="space-y-5">
      <fieldset className="space-y-4">
        <legend className="text-caption font-semibold uppercase tracking-wide text-muted">Client</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Full name">
            <TextInput kind="name" name="fullName" required defaultValue={c?.fullName} placeholder="Full name" />
          </Field>
          <Field label="Phone">
            <TextInput kind="phone" name="phone" defaultValue={c?.phone ?? undefined} placeholder="Phone number" />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Email">
            <TextInput kind="email" name="email" defaultValue={c?.email ?? undefined} placeholder="email@example.com" />
          </Field>
          <Field label="Address">
            <TextInput name="address" maxLength={300} defaultValue={c?.address ?? undefined} placeholder="City / address" />
          </Field>
        </div>
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="text-caption font-semibold uppercase tracking-wide text-muted">Course</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Product chosen">
            <Select name="product" options={PRODUCT_OPTIONS} defaultValue={c?.product ?? "A1"} onChange={(e) => setProduct(e.target.value as GnWorkshopProduct)} />
          </Field>
          <Field label="Source" hint="Ad = split the workshop's ad spend; Organic = no ad cost.">
            <Select name="source" options={SOURCE_OPTIONS} defaultValue={c?.source ?? "AD"} />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Weekday / Weekend">
            <Select name="dayType" options={DAY_TYPE_OPTIONS} defaultValue={c?.dayType ?? "WEEKDAY"} />
          </Field>
          <Field label="Status">
            <Select name="status" options={CONV_STATUS_OPTIONS} defaultValue={c?.status ?? "CONFIRMED"} />
          </Field>
        </div>
        <CheckboxField
          name="isFreeSeat"
          label="Free seat (B2 client / free repeat)"
          hint="No revenue counted — enrolled but not billed (delivery cost still applies)."
          defaultChecked={c?.isFreeSeat}
        />
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="text-caption font-semibold uppercase tracking-wide text-muted">Batch assignment</legend>
        {(["A1", "A2", "B1"] as const).map((level) => (
          <div key={level} className="grid grid-cols-[2.5rem_1fr_1fr] items-center gap-3">
            <span className="text-sm font-semibold text-muted">{level}</span>
            <TextInput name={`batch${level}`} maxLength={40} defaultValue={batchFor(level)?.batch ?? undefined} placeholder="Batch (e.g. B26)" aria-label={`${level} batch`} />
            <TextInput name={`time${level}`} maxLength={40} defaultValue={batchFor(level)?.time ?? undefined} placeholder="Time (e.g. 7:00 AM)" aria-label={`${level} time`} />
          </div>
        ))}
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="text-caption font-semibold uppercase tracking-wide text-muted">Payment</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <MoneyField label="Final price (₹)" name="finalPrice" defaultValue={c?.pnl.final} />
          <MoneyField label="Paid amount (₹)" name="paidAmount" defaultValue={c?.pnl.paid} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Payment method">
            <TextInput name="paymentMethod" maxLength={60} defaultValue={c?.paymentMethod ?? undefined} placeholder="UPI · Credit Card · German Bank…" />
          </Field>
          <Field label="Next payment due (optional)">
            <TextInput type="date" name="nextDueDate" defaultValue={c?.nextDueDate ? c.nextDueDate.slice(0, 10) : undefined} />
          </Field>
        </div>
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="text-caption font-semibold uppercase tracking-wide text-muted">Cost overrides (optional)</legend>
        <p className="text-caption text-muted">
          Books &amp; tutor default to the level cost model; leave blank to use it. Ad spend is allocated
          automatically across the workshop&apos;s ad conversions.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <MoneyField label="Books cost (₹)" name="booksCostOverride" defaultValue={c?.costOverridden ? c.pnl.books : undefined} placeholder={`Model: ${modelBooks}`} />
          <MoneyField label="Tutor fees (₹)" name="tutorCostOverride" defaultValue={c?.costOverridden ? c.pnl.tutor : undefined} placeholder={`Model: ${modelTutor}`} />
        </div>
        <MoneyField label="Referral cost (₹)" name="referral" defaultValue={c?.pnl.referral} />
      </fieldset>

      <Field label="Notes (optional)">
        <TextArea kind="text" name="notes" maxLength={2000} defaultValue={c?.notes ?? undefined} placeholder="EMI plan, carry-over, anything worth remembering…" />
      </Field>
    </div>
  );
}

function batchSummary(c: GnConversionRow): string {
  const parts = c.batches
    .filter((b) => b.batch || b.time)
    .map((b) => `${b.level}: ${[b.batch, b.time].filter(Boolean).join(" ")}`);
  return parts.length ? parts.join(" · ") : "—";
}

export function ConversionsPanel({ workshopId, conversions }: { workshopId: string; conversions: GnConversionRow[] }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<GnConversionRow | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => startTransition(() => router.refresh());

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-semibold">Conversions</h2>
          <p className="text-xs text-muted">{conversions.length} client{conversions.length === 1 ? "" : "s"} converted from this workshop.</p>
        </div>
        <Btn variant="soft" icon={<Plus size={15} />} onClick={() => { setCreating(true); setError(null); }}>
          Add conversion
        </Btn>
      </div>

      {conversions.length === 0 ? (
        <p className="rounded-card border border-dashed border-line bg-surface-2 px-4 py-8 text-center text-sm text-muted">
          No conversions yet — add the first client above.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-card border border-line bg-surface shadow-card">
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-caption uppercase tracking-wide text-muted">
                <th className="px-3 py-2.5 font-semibold">Client</th>
                <th className="px-3 py-2.5 font-semibold">Product</th>
                <th className="px-3 py-2.5 font-semibold">Batches</th>
                <th className="px-3 py-2.5 text-right font-semibold">Final</th>
                <th className="px-3 py-2.5 text-right font-semibold">Paid</th>
                <th className="px-3 py-2.5 text-right font-semibold">Balance</th>
                <th className="px-3 py-2.5 text-right font-semibold">Net · NP%</th>
                <th className="px-3 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {conversions.map((c) => (
                <tr key={c.id} className="border-b border-line last:border-0 align-top hover:bg-surface-2">
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-ink">{c.fullName}</span>
                      <StatusChip status={c.status} />
                      {c.isFreeSeat && <span className="rounded-full bg-ink/10 px-2 py-0.5 text-caption font-semibold text-muted">Free</span>}
                      {c.source === "ORGANIC" && <span className="rounded-full bg-ink/10 px-2 py-0.5 text-caption font-semibold text-muted">{SOURCE_LABELS.ORGANIC}</span>}
                    </div>
                    {(c.phone || c.email) && (
                      <p className="text-caption text-muted">{[c.phone, c.email].filter(Boolean).join(" · ")}</p>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    <ProductChip product={c.product} />
                    <p className="mt-0.5 text-caption text-muted">{DAY_TYPE_LABELS[c.dayType]}</p>
                  </td>
                  <td className="px-3 py-2.5 text-xs text-muted">{batchSummary(c)}</td>
                  <td className="px-3 py-2.5 text-right tnum">{inr(c.pnl.final)}</td>
                  <td className="px-3 py-2.5 text-right tnum">{inr(c.pnl.paid)}</td>
                  <td className="px-3 py-2.5 text-right"><Signed minor={c.pnl.balance} /></td>
                  <td className="px-3 py-2.5 text-right">
                    <Signed minor={c.pnl.netProfit} />
                    <p className="text-caption text-muted">{pct(c.pnl.npMargin)}</p>
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center justify-end gap-1">
                      <IconButton label={`Edit ${c.fullName}`} size="sm" onClick={() => { setEditing(c); setError(null); }}>
                        <Pencil size={14} />
                      </IconButton>
                      <IconButton
                        label={`Delete ${c.fullName}`}
                        size="sm"
                        tone="danger"
                        onClick={async () => {
                          const ok = await askConfirm({
                            title: `Delete “${c.fullName}”?`,
                            body: "This conversion is removed permanently.",
                            confirmLabel: "Delete",
                            danger: true,
                          });
                          if (!ok) return;
                          const res = await deleteConversion(c.id);
                          if (!res.ok) return toast(res.error, "error");
                          toast("Conversion deleted");
                          refresh();
                        }}
                      >
                        <Trash2 size={14} />
                      </IconButton>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={creating} onClose={() => setCreating(false)} title="Add conversion" size="lg">
        <form
          action={async (form) => {
            setError(null);
            const res = await createConversion(workshopId, form);
            if (!res.ok) return setError(res.error);
            setCreating(false);
            toast("Conversion added");
            refresh();
          }}
        >
          <ConversionFields />
          <div className="mt-5 flex items-center justify-between gap-3">
            <FormError message={error} />
            <span className="ml-auto"><SubmitButton>Add conversion</SubmitButton></span>
          </div>
        </form>
      </Modal>

      <Modal open={editing !== null} onClose={() => setEditing(null)} title="Edit conversion" size="lg">
        {editing && (
          <form
            action={async (form) => {
              setError(null);
              const res = await updateConversion(editing.id, form);
              if (!res.ok) return setError(res.error);
              setEditing(null);
              toast("Conversion updated");
              refresh();
            }}
          >
            <ConversionFields c={editing} />
            <div className="mt-5 flex items-center justify-between gap-3">
              <FormError message={error} />
              <span className="ml-auto"><SubmitButton>Save changes</SubmitButton></span>
            </div>
          </form>
        )}
      </Modal>
    </section>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BookOpen, Plus, Truck } from "lucide-react";
import type { BookOrderRow, StudentOption, VendorRow } from "@/server/book-order-metrics";
import type { LevelOption } from "@/lib/levels";
import { advanceBookOrder, createBookOrder, upsertVendor } from "@/server/book-order-actions";
import { Btn } from "@/components/ui/controls";
import { Field, FormError, Select, SubmitButton, TextInput } from "@/components/ui/form";
import { toast } from "@/components/ui/feedback";
import { Modal } from "@/components/ui/Modal";

/**
 * Book orders with the publisher (spec §9.2, Part 2 §4):
 *   token advance → confirm the level → vendor quotation → pay → courier.
 *
 * The "ready to release" flag is the reason this screen is worth opening. A DEFERRED order
 * whose student has since paid past the threshold is money sitting still — the release job
 * clears those on its own, but a human looking at this list should never be the last to know.
 */

const STATUS_FLOW = [
  { value: "DEFERRED", label: "Deferred — waiting on payment" },
  { value: "QUOTE_REQUESTED", label: "Quote requested" },
  { value: "QUOTED", label: "Quoted" },
  { value: "ORDERED", label: "Ordered" },
  { value: "PAID", label: "Paid the vendor" },
  { value: "COURIERED", label: "Couriered" },
  { value: "CANCELLED", label: "Cancelled" },
] as const;

const STATUS_TONE: Record<string, string> = {
  DEFERRED: "border border-line bg-surface-2 text-ink-2",
  QUOTE_REQUESTED: "bg-accent-soft text-ink",
  QUOTED: "bg-accent-soft text-ink",
  ORDERED: "bg-accent-soft text-ink",
  PAID: "bg-accent-soft text-ink",
  COURIERED: "bg-ok-soft text-ink",
  CANCELLED: "border border-line bg-surface-2 text-ink-3",
};

const inr = (n: number | null) => (n === null ? "—" : `₹${n.toLocaleString("en-IN")}`);

export function BookOrdersPanel({
  rows,
  vendors,
  students,
  thresholdRupees,
  levelOptions,
}: {
  rows: BookOrderRow[];
  vendors: VendorRow[];
  students: StudentOption[];
  thresholdRupees: number;
  levelOptions: LevelOption[];
}) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [addingVendor, setAddingVendor] = useState(false);
  const [editing, setEditing] = useState<BookOrderRow | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function create(form: FormData) {
    setError(null);
    const res = await createBookOrder(form);
    if (!res.ok) return setError(res.error);
    setCreating(false);
    toast("Book order opened");
    router.refresh();
  }

  async function addVendor(form: FormData) {
    setError(null);
    const res = await upsertVendor(null, form);
    if (!res.ok) return setError(res.error);
    setAddingVendor(false);
    toast("Vendor saved");
    router.refresh();
  }

  async function advance(form: FormData) {
    if (!editing) return;
    setError(null);
    const res = await advanceBookOrder(editing.id, form);
    if (!res.ok) return setError(res.error);
    setEditing(null);
    toast("Order updated");
    router.refresh();
  }

  const releasable = rows.filter((r) => r.readyToRelease);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-muted">
          Orders with the book publisher. An order releases once a student has paid{" "}
          <strong>₹{thresholdRupees.toLocaleString("en-IN")}</strong> in total — the rule reads cash
          actually collected, not the payment plan, so a reliable EMI payer gets their books.
        </p>
        <div className="flex gap-2">
          <Btn variant="ghost" onClick={() => { setAddingVendor(true); setError(null); }}>
            <Truck size={15} /> Add vendor
          </Btn>
          <Btn onClick={() => { setCreating(true); setError(null); }}>
            <Plus size={15} /> New order
          </Btn>
        </div>
      </div>

      {releasable.length > 0 && (
        <div className="rounded-field border border-accent/40 bg-accent-soft px-4 py-3">
          <p className="text-sm font-semibold text-ink">
            {releasable.length} deferred order{releasable.length === 1 ? "" : "s"} now clear the threshold
          </p>
          <p className="mt-0.5 text-xs text-muted">
            {releasable.map((r) => r.studentName).join(", ")} — these can go to the publisher.
          </p>
        </div>
      )}

      {rows.length === 0 ? (
        <div className="rounded-field border border-line bg-surface-2 px-4 py-8 text-center">
          <BookOpen size={20} className="mx-auto text-ink-3" />
          <p className="mt-2 text-sm text-muted">No book orders yet.</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-caption uppercase text-ink-3">
                <th className="py-2 pr-4 font-medium">Student</th>
                <th className="py-2 pr-4 font-medium">Level</th>
                <th className="py-2 pr-4 font-medium">Status</th>
                <th className="py-2 pr-4 font-medium">Paid so far</th>
                <th className="py-2 pr-4 font-medium">Quoted</th>
                <th className="py-2 pr-4 font-medium">Vendor</th>
                <th className="py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-line/60">
                  <td className="py-2 pr-4 font-medium text-ink">{r.studentName}</td>
                  <td className="py-2 pr-4 text-ink-2">{r.level}</td>
                  <td className="py-2 pr-4">
                    <span
                      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_TONE[r.status] ?? ""}`}
                      title={r.deferReason ?? undefined}
                    >
                      {r.status.toLowerCase().replace("_", " ")}
                    </span>
                    {r.readyToRelease && (
                      <span className="ml-2 text-xs font-semibold text-accent">ready</span>
                    )}
                  </td>
                  <td className="py-2 pr-4 text-ink-2">
                    {inr(r.cashCollectedRupees)}
                    {r.status === "DEFERRED" && r.shortfallRupees > 0 && (
                      <span className="text-muted"> · {inr(r.shortfallRupees)} short</span>
                    )}
                  </td>
                  <td className="py-2 pr-4 text-ink-2">{inr(r.quotedRupees)}</td>
                  <td className="py-2 pr-4 text-ink-2">{r.vendorName ?? "—"}</td>
                  <td className="py-2">
                    <Btn variant="ghost" onClick={() => { setEditing(r); setError(null); }}>
                      Update
                    </Btn>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={creating} onClose={() => setCreating(false)} title="New book order">
        <form action={create} className="space-y-4">
          <Field label="Student">
            <Select name="studentId" options={students.map((s) => ({ value: s.id, label: s.fullName }))} />
          </Field>
          <Field label="Level" hint="One order per level — take a fresh quote before each new level.">
            <Select name="level" options={levelOptions} />
          </Field>
          <Field label="Vendor" hint="Optional now; you can set it when the quote comes back.">
            <Select
              name="vendorId"
              options={[{ value: "", label: "—" }, ...vendors.map((v) => ({ value: v.id, label: v.name }))]}
            />
          </Field>
          <Field label="Notes">
            <TextInput name="notes" />
          </Field>
          <p className="rounded-field border border-line bg-surface-2 px-3 py-2 text-xs text-muted">
            Whether this holds or goes straight to the publisher is decided by what the student
            has already paid — you don&apos;t choose it here.
          </p>
          <FormError message={error} />
          <div className="flex justify-end gap-2">
            <Btn variant="ghost" onClick={() => setCreating(false)}>Cancel</Btn>
            <SubmitButton>Open order</SubmitButton>
          </div>
        </form>
      </Modal>

      <Modal open={addingVendor} onClose={() => setAddingVendor(false)} title="Add a book vendor">
        <form action={addVendor} className="space-y-4">
          <Field label="Name"><TextInput name="name" /></Field>
          <Field label="Phone" hint="The WhatsApp number the team sends orders to."><TextInput name="phone" /></Field>
          <Field label="Email"><TextInput name="email" /></Field>
          <Field label="Address"><TextInput name="address" /></Field>
          <Field label="Notes"><TextInput name="notes" /></Field>
          <FormError message={error} />
          <div className="flex justify-end gap-2">
            <Btn variant="ghost" onClick={() => setAddingVendor(false)}>Cancel</Btn>
            <SubmitButton>Save vendor</SubmitButton>
          </div>
        </form>
      </Modal>

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing ? `${editing.studentName} · ${editing.level}` : "Update order"}
        subtitle={editing?.shipToAddress ? `Ships to: ${editing.shipToAddress}` : "No ship-to address on file"}
      >
        {editing && (
          <form action={advance} className="space-y-4">
            <Field label="Status">
              <Select name="status" defaultValue={editing.status} options={STATUS_FLOW.map((s) => ({ value: s.value, label: s.label }))} />
            </Field>
            <Field label="Vendor">
              <Select
                name="vendorId"
                defaultValue={editing.vendorId ?? ""}
                options={[{ value: "", label: "—" }, ...vendors.map((v) => ({ value: v.id, label: v.name }))]}
              />
            </Field>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Quoted (₹)" hint="What the publisher quoted.">
                <TextInput name="quotedAmount" inputMode="numeric" defaultValue={editing.quotedRupees?.toString() ?? ""} />
              </Field>
              <Field label="Paid the vendor (₹)">
                <TextInput name="paidAmount" inputMode="numeric" defaultValue={editing.paidRupees?.toString() ?? ""} />
              </Field>
            </div>
            <Field label="Courier reference" hint="Required before you can mark it couriered.">
              <TextInput name="courierRef" defaultValue={editing.courierRef ?? ""} />
            </Field>
            <FormError message={error} />
            <div className="flex justify-end gap-2">
              <Btn variant="ghost" onClick={() => setEditing(null)}>Cancel</Btn>
              <SubmitButton>Save</SubmitButton>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}

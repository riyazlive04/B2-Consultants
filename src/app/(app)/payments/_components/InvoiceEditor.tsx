"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, Plus, Trash2, Send, Download, Link2, Ban, CheckCircle2, ArrowRightLeft,
} from "lucide-react";
import type { InvoiceDetail } from "@/server/payments-metrics";
import { Btn, IconButton } from "@/components/ui/controls";
import { Card, Pill, type Tone } from "@/components/ui/kit";
import { Modal } from "@/components/ui/Modal";
import { Field, TextInput, Select, SubmitButton, FormError } from "@/components/ui/form";
import { DatePicker } from "@/components/ui/DatePicker";
import { toast, askConfirm } from "@/components/ui/feedback";
import { formatInrMinor } from "@/lib/format";
import {
  createInvoice, updateInvoice, setInvoiceStatus, sendInvoice, recordPayment, deleteInvoice, convertEstimate,
} from "@/server/payments-actions";

type Pickers = {
  contacts: { id: string; name: string; email: string | null; phone: string | null }[];
  products: { id: string; name: string; priceInr: string }[];
};
type Item = { description: string; quantity: number; unitPriceInr: string };

const inputCls = "h-9 w-full rounded-field border border-line bg-surface px-3 text-sm outline-none focus:border-primary";
const toPaise = (s: string) => Math.round((parseFloat(s || "0") || 0) * 100);
const today = () => new Date().toISOString().slice(0, 10);

function statusTone(s: string): Tone {
  if (s === "PAID" || s === "ACCEPTED") return "good";
  if (s === "OVERDUE" || s === "DECLINED") return "bad";
  if (s === "SENT" || s === "PARTIAL") return "warn";
  return "neutral";
}

export default function InvoiceEditor({
  invoice,
  kind,
  pickers,
}: {
  invoice: InvoiceDetail | null;
  kind: "INVOICE" | "ESTIMATE";
  pickers: Pickers;
}) {
  const router = useRouter();
  const isNew = !invoice;
  const noun = kind === "ESTIMATE" ? "Estimate" : "Invoice";

  const [leadId, setLeadId] = useState(invoice?.leadId ?? "");
  const [customerName, setCustomerName] = useState(invoice?.customerName ?? "");
  const [customerEmail, setCustomerEmail] = useState(invoice?.customerEmail ?? "");
  const [customerPhone, setCustomerPhone] = useState(invoice?.customerPhone ?? "");
  const [issueDate, setIssueDate] = useState(invoice?.issueDate || today());
  const [dueDate, setDueDate] = useState(invoice?.dueDate ?? "");
  const [items, setItems] = useState<Item[]>(
    invoice?.items.map((i) => ({ description: i.description, quantity: i.quantity, unitPriceInr: i.unitPriceInr })) ?? [
      { description: "", quantity: 1, unitPriceInr: "" },
    ],
  );
  const [discountInr, setDiscountInr] = useState(invoice?.discountInr ?? "");
  const [taxPercent, setTaxPercent] = useState(invoice?.taxPercent ?? 0);
  const [notes, setNotes] = useState(invoice?.notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);

  // client-side totals (server recomputes authoritatively)
  const subtotal = items.reduce((a, it) => a + toPaise(it.unitPriceInr) * Math.max(1, it.quantity), 0);
  const discount = toPaise(discountInr);
  const taxable = Math.max(0, subtotal - discount);
  const tax = Math.round((taxable * taxPercent) / 100);
  const total = taxable + tax;

  function setItem(i: number, patch: Partial<Item>) {
    setItems((its) => its.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  }
  function pickContact(id: string) {
    setLeadId(id);
    const c = pickers.contacts.find((x) => x.id === id);
    if (c) {
      setCustomerName(c.name);
      setCustomerEmail(c.email ?? "");
      setCustomerPhone(c.phone ?? "");
    }
  }
  function addProduct(id: string) {
    const p = pickers.products.find((x) => x.id === id);
    if (p) setItems((its) => [...its, { description: p.name, quantity: 1, unitPriceInr: p.priceInr }]);
  }

  async function save() {
    setError(null);
    setSaving(true);
    const payload = {
      kind, leadId: leadId || undefined, customerName, customerEmail, customerPhone,
      issueDate, dueDate: dueDate || undefined, items, discountInr, taxPercent, notes,
    };
    const res = invoice ? await updateInvoice(invoice.id, payload) : await createInvoice(payload);
    setSaving(false);
    if (!res.ok) return setError(res.error);
    toast(invoice ? "Saved" : `${noun} created`);
    if (!invoice) router.push("/payments");
    else router.refresh();
  }

  async function status(s: string, label: string) {
    if (!invoice) return;
    const res = await setInvoiceStatus(invoice.id, s);
    if (res.ok) { toast(label); router.refresh(); } else toast(res.error, "error");
  }
  async function send() {
    if (!invoice) return;
    const res = await sendInvoice(invoice.id);
    if (res.ok) { toast(res.message); router.refresh(); } else toast(res.error, "error");
  }
  async function convert() {
    if (!invoice) return;
    const res = await convertEstimate(invoice.id);
    if (res.ok) { toast("Converted to invoice"); router.push("/payments"); } else toast(res.error, "error");
  }
  async function remove() {
    if (!invoice) return;
    if (!(await askConfirm({ title: `Delete ${invoice.number}?`, danger: true }))) return;
    const res = await deleteInvoice(invoice.id);
    if (res.ok) { toast("Deleted"); router.push("/payments"); } else toast(res.error, "error");
  }
  async function pay(fd: FormData) {
    if (!invoice) return;
    setPayError(null);
    const res = await recordPayment(invoice.id, fd);
    if (!res.ok) return setPayError(res.error);
    toast("Payment recorded");
    setPayOpen(false);
    router.refresh();
  }
  async function copyLink() {
    if (!invoice) return;
    await navigator.clipboard.writeText(`${window.location.origin}/i/${invoice.publicToken}`).catch(() => {});
    toast("Public link copied");
  }

  const canShare = invoice && invoice.status !== "DRAFT" && invoice.status !== "VOID";

  return (
    <div className="space-y-5">
      <Link href="/payments" className="inline-flex items-center gap-1.5 text-sm text-ink-2 hover:text-primary"><ArrowLeft size={16} /> Payments</Link>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="font-display text-display-l font-bold text-ink">{invoice ? invoice.number : `New ${noun.toLowerCase()}`}</h1>
          {invoice && <Pill tone={statusTone(invoice.status)}>{invoice.status}</Pill>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {invoice && (
            <>
              {invoice.status === "DRAFT" && <Btn variant="soft" icon={<Send size={15} />} onClick={send}>Send</Btn>}
              {canShare && <Btn variant="ghost" icon={<Link2 size={15} />} onClick={copyLink}>Link</Btn>}
              {canShare && <a href={`/i/${invoice.publicToken}/pdf?download=1`} target="_blank" rel="noreferrer"><Btn variant="ghost" icon={<Download size={15} />}>PDF</Btn></a>}
              {kind === "INVOICE" && invoice.status !== "PAID" && invoice.status !== "VOID" && <Btn variant="soft" icon={<CheckCircle2 size={15} />} onClick={() => setPayOpen(true)}>Record payment</Btn>}
              {kind === "ESTIMATE" && invoice.status !== "ACCEPTED" && <Btn variant="soft" icon={<ArrowRightLeft size={15} />} onClick={convert}>Convert to invoice</Btn>}
              {invoice.status !== "VOID" && <IconButton label="Void" onClick={() => status("VOID", "Voided")}><Ban size={16} /></IconButton>}
              <IconButton label="Delete" onClick={remove}><Trash2 size={16} /></IconButton>
            </>
          )}
          <Btn onClick={save} busy={saving}>{invoice ? "Save" : `Create ${noun.toLowerCase()}`}</Btn>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_320px]">
        <div className="space-y-5">
          <Card title="Customer">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="text-caption font-semibold uppercase text-ink-3 sm:col-span-2">Existing contact
                <div className="mt-1 font-normal normal-case">
                  <Select
                    size="sm"
                    value={leadId}
                    onChange={(e) => pickContact(e.target.value)}
                    options={[
                      { value: "", label: "— pick or enter manually —" },
                      ...pickers.contacts.slice(0, 500).map((c) => ({ value: c.id, label: `${c.name} · ${c.phone ?? "no phone"}` })),
                    ]}
                  />
                </div>
              </label>
              <label className="text-caption font-semibold uppercase text-ink-3">Name
                <input className={inputCls} value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
              </label>
              <label className="text-caption font-semibold uppercase text-ink-3">Email
                <input className={inputCls} value={customerEmail} onChange={(e) => setCustomerEmail(e.target.value)} />
              </label>
              <label className="text-caption font-semibold uppercase text-ink-3">Phone
                <input className={inputCls} value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} />
              </label>
            </div>
          </Card>

          <Card title="Line items" actions={
            <Select
              size="sm"
              className="w-48"
              value=""
              onChange={(e) => e.target.value && addProduct(e.target.value)}
              options={[
                { value: "", label: "+ Add from product" },
                ...pickers.products.map((p) => ({ value: p.id, label: p.name })),
              ]}
            />
          }>
            <div className="space-y-2">
              <div className="flex gap-2 text-caption font-semibold uppercase text-ink-3">
                <span className="flex-1">Description</span><span className="w-14 text-right">Qty</span><span className="w-28 text-right">Unit ₹</span><span className="w-28 text-right">Amount</span><span className="w-6" />
              </div>
              {items.map((it, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input className={`${inputCls} flex-1`} placeholder="Item description" value={it.description} onChange={(e) => setItem(i, { description: e.target.value })} />
                  <input className={`${inputCls} w-14 text-right`} type="number" min={1} value={it.quantity} onChange={(e) => setItem(i, { quantity: Number(e.target.value) || 1 })} />
                  <input className={`${inputCls} w-28 text-right`} inputMode="decimal" value={it.unitPriceInr} onChange={(e) => setItem(i, { unitPriceInr: e.target.value })} />
                  <span className="w-28 text-right text-sm text-ink-2">{formatInrMinor(toPaise(it.unitPriceInr) * Math.max(1, it.quantity))}</span>
                  <IconButton label="Remove line" onClick={() => setItems((its) => its.filter((_, idx) => idx !== i))}><Trash2 size={15} /></IconButton>
                </div>
              ))}
              <Btn size="sm" variant="ghost" icon={<Plus size={14} />} onClick={() => setItems((its) => [...its, { description: "", quantity: 1, unitPriceInr: "" }])}>Add line</Btn>
            </div>
          </Card>

          <Card title="Notes">
            <textarea className="w-full rounded-field border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-primary" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Payment terms, bank details, thank-you note…" />
          </Card>
        </div>

        <div className="space-y-5">
          <Card title="Details">
            <div className="space-y-3">
              <label className="block text-caption font-semibold uppercase text-ink-3">Issue date
                <div className="mt-1 font-normal normal-case">
                  <DatePicker size="sm" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
                </div>
              </label>
              <label className="block text-caption font-semibold uppercase text-ink-3">Due date
                <div className="mt-1 font-normal normal-case">
                  <DatePicker size="sm" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
                </div>
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="text-caption font-semibold uppercase text-ink-3">Discount ₹
                  <input className={inputCls} inputMode="decimal" value={discountInr} onChange={(e) => setDiscountInr(e.target.value)} />
                </label>
                <label className="text-caption font-semibold uppercase text-ink-3">Tax %
                  <input className={inputCls} type="number" min={0} value={taxPercent} onChange={(e) => setTaxPercent(Number(e.target.value) || 0)} />
                </label>
              </div>
            </div>
          </Card>

          <Card title="Summary">
            <div className="space-y-1.5 text-sm">
              <Line label="Subtotal" value={formatInrMinor(subtotal)} />
              <Line label="Discount" value={`-${formatInrMinor(discount)}`} />
              <Line label={`Tax (${taxPercent}%)`} value={formatInrMinor(tax)} />
              <div className="flex justify-between border-t border-line pt-2 text-base font-bold text-ink"><span>Total</span><span>{formatInrMinor(total)}</span></div>
              {invoice && <div className="flex justify-between text-caption text-ink-3"><span>Paid {invoice.amountPaidDisplay}</span><span>Balance {invoice.balanceDisplay}</span></div>}
            </div>
          </Card>

          {invoice && invoice.payments.length > 0 && (
            <Card title="Payments">
              <div className="space-y-2">
                {invoice.payments.map((p) => (
                  <div key={p.id} className="flex items-center justify-between text-sm">
                    <span className="text-ink-2">{p.method}{p.reference ? ` · ${p.reference}` : ""}</span>
                    <span className="font-medium text-ink">{p.amountDisplay}</span>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      </div>

      <FormError message={error} />

      <Modal open={payOpen} onClose={() => setPayOpen(false)} title="Record payment" size="sm">
        <form action={pay} className="space-y-4">
          <Field label="Amount (₹)"><TextInput name="amountInr" inputMode="decimal" required defaultValue={invoice ? invoice.balanceDisplay.replace(/[^\d.]/g, "") : ""} /></Field>
          <Field label="Method"><Select name="method" options={[{ value: "cash", label: "Cash" }, { value: "upi", label: "UPI" }, { value: "bank", label: "Bank transfer" }, { value: "card", label: "Card" }, { value: "other", label: "Other" }]} defaultValue="upi" /></Field>
          <Field label="Reference (optional)"><TextInput name="reference" placeholder="Txn id / note" /></Field>
          <FormError message={payError} />
          <div className="flex justify-end gap-2"><Btn variant="ghost" type="button" onClick={() => setPayOpen(false)}>Cancel</Btn><SubmitButton>Record</SubmitButton></div>
        </form>
      </Modal>
    </div>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return <div className="flex justify-between text-ink-2"><span>{label}</span><span>{value}</span></div>;
}

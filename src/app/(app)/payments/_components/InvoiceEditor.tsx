"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, Plus, Trash2, Send, Download, Link2, Ban, CheckCircle2, ArrowRightLeft, Lock, Mail,
} from "lucide-react";
import type { InvoiceDetail, InvoiceLineOption } from "@/server/payments-metrics";
import type { InvoiceTaxConfig } from "@/lib/config-schema";
import { Btn, IconButton } from "@/components/ui/controls";
import { Card, Pill, type Tone } from "@/components/ui/kit";
import { Modal } from "@/components/ui/Modal";
import { Field, TextInput, Select, SubmitButton, FormError } from "@/components/ui/form";
import { MoneyInput } from "@/components/ui/MoneyInput";
import { fieldKindProps } from "@/components/ui/field-base";
import { DatePicker } from "@/components/ui/DatePicker";
import { toast, askConfirm } from "@/components/ui/feedback";
import {
  CURRENCY_LABELS,
  CURRENCY_SYMBOLS,
  computeInvoiceTotals,
  convertMinorPreview,
  formatMinor,
  otherCurrency,
  taxLine,
  type InvoiceCurrencyCode,
} from "@/lib/invoice-money";
import { safeAction } from "@/lib/action-guard";
import {
  createInvoice, updateInvoice, setInvoiceStatus, sendInvoice, recordPayment, deleteInvoice, convertEstimate,
  sendReceipt,
} from "@/server/payments-actions";

/**
 * The invoice / estimate editor.
 *
 * ── IT IS PRICED IN ONE CURRENCY, AND YOU CHOOSE WHICH ────────────────────────────
 * Every figure typed below is in the invoice's own currency. The sidebar shows the converted
 * total underneath as a courtesy, labelled as a conversion - never as a second amount owed.
 *
 * ── EVERY LINE CAN NAME ITS PROGRAMME ─────────────────────────────────────────────
 * Picking a programme fills the description and the price from the catalogue and, more
 * importantly, carries the level onto the saved line - which is what lets a paid invoice post its
 * Income against the real programme instead of a generic "Other". A hand-typed line is still a
 * line: not everything invoiced is a programme.
 *
 * ── THE PREVIEW IS THE SAME ARITHMETIC THE SERVER WILL DO ─────────────────────────
 * `computeInvoiceTotals` is the one both run, so the number watched on screen and the number
 * stored cannot drift. The server still recomputes authoritatively - this is a preview, not a
 * submission of totals.
 */

type Pickers = {
  contacts: {
    id: string; name: string; email: string | null; phone: string | null;
    /** From the contact's signed agreement, when there is one. */
    address: string | null; agreementNo: string | null;
  }[];
  /**
   * What a line can sell: the whole active programme catalogue plus the one-off products -
   * see `getInvoicePickers`. Keyed by its own `id`, and an option may be UNPRICED, in which
   * case picking it names the programme and leaves the amount to be typed.
   */
  lineOptions: InvoiceLineOption[];
};
type Item = { description: string; quantity: number; unitPrice: string; levelCode: string | null };

const inputCls = "h-9 w-full rounded-field border border-line bg-surface px-3 text-sm outline-none focus:border-primary";
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
  tax,
  fxRate,
}: {
  invoice: InvoiceDetail | null;
  kind: "INVOICE" | "ESTIMATE";
  pickers: Pickers;
  /** The founder's per-currency defaults. A new invoice opens on the one for its currency. */
  tax: InvoiceTaxConfig;
  /** INR per EUR, for the sidebar's converted figure only - the server stamps its own. */
  fxRate: number;
}) {
  const router = useRouter();
  const noun = kind === "ESTIMATE" ? "Estimate" : "Invoice";

  const [currency, setCurrency] = useState<InvoiceCurrencyCode>(invoice?.currency ?? "INR");
  const [leadId, setLeadId] = useState(invoice?.leadId ?? "");
  const [customerName, setCustomerName] = useState(invoice?.customerName ?? "");
  const [customerEmail, setCustomerEmail] = useState(invoice?.customerEmail ?? "");
  const [customerPhone, setCustomerPhone] = useState(invoice?.customerPhone ?? "");
  const [customerAddress, setCustomerAddress] = useState(invoice?.customerAddress ?? "");
  const [issueDate, setIssueDate] = useState(invoice?.issueDate || today());
  const [dueDate, setDueDate] = useState(invoice?.dueDate ?? "");
  const [serviceStart, setServiceStart] = useState(invoice?.servicePeriodStart ?? "");
  const [serviceEnd, setServiceEnd] = useState(invoice?.servicePeriodEnd ?? "");
  const [agreementRef, setAgreementRef] = useState(invoice?.agreementRef ?? "");
  const [taxNote, setTaxNote] = useState(invoice?.taxNote ?? "");
  const [items, setItems] = useState<Item[]>(
    invoice?.items.map((i) => ({
      description: i.description, quantity: i.quantity, unitPrice: i.unitPrice, levelCode: i.levelCode,
    })) ?? [{ description: "", quantity: 1, unitPrice: "", levelCode: null }],
  );
  const [discount, setDiscount] = useState(invoice?.discount ?? "");
  /**
   * An EXISTING invoice keeps the rate it charged; a new one opens on the founder's default for
   * its currency. Re-reading the config onto a saved invoice would silently re-tax a document
   * that has already been sent.
   */
  const [taxPercent, setTaxPercent] = useState(invoice?.taxPercent ?? tax[invoice?.currency ?? "INR"].percent);
  const [taxLabel, setTaxLabel] = useState(invoice?.taxLabel ?? tax[invoice?.currency ?? "INR"].label);
  const [notes, setNotes] = useState(invoice?.notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);

  // This screen hand-rolls its <input>s (they're denser than the form kit's), so each one picks up
  // its character rule through fieldKindProps rather than a `kind` prop. Not hooks - safe to call
  // here and, below, inside the line-item .map().
  const nameField = fieldKindProps<HTMLInputElement>("name", (e) => setCustomerName(e.target.value));
  const emailField = fieldKindProps<HTMLInputElement>("email", (e) => setCustomerEmail(e.target.value));
  const phoneField = fieldKindProps<HTMLInputElement>("phone", (e) => setCustomerPhone(e.target.value));
  const notesField = fieldKindProps<HTMLTextAreaElement>("text", (e) => setNotes(e.target.value));

  // Client-side preview, from the same pure functions the server action uses.
  const totals = computeInvoiceTotals(items, discount, taxPercent);
  const sym = CURRENCY_SYMBOLS[currency];
  const other = otherCurrency(currency);
  const convertedTotal = convertMinorPreview(totals.totalMinor, fxRate, currency, other);
  const taxRow = taxLine(taxLabel, taxPercent);

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
      // The address the student signed their agreement with, and that agreement - whose payment
      // terms then print on the invoice. Only filled, never cleared: a typed address survives.
      if (c.address) setCustomerAddress(c.address);
      if (c.agreementNo) setAgreementRef(c.agreementNo);
    }
  }
  /** The option's price in THIS invoice's currency - never the rupee figure pasted into a euro line. */
  const priceOf = (p: InvoiceLineOption) => (currency === "EUR" ? p.priceEur : p.priceInr);
  /** An unpriced programme contributes a name and a level, and no amount. */
  const describe = (p: InvoiceLineOption) => p.description?.trim() || p.label.split(" · ")[0];

  function addProduct(id: string) {
    const p = pickers.lineOptions.find((x) => x.id === id);
    if (!p) return;
    setItems((its) => {
      const line: Item = { description: describe(p), quantity: 1, unitPrice: priceOf(p), levelCode: p.levelCode };
      // An untouched opening line is REPLACED rather than left above the one just added - a blank
      // first row is the editor's starting state, not a line somebody wrote.
      const blank = its.length === 1 && !its[0].description.trim() && !its[0].unitPrice.trim();
      return blank ? [line] : [...its, line];
    });
  }

  /** Fill a line from a programme in place - the per-line version of "add a programme". */
  function setLineProduct(i: number, optionId: string) {
    const p = pickers.lineOptions.find((x) => x.id === optionId);
    if (!p) return setItem(i, { levelCode: null });
    // An unpriced option leaves whatever is in the box alone rather than blanking a typed
    // amount: naming the programme is the point, and the price may already be right.
    const price = priceOf(p);
    setItem(i, { description: describe(p), levelCode: p.levelCode, ...(price ? { unitPrice: price } : {}) });
  }

  /**
   * Switching currency re-reads the tax DEFAULT, because the rate is the other country's now.
   * The amounts typed are deliberately left alone: they are what somebody meant to charge, and
   * silently multiplying them by ~90 is not a conversion anyone asked for.
   */
  function switchCurrency(next: InvoiceCurrencyCode) {
    setCurrency(next);
    if (!invoice) {
      setTaxPercent(tax[next].percent);
      setTaxLabel(tax[next].label);
    }
  }

  async function save() {
    setError(null);
    setSaving(true);
    const payload = {
      kind, leadId: leadId || undefined, customerName, customerEmail, customerPhone, customerAddress,
      issueDate, dueDate: dueDate || undefined, servicePeriodStart: serviceStart, servicePeriodEnd: serviceEnd,
      agreementRef, taxNote, currency, items, discount, taxPercent, taxLabel, notes,
    };
    const res = await safeAction(() =>
      invoice ? updateInvoice(invoice.id, payload) : createInvoice(payload),
    );
    setSaving(false);
    if (!res.ok) return setError(res.error);
    toast(invoice ? "Saved" : `${noun} created`);
    if (!invoice) router.push("/payments");
    else router.refresh();
  }

  async function status(s: string, label: string) {
    if (!invoice) return;
    const res = await safeAction(() => setInvoiceStatus(invoice.id, s));
    if (res.ok) { toast(label); router.refresh(); } else toast(res.error, "error");
  }
  async function send() {
    if (!invoice) return;
    const res = await safeAction(() => sendInvoice(invoice.id));
    if (res.ok) { toast(res.message); router.refresh(); } else toast(res.error, "error");
  }
  async function convert() {
    if (!invoice) return;
    const res = await safeAction(() => convertEstimate(invoice.id));
    if (res.ok) { toast("Converted to invoice"); router.push("/payments"); } else toast(res.error, "error");
  }
  async function remove() {
    if (!invoice) return;
    /*
      Archive, not delete (issue 26). The record is soft-deleted and restorable for 90 days, and
      calling that "Delete" taught people the number was gone - which matters most for an invoice,
      whose number is quoted to a customer and must never be reissued.
    */
    if (
      !(await askConfirm({
        title: `Archive ${invoice.number}?`,
        body: "It moves to the Archived list and can be restored. The invoice number stays reserved.",
        confirmLabel: "Archive",
        danger: true,
      }))
    )
      return;
    const res = await safeAction(() => deleteInvoice(invoice.id));
    if (res.ok) { toast("Archived"); router.push("/payments"); } else toast(res.error, "error");
  }
  async function pay(fd: FormData) {
    if (!invoice) return;
    setPayError(null);
    const res = await safeAction(() => recordPayment(invoice.id, fd));
    if (!res.ok) return setPayError(res.error);
    toast("Payment recorded");
    setPayOpen(false);
    router.refresh();
  }
  async function emailReceipt(paymentId: string) {
    const res = await safeAction(() => sendReceipt(paymentId));
    if (res.ok) { toast(res.message); router.refresh(); } else toast(res.error, "error");
  }
  async function copyLink() {
    if (!invoice) return;
    await navigator.clipboard.writeText(`${window.location.origin}/i/${invoice.publicToken}`).catch(() => {});
    toast("Public link copied");
  }

  const canShare = invoice && invoice.status !== "DRAFT" && invoice.status !== "VOID";
  /** Issued = numbered and locked. Everything below renders read-only. */
  const locked = !!invoice?.issued;
  const productOpts = pickers.lineOptions.map((p) => ({ value: p.id, label: p.label }));

  return (
    <div className="space-y-5">
      <Link href="/payments" className="inline-flex items-center gap-1.5 text-sm text-ink-2 hover:text-primary"><ArrowLeft size={16} /> Payments</Link>

      {/*
        The save button used to live up here, alone above the sidebar, which put the one action
        that commits the document as far from the figures it commits as the layout allowed. It now
        sits under the summary it is confirming; this row keeps only the actions that act on an
        invoice that already exists.
      */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="font-display text-display-l font-bold text-ink">
            {invoice ? (invoice.provisional ? "Draft invoice" : invoice.number) : `New ${noun.toLowerCase()}`}
          </h1>
          {invoice && <Pill tone={statusTone(invoice.status)}>{invoice.status}</Pill>}
          {invoice?.provisional && (
            <span className="text-caption text-ink-3">Gets its INV number when it is sent</span>
          )}
        </div>
        {invoice && (
          <div className="flex flex-wrap items-center gap-2">
            {invoice.status === "DRAFT" && <Btn variant="soft" icon={<Send size={15} />} onClick={send}>Send</Btn>}
            {canShare && <Btn variant="ghost" icon={<Link2 size={15} />} onClick={copyLink}>Link</Btn>}
            {canShare && <a href={`/i/${invoice.publicToken}/pdf?download=1`} target="_blank" rel="noreferrer"><Btn variant="ghost" icon={<Download size={15} />}>PDF</Btn></a>}
            {kind === "INVOICE" && invoice.status !== "PAID" && invoice.status !== "VOID" && <Btn variant="soft" icon={<CheckCircle2 size={15} />} onClick={() => setPayOpen(true)}>Record payment</Btn>}
            {kind === "ESTIMATE" && invoice.status !== "ACCEPTED" && <Btn variant="soft" icon={<ArrowRightLeft size={15} />} onClick={convert}>Convert to invoice</Btn>}
            {invoice.status !== "VOID" && <IconButton label="Void" onClick={() => status("VOID", "Voided")}><Ban size={16} /></IconButton>}
            <IconButton label="Archive invoice" onClick={remove}><Trash2 size={16} /></IconButton>
          </div>
        )}
      </div>

      {locked && (
        <div className="flex items-start gap-2 rounded-card border border-line bg-surface-2 px-4 py-3 text-sm text-ink-2">
          <Lock size={16} className="mt-0.5 flex-none text-ink-3" />
          <p>
            <strong className="text-ink">{invoice?.number} has been issued, so it can&rsquo;t be changed.</strong>{" "}
            The customer holds this version. To correct it, void it and raise a new invoice &ndash; both stay on record.
          </p>
        </div>
      )}

      {/* `items-start` is what lets the sticky sidebar work: a stretched grid item is as tall as
          the row, so there is nothing for `sticky` to travel within. */}
      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[1fr_340px]">
        <fieldset disabled={locked} className="min-w-0 space-y-5">
          <Card title="Customer">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="text-caption font-semibold uppercase text-ink-3 sm:col-span-2">Existing contact
                <div className="mt-1 font-normal normal-case">
                  <Select
                    size="sm"
                    value={leadId}
                    onChange={(e) => pickContact(e.target.value)}
                    options={[
                      { value: "", label: "- pick or enter manually -" },
                      ...pickers.contacts.slice(0, 500).map((c) => ({ value: c.id, label: `${c.name} · ${c.phone ?? "no phone"}` })),
                    ]}
                  />
                </div>
              </label>
              <label className="text-caption font-semibold uppercase text-ink-3">Name
                <input {...nameField.attrs} className={inputCls} value={customerName} onChange={nameField.onChange} />
              </label>
              <label className="text-caption font-semibold uppercase text-ink-3">Email
                <input {...emailField.attrs} className={inputCls} value={customerEmail} onChange={emailField.onChange} />
              </label>
              <label className="text-caption font-semibold uppercase text-ink-3">Phone
                <input {...phoneField.attrs} className={inputCls} value={customerPhone} onChange={phoneField.onChange} />
              </label>
              {/* Required to issue: an invoice names the recipient's address, not just a name. */}
              <label className="text-caption font-semibold uppercase text-ink-3 sm:col-span-2">Postal address
                <textarea
                  className="mt-1 w-full rounded-field border border-line bg-surface px-3 py-2 text-sm font-normal normal-case outline-none focus:border-primary"
                  rows={2}
                  maxLength={300}
                  value={customerAddress}
                  placeholder={"Street and number\nPostcode, city, country"}
                  onChange={(e) => setCustomerAddress(e.target.value)}
                />
              </label>
            </div>
          </Card>

          <Card
            title="Line items"
            actions={
              <Select
                size="sm"
                className="w-52"
                value=""
                onChange={(e) => e.target.value && addProduct(e.target.value)}
                options={[{ value: "", label: "+ Add a programme" }, ...productOpts]}
              />
            }
          >
            <div className="space-y-3">
              {/*
                ── A LINE IS A BLOCK, NOT A ROW OF BOXES ───────────────────────────────
                The old layout was one flex row per line with the description on `flex-1`. Beside
                a fixed sidebar it had barely any width left, so the row wrapped and the three
                fields stacked under unlabelled headers - a column header saying "QTY" with the
                quantity box two lines below it, which is the screenshot that prompted this.
                Each line is now a small grid that reflows honestly, carries its own labels, and
                has room for the thing that was missing: what the line actually sells.
              */}
              {items.map((it, i) => {
                // Per-row, inside the map: fieldKindProps calls no hooks, so this is safe.
                const price = fieldKindProps<HTMLInputElement>("money", (e) => setItem(i, { unitPrice: e.target.value }));
                const lineTotal = totals.subtotalMinor === 0n && !it.unitPrice
                  ? 0n
                  : computeInvoiceTotals([it], "", 0).subtotalMinor;
                // A line remembers its PROGRAMME, not which catalogue row filled it, so the
                // picker re-matches by level code. A one-off item has none and reads as custom.
                const matchedProduct = pickers.lineOptions.find((p) => p.levelCode && p.levelCode === it.levelCode);
                return (
                  <div key={i} className="rounded-card border border-line bg-surface-2/40 p-3">
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-12">
                      <label className="text-caption font-semibold uppercase text-ink-3 sm:col-span-5">
                        Programme
                        <div className="mt-1 font-normal normal-case">
                          <Select
                            size="sm"
                            value={matchedProduct?.id ?? ""}
                            onChange={(e) =>
                              e.target.value ? setLineProduct(i, e.target.value) : setItem(i, { levelCode: null })
                            }
                            options={[{ value: "", label: "Custom line (no programme)" }, ...productOpts]}
                          />
                        </div>
                      </label>
                      <label className="text-caption font-semibold uppercase text-ink-3 sm:col-span-7">
                        Description
                        <input
                          className={`${inputCls} mt-1 font-normal normal-case`}
                          placeholder="What the customer is being charged for"
                          value={it.description}
                          onChange={(e) => setItem(i, { description: e.target.value })}
                        />
                      </label>

                      <label className="text-caption font-semibold uppercase text-ink-3 sm:col-span-2">
                        Qty
                        <input
                          className={`${inputCls} mt-1 text-right font-normal normal-case`}
                          type="number"
                          min={1}
                          value={it.quantity}
                          onChange={(e) => setItem(i, { quantity: Number(e.target.value) || 1 })}
                        />
                      </label>
                      <label className="text-caption font-semibold uppercase text-ink-3 sm:col-span-4">
                        Unit price ({sym})
                        <input
                          {...price.attrs}
                          className={`${inputCls} mt-1 text-right font-normal normal-case`}
                          value={it.unitPrice}
                          onChange={price.onChange}
                        />
                      </label>
                      <div className="flex items-end justify-between gap-2 sm:col-span-6">
                        <div className="min-w-0">
                          <span className="block text-caption font-semibold uppercase text-ink-3">Amount</span>
                          <span className="block text-sm font-semibold text-ink">{formatMinor(lineTotal, currency)}</span>
                        </div>
                        <IconButton
                          label={`Remove line ${i + 1}`}
                          onClick={() => setItems((its) => (its.length === 1 ? its : its.filter((_, idx) => idx !== i)))}
                        >
                          <Trash2 size={15} />
                        </IconButton>
                      </div>
                    </div>
                  </div>
                );
              })}
              <Btn
                size="sm"
                variant="ghost"
                icon={<Plus size={14} />}
                onClick={() => setItems((its) => [...its, { description: "", quantity: 1, unitPrice: "", levelCode: null }])}
              >
                Add line
              </Btn>
            </div>
          </Card>

          <Card title="Notes">
            <textarea {...notesField.attrs} className="w-full rounded-field border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-primary" rows={3} value={notes} onChange={notesField.onChange} placeholder="Anything specific to this invoice - e.g. Instalment 2 of 4" />
          </Card>
        </fieldset>

        {/*
          The sidebar FOLLOWS THE PAGE. On a long invoice the totals and the save button used to
          scroll away, so the figures you were checking and the button that commits them were
          never on screen together. `top-20` clears the sticky app header.
        */}
        <div className="space-y-4 lg:sticky lg:top-20">
          <Card title="Details">
            <fieldset disabled={locked} className="min-w-0 space-y-3">
              <label className="block text-caption font-semibold uppercase text-ink-3">Currency
                <div className="mt-1 font-normal normal-case">
                  <Select
                    size="sm"
                    value={currency}
                    onChange={(e) => switchCurrency(e.target.value as InvoiceCurrencyCode)}
                    options={[
                      { value: "INR", label: CURRENCY_LABELS.INR },
                      { value: "EUR", label: CURRENCY_LABELS.EUR },
                    ]}
                  />
                </div>
              </label>
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
              {/* Required to issue: when the service is supplied - a date, or a period for a programme. */}
              <div className="grid grid-cols-2 gap-2">
                <label className="block text-caption font-semibold uppercase text-ink-3">Service from
                  <div className="mt-1 font-normal normal-case">
                    <DatePicker size="sm" value={serviceStart} onChange={(e) => setServiceStart(e.target.value)} />
                  </div>
                </label>
                <label className="block text-caption font-semibold uppercase text-ink-3">to (optional)
                  <div className="mt-1 font-normal normal-case">
                    <DatePicker size="sm" value={serviceEnd} onChange={(e) => setServiceEnd(e.target.value)} />
                  </div>
                </label>
              </div>
              <label className="block text-caption font-semibold uppercase text-ink-3">Agreement
                <input
                  className={`${inputCls} mt-1 font-normal normal-case`}
                  value={agreementRef}
                  placeholder="B2-GM-2026-0001"
                  onChange={(e) => setAgreementRef(e.target.value)}
                />
                <span className="mt-1 block text-caption font-normal normal-case text-ink-3">
                  Prints the agreement&rsquo;s payment &amp; refund terms (§7.3, §7.4, §8) on the invoice.
                </span>
              </label>
              <label className="block text-caption font-semibold uppercase text-ink-3">Discount ({sym})
                <div className="mt-1 font-normal normal-case">
                  <MoneyInput
                    size="sm"
                    currency={currency}
                    value={discount}
                    onValueChange={setDiscount}
                    placeholder="0"
                  />
                </div>
              </label>
              <div className="grid grid-cols-[1fr_5.5rem] gap-2">
                <label className="text-caption font-semibold uppercase text-ink-3">Tax name
                  <input
                    className={`${inputCls} mt-1 font-normal normal-case`}
                    value={taxLabel}
                    placeholder={currency === "EUR" ? "VAT" : "GST"}
                    onChange={(e) => setTaxLabel(e.target.value)}
                  />
                </label>
                <label className="text-caption font-semibold uppercase text-ink-3">Rate %
                  <input
                    className={`${inputCls} mt-1 text-right font-normal normal-case`}
                    type="number"
                    min={0}
                    max={100}
                    step="0.5"
                    value={taxPercent}
                    onChange={(e) => setTaxPercent(Number(e.target.value) || 0)}
                  />
                </label>
              </div>
              {/* Nothing is charged at 0, and the document says nothing about tax at all. */}
              <p className="text-caption text-ink-3">
                {taxRow ? `Charged as “${taxRow}”.` : "No tax on this invoice - the tax line is left off the document."}
                {taxPercent > 0 && (
                  <>
                    {" "}
                    <button type="button" className="font-semibold text-primary hover:underline" onClick={() => setTaxPercent(0)}>
                      Remove tax
                    </button>
                  </>
                )}
              </p>
              {/* A 0% invoice must say WHY no tax is charged. Blank takes the Console's wording. */}
              {!taxRow && (
                <label className="block text-caption font-semibold uppercase text-ink-3">Why no tax
                  <textarea
                    className="mt-1 w-full rounded-field border border-line bg-surface px-3 py-2 text-sm font-normal normal-case outline-none focus:border-primary"
                    rows={2}
                    maxLength={300}
                    value={taxNote}
                    placeholder={tax[currency].note || "Set the default in Console → Money → Invoicing"}
                    onChange={(e) => setTaxNote(e.target.value)}
                  />
                </label>
              )}
            </fieldset>
          </Card>

          <Card title="Summary">
            <div className="space-y-1.5 text-sm">
              <Line label="Subtotal" value={formatMinor(totals.subtotalMinor, currency)} />
              {totals.discountMinor > 0n && <Line label="Discount" value={`-${formatMinor(totals.discountMinor, currency)}`} />}
              {taxRow && <Line label={taxRow} value={formatMinor(totals.taxMinor, currency)} />}
              <div className="flex justify-between border-t border-line pt-2 text-base font-bold text-ink"><span>Total</span><span>{formatMinor(totals.totalMinor, currency)}</span></div>
              {/* A conversion, said to be one. Never a second amount owed. */}
              <div className="flex justify-between text-caption text-ink-3">
                <span>approx. {formatMinor(convertedTotal, other)}</span>
                <span>at today&rsquo;s rate</span>
              </div>
              {invoice && <div className="flex justify-between text-caption text-ink-3"><span>Paid {invoice.amountPaidDisplay}</span><span>Balance {invoice.balanceDisplay}</span></div>}
            </div>
          </Card>

          {/* The commit button, directly under the figures it commits. */}
          {!locked && (
            <div className="space-y-2">
              <Btn className="w-full justify-center" onClick={save} busy={saving}>
                {invoice ? "Save changes" : `Create ${noun.toLowerCase()}`}
              </Btn>
              <FormError message={error} />
            </div>
          )}

          {invoice && invoice.payments.length > 0 && (
            <Card title="Payments">
              <div className="space-y-2">
                {invoice.payments.map((p) => (
                  <div key={p.id} className="space-y-1 border-b border-line pb-2 text-sm last:border-0 last:pb-0">
                    <div className="flex items-center justify-between">
                      <span className="text-ink-2">{p.method}{p.reference ? ` · ${p.reference}` : ""}</span>
                      <span className="font-medium text-ink">{p.amountDisplay}</span>
                    </div>
                    {/* The written confirmation the agreement promises (§7.4). */}
                    {p.receiptNumber && (
                      <div className="flex items-center justify-between gap-2 text-caption text-ink-3">
                        <span>
                          {p.receiptNumber}
                          {p.receiptSentAt ? " · emailed" : ""}
                        </span>
                        <span className="flex items-center gap-1">
                          <a
                            href={`/i/${invoice.publicToken}/receipt/${encodeURIComponent(p.receiptNumber)}?download=1`}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 font-semibold text-primary hover:underline"
                          >
                            <Download size={13} /> Receipt
                          </a>
                          <IconButton label={`Email receipt ${p.receiptNumber}`} onClick={() => emailReceipt(p.id)}>
                            <Mail size={14} />
                          </IconButton>
                        </span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      </div>

      <Modal open={payOpen} onClose={() => setPayOpen(false)} title="Record payment" size="sm">
        <form action={pay} className="space-y-4">
          {/* Paid in the currency the invoice was raised in - the server values it at the rate
              that invoice was stamped with, not today's. */}
          <Field label={`Amount (${sym})`}>
            <MoneyInput
              currency={currency}
              name="amountInr"
              required
              // The canonical balance, not the formatted one: re-parsing "125.000,50" back into
              // a number is exactly the trap MoneyInput's hidden field exists to avoid.
              defaultValue={invoice?.balance ?? ""}
            />
          </Field>
          <Field label="Method"><Select name="method" options={[{ value: "cash", label: "Cash" }, { value: "upi", label: "UPI" }, { value: "bank", label: "Bank transfer" }, { value: "card", label: "Card" }, { value: "other", label: "Other" }]} defaultValue={currency === "EUR" ? "bank" : "upi"} /></Field>
          <Field label="Reference (optional)"><TextInput kind="text" name="reference" placeholder="Txn id / note" /></Field>
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

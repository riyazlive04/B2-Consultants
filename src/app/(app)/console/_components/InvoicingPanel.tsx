"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { DEFAULT_INVOICE_SETTINGS, type InvoiceSettings } from "@/lib/config-schema";
import { CURRENCY_LABELS, INVOICE_CURRENCIES, taxLine, type InvoiceCurrencyCode } from "@/lib/invoice-money";
import { toast } from "@/components/ui/feedback";
import { saveInvoiceSettings } from "@/server/console-actions";
import { safeAction } from "@/lib/action-guard";
import { Card, ColHead, ColRow, ColScroll, EditorSection, Hint, NameCell, NumInput, SaveBar, TextIn } from "./kit";

/**
 * Invoicing (Founder Console → Money → Invoicing): who invoices are FROM, and what tax they
 * charge.
 *
 * ── THE ISSUER BLOCK ──────────────────────────────────────────────────────────────
 * An invoice is a legal instrument, and the details that make it one - the registered name, the
 * full address, the tax registration it charges under - are facts about a company that no source
 * file can know. They were hard-coded as two lines ("B2 Consultants" / "Reichelsheim, Germany")
 * in the PDF and in the public page: both too little to make a valid invoice header, and in the
 * wrong place for the person who actually knows the details to correct them.
 *
 * EVERY EMPTY FIELD IS SIMPLY LEFT OFF the document. Nothing here invents a placeholder tax
 * number, because an invoice carrying an invented registration is worse than one carrying none.
 * These are read at PRINT time, so fixing a typo in the address fixes it on every document,
 * including ones already issued - which is what you want for an address.
 *
 * ── THE TAX RATES ─────────────────────────────────────────────────────────────────
 * One per currency, because the two halves of this business are taxed by different countries:
 * India's GST on a rupee invoice, German VAT on a euro one. A single shared "Tax %" box could
 * only ever be right for one of them. Unlike the address, a rate is a DEFAULT: each invoice
 * snapshots what it actually charged, so changing it here never rewrites a document already
 * sent. A rate of 0 prints no tax line at all - which is how a customer who should not be taxed
 * is invoiced.
 */

const TAX_COLS = "10rem 1fr 7rem 1fr";
const FIELD_COLS = "11rem 1fr";

export function InvoicingPanel({ config }: { config: InvoiceSettings }) {
  const router = useRouter();
  const [draft, setDraft] = useState<InvoiceSettings>(config);
  const [saved, setSaved] = useState<InvoiceSettings>(config);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);

  const patchIssuer = (patch: Partial<InvoiceSettings["issuer"]>) =>
    setDraft((d) => ({ ...d, issuer: { ...d.issuer, ...patch } }));

  const patchTax = (currency: InvoiceCurrencyCode, patch: Partial<InvoiceSettings["tax"]["INR"]>) =>
    setDraft((d) => ({ ...d, tax: { ...d.tax, [currency]: { ...d.tax[currency], ...patch } } }));

  async function save() {
    setBusy(true);
    setError(null);
    const res = await safeAction(() => saveInvoiceSettings(draft));
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setSaved(draft);
    toast("Invoicing settings saved");
    router.refresh();
  }

  /** One labelled row of the issuer form. */
  const Row = ({ label, value, onChange, placeholder, index }: {
    label: string;
    value: string;
    onChange: (s: string) => void;
    placeholder?: string;
    index: number;
  }) => (
    <ColRow cols={FIELD_COLS} index={index}>
      <NameCell className="font-medium">{label}</NameCell>
      <TextIn ariaLabel={label} value={value} placeholder={placeholder} onChange={onChange} />
    </ColRow>
  );

  const issuer = draft.issuer;
  /** The address as one editable block - street layout differs too much country to country. */
  const addressText = issuer.addressLines.join("\n");

  return (
    <div className="space-y-5">
      <Card>
        <EditorSection
          title="Who the invoice is from"
          hint={
            <Hint>
              Printed at the top of every invoice, estimate and PDF.{" "}
              <strong>Anything left blank is left off the document</strong> &ndash; nothing here
              invents a tax number. These are read when a document is printed, so a correction
              shows on invoices already issued too.
            </Hint>
          }
        >
          <div className="space-y-1.5">
            <ColHead cols={FIELD_COLS} labels={["Field", "Value"]} />
            <Row index={0} label="Trading name" value={issuer.name} placeholder="B2 Consultants" onChange={(name) => patchIssuer({ name })} />
            {/* A sole trader's invoice must carry the owner's own full name - required to issue. */}
            <Row index={0} label="Owner's legal name" value={issuer.ownerName} placeholder="First and last name" onChange={(ownerName) => patchIssuer({ ownerName })} />
            <ColRow cols={FIELD_COLS} index={1}>
              <NameCell className="font-medium">Street address</NameCell>
              <textarea
                aria-label="Street address"
                value={addressText}
                rows={2}
                placeholder={"Example Street 1\nBuilding B"}
                onChange={(e) =>
                  patchIssuer({
                    // One line per line typed, blanks dropped - an empty line would print as a
                    // gap in the address block on the finished document.
                    addressLines: e.target.value.split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 5),
                  })
                }
                className="w-full rounded-field border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
              />
            </ColRow>
            <Row index={2} label="Postcode" value={issuer.postcode} placeholder="64385" onChange={(postcode) => patchIssuer({ postcode })} />
            <Row index={3} label="City" value={issuer.city} placeholder="Reichelsheim" onChange={(city) => patchIssuer({ city })} />
            <Row index={4} label="Country" value={issuer.country} placeholder="Germany" onChange={(country) => patchIssuer({ country })} />
            <Row index={5} label="Email" value={issuer.email} placeholder="billing@…" onChange={(email) => patchIssuer({ email })} />
            <Row index={6} label="Phone" value={issuer.phone} placeholder="+49 …" onChange={(phone) => patchIssuer({ phone })} />
            <Row index={7} label="Website" value={issuer.website} placeholder="b2consultants.…" onChange={(website) => patchIssuer({ website })} />
            <Row index={8} label="Tax ID" value={issuer.taxId} placeholder="Steuernummer or USt-IdNr - required to issue" onChange={(taxId) => patchIssuer({ taxId })} />
            <Row index={9} label="Registration no." value={issuer.registrationNo} placeholder="Company register number" onChange={(registrationNo) => patchIssuer({ registrationNo })} />
            <ColRow cols={FIELD_COLS} index={10}>
              <NameCell className="font-medium">How to pay</NameCell>
              <textarea
                aria-label="Bank details"
                value={issuer.bankDetails}
                rows={3}
                placeholder={"Account name\nIBAN …\nBIC …"}
                onChange={(e) => patchIssuer({ bankDetails: e.target.value })}
                className="w-full rounded-field border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
              />
            </ColRow>
            <ColRow cols={FIELD_COLS} index={11}>
              <NameCell className="font-medium">Standing terms</NameCell>
              <textarea
                aria-label="Payment terms"
                value={issuer.paymentTerms}
                rows={2}
                placeholder="Payable within 14 days of the issue date."
                onChange={(e) => patchIssuer({ paymentTerms: e.target.value })}
                className="w-full rounded-field border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
              />
            </ColRow>
          </div>
        </EditorSection>
      </Card>

      <Card>
        <EditorSection
          title="Tax"
          hint={
            <Hint>
              What a <strong>new invoice</strong> starts with, by the currency it is issued in.
              Each invoice keeps the name and rate it actually charged, so changing these never
              rewrites a document already sent &ndash; and whoever raises an invoice can still
              override it. <strong>A rate of 0 prints no tax line at all</strong>, which is how a
              customer who should not be taxed is invoiced &ndash; and then the invoice must say
              why. <strong>Which reason applies is for your tax adviser to confirm</strong>: the
              small-business rule (§ 19 UStG), a service not taxable in Germany (§ 3a UStG), or an
              exemption.
            </Hint>
          }
        >
          <ColScroll>
            <div className="space-y-1.5">
              <ColHead cols={TAX_COLS} labels={["Currency", "Called", "Rate %", "On the invoice / why no tax"]} />
              {INVOICE_CURRENCIES.map((currency, i) => {
                const row = draft.tax[currency];
                const line = taxLine(row.label, row.percent);
                return (
                  <ColRow key={currency} cols={TAX_COLS} index={i}>
                    <NameCell className="font-medium">{CURRENCY_LABELS[currency]}</NameCell>
                    <TextIn
                      ariaLabel={`What the ${currency} tax is called`}
                      value={row.label}
                      placeholder={currency === "INR" ? "GST" : "VAT"}
                      onChange={(label) => patchTax(currency, { label })}
                    />
                    <NumInput
                      ariaLabel={`${currency} tax rate`}
                      value={row.percent}
                      min={0}
                      max={100}
                      onChange={(percent) => patchTax(currency, { percent })}
                    />
                    {line ? (
                      <NameCell className="text-ink-2">{line}</NameCell>
                    ) : (
                      // No tax line means the invoice must say WHY (§14 Abs. 4 Nr. 8 UStG) - a 0%
                      // invoice without this note cannot be issued.
                      <TextIn
                        ariaLabel={`Why no tax is charged on ${currency} invoices`}
                        value={row.note}
                        placeholder="Required at 0% - e.g. Gemäß § 19 UStG wird keine Umsatzsteuer berechnet."
                        onChange={(note) => patchTax(currency, { note })}
                      />
                    )}
                  </ColRow>
                );
              })}
            </div>
          </ColScroll>
        </EditorSection>

        <SaveBar
          dirty={dirty}
          onSave={save}
          onReset={() => setDraft(DEFAULT_INVOICE_SETTINGS)}
          busy={busy}
          error={error}
        />
      </Card>
    </div>
  );
}

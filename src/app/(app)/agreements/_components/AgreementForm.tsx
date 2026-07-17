"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Field, FormError, Select, TextArea, TextInput } from "@/components/ui/form";
import { toast } from "@/components/ui/feedback";
import { type AgreementData } from "@/lib/agreement";
import { formatInrMinor, majorStringToMinor, minorToMajorString } from "@/lib/format";
import { createAgreement, updateAgreement } from "@/server/agreement-actions";

/**
 * The founder's field form. Everything the master document leaves variable, and nothing else —
 * clause text lives in the renderer, not in a database column a typo can reach.
 *
 * The instalment total is checked here AND in `agreementDataSchema` on the server. The client
 * check exists so the founder sees the mismatch as they type; the server check exists because the
 * client one is advisory.
 */

type Mode = { kind: "create"; leadId: string | null; studentId: string | null } | { kind: "edit"; id: string };

/** Rupees in the inputs, minor units in the payload — the same split the ledger uses. */
const toMajor = (minor: string) => minorToMajorString(BigInt(minor)).replace(/\.00$/, "");
const toMinor = (major: string) => majorStringToMinor(major).toString();

/** Prefill field keys (server/agreement-metrics.ts) → what the founder calls them. */
const PREFILL_FIELD_LABELS: Record<string, string> = {
  fullName: "Full name",
  email: "Email",
  phone: "WhatsApp number",
  address: "Postal address",
  batchNumber: "Batch",
  batchStartDate: "Start date",
  payment: "Fee & plan",
};

export function AgreementForm({
  initial,
  mode,
  notes,
  missing,
  filled,
}: {
  initial: AgreementData;
  mode: Mode;
  notes?: string[];
  /** Fields the CRM had no answer for — the founder must type these. */
  missing?: string[];
  /** Field keys filled from the CRM, so we can say so instead of making them re-check everything. */
  filled?: string[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [fullName, setFullName] = useState(initial.student.fullName);
  const [address, setAddress] = useState(initial.student.address);
  const [phone, setPhone] = useState(initial.student.phone);
  const [email, setEmail] = useState(initial.student.email);
  const [batchNo, setBatchNo] = useState(initial.batch.number);
  const [startDate, setStartDate] = useState(initial.batch.startDate);

  const [option, setOption] = useState<"FULL" | "INSTALMENT">(initial.payment.option);
  const [total, setTotal] = useState(toMajor(initial.payment.totalInrMinor));
  const [fullDue, setFullDue] = useState(
    initial.payment.option === "FULL" ? initial.payment.dueMilestone : "Before commencement of Week 1",
  );
  const [inst, setInst] = useState(
    initial.payment.option === "INSTALMENT"
      ? initial.payment.instalments.map((i) => ({ amount: toMajor(i.amountInrMinor), due: i.dueMilestone }))
      : [
          { amount: "", due: "Before commencement of Week 1" },
          { amount: "", due: "Before the commencement of 2nd Sprint Week" },
        ],
  );

  const sumMismatch = useMemo(() => {
    if (option !== "INSTALMENT") return null;
    const totalMinor = majorStringToMinor(total || "0");
    const sum = inst.reduce((a, i) => a + majorStringToMinor(i.amount || "0"), BigInt(0));
    if (sum === totalMinor || totalMinor === BigInt(0)) return null;
    return `Instalments add up to ${formatInrMinor(sum)}, but the total fee is ${formatInrMinor(totalMinor)}.`;
  }, [option, total, inst]);

  function build(): AgreementData {
    const student = { fullName, address, phone, email };
    const batch = { number: batchNo, startDate };
    const payment: AgreementData["payment"] =
      option === "FULL"
        ? { option: "FULL", totalInrMinor: toMinor(total), dueMilestone: fullDue }
        : {
            option: "INSTALMENT",
            totalInrMinor: toMinor(total),
            instalments: inst.map((i) => ({ amountInrMinor: toMinor(i.amount), dueMilestone: i.due })),
          };
    return { student, batch, payment } as AgreementData;
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const data = build();
    startTransition(async () => {
      const res =
        mode.kind === "create"
          ? await createAgreement({ data, leadId: mode.leadId, studentId: mode.studentId })
          : await updateAgreement(mode.id, data);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      toast(mode.kind === "create" ? "Draft agreement created" : "Draft updated");
      const id = mode.kind === "create" ? (res.data as { id: string }).id : mode.id;
      router.push(`/agreements/${id}`);
      router.refresh();
    });
  }

  const filledLabels = [...new Set(filled ?? [])].map((k) => PREFILL_FIELD_LABELS[k] ?? k);

  return (
    <form onSubmit={submit} className="space-y-6">
      {/* What the CRM answered, and what it couldn't. The founder should re-type only the second
          list — everything else is already on the record and re-asking for it is the bug this
          redesign exists to kill. */}
      {(filledLabels.length > 0 || (missing && missing.length > 0)) && (
        <div className="space-y-1.5 rounded-card border border-line bg-surface-2 px-4 py-3 text-sm">
          {filledLabels.length > 0 && (
            <p style={{ color: "var(--good)" }}>
              <span className="font-semibold">Filled from the record:</span>{" "}
              <span className="text-ink-2">{filledLabels.join(", ")}</span>
            </p>
          )}
          {missing && missing.length > 0 && (
            <p style={{ color: "var(--warn)" }}>
              <span className="font-semibold">Needs you:</span>{" "}
              <span className="text-ink-2">{missing.join(", ")}</span>
            </p>
          )}
        </div>
      )}

      {notes && notes.length > 0 && (
        <div className="rounded-field bg-warn-bg px-3 py-2 text-sm" style={{ color: "var(--warn)" }}>
          {notes.map((n) => (
            <p key={n}>{n}</p>
          ))}
        </div>
      )}

      <section className="rounded-card border border-line bg-surface p-5 shadow-card">
        <h2 className="mb-1 font-display text-h2 font-semibold">The Student</h2>
        <p className="mb-4 text-xs text-muted">
          These values are frozen into the agreement when you issue it. Editing the student record later never
          changes a signed contract.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Full name">
            <TextInput value={fullName} onChange={(e) => setFullName(e.target.value)} required maxLength={120} />
          </Field>
          <Field label="WhatsApp number" hint="With country code. The signing link and code both go here.">
            <TextInput value={phone} onChange={(e) => setPhone(e.target.value)} required placeholder="+91 98765 43210" />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Postal address" hint="Printed in the agreement header (§2).">
              <TextArea value={address} onChange={(e) => setAddress(e.target.value)} required rows={2} maxLength={300} />
            </Field>
          </div>
          <Field label="Email (optional)">
            <TextInput type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={200} />
          </Field>
        </div>
      </section>

      <section className="rounded-card border border-line bg-surface p-5 shadow-card">
        <h2 className="mb-4 font-display text-h2 font-semibold">Batch (§2.1)</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Batch">
            <TextInput value={batchNo} onChange={(e) => setBatchNo(e.target.value)} required placeholder="Batch 12" />
          </Field>
          <Field label="Programme start date" hint="Also the 12-month boundary in §6.">
            <TextInput type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required />
          </Field>
        </div>
      </section>

      <section className="rounded-card border border-line bg-surface p-5 shadow-card">
        <h2 className="mb-4 font-display text-h2 font-semibold">Payment (§7)</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Total programme fee (INR)">
            <TextInput
              inputMode="decimal"
              value={total}
              onChange={(e) => setTotal(e.target.value)}
              required
              placeholder="69999"
            />
          </Field>
          <Field label="Payment option">
            <Select
              value={option}
              onChange={(e) => setOption(e.target.value as "FULL" | "INSTALMENT")}
              options={[
                { value: "FULL", label: "Option A — Full payment" },
                { value: "INSTALMENT", label: "Option B — Instalment plan (max 2)" },
              ]}
            />
          </Field>
        </div>

        {option === "FULL" ? (
          <div className="mt-4">
            <Field label="Due milestone">
              <TextInput value={fullDue} onChange={(e) => setFullDue(e.target.value)} required maxLength={120} />
            </Field>
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            {inst.map((row, i) => (
              <div key={i} className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
                <Field label={`Instalment ${i + 1} amount (INR)`}>
                  <TextInput
                    inputMode="decimal"
                    value={row.amount}
                    onChange={(e) =>
                      setInst((p) => p.map((r, j) => (j === i ? { ...r, amount: e.target.value } : r)))
                    }
                    required
                  />
                </Field>
                <Field label={`Instalment ${i + 1} due milestone`}>
                  <TextInput
                    value={row.due}
                    onChange={(e) => setInst((p) => p.map((r, j) => (j === i ? { ...r, due: e.target.value } : r)))}
                    required
                    maxLength={120}
                  />
                </Field>
              </div>
            ))}
            {sumMismatch && (
              <p role="alert" className="rounded-field bg-risk-soft px-3 py-2 text-sm font-medium text-risk">
                {sumMismatch}
              </p>
            )}
          </div>
        )}
      </section>

      <FormError message={error} />

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending || !!sumMismatch}
          className="inline-flex h-10 items-center justify-center gap-1.5 rounded-btn bg-primary px-4 text-sm font-semibold text-on-accent transition-colors hover:bg-primary-strong disabled:opacity-60"
        >
          {pending && <Loader2 size={15} className="animate-spin" />}
          {mode.kind === "create" ? "Create draft" : "Save draft"}
        </button>
        <p className="text-xs text-muted">Nothing is sent yet — you countersign and issue on the next screen.</p>
      </div>
    </form>
  );
}

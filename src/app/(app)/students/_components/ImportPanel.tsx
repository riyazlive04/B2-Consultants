"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Upload, FileWarning } from "lucide-react";
import type { ImportPlan } from "@/lib/student-import";
import { commitStudentImport, previewStudentImport } from "@/server/student-import-actions";
import { Btn } from "@/components/ui/controls";
import { FormError } from "@/components/ui/form";
import { askConfirm, toast } from "@/components/ui/feedback";

/**
 * Student import (spec Part 2 §9: "Export exists now; import is planned").
 *
 * Preview-then-commit. Nothing is written until the founder has seen the counts and the
 * skipped rows — this writes into a live roster of real people, and a bad paste that reports
 * afterwards is a cleanup job, not an error message.
 */
export function ImportPanel() {
  const router = useRouter();
  const [csv, setCsv] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setPlan(null);
    const text = await file.text();
    setCsv(text);
    setFileName(file.name);
    setBusy(true);
    const res = await previewStudentImport(text);
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setPlan(res.plan);
  }

  async function commit() {
    if (!csv || !plan) return;
    const ok = await askConfirm({
      title: "Apply this import?",
      body: `${plan.creates} student${plan.creates === 1 ? "" : "s"} will be created and ${plan.updates} updated. This writes to the live roster.`,
      confirmLabel: "Import",
    });
    if (!ok) return;
    setBusy(true);
    const res = await commitStudentImport(csv);
    setBusy(false);
    if (!res.ok) return setError(res.error);
    toast(res.summary ?? "Imported");
    setCsv(null);
    setPlan(null);
    setFileName(null);
    router.refresh();
  }

  const skips = plan?.plans.filter((p) => p.kind === "skip") ?? [];

  return (
    <div className="space-y-5">
      <p className="max-w-2xl text-sm text-muted">
        Import students from a CSV. Needs a header row with a <strong>name</strong> column;{" "}
        <strong>email</strong>, <strong>phone</strong> and <strong>address</strong> are matched
        too. People are matched by email — a matching email updates that student, a new one
        creates. Nothing is written until you confirm.
      </p>

      <div className="rounded-field border border-line bg-surface-2 px-4 py-4">
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-btn border border-line bg-surface px-3 py-2 text-sm font-medium text-ink hover:bg-surface-2">
          <Upload size={15} />
          {fileName ?? "Choose a CSV file"}
          <input type="file" accept=".csv,text/csv" className="hidden" onChange={onFile} disabled={busy} />
        </label>
        {busy && <span className="ml-3 text-sm text-muted">Reading…</span>}
      </div>

      <FormError message={error} />

      {plan && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Will create" value={plan.creates} tone="accent" />
            <Stat label="Will update" value={plan.updates} tone="accent" />
            <Stat label="Unchanged" value={plan.unchanged} />
            <Stat label="Skipped" value={plan.skipped} tone={plan.skipped ? "warn" : undefined} />
          </div>

          {/* Skipped rows are named, with the line number and the reason. A count alone
              ("12 skipped") tells the founder something went wrong but not what to fix. */}
          {skips.length > 0 && (
            <div className="rounded-field border border-line bg-surface-2 px-4 py-3">
              <p className="flex items-center gap-2 text-caption font-semibold uppercase text-ink-3">
                <FileWarning size={13} /> Skipped rows
              </p>
              <ul className="mt-2 space-y-1 text-sm text-ink-2">
                {skips.slice(0, 20).map((s) => (
                  <li key={s.line}>
                    <span className="text-muted">Line {s.line}:</span>{" "}
                    {"reason" in s ? s.reason : ""}
                  </li>
                ))}
                {skips.length > 20 && <li className="text-muted">…and {skips.length - 20} more</li>}
              </ul>
            </div>
          )}

          {plan.creates + plan.updates === 0 ? (
            <p className="text-sm text-muted">Nothing to import — every row already matches what&apos;s on file.</p>
          ) : (
            <div className="flex justify-end">
              <Btn onClick={commit} disabled={busy}>
                Import {plan.creates + plan.updates} row{plan.creates + plan.updates === 1 ? "" : "s"}
              </Btn>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "accent" | "warn" }) {
  const toneCls =
    tone === "accent" && value > 0
      ? "border-accent/40 bg-accent-soft"
      : tone === "warn" && value > 0
        ? "border-line bg-surface-2"
        : "border-line bg-surface-2";
  return (
    <div className={`rounded-field border px-3 py-2 ${toneCls}`}>
      <p className="text-caption font-semibold uppercase text-ink-3">{label}</p>
      <p className="mt-0.5 text-lg font-semibold text-ink">{value}</p>
    </div>
  );
}

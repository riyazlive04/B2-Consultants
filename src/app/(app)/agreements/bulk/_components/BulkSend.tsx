"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Loader2, Send, XCircle } from "lucide-react";
import { Btn } from "@/components/ui/controls";
import { Field, FormError, Select, TextInput } from "@/components/ui/form";
import { askConfirm, toast } from "@/components/ui/feedback";
import { collectReportedDevice } from "@/lib/device";
import { bulkIssueAgreements, type BulkOutcome } from "@/server/agreement-actions";
import type { UsableTemplate } from "../../_components/DocumentChooser";

/**
 * Issue the same document to a group of students at once.
 *
 * ── WHAT IS AND IS NOT BATCHED ──────────────────────────────────────────────────────────────
 * Only the clicking. Every student gets their own agreement, their own document number, their own
 * signing link, their own one-time code and their own audit trail - the server loops over the
 * single-agreement path to make sure of it. There is no shared token and no "group agreement",
 * because a contract is between B2 and one person.
 *
 * ── IT REPORTS PER STUDENT, NOT A COUNT ─────────────────────────────────────────────────────
 * A student whose record cannot answer every field a contract needs is SKIPPED rather than issued
 * with a blank §2, and the result says which and why. "18 sent, 2 need a postal address" is
 * actionable; "20 processed" is not.
 */
export function BulkSend({
  students,
  templates,
}: {
  students: { id: string; fullName: string; code: string | null; level: string | null }[];
  templates: UsableTemplate[];
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [templateId, setTemplateId] = useState<string>("");
  const [outcomes, setOutcomes] = useState<BulkOutcome[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return students;
    return students.filter(
      (s) =>
        s.fullName.toLowerCase().includes(q) ||
        (s.code ?? "").toLowerCase().includes(q) ||
        (s.level ?? "").toLowerCase().includes(q),
    );
  }, [students, query]);

  const toggle = (id: string) => {
    const next = new Set(picked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPicked(next);
  };

  const send = () => {
    setError(null);
    startTransition(async () => {
      const names = students.filter((s) => picked.has(s.id)).map((s) => s.fullName);
      const ok = await askConfirm({
        title: `Countersign and send ${names.length} agreement${names.length === 1 ? "" : "s"}?`,
        body:
          `Each one is countersigned with your saved signature and sent immediately: ${names.slice(0, 5).join(", ")}` +
          `${names.length > 5 ? ` and ${names.length - 5} more` : ""}. Anybody whose record is incomplete is skipped, not guessed at.`,
        confirmLabel: `Send ${names.length}`,
      });
      if (!ok) return;

      const res = await bulkIssueAgreements({
        studentIds: [...picked],
        templateId: templateId || null,
        reported: collectReportedDevice(),
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setOutcomes(res.data!.outcomes);
      const sent = res.data!.outcomes.filter((o) => o.status === "sent").length;
      toast(`${sent} of ${res.data!.outcomes.length} agreements sent.`);
      setPicked(new Set());
      router.refresh();
    });
  };

  return (
    <div className="space-y-5">
      <div className="rounded-card border border-line bg-surface p-5 shadow-card">
        <h2 className="mb-1 font-display text-h2 font-semibold">The document</h2>
        <p className="mb-3 text-xs text-muted">
          One document for everybody in this run. Each student&apos;s own fee, batch and address are
          merged into their own copy of it.
        </p>
        <Field label="Draw it up on">
          <Select
            value={templateId}
            onChange={(e) => setTemplateId(e.target.value)}
            options={[
              { value: "", label: "Guided Mode clause set (built in)" },
              ...templates.map((t) => ({
                value: t.id,
                label: `${t.name} - v${t.version} (${t.kind === "PDF" ? "PDF" : "Word"})`,
              })),
            ]}
          />
        </Field>
      </div>

      <div className="rounded-card border border-line bg-surface p-5 shadow-card">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-display text-h2 font-semibold">Who it goes to</h2>
            <p className="text-xs text-muted">
              {picked.size} of {students.length} students selected · up to 50 per run
            </p>
          </div>
          <div className="flex items-end gap-2">
            <div className="w-48">
              <TextInput
                value={query}
                placeholder="Search name, code, level"
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <Btn
              variant="ghost"
              size="sm"
              onClick={() => setPicked(new Set(filtered.slice(0, 50).map((s) => s.id)))}
              disabled={pending || filtered.length === 0}
            >
              Select {filtered.length > 50 ? "first 50" : "all shown"}
            </Btn>
            {picked.size > 0 && (
              <Btn variant="ghost" size="sm" onClick={() => setPicked(new Set())} disabled={pending}>
                Clear
              </Btn>
            )}
          </div>
        </div>

        {filtered.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted">No students match that search.</p>
        ) : (
          <ul className="max-h-[22rem] space-y-1 overflow-y-auto pr-1">
            {filtered.map((s) => {
              const on = picked.has(s.id);
              const atCap = !on && picked.size >= 50;
              return (
                <li key={s.id}>
                  <label
                    className={`flex cursor-pointer items-center gap-3 rounded-field border px-3 py-2 text-sm transition-colors ${
                      on ? "border-primary bg-primary-soft" : "border-line hover:border-primary/50"
                    } ${atCap ? "opacity-50" : ""}`}
                  >
                    <input
                      type="checkbox"
                      checked={on}
                      disabled={pending || atCap}
                      onChange={() => toggle(s.id)}
                      className="h-4 w-4 flex-none accent-[var(--primary)]"
                    />
                    <span className="min-w-0 flex-1 truncate font-medium">{s.fullName}</span>
                    <span className="flex-none text-xs text-muted">
                      {s.code ?? "-"}
                      {s.level ? ` · ${s.level}` : ""}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <FormError message={error} />

      <div className="flex flex-wrap items-center gap-3">
        <Btn
          variant="primary"
          icon={pending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
          onClick={send}
          disabled={pending || picked.size === 0}
          busy={pending}
        >
          Countersign &amp; send {picked.size > 0 ? picked.size : ""}
        </Btn>
        <p className="text-xs text-muted">
          Uses your saved countersignature. Nothing is sent until you confirm.
        </p>
      </div>

      {outcomes && <Results outcomes={outcomes} />}
    </div>
  );
}

/** The per-student result. The skipped list is the point of this panel. */
function Results({ outcomes }: { outcomes: BulkOutcome[] }) {
  const sent = outcomes.filter((o) => o.status === "sent");
  const needsForm = outcomes.filter((o) => o.status === "needsForm");
  const failed = outcomes.filter((o) => o.status === "failed");

  return (
    <div className="space-y-3 rounded-card border border-line bg-surface p-5 shadow-card">
      <h2 className="font-display text-h2 font-semibold">
        {sent.length} of {outcomes.length} sent
      </h2>

      {needsForm.length > 0 && (
        <div className="rounded-field border border-warn/40 bg-warn-soft px-3 py-2.5">
          <p className="flex items-center gap-2 text-sm font-semibold text-warn">
            <AlertTriangle size={15} /> {needsForm.length} skipped - their record is incomplete
          </p>
          <ul className="mt-1.5 space-y-0.5 text-xs text-ink-2">
            {needsForm.map((o) => (
              <li key={o.studentId}>
                <span className="font-medium">{o.name}</span> — {o.note}
              </li>
            ))}
          </ul>
        </div>
      )}

      {failed.length > 0 && (
        <div className="rounded-field border border-risk/40 bg-risk-soft px-3 py-2.5">
          <p className="flex items-center gap-2 text-sm font-semibold text-risk">
            <XCircle size={15} /> {failed.length} did not go out
          </p>
          <ul className="mt-1.5 space-y-0.5 text-xs text-ink-2">
            {failed.map((o) => (
              <li key={o.studentId}>
                <span className="font-medium">{o.name}</span> — {o.note}
              </li>
            ))}
          </ul>
        </div>
      )}

      {sent.length > 0 && (
        <details className="rounded-field border border-line bg-surface-2 px-3 py-2.5">
          <summary className="cursor-pointer text-sm font-semibold text-ok">
            <span className="inline-flex items-center gap-2">
              <CheckCircle2 size={15} /> {sent.length} sent
            </span>
          </summary>
          <ul className="mt-1.5 space-y-0.5 text-xs text-ink-2">
            {sent.map((o) => (
              <li key={o.studentId}>
                <span className="font-medium">{o.name}</span> — {o.note}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

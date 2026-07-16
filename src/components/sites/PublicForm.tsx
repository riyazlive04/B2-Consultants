"use client";

import { useState } from "react";
import { Loader2, CheckCircle2, ChevronDown } from "lucide-react";
import type { PublicForm as PublicFormType } from "@/server/forms-metrics";
import { submitPublicForm } from "@/server/forms-actions";

/** Renders a published form on a public page and posts to the public intake action. */
export default function PublicForm({ form, utm }: { form: PublicFormType; utm?: Record<string, string> }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const fd = new FormData(e.currentTarget);
    const res = await submitPublicForm(form.slug, fd);
    setBusy(false);
    if (!res.ok) return setError(res.error);
    if (res.redirectUrl) {
      window.location.href = res.redirectUrl;
      return;
    }
    setDone(res.message);
  }

  if (done) {
    return (
      <div className="rounded-card border border-line bg-surface p-8 text-center shadow-card">
        <CheckCircle2 className="mx-auto mb-3 text-good" size={32} />
        <p className="text-h3 font-display text-ink">{done}</p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4 rounded-card border border-line bg-surface p-6 shadow-card">
      {form.fields.map((f) => (
        <div key={f.key}>
          <label className="mb-1.5 block text-sm font-medium text-ink">
            {f.label}
            {f.required && <span className="text-bad"> *</span>}
          </label>
          {f.type === "textarea" ? (
            <textarea name={f.key} required={f.required} placeholder={f.placeholder} rows={3} className="w-full rounded-field border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-primary" />
          ) : f.type === "select" ? (
            // Public lead-capture form: keep a REAL native <select> (max mobile/keyboard
            // compatibility, no popover-JS on the intake path) but strip the OS grey arrow
            // per §5.5 and draw our own. color-scheme themes the native option list.
            <span className="relative block">
              <select name={f.key} required={f.required} defaultValue="" className="h-10 w-full cursor-pointer appearance-none rounded-field border border-line bg-surface px-3 pr-9 text-sm outline-none focus:border-primary">
                <option value="" disabled>Choose…</option>
                {(f.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
              <ChevronDown size={16} aria-hidden className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-ink-3" />
            </span>
          ) : f.type === "checkbox" ? (
            <label className="flex items-center gap-2 text-sm text-ink-2">
              <input type="checkbox" name={f.key} className="h-4 w-4 accent-[var(--primary)]" /> {f.placeholder || "Yes"}
            </label>
          ) : (
            <input
              name={f.key}
              type={f.type === "phone" ? "tel" : f.type}
              required={f.required}
              placeholder={f.placeholder}
              className="h-10 w-full rounded-field border border-line bg-surface px-3 text-sm outline-none focus:border-primary"
            />
          )}
        </div>
      ))}

      {/* Honeypot (hidden from humans) */}
      <input type="text" name="company_website" tabIndex={-1} autoComplete="off" className="absolute left-[-9999px]" aria-hidden />
      {/* UTM passthrough */}
      {utm && Object.entries(utm).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}

      {error && <p className="rounded-field bg-bad-soft px-3 py-2 text-sm font-medium text-bad">{error}</p>}

      <button type="submit" disabled={busy} className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-btn bg-primary text-sm font-semibold text-on-accent hover:bg-primary-strong disabled:opacity-60">
        {busy && <Loader2 size={16} className="animate-spin" />}
        {form.settings.submitText || "Submit"}
      </button>
    </form>
  );
}

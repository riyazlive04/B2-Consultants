"use client";

import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";

/** Minimal form kit - every entry form in the app uses these so fields look identical. */

const fieldCls =
  "w-full rounded-field border border-line bg-surface-2 px-3 py-2 text-sm text-ink outline-none transition-colors focus:border-accent disabled:cursor-not-allowed disabled:opacity-60";

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block min-w-0 text-sm font-medium text-ink">
      {label}
      <div className="mt-1.5 font-normal">{children}</div>
      {hint && <p className="mt-1 text-xs font-normal text-muted">{hint}</p>}
    </label>
  );
}

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={fieldCls} />;
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea rows={2} {...props} className={fieldCls} />;
}

export function Select({
  options,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { options: { value: string; label: string }[] }) {
  return (
    <select {...props} className={fieldCls}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function CheckboxField({ name, label, defaultChecked, hint }: {
  name: string; label: string; defaultChecked?: boolean; hint?: string;
}) {
  return (
    <label className="flex items-start gap-2.5 text-sm font-medium">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} className="mt-0.5 h-4 w-4 accent-[var(--accent)]" />
      <span>
        {label}
        {hint && <span className="block text-xs font-normal text-muted">{hint}</span>}
      </span>
    </label>
  );
}

export function SubmitButton({ children }: { children: ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex items-center justify-center gap-1.5 rounded-field bg-accent px-4 py-2 text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-95 disabled:opacity-60"
    >
      {pending && <Loader2 size={15} className="animate-spin" />}
      {pending ? "Saving…" : children}
    </button>
  );
}

export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p className="rounded-field bg-risk-soft px-3 py-2 text-sm font-medium text-risk">
      {message}
    </p>
  );
}

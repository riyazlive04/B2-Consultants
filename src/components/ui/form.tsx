"use client";

import { forwardRef, useId } from "react";
import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { useFormStatus } from "react-dom";
import { Check, Loader2 } from "lucide-react";
import { FieldContext, useControlProps } from "./field-base";
import { DatePicker } from "./DatePicker";
import { SelectMenu, type SelectOption } from "./SelectMenu";

/** Minimal form kit - every entry form in the app uses these so fields look identical. */

// The control base (FieldContext, useControlProps, the input-surface classes) lives in
// field-base.tsx so DatePicker/SelectMenu can share it without importing this file back.

export { FieldContext } from "./field-base";

// type="date" renders our own calendar; these keep a themed NATIVE popup (color-scheme in
// globals.css themes it) because a bespoke clock/month grid isn't worth 3 call sites.
const NATIVE_DATEISH = new Set(["time", "month", "datetime-local", "week"]);

export function Field({
  label,
  children,
  hint,
  error,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
  /** Renders below the control in --bad and marks the control aria-invalid (§5.5). */
  error?: string | null;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errId = `${id}-error`;
  // An error supersedes the hint, so only one description is ever announced.
  const describedBy = error ? errId : hint ? hintId : undefined;

  return (
    <div className="block min-w-0">
      {/* The control stays INSIDE the label (implicit association, works for any
          child). The hint/error sit outside it, or they'd be read as part of the
          field's accessible name. */}
      <label className="block text-sm font-medium text-ink">
        {label}
        <FieldContext.Provider value={{ describedBy, invalid: !!error }}>
          <div className="mt-1.5 font-normal">{children}</div>
        </FieldContext.Provider>
      </label>
      {error ? (
        <p id={errId} className="mt-1 text-caption font-medium text-risk">
          {error}
        </p>
      ) : (
        hint && (
          <p id={hintId} className="mt-1 text-caption text-muted">
            {hint}
          </p>
        )
      )}
    </div>
  );
}

/** Ref-forwarding so callers can reach the DOM node (e.g. to hook the form's reset event). */
export const TextInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function TextInput(props, ref) {
    // A `type="date"` field gets the app's own calendar (§5.5) — same call site, no
    // native OS popup. `time`/`month`/`datetime-local` stay native but theme-corrected.
    if (props.type === "date") {
      // drop native `type` and `size` (a number) — DatePicker owns both
      const { type: _t, size: _s, ...rest } = props;
      return <DatePicker {...rest} />;
    }
    const { cls, ...aria } = useControlProps();
    const native = NATIVE_DATEISH.has(props.type ?? "") ? "dateish-native" : "";
    return <input ref={ref} {...aria} {...props} className={`${cls} h-10 px-3 ${native}`} />;
  },
);

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const { cls, ...aria } = useControlProps();
  return <textarea rows={2} {...aria} {...props} className={`${cls} min-h-10 px-3 py-2.5`} />;
}

/**
 * §5.5: the app's own dropdown — a custom listbox (SelectMenu), not the OS popup. Same
 * `{ options }` API it always had, so all existing call sites upgrade untouched.
 */
export function Select(
  props: Omit<SelectHTMLAttributes<HTMLSelectElement>, "size"> & {
    options: SelectOption[];
    /** "sm" for dense table rows / filter bars; defaults to the 40px field height. */
    size?: "sm" | "md";
    /** empty-state label; also renders a leading empty option in the hidden native select. */
    placeholder?: string;
  },
) {
  return <SelectMenu {...props} />;
}

/** §5.5: the box is a styled span; the real input stays `sr-only` so it keeps focus + the tab order. */
export function CheckboxField({ name, label, defaultChecked, hint }: {
  name: string; label: string; defaultChecked?: boolean; hint?: string;
}) {
  return (
    // min-h-10: the whole row is the hit target (§7), not just the 20px box.
    <label className="group flex min-h-10 cursor-pointer items-start gap-2.5 py-2 text-sm font-medium">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} className="peer sr-only" />
      {/* the tick is a descendant, so it's reached with a child selector, not `peer-checked:` */}
      <span
        aria-hidden
        className="mt-0.5 grid h-5 w-5 flex-none place-items-center rounded-[6px] border border-line-strong bg-surface text-on-accent transition-[background-color,border-color] duration-150 ease-out group-hover:border-primary-tint peer-checked:border-primary peer-checked:bg-primary peer-checked:[&>svg]:scale-100 peer-focus-visible:ring-2 peer-focus-visible:ring-primary-soft"
      >
        <Check size={13} strokeWidth={3.4} className="scale-0 transition-transform duration-150 [transition-timing-function:var(--ease-spring)]" />
      </span>
      <span>
        {label}
        {hint && <span className="block text-caption font-normal text-muted">{hint}</span>}
      </span>
    </label>
  );
}

/** Kept as the app-wide submit button; `controls.tsx` re-exports the same thing as SubmitBtn. */
export function SubmitButton({ children }: { children: ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex h-10 flex-none items-center justify-center gap-2 rounded-btn bg-primary px-4 text-sm font-semibold text-on-accent transition-colors hover:bg-primary-strong disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-ink-disabled"
    >
      {pending && <Loader2 size={15} className="animate-spin" />}
      {pending ? "Saving…" : children}
    </button>
  );
}

export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    // role="alert" so assistive tech announces the failure the moment it renders
    <p role="alert" className="rounded-field bg-risk-soft px-3 py-2 text-sm font-medium text-risk">
      {message}
    </p>
  );
}

"use client";

/**
 * Console-only editor controls. Everything generic (Card, Btn, Toggle, SaveBar, Hint)
 * now lives in the shared kit — this file keeps only the three inputs that exist to
 * make the rules editors dense: a NaN-proof number box, a bare text box, and a select.
 */

import { Btn, SaveBar, Switch } from "@/components/ui/controls";
import { Card, Hint } from "@/components/ui/kit";
import type { ReactNode } from "react";

export { Btn, Card, Hint, SaveBar };

const fieldCls =
  "w-full rounded-field border border-line-strong bg-surface px-2.5 py-1.5 text-sm text-ink outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary-soft disabled:cursor-not-allowed disabled:opacity-60";

/** A number input that never hands NaN back to the caller. */
export function NumInput({
  value,
  onChange,
  min = 0,
  max,
  className = "",
  ariaLabel,
}: {
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <input
      type="number"
      inputMode="numeric"
      aria-label={ariaLabel}
      value={Number.isFinite(value) ? value : 0}
      min={min}
      max={max}
      onChange={(e) => {
        const n = e.target.valueAsNumber;
        onChange(Number.isFinite(n) ? n : 0);
      }}
      className={`${fieldCls} tnum ${className}`}
    />
  );
}

export function TextIn({
  value,
  onChange,
  placeholder,
  ariaLabel,
  className = "",
}: {
  value: string;
  onChange: (s: string) => void;
  placeholder?: string;
  ariaLabel?: string;
  className?: string;
}) {
  return (
    <input
      type="text"
      aria-label={ariaLabel}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className={`${fieldCls} ${className}`}
    />
  );
}

export function Picker<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
  className = "",
}: {
  value: T;
  onChange: (v: T) => void;
  options: ReadonlyArray<{ value: T; label: string }>;
  ariaLabel?: string;
  className?: string;
}) {
  return (
    <select
      aria-label={ariaLabel}
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      className={`${fieldCls} ${className}`}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/**
 * A checkbox with a label. The console's rule editors have dozens of these in a row,
 * where the shared `Switch` would be far too heavy — a switch is for a capability,
 * a checkbox is for a row in a list.
 */
export function Toggle({
  checked,
  onChange,
  label,
  disabled,
  title,
}: {
  checked: boolean;
  onChange: (b: boolean) => void;
  label: string;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <label className="flex items-center gap-2 text-sm" title={title}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 accent-[var(--primary)] disabled:opacity-50"
      />
      <span className={disabled ? "text-muted" : undefined}>{label}</span>
    </label>
  );
}

/** Rows of an editable list: consistent spacing + a remove affordance. */
export function Row({ children, onRemove }: { children: ReactNode; onRemove?: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-field border border-line bg-surface-2 p-2">
      {children}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label="Remove"
          className="ml-auto rounded-field px-2 py-1 text-xs font-semibold text-risk hover:bg-risk-soft"
        >
          Remove
        </button>
      )}
    </div>
  );
}

/** Re-exported so console panels can use the pill switch where it genuinely fits. */
export { Switch };

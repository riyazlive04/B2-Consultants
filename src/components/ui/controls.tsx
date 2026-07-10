"use client";

import { useState, type ReactNode } from "react";
import { Check, Copy, Loader2 } from "lucide-react";
import { useFormStatus } from "react-dom";

/**
 * The interactive half of the kit. Split from `kit.tsx` so a server component can
 * render a Card without dragging every event handler in the app into its bundle.
 *
 * Same rule as kit.tsx: no hex. Everything resolves through the design tokens.
 */

// ───────────────────────────── buttons ─────────────────────────────

export type BtnVariant = "primary" | "secondary" | "ghost" | "danger";
export type BtnSize = "sm" | "md";

const VARIANT: Record<BtnVariant, string> = {
  primary: "bg-primary text-white hover:bg-primary-strong",
  secondary: "border border-line bg-surface text-ink hover:bg-surface-2",
  ghost: "text-ink-2 hover:bg-surface-2 hover:text-ink",
  danger: "border border-line text-risk hover:bg-risk-soft",
};

const SIZE: Record<BtnSize, string> = {
  sm: "h-9 px-3 text-[13px]",
  md: "h-10 px-4 text-sm",
};

export function Btn({
  children,
  variant = "secondary",
  size = "md",
  type = "button",
  onClick,
  disabled,
  busy,
  title,
  icon,
  className = "",
}: {
  children?: ReactNode;
  variant?: BtnVariant;
  size?: BtnSize;
  type?: "button" | "submit";
  onClick?: () => void;
  disabled?: boolean;
  busy?: boolean;
  title?: string;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || busy}
      title={title}
      className={`inline-flex flex-none items-center justify-center gap-1.5 rounded-btn font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${VARIANT[variant]} ${SIZE[size]} ${className}`}
    >
      {busy ? <Loader2 size={15} className="animate-spin" /> : icon}
      {children}
    </button>
  );
}

/** A square button carrying only an icon. `label` is required — it's the accessible name. */
export function IconButton({
  label,
  children,
  onClick,
  disabled,
  tone = "neutral",
}: {
  label: string;
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  tone?: "neutral" | "danger";
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={`grid h-9 w-9 flex-none place-items-center rounded-btn border border-line transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        tone === "danger" ? "text-risk hover:bg-risk-soft" : "text-ink-2 hover:bg-surface-2 hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

/** Submit button that shows the form's own pending state. */
export function SubmitBtn({ children, variant = "primary" }: { children: ReactNode; variant?: BtnVariant }) {
  const { pending } = useFormStatus();
  return (
    <Btn type="submit" variant={variant} busy={pending}>
      {pending ? "Saving…" : children}
    </Btn>
  );
}

// ───────────────────────────── switches & choices ─────────────────────────────

/**
 * A pill switch. Visually distinct from a checkbox on purpose: a checkbox picks a
 * thing from a set, a switch turns a capability on. The Users & access dialog leans
 * on that difference to separate "what you can see" from "what you can do".
 */
export function Switch({
  name,
  checked,
  onChange,
  disabled,
  label,
}: {
  name?: string;
  checked: boolean;
  onChange?: (v: boolean) => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <span className="relative inline-flex flex-none">
      <input
        type="checkbox"
        role="switch"
        name={name}
        aria-label={label}
        checked={checked}
        disabled={disabled}
        aria-checked={checked}
        onChange={(e) => onChange?.(e.target.checked)}
        className="peer h-7 w-12 cursor-pointer appearance-none rounded-full bg-line-strong transition-colors checked:bg-good disabled:cursor-not-allowed disabled:opacity-50"
      />
      <span
        aria-hidden
        className="pointer-events-none absolute left-0.5 top-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform peer-checked:translate-x-5"
      />
    </span>
  );
}

/** A switch with its title and one line of explanation — the Capabilities row. */
export function SwitchRow({
  title,
  description,
  name,
  checked,
  onChange,
  disabled,
  hint,
}: {
  title: string;
  description?: string;
  name?: string;
  checked: boolean;
  onChange?: (v: boolean) => void;
  disabled?: boolean;
  hint?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-field border border-line bg-surface px-3.5 py-3">
      <div className="min-w-0">
        <p className="text-sm font-medium text-ink">{title}</p>
        {description && <p className="text-xs text-muted">{description}</p>}
      </div>
      <span title={hint}>
        <Switch name={name} label={title} checked={checked} onChange={onChange} disabled={disabled} />
      </span>
    </div>
  );
}

/** A checkbox that reads as a selectable card. Used for module access. */
export function CheckCard({
  name,
  label,
  checked,
  onChange,
  disabled,
  strikethrough,
  title,
}: {
  name?: string;
  label: string;
  checked: boolean;
  onChange?: (v: boolean) => void;
  disabled?: boolean;
  strikethrough?: boolean;
  title?: string;
}) {
  return (
    <label
      title={title}
      className={`flex cursor-pointer items-center gap-3 rounded-field border px-3.5 py-3 text-sm transition-colors ${
        checked ? "border-primary bg-primary-soft" : "border-line bg-surface hover:bg-surface-2"
      } ${disabled ? "cursor-not-allowed opacity-70" : ""}`}
    >
      <span
        aria-hidden
        className={`grid h-5 w-5 flex-none place-items-center rounded-[6px] border ${
          checked ? "border-primary bg-primary text-white" : "border-line-strong bg-surface"
        }`}
      >
        {checked && <Check size={13} strokeWidth={3.2} />}
      </span>
      <input
        type="checkbox"
        name={name}
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange?.(e.target.checked)}
        className="sr-only"
      />
      <span
        className={`font-medium ${checked ? "text-primary-strong" : "text-ink"} ${strikethrough ? "line-through" : ""}`}
      >
        {label}
      </span>
    </label>
  );
}

/** Role presets, period pickers, view switchers — one visual answer for all of them. */
export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
  grow = false,
}: {
  value: T;
  onChange: (v: T) => void;
  options: ReadonlyArray<{ value: T; label: string; disabled?: boolean; title?: string }>;
  ariaLabel?: string;
  /** stretch each segment to fill the row (the role preset row) */
  grow?: boolean;
}) {
  return (
    <div role="group" aria-label={ariaLabel} className="flex flex-wrap gap-2">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            disabled={o.disabled}
            title={o.title}
            aria-pressed={active}
            onClick={() => onChange(o.value)}
            className={`h-10 rounded-field border px-3 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
              grow ? "min-w-28 flex-1" : ""
            } ${
              active
                ? "border-primary bg-primary-soft text-primary-strong"
                : "border-line bg-surface text-ink-2 hover:bg-surface-2"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// ───────────────────────────── misc ─────────────────────────────

/** A read-only value with a copy button. Invite links, API keys. */
export function CopyField({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2 rounded-field border border-line bg-surface-2 p-2">
      <input
        readOnly
        value={value}
        aria-label={label}
        onFocus={(e) => e.currentTarget.select()}
        className="min-w-0 flex-1 bg-transparent px-2 font-mono text-xs text-ink outline-none"
      />
      <Btn
        variant="primary"
        size="sm"
        icon={<Copy size={14} />}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
          } catch {
            /* the input is selectable — the user can copy manually */
          }
        }}
      >
        {copied ? "Copied" : "Copy"}
      </Btn>
    </div>
  );
}

/** Sticky footer for long editors: dirty state, save, reset, error. */
export function SaveBar({
  dirty,
  onSave,
  onReset,
  busy,
  error,
  resetLabel = "Reset to defaults",
}: {
  dirty: boolean;
  onSave: () => void;
  onReset?: () => void;
  busy?: boolean;
  error: string | null;
  resetLabel?: string;
}) {
  return (
    <div className="sticky bottom-0 z-10 -mx-5 -mb-5 mt-5 flex flex-wrap items-center gap-3 border-t border-line bg-surface/95 px-5 py-3 backdrop-blur">
      <Btn variant="primary" onClick={onSave} disabled={!dirty} busy={busy}>
        {dirty ? "Save changes" : "Saved"}
      </Btn>
      {onReset && (
        <Btn variant="danger" onClick={onReset} busy={busy}>
          {resetLabel}
        </Btn>
      )}
      {dirty && <span className="text-xs text-warn">Unsaved changes</span>}
      {error && (
        <p role="alert" className="rounded-field bg-risk-soft px-3 py-1.5 text-sm font-medium text-risk">
          {error}
        </p>
      )}
    </div>
  );
}

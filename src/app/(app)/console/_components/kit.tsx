"use client";

/**
 * Console-only editor controls. Everything generic (Card, Btn, Toggle, SaveBar, Hint)
 * lives in the shared kit — this file keeps the dense inputs the rules editors need
 * (a NaN-proof number box, a bare text box, a select) and the column grid that gives
 * those inputs a name.
 *
 * On the column grid: these editors are lists of records with identical fields, and
 * the founder is the only reader. So the fields stay compact and unlabelled *in the
 * row* — the label is printed once, in a header above the list, and every row aligns
 * to the same track. Previously each row was a `flex-wrap` sentence ("At [7] days,
 * pay [50] XP"), which read fine at full width and fell apart the moment it wrapped.
 */

import { Btn, SaveBar, Switch } from "@/components/ui/controls";
import { Card, Hint } from "@/components/ui/kit";
import { Check, X } from "lucide-react";
import { SelectMenu } from "@/components/ui/SelectMenu";
import type { ReactNode } from "react";

export { Btn, Card, Hint, SaveBar };

/**
 * One field surface for the console.
 *
 * `h-10` is §5.5's mandated 40px — the same height `form.tsx` has always used. The
 * console had been sitting at ~32px (`py-1.5`), which is what read as cramped: it
 * was the only screen in the app off that spec.
 *
 * The border only firms up on hover and turns primary on focus, so a wall of 23 rows
 * reads as a surface rather than 23 outlined boxes, without dropping the 3:1 control
 * boundary §7 requires.
 */
const fieldCls =
  "h-10 w-full rounded-field border border-line-strong bg-surface px-3 text-sm text-ink outline-none transition-[border-color,box-shadow] duration-150 ease-out hover:border-primary-tint focus:border-primary focus:ring-2 focus:ring-primary-soft disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-ink-disabled";

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

/**
 * The Founder Console's controlled dropdown. Delegates to the app-wide {@link SelectMenu}
 * so the console's option lists are the SAME custom popover as every other picker (§5.5),
 * not a second look. Kept as a thin wrapper because callers pass `onChange(v)` not an event.
 */
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
    <SelectMenu
      aria-label={ariaLabel}
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      options={options.map((o) => ({ value: o.value, label: o.label }))}
      className={className}
    />
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
    <label
      className={`group flex select-none items-center gap-2 text-sm ${
        disabled ? "cursor-not-allowed" : "cursor-pointer"
      }`}
      title={title}
    >
      {/* The real control, hidden but not removed — sr-only keeps it focusable and
          in the tab order, which `display:none` would not. Everything visible below
          is driven off its :checked / :focus-visible state. */}
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="peer sr-only"
      />
      {/* The tick is a DESCENDANT of this span, not a sibling of the input, so it
          can't use `peer-checked:` on its own — that compiles to `.peer:checked ~ x`.
          The arbitrary child selector reaches it from here instead. */}
      <span
        aria-hidden
        className="grid h-5 w-5 flex-none place-items-center rounded-[6px] border border-line-strong bg-surface text-on-accent transition-[background-color,border-color] duration-150 ease-out group-hover:border-primary-tint peer-checked:border-primary peer-checked:bg-primary peer-checked:[&>svg]:scale-100 peer-focus-visible:ring-2 peer-focus-visible:ring-primary-soft peer-disabled:border-line peer-disabled:bg-surface-2 peer-disabled:text-ink-disabled"
      >
        {/* scale-0 → scale-100 on check: the tick springs in rather than blinking */}
        <Check
          size={13}
          strokeWidth={3.4}
          className="scale-0 transition-transform duration-150 [transition-timing-function:var(--ease-spring)]"
        />
      </span>
      <span className={disabled ? "text-ink-disabled" : "text-ink-2"}>{label}</span>
    </label>
  );
}

// ───────────────────────────── the column grid ─────────────────────────────

/**
 * A list editor's column widths, as a CSS `grid-template-columns` string. Declared
 * once per editor and handed to both the header and every row, which is the only
 * reason the two line up.
 */
export type Cols = string;

/**
 * The label row for a list editor. Printed once, so the rows below can stay bare.
 *
 * The transparent border is load-bearing: rows carry a 1px border, so without a
 * matching one here the header's content box is 2px wider and every column drifts.
 */
export function ColHead({ cols, labels }: { cols: Cols; labels: ReadonlyArray<string> }) {
  return (
    <div
      aria-hidden
      className="grid items-end gap-2 border border-transparent px-2 pb-1.5"
      style={{ gridTemplateColumns: cols }}
    >
      {labels.map((l, i) => (
        <span key={i} className="truncate text-label font-semibold uppercase text-ink-3">
          {l}
        </span>
      ))}
    </div>
  );
}

/**
 * One record. `sub` is the full-width line under the main track — descriptions are
 * long and would blow out any column they were given.
 */
export function ColRow({
  cols,
  children,
  sub,
  dim = false,
  index,
}: {
  cols: Cols;
  children: ReactNode;
  sub?: ReactNode;
  dim?: boolean;
  /** Position in the list — drives the entry stagger (§6). */
  index?: number;
}) {
  return (
    <div
      className={`group/row row-lift row-in rounded-field border border-line bg-surface-2 px-2.5 py-2.5 ${
        dim ? "opacity-60" : ""
      }`}
      // --i is the stagger index; the delay is computed in CSS so the cap lives in one place
      style={index === undefined ? undefined : ({ "--i": Math.min(index, 14) } as React.CSSProperties)}
    >
      <div className="grid items-center gap-2" style={{ gridTemplateColumns: cols }}>
        {children}
      </div>
      {sub && <div className="mt-2">{sub}</div>}
    </div>
  );
}

/**
 * The remove affordance, sized to sit in a grid cell without stretching the track.
 * Stays quiet until the pointer is in the row — a column of red X's would shout
 * "delete" louder than anything else on a screen that is mostly about editing.
 */
export function RemoveCell({ onClick, label = "Remove" }: { onClick: () => void; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="press grid h-8 w-8 place-items-center justify-self-end rounded-field text-ink-3 opacity-0 transition-[color,background-color,opacity] duration-150 ease-out hover:bg-risk-soft hover:text-risk focus-visible:opacity-100 group-hover/row:opacity-100"
    >
      <X size={15} />
    </button>
  );
}

/** A static cell — the row's own label, in the same voice as the column header. */
export function NameCell({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <span className={`truncate text-sm text-ink-2 ${className}`}>{children}</span>;
}

/** Wraps a list editor: heading, hint, the labelled list, and its add button. */
export function EditorSection({
  title,
  hint,
  children,
}: {
  title?: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section>
      {title && <h4 className="text-h3 text-ink">{title}</h4>}
      {hint && <div className="mt-0.5 max-w-3xl">{hint}</div>}
      <div className={title || hint ? "mt-3" : ""}>{children}</div>
    </section>
  );
}

/** Re-exported so console panels can use the pill switch where it genuinely fits. */
export { Switch };

"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { InputHTMLAttributes } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { ControlSize, fieldButtonCls, Popover, useControlProps } from "./field-base";

/**
 * App-styled date picker (§5.5, "fully custom popover" — the calendar grid is ours, not
 * the OS one). It wraps a REAL hidden `<input type="date">`:
 *   - that input carries `name`/`value`/`required`, so the 60 server-action forms that
 *     submit dates keep working unchanged, and native constraint validation still fires;
 *   - the visible trigger + month grid sit on top for interaction.
 * The hidden input stays the DOM source of truth, so `onChange` handlers still receive a
 * real change event whose `target.value` is the YYYY-MM-DD string, exactly as before.
 *
 * Only `type="date"` is fully custom. `time` / `month` / `datetime-local` fall back to a
 * theme-corrected native input (TextInput handles that branch) — those are 3 call sites,
 * not worth a bespoke clock/month-grid, and color-scheme now themes their native popups.
 */

const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const pad = (n: number) => String(n).padStart(2, "0");
const toYmd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
// Parse YYYY-MM-DD as a LOCAL calendar date — never `new Date(str)`, which is UTC and
// would shift the day across a timezone. A pure calendar date has no zone.
function fromYmd(s: string | undefined | null): Date | null {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}
const displayDMY = (s: string) => {
  const d = fromYmd(s);
  return d ? `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}` : "";
};
const sameYmd = (a: Date, b: Date) => toYmd(a) === toYmd(b);

// Set a native input's value so React's own value tracker still fires onChange (needed
// because we mutate the input imperatively). The prototype setter bypasses the tracker.
function setNativeValue(el: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

// Omit the native `size` (a number) so our variant name wins.
type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "size"> & { size?: ControlSize };

export function DatePicker({
  size = "md",
  className = "",
  value,
  defaultValue,
  onChange,
  min,
  max,
  disabled,
  required,
  name,
  id,
  placeholder = "DD/MM/YYYY",
  "aria-label": ariaLabel,
  ...rest
}: Props) {
  const { cls: _ignore, invalid, "aria-describedby": describedBy } = useControlProps();
  const controlled = value !== undefined;
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const gridId = useId();

  // Display value: from the controlled prop, else mirror the uncontrolled input.
  const [uncontrolled, setUncontrolled] = useState<string>((defaultValue as string) ?? "");
  const current = controlled ? ((value as string) ?? "") : uncontrolled;

  // Which month the grid is showing; seeds from the value, else today.
  const [view, setView] = useState<Date>(() => fromYmd((value as string) ?? (defaultValue as string)) ?? new Date());
  useEffect(() => {
    if (open) setView(fromYmd(current) ?? new Date());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Keyboard focus target within the grid.
  const [focusDay, setFocusDay] = useState<Date>(() => fromYmd(current) ?? new Date());
  const focusRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (open) focusRef.current?.focus();
  }, [open, focusDay]);

  const minD = fromYmd(min as string);
  const maxD = fromYmd(max as string);
  const outOfRange = (d: Date) => Boolean((minD && d < minD) || (maxD && d > maxD));

  function commit(d: Date) {
    if (outOfRange(d)) return;
    const ymd = toYmd(d);
    if (!controlled) setUncontrolled(ymd);
    if (inputRef.current) setNativeValue(inputRef.current, ymd); // fires form + onChange
    setOpen(false);
    triggerRef.current?.focus();
  }

  // 6-week grid, Monday-first, for the viewed month.
  const weeks = useMemo(() => {
    const first = new Date(view.getFullYear(), view.getMonth(), 1);
    const lead = (first.getDay() + 6) % 7; // Mon=0 … Sun=6
    const start = new Date(first);
    start.setDate(1 - lead);
    return Array.from({ length: 6 }, (_, w) =>
      Array.from({ length: 7 }, (_, d) => {
        const cell = new Date(start);
        cell.setDate(start.getDate() + w * 7 + d);
        return cell;
      }),
    );
  }, [view]);

  const today = new Date();
  const selected = fromYmd(current);

  function onGridKey(e: React.KeyboardEvent) {
    const move = (days: number) => {
      e.preventDefault();
      const next = new Date(focusDay);
      next.setDate(next.getDate() + days);
      setFocusDay(next);
      if (next.getMonth() !== view.getMonth() || next.getFullYear() !== view.getFullYear()) setView(next);
    };
    switch (e.key) {
      case "ArrowLeft": return move(-1);
      case "ArrowRight": return move(1);
      case "ArrowUp": return move(-7);
      case "ArrowDown": return move(7);
      case "Home": return move(-((focusDay.getDay() + 6) % 7));
      case "End": return move(6 - ((focusDay.getDay() + 6) % 7));
      case "PageUp": { e.preventDefault(); const n = new Date(focusDay); n.setMonth(n.getMonth() - 1); setFocusDay(n); setView(n); return; }
      case "PageDown": { e.preventDefault(); const n = new Date(focusDay); n.setMonth(n.getMonth() + 1); setFocusDay(n); setView(n); return; }
      case "Enter":
      case " ": e.preventDefault(); return commit(focusDay);
      case "Escape": e.preventDefault(); setOpen(false); triggerRef.current?.focus(); return;
    }
  }

  return (
    <span className="relative block min-w-0">
      {/* Real control: carries name/value/required for the form; invisible & inert. */}
      <input
        ref={inputRef}
        type="date"
        name={name}
        id={id}
        required={required}
        min={min}
        max={max}
        disabled={disabled}
        aria-hidden
        tabIndex={-1}
        defaultValue={controlled ? undefined : (defaultValue as string)}
        value={controlled ? (value as string) : undefined}
        onChange={onChange}
        className="pointer-events-none absolute inset-0 h-full w-full opacity-0"
        {...rest}
      />
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={ariaLabel}
        aria-describedby={describedBy}
        aria-required={required || undefined}
        onClick={() => !disabled && setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen(true); }
        }}
        className={`${fieldButtonCls(size, invalid, open)} ${className}`}
      >
        <span className={current ? "tnum" : "text-ink-3"}>{current ? displayDMY(current) : placeholder}</span>
        <CalendarDays size={size === "sm" ? 14 : 16} aria-hidden className="flex-none text-ink-3" />
      </button>

      <Popover anchorRef={triggerRef} open={open} onClose={() => setOpen(false)} role="dialog" className="w-[17rem] p-2">
        <div className="mb-1 flex items-center justify-between px-1">
          <button
            type="button"
            aria-label="Previous month"
            onClick={() => setView(new Date(view.getFullYear(), view.getMonth() - 1, 1))}
            className="grid h-7 w-7 place-items-center rounded-btn text-ink-2 hover:bg-surface-2 hover:text-ink"
          >
            <ChevronLeft size={16} />
          </button>
          <span id={gridId} className="text-sm font-semibold text-ink">
            {MONTHS[view.getMonth()]} {view.getFullYear()}
          </span>
          <button
            type="button"
            aria-label="Next month"
            onClick={() => setView(new Date(view.getFullYear(), view.getMonth() + 1, 1))}
            className="grid h-7 w-7 place-items-center rounded-btn text-ink-2 hover:bg-surface-2 hover:text-ink"
          >
            <ChevronRight size={16} />
          </button>
        </div>
        <div className="grid grid-cols-7 gap-0.5 px-1 pb-1" role="row">
          {WEEKDAYS.map((w) => (
            <div key={w} className="grid h-7 place-items-center text-caption font-medium text-muted">{w}</div>
          ))}
        </div>
        <div role="grid" aria-labelledby={gridId} onKeyDown={onGridKey} className="grid grid-cols-7 gap-0.5 px-1 pb-1">
          {weeks.flat().map((d) => {
            const inMonth = d.getMonth() === view.getMonth();
            const isSel = !!(selected && sameYmd(d, selected));
            const isToday = sameYmd(d, today);
            const isFocus = sameYmd(d, focusDay);
            const disabledDay = outOfRange(d);
            return (
              <button
                key={toYmd(d)}
                ref={isFocus ? focusRef : undefined}
                type="button"
                role="gridcell"
                tabIndex={isFocus ? 0 : -1}
                aria-selected={isSel || undefined}
                aria-current={isToday ? "date" : undefined}
                disabled={disabledDay}
                onClick={() => commit(d)}
                className={[
                  "grid h-8 w-8 place-items-center rounded-btn text-sm tnum transition-colors",
                  disabledDay ? "cursor-not-allowed text-ink-disabled" : "hover:bg-surface-2",
                  !inMonth ? "text-ink-3" : "text-ink",
                  isSel ? "!bg-primary !text-on-accent font-semibold hover:!bg-primary-strong" : "",
                  isToday && !isSel ? "font-semibold text-primary ring-1 ring-inset ring-primary-tint" : "",
                ].join(" ")}
              >
                {d.getDate()}
              </button>
            );
          })}
        </div>
        <div className="flex justify-between border-t border-line px-1 pt-2">
          <button
            type="button"
            onClick={() => commit(new Date())}
            className="rounded-btn px-2 py-1 text-caption font-medium text-primary hover:bg-primary-soft"
          >
            Today
          </button>
          {!required && current && (
            <button
              type="button"
              onClick={() => { if (!controlled) setUncontrolled(""); if (inputRef.current) setNativeValue(inputRef.current, ""); setOpen(false); triggerRef.current?.focus(); }}
              className="rounded-btn px-2 py-1 text-caption font-medium text-muted hover:bg-surface-2 hover:text-ink"
            >
              Clear
            </button>
          )}
        </div>
      </Popover>
    </span>
  );
}

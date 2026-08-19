"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { InputHTMLAttributes } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { ControlSize, fieldButtonCls, Popover, useControlProps } from "./field-base";

/**
 * App-styled month picker - the missing sibling of {@link DatePicker}.
 *
 * `<input type="month">` was left native on the grounds that it was "3 call sites, not worth a
 * bespoke month grid". That reasoning missed what the native popup actually looks like: Chrome
 * draws its own panel in the platform's serif-ish UI font with its own blue selection chip and
 * its own "Clear / This month" links. Sitting under this app's fields it read as a different
 * product - and it is unthemeable, so no amount of `color-scheme` correction fixed it.
 *
 * Same construction as DatePicker, for the same reasons:
 *   - a REAL hidden `<input type="month">` carries `name` / `value` / `required`, so every form
 *     that submits a month keeps working and native constraint validation still fires;
 *   - it stays the DOM source of truth, so `onChange` handlers receive a real event whose
 *     `target.value` is the `YYYY-MM` string they already expect;
 *   - the visible trigger + grid are ours.
 */

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const pad2 = (n: number) => String(n).padStart(2, "0");

/** `YYYY-MM` → {year, month(0-11)}, or null. Parsed by hand: `new Date("2026-07")` is UTC. */
function parseMonth(s: string | undefined | null): { y: number; m: number } | null {
  if (!s) return null;
  const hit = /^(\d{4})-(\d{2})/.exec(s);
  if (!hit) return null;
  const m = Number(hit[2]) - 1;
  if (m < 0 || m > 11) return null;
  return { y: Number(hit[1]), m };
}
const toMonthValue = (y: number, m: number) => `${y}-${pad2(m + 1)}`;
const displayMonth = (s: string) => {
  const p = parseMonth(s);
  return p ? `${MONTHS_LONG[p.m]} ${p.y}` : "";
};

function setNativeValue(el: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "size"> & { size?: ControlSize };

export function MonthPicker({
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
  placeholder = "Month YYYY",
  "aria-label": ariaLabel,
  ...rest
}: Props) {
  const { invalid, "aria-describedby": describedBy } = useControlProps();
  const controlled = value !== undefined;
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const gridId = useId();

  const [uncontrolled, setUncontrolled] = useState<string>((defaultValue as string) ?? "");
  const current = controlled ? ((value as string) ?? "") : uncontrolled;
  const selected = parseMonth(current);

  const now = new Date();
  /** Which YEAR the grid shows. Seeds from the value, else this year. */
  const [year, setYear] = useState<number>(() => parseMonth((value as string) ?? (defaultValue as string))?.y ?? now.getFullYear());
  useEffect(() => {
    if (open) setYear(parseMonth(current)?.y ?? now.getFullYear());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Keyboard focus target inside the grid, as a month index in the shown year.
  const [focusM, setFocusM] = useState<number>(() => parseMonth(current)?.m ?? now.getMonth());
  const focusRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (open) focusRef.current?.focus();
  }, [open, focusM, year]);

  const minP = parseMonth(min as string);
  const maxP = parseMonth(max as string);
  /** Compare as a single ordinal so a min/max spanning a year boundary works. */
  const ord = (y: number, m: number) => y * 12 + m;
  const outOfRange = (y: number, m: number) =>
    Boolean((minP && ord(y, m) < ord(minP.y, minP.m)) || (maxP && ord(y, m) > ord(maxP.y, maxP.m)));

  function commit(y: number, m: number) {
    if (outOfRange(y, m)) return;
    const v = toMonthValue(y, m);
    if (!controlled) setUncontrolled(v);
    if (inputRef.current) setNativeValue(inputRef.current, v); // fires form + onChange
    setOpen(false);
    triggerRef.current?.focus();
  }

  function clear() {
    if (!controlled) setUncontrolled("");
    if (inputRef.current) setNativeValue(inputRef.current, "");
    setOpen(false);
    triggerRef.current?.focus();
  }

  function onGridKey(e: React.KeyboardEvent) {
    // Step through months as one continuous run, rolling into the next/previous year at the
    // edges - arrowing right from December should land on January, not stop dead.
    const move = (delta: number) => {
      e.preventDefault();
      const next = ord(year, focusM) + delta;
      const ny = Math.floor(next / 12);
      const nm = ((next % 12) + 12) % 12;
      setYear(ny);
      setFocusM(nm);
    };
    switch (e.key) {
      case "ArrowLeft": return move(-1);
      case "ArrowRight": return move(1);
      case "ArrowUp": return move(-4); // the grid is 4 wide
      case "ArrowDown": return move(4);
      case "Home": { e.preventDefault(); setFocusM(0); return; }
      case "End": { e.preventDefault(); setFocusM(11); return; }
      case "PageUp": return move(-12);
      case "PageDown": return move(12);
      case "Enter":
      case " ": e.preventDefault(); return commit(year, focusM);
      // stopPropagation: Escape closes only this popover, not a Modal hosting it (see SelectMenu)
      case "Escape": e.preventDefault(); e.stopPropagation(); setOpen(false); triggerRef.current?.focus(); return;
    }
  }

  return (
    <span className="relative block min-w-0">
      {/* Real control: name/value/required for the form; invisible & inert. */}
      <input
        ref={inputRef}
        type="month"
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
        <span className={current ? "truncate" : "truncate text-ink-3"}>
          {current ? displayMonth(current) : placeholder}
        </span>
        <CalendarDays size={size === "sm" ? 14 : 16} aria-hidden className="flex-none text-ink-3" />
      </button>

      <Popover anchorRef={triggerRef} open={open} onClose={() => setOpen(false)} role="dialog" className="w-[16.5rem] p-2">
        <div className="mb-1 flex items-center justify-between px-1">
          <button
            type="button"
            aria-label="Previous year"
            onClick={() => setYear((y) => y - 1)}
            className="grid h-7 w-7 place-items-center rounded-btn text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
          >
            <ChevronLeft size={16} />
          </button>
          <span id={gridId} className="tnum text-sm font-semibold text-ink">{year}</span>
          <button
            type="button"
            aria-label="Next year"
            onClick={() => setYear((y) => y + 1)}
            className="grid h-7 w-7 place-items-center rounded-btn text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
          >
            <ChevronRight size={16} />
          </button>
        </div>

        <div role="grid" aria-labelledby={gridId} onKeyDown={onGridKey} className="grid grid-cols-4 gap-1 px-1 pb-1">
          {MONTHS_SHORT.map((label, m) => {
            const isSel = !!selected && selected.y === year && selected.m === m;
            const isNow = year === now.getFullYear() && m === now.getMonth();
            const isFocus = m === focusM;
            const off = outOfRange(year, m);
            return (
              <button
                key={label}
                ref={isFocus ? focusRef : undefined}
                type="button"
                role="gridcell"
                tabIndex={isFocus ? 0 : -1}
                aria-selected={isSel || undefined}
                aria-current={isNow ? "date" : undefined}
                aria-label={`${MONTHS_LONG[m]} ${year}`}
                disabled={off}
                onClick={() => commit(year, m)}
                className={[
                  "grid h-9 place-items-center rounded-btn text-sm transition-colors",
                  off ? "cursor-not-allowed text-ink-disabled" : "text-ink hover:bg-surface-2",
                  isSel ? "!bg-primary !text-on-accent font-semibold hover:!bg-primary-strong" : "",
                  isNow && !isSel ? "font-semibold text-primary ring-1 ring-inset ring-primary-tint" : "",
                ].join(" ")}
              >
                {label}
              </button>
            );
          })}
        </div>

        <div className="flex justify-between border-t border-line px-1 pt-2">
          <button
            type="button"
            onClick={() => commit(now.getFullYear(), now.getMonth())}
            className="rounded-btn px-2 py-1 text-caption font-medium text-primary transition-colors hover:bg-primary-soft"
          >
            This month
          </button>
          {!required && current && (
            <button
              type="button"
              onClick={clear}
              className="rounded-btn px-2 py-1 text-caption font-medium text-muted transition-colors hover:bg-surface-2 hover:text-ink"
            >
              Clear
            </button>
          )}
        </div>
      </Popover>
    </span>
  );
}

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { InputHTMLAttributes } from "react";
import { CalendarClock, ChevronLeft, ChevronRight } from "lucide-react";
import { ControlSize, fieldButtonCls, Popover, useControlProps } from "./field-base";

/**
 * App-styled date + time picker — the last native popup replaced (see {@link MonthPicker}).
 *
 * One popover, calendar on the left and a time column on the right, because the two halves of a
 * `datetime-local` are one decision: "when is this task due". Splitting them into two fields (or
 * two popups) makes the reader answer twice.
 *
 * Same hidden-real-input construction as DatePicker: `<input type="datetime-local">` carries
 * `name` / `value` / `required` and stays the DOM source of truth, so callers keep receiving the
 * `YYYY-MM-DDTHH:MM` string they already parse — including `toLocalInput` on the schedule form,
 * whose whole point is that this value is LOCAL wall-clock, never UTC.
 */

const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const pad2 = (n: number) => String(n).padStart(2, "0");

/**
 * Parse `YYYY-MM-DDTHH:MM` as LOCAL wall-clock, by hand.
 * `new Date(str)` would read a bare datetime as UTC in some engines and shift the hour.
 */
function parseLocal(s: string | undefined | null): { d: Date; h: number; m: number } | null {
  if (!s) return null;
  const hit = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(s);
  if (!hit) return null;
  const d = new Date(Number(hit[1]), Number(hit[2]) - 1, Number(hit[3]));
  return { d, h: Number(hit[4]), m: Number(hit[5]) };
}
const toValue = (d: Date, h: number, m: number) =>
  `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(h)}:${pad2(m)}`;
const dayKey = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const sameDay = (a: Date, b: Date) => dayKey(a) === dayKey(b);

function display(s: string): string {
  const p = parseLocal(s);
  if (!p) return "";
  const period = p.h < 12 ? "AM" : "PM";
  const h12 = p.h % 12 === 0 ? 12 : p.h % 12;
  return `${pad2(p.d.getDate())}/${pad2(p.d.getMonth() + 1)}/${p.d.getFullYear()}, ${h12}:${pad2(p.m)} ${period}`;
}

function setNativeValue(el: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

/** Half-hour slots — the granularity every datetime field in this app actually needs. */
const SLOTS = Array.from({ length: 48 }, (_, i) => ({ h: Math.floor(i / 2), m: (i % 2) * 30 }));

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "size"> & { size?: ControlSize };

export function DateTimePicker({
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
  placeholder = "DD/MM/YYYY, --:--",
  "aria-label": ariaLabel,
  ...rest
}: Props) {
  const { invalid, "aria-describedby": describedBy } = useControlProps();
  const controlled = value !== undefined;
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);

  const [uncontrolled, setUncontrolled] = useState<string>((defaultValue as string) ?? "");
  const current = controlled ? ((value as string) ?? "") : uncontrolled;
  const parsed = parseLocal(current);

  const now = new Date();
  const [view, setView] = useState<Date>(() => parseLocal((value as string) ?? (defaultValue as string))?.d ?? now);
  useEffect(() => {
    if (open) setView(parseLocal(current)?.d ?? new Date());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const slotColRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    slotColRef.current?.querySelector<HTMLElement>('[data-sel="1"]')?.scrollIntoView({ block: "center" });
  }, [open]);

  const minP = parseLocal(min as string);
  const maxP = parseLocal(max as string);
  const outOfRange = (d: Date) =>
    Boolean((minP && dayKey(d) < dayKey(minP.d)) || (maxP && dayKey(d) > dayKey(maxP.d)));

  /**
   * Picking a DAY keeps the time already chosen (or defaults to 09:00) and picking a TIME keeps
   * the day — so the two halves can be answered in either order without one resetting the other.
   * The popover stays OPEN on a day click: the reader still owes an answer for the time.
   */
  function commit(d: Date, h: number, m: number, close: boolean) {
    if (outOfRange(d)) return;
    const v = toValue(d, h, m);
    if (!controlled) setUncontrolled(v);
    if (inputRef.current) setNativeValue(inputRef.current, v);
    if (close) {
      setOpen(false);
      triggerRef.current?.focus();
    }
  }
  const pickDay = (d: Date) => commit(d, parsed?.h ?? 9, parsed?.m ?? 0, false);
  const pickSlot = (h: number, m: number) => commit(parsed?.d ?? new Date(), h, m, true);

  const weeks = useMemo(() => {
    const first = new Date(view.getFullYear(), view.getMonth(), 1);
    const lead = (first.getDay() + 6) % 7; // Mon=0 … Sun=6
    const start = new Date(first);
    start.setDate(1 - lead);
    return Array.from({ length: 6 }, (_, w) =>
      Array.from({ length: 7 }, (_, i) => {
        const cell = new Date(start);
        cell.setDate(start.getDate() + w * 7 + i);
        return cell;
      }),
    );
  }, [view]);

  return (
    <span className="relative block min-w-0">
      <input
        ref={inputRef}
        type="datetime-local"
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
          if (e.key === "Escape" && open) { e.preventDefault(); e.stopPropagation(); setOpen(false); }
        }}
        className={`${fieldButtonCls(size, invalid, open)} ${className}`}
      >
        <span className={current ? "tnum truncate" : "truncate text-ink-3"}>
          {current ? display(current) : placeholder}
        </span>
        <CalendarClock size={size === "sm" ? 14 : 16} aria-hidden className="flex-none text-ink-3" />
      </button>

      <Popover anchorRef={triggerRef} open={open} onClose={() => setOpen(false)} role="dialog" className="w-[23rem] p-2">
        <div className="flex gap-2">
          {/* calendar */}
          <div className="min-w-0 flex-1">
            <div className="mb-1 flex items-center justify-between">
              <button
                type="button"
                aria-label="Previous month"
                onClick={() => setView(new Date(view.getFullYear(), view.getMonth() - 1, 1))}
                className="grid h-7 w-7 place-items-center rounded-btn text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
              >
                <ChevronLeft size={16} />
              </button>
              <span className="text-caption font-semibold text-ink">
                {MONTHS[view.getMonth()]} {view.getFullYear()}
              </span>
              <button
                type="button"
                aria-label="Next month"
                onClick={() => setView(new Date(view.getFullYear(), view.getMonth() + 1, 1))}
                className="grid h-7 w-7 place-items-center rounded-btn text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
              >
                <ChevronRight size={16} />
              </button>
            </div>
            <div className="grid grid-cols-7 gap-0.5">
              {WEEKDAYS.map((w) => (
                <div key={w} className="grid h-6 place-items-center text-caption font-medium text-muted">{w}</div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-0.5">
              {weeks.flat().map((d) => {
                const inMonth = d.getMonth() === view.getMonth();
                const isSel = !!parsed && sameDay(d, parsed.d);
                const isToday = sameDay(d, now);
                const off = outOfRange(d);
                return (
                  <button
                    key={dayKey(d)}
                    type="button"
                    disabled={off}
                    aria-selected={isSel || undefined}
                    aria-current={isToday ? "date" : undefined}
                    onClick={() => pickDay(d)}
                    className={[
                      "tnum grid h-7 w-7 place-items-center rounded-btn text-caption transition-colors",
                      off ? "cursor-not-allowed text-ink-disabled" : "hover:bg-surface-2",
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
          </div>

          {/* time slots */}
          <div className="w-[6.5rem] flex-none border-l border-line pl-2">
            <p className="pb-1 text-caption font-semibold uppercase text-ink-3">Time</p>
            <div ref={slotColRef} className="max-h-[13.5rem] space-y-0.5 overflow-y-auto pr-0.5">
              {SLOTS.map(({ h, m }) => {
                const on = parsed?.h === h && parsed?.m === m;
                const period = h < 12 ? "am" : "pm";
                const h12 = h % 12 === 0 ? 12 : h % 12;
                return (
                  <button
                    key={`${h}:${m}`}
                    type="button"
                    data-sel={on ? "1" : undefined}
                    aria-pressed={on}
                    onClick={() => pickSlot(h, m)}
                    className={[
                      "tnum w-full rounded-btn px-2 py-1 text-center text-caption transition-colors",
                      on ? "bg-primary font-semibold text-on-accent hover:bg-primary-strong" : "text-ink hover:bg-surface-2",
                    ].join(" ")}
                  >
                    {h12}:{pad2(m)} {period}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="mt-1 flex justify-between border-t border-line px-1 pt-2">
          <button
            type="button"
            onClick={() => {
              const d = new Date();
              // Round up to the next half hour — "now" for a due date means the next usable slot.
              const m = d.getMinutes() <= 30 ? 30 : 0;
              const h = d.getMinutes() <= 30 ? d.getHours() : d.getHours() + 1;
              commit(d, h % 24, m, true);
            }}
            className="rounded-btn px-2 py-1 text-caption font-medium text-primary transition-colors hover:bg-primary-soft"
          >
            Today
          </button>
          {!required && current && (
            <button
              type="button"
              onClick={() => {
                if (!controlled) setUncontrolled("");
                if (inputRef.current) setNativeValue(inputRef.current, "");
                setOpen(false);
                triggerRef.current?.focus();
              }}
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

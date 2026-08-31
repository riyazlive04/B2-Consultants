"use client";

import { useEffect, useRef, useState } from "react";
import type { InputHTMLAttributes } from "react";
import { Clock } from "lucide-react";
import { ControlSize, fieldButtonCls, Popover, useControlProps } from "./field-base";
import { useFormReset } from "./use-form-reset";

/**
 * App-styled time picker - the third native popup replaced (see {@link MonthPicker}).
 *
 * Two columns of buttons rather than a spinner or a free-text field: every time this app asks
 * for is a slot boundary or a cutoff ("15:00", "21:00"), so a list of real choices is both
 * faster to hit and impossible to typo. `step` drives the minute column, so a 15-minute slot
 * grid offers :00/:15/:30/:45 and nothing else.
 *
 * Same hidden-real-input construction as DatePicker: `<input type="time">` keeps `name` /
 * `value` / `required`, stays the DOM source of truth, and hands `onChange` the "HH:MM" string
 * its existing callers already parse (see `formatIstMinutes` / `parseIstMinutes`).
 */

const pad2 = (n: number) => String(n).padStart(2, "0");

/** "HH:MM" → minutes since midnight, or null. */
function parseHm(s: string | undefined | null): { h: number; m: number } | null {
  if (!s) return null;
  const hit = /^(\d{1,2}):(\d{2})/.exec(s);
  if (!hit) return null;
  const h = Number(hit[1]);
  const m = Number(hit[2]);
  if (h > 23 || m > 59) return null;
  return { h, m };
}

/** 24h value → the 12-hour label the rest of the app shows ("21:00" → "9:00 PM"). */
function display12(s: string): string {
  const p = parseHm(s);
  if (!p) return "";
  const period = p.h < 12 ? "AM" : "PM";
  const h12 = p.h % 12 === 0 ? 12 : p.h % 12;
  return `${h12}:${pad2(p.m)} ${period}`;
}

function setNativeValue(el: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "size"> & { size?: ControlSize };

export function TimePicker({
  size = "md",
  className = "",
  value,
  defaultValue,
  onChange,
  disabled,
  required,
  name,
  id,
  step,
  placeholder = "--:--",
  "aria-label": ariaLabel,
  ...rest
}: Props) {
  const { invalid, "aria-describedby": describedBy } = useControlProps();
  const controlled = value !== undefined;
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);

  const [uncontrolled, setUncontrolled] = useState<string>((defaultValue as string) ?? "");

  // A successful save calls form.reset(), which restores the hidden input and would otherwise
  // leave this trigger showing the previous entry - see `useFormReset`.
  useFormReset(inputRef, () => {
    if (!controlled) setUncontrolled(inputRef.current?.value ?? "");
  });
  const current = controlled ? ((value as string) ?? "") : uncontrolled;
  const parsed = parseHm(current);

  /**
   * Minute granularity from the native `step` (seconds), defaulting to 5.
   * A step under a minute would offer 60 identical-looking rows, so it clamps to 1 minute.
   */
  const stepMins = (() => {
    const secs = Number(step);
    if (!Number.isFinite(secs) || secs <= 0) return 5;
    return Math.max(1, Math.round(secs / 60));
  })();
  const minutes = Array.from({ length: Math.ceil(60 / stepMins) }, (_, i) => (i * stepMins) % 60);
  const hours = Array.from({ length: 24 }, (_, h) => h);

  // Scroll the chosen hour/minute into view when the panel opens - with 24 hours in a scroller,
  // opening at the top would hide the current selection more often than not.
  const hourColRef = useRef<HTMLDivElement>(null);
  const minColRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    for (const col of [hourColRef.current, minColRef.current]) {
      col?.querySelector<HTMLElement>('[data-sel="1"]')?.scrollIntoView({ block: "center" });
    }
  }, [open]);

  /** Commit an hour/minute pair, filling the missing half from the current value or a sane default. */
  function commit(h: number, m: number) {
    const v = `${pad2(h)}:${pad2(m)}`;
    if (!controlled) setUncontrolled(v);
    if (inputRef.current) setNativeValue(inputRef.current, v);
  }
  const pickHour = (h: number) => commit(h, parsed?.m ?? 0);
  const pickMinute = (m: number) => commit(parsed?.h ?? 9, m); // 9am: a working-day default

  const cell = (on: boolean) =>
    [
      "w-full rounded-btn px-2 py-1.5 text-center text-sm tnum transition-colors",
      on ? "bg-primary font-semibold text-on-accent hover:bg-primary-strong" : "text-ink hover:bg-surface-2",
    ].join(" ");

  return (
    <span className="relative block min-w-0">
      <input
        ref={inputRef}
        type="time"
        name={name}
        id={id}
        required={required}
        step={step}
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
          // stopPropagation so Escape closing the list never also closes a hosting Modal.
          if (e.key === "Escape" && open) { e.preventDefault(); e.stopPropagation(); setOpen(false); }
        }}
        className={`${fieldButtonCls(size, invalid, open)} ${className}`}
      >
        <span className={current ? "tnum truncate" : "truncate text-ink-3"}>
          {current ? display12(current) : placeholder}
        </span>
        <Clock size={size === "sm" ? 14 : 16} aria-hidden className="flex-none text-ink-3" />
      </button>

      <Popover anchorRef={triggerRef} open={open} onClose={() => setOpen(false)} role="dialog" className="w-[13rem] p-2">
        <div className="flex gap-2">
          <div className="min-w-0 flex-1">
            <p className="px-1 pb-1 text-caption font-semibold uppercase text-ink-3">Hour</p>
            <div ref={hourColRef} className="max-h-52 space-y-0.5 overflow-y-auto pr-0.5">
              {hours.map((h) => {
                const on = parsed?.h === h;
                // 12-hour label, matching the trigger. Printing the 24-hour number beside an
                // am/pm suffix produced "15 pm", which is neither clock and reads as a typo.
                const h12 = h % 12 === 0 ? 12 : h % 12;
                return (
                  <button
                    key={h}
                    type="button"
                    data-sel={on ? "1" : undefined}
                    aria-pressed={on}
                    aria-label={`${h12} ${h < 12 ? "am" : "pm"}`}
                    onClick={() => pickHour(h)}
                    className={cell(on)}
                  >
                    {h12}
                    <span className={`ml-1 text-caption ${on ? "opacity-80" : "text-ink-3"}`}>
                      {h < 12 ? "am" : "pm"}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
          <div className="min-w-0 flex-1">
            <p className="px-1 pb-1 text-caption font-semibold uppercase text-ink-3">Minute</p>
            <div ref={minColRef} className="max-h-52 space-y-0.5 overflow-y-auto pr-0.5">
              {minutes.map((m) => {
                const on = parsed?.m === m;
                return (
                  <button
                    key={m}
                    type="button"
                    data-sel={on ? "1" : undefined}
                    aria-pressed={on}
                    onClick={() => pickMinute(m)}
                    className={cell(on)}
                  >
                    {pad2(m)}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
        <div className="mt-1 flex justify-between border-t border-line px-1 pt-2">
          <button
            type="button"
            onClick={() => { setOpen(false); triggerRef.current?.focus(); }}
            className="rounded-btn px-2 py-1 text-caption font-medium text-primary transition-colors hover:bg-primary-soft"
          >
            Done
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

"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { SelectHTMLAttributes } from "react";
import { Check, ChevronDown } from "lucide-react";
import { ControlSize, fieldButtonCls, Popover, useControlProps } from "./field-base";

/**
 * App-styled select (§5.5, "fully custom popover" — the option list is ours, not the OS
 * dropdown). Same wrapping trick as DatePicker: a REAL hidden `<select>` carries
 * `name`/`value`/`required` so forms submit and validate exactly as before, and it stays
 * the DOM source of truth so `onChange` handlers still get a real change event with
 * `target.value`. The visible trigger + listbox sit on top.
 *
 * Drop-in for the old `Select`: same `{ options }` prop, same select attributes.
 */

export type SelectOption = { value: string; label: string; disabled?: boolean };

type Props = Omit<SelectHTMLAttributes<HTMLSelectElement>, "size"> & {
  options: SelectOption[];
  size?: ControlSize;
  placeholder?: string;
};

function setNativeSelectValue(el: HTMLSelectElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
  setter?.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

export function SelectMenu({
  options,
  size = "md",
  className = "",
  value,
  defaultValue,
  onChange,
  disabled,
  required,
  name,
  id,
  placeholder,
  "aria-label": ariaLabel,
  ...rest
}: Props) {
  const { invalid, "aria-describedby": describedBy } = useControlProps();
  const controlled = value !== undefined;
  const selectRef = useRef<HTMLSelectElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const listId = useId();

  const [uncontrolled, setUncontrolled] = useState<string>(
    (defaultValue as string) ?? (placeholder ? "" : options[0]?.value ?? ""),
  );
  const currentVal = controlled ? ((value as string) ?? "") : uncontrolled;
  const currentOpt = options.find((o) => o.value === currentVal);

  const [active, setActive] = useState(0);
  const typeahead = useRef({ buf: "", at: 0 });

  useEffect(() => {
    if (!open) return;
    const i = options.findIndex((o) => o.value === currentVal);
    setActive(i >= 0 ? i : 0);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // keep the active option scrolled into view
  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  function commit(idx: number) {
    const opt = options[idx];
    if (!opt || opt.disabled) return; // unselectable option (e.g. an unmapped touchpoint)
    if (!controlled) setUncontrolled(opt.value);
    if (selectRef.current) setNativeSelectValue(selectRef.current, opt.value); // fires form + onChange
    setOpen(false);
    triggerRef.current?.focus();
  }

  function onKey(e: React.KeyboardEvent) {
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) { e.preventDefault(); setOpen(true); }
      return;
    }
    // step to the next selectable option in a direction, skipping disabled ones
    const step = (from: number, dir: 1 | -1) => {
      for (let i = from + dir; i >= 0 && i < options.length; i += dir) if (!options[i].disabled) return i;
      return from;
    };
    switch (e.key) {
      case "ArrowDown": e.preventDefault(); setActive((a) => step(a, 1)); return;
      case "ArrowUp": e.preventDefault(); setActive((a) => step(a, -1)); return;
      case "Home": e.preventDefault(); setActive(step(-1, 1)); return;
      case "End": e.preventDefault(); setActive(step(options.length, -1)); return;
      case "Enter":
      case " ": e.preventDefault(); commit(active); return;
      case "Escape": e.preventDefault(); setOpen(false); triggerRef.current?.focus(); return;
      case "Tab": setOpen(false); return;
      default:
        if (e.key.length === 1) {
          // type-ahead: accumulate within 600ms
          const now = Date.now();
          const t = typeahead.current;
          t.buf = now - t.at > 600 ? e.key : t.buf + e.key;
          t.at = now;
          const hit = options.findIndex((o) => o.label.toLowerCase().startsWith(t.buf.toLowerCase()));
          if (hit >= 0) setActive(hit);
        }
    }
  }

  return (
    <span className="relative block min-w-0">
      {/* Real control: form value + required + native semantics; invisible & inert. */}
      <select
        ref={selectRef}
        name={name}
        id={id}
        required={required}
        disabled={disabled}
        aria-hidden
        tabIndex={-1}
        value={controlled ? (value as string) : undefined}
        defaultValue={controlled ? undefined : uncontrolled}
        onChange={onChange}
        className="pointer-events-none absolute inset-0 h-full w-full opacity-0"
        {...rest}
      >
        {placeholder && <option value="">{placeholder}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>
        ))}
      </select>

      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={ariaLabel}
        aria-describedby={describedBy}
        aria-required={required || undefined}
        onClick={() => !disabled && setOpen((o) => !o)}
        onKeyDown={onKey}
        className={`${fieldButtonCls(size, invalid, open)} ${className}`}
      >
        <span className={`truncate ${currentOpt ? "" : "text-ink-3"}`}>
          {currentOpt ? currentOpt.label : placeholder ?? ""}
        </span>
        <ChevronDown
          size={size === "sm" ? 14 : 16}
          aria-hidden
          className={`flex-none text-ink-3 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      <Popover anchorRef={triggerRef} open={open} onClose={() => setOpen(false)} role="listbox" className="max-h-64 overflow-auto py-1">
        <div ref={listRef} id={listId} role="listbox" aria-activedescendant={`${listId}-${active}`}>
          {options.map((o, i) => {
            const isSel = o.value === currentVal;
            return (
              <div
                key={o.value}
                id={`${listId}-${i}`}
                data-idx={i}
                role="option"
                aria-selected={isSel}
                aria-disabled={o.disabled || undefined}
                onPointerEnter={() => !o.disabled && setActive(i)}
                onClick={() => commit(i)}
                className={[
                  "flex items-center justify-between gap-2 rounded-btn px-2.5 py-1.5 text-sm",
                  o.disabled
                    ? "cursor-not-allowed text-ink-disabled"
                    : i === active
                      ? "cursor-pointer bg-surface-2 text-ink"
                      : "cursor-pointer text-ink-2",
                  isSel && !o.disabled ? "font-medium text-ink" : "",
                ].join(" ")}
              >
                <span className="truncate">{o.label}</span>
                {isSel && <Check size={15} className="flex-none text-primary" />}
              </div>
            );
          })}
        </div>
      </Popover>
    </span>
  );
}

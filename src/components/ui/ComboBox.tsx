"use client";

import { useId, useRef, useState } from "react";
import { Check } from "lucide-react";
import {
  baseCls, errCls, okCls, Popover, sizeCls, useControlProps, type ControlSize,
} from "./field-base";

/**
 * A searchable text field that can ALSO resolve to a known record — a "combobox" (§5.5 popover
 * language, same portal + anchoring as SelectMenu/DatePicker).
 *
 * Built for the income "Student name" field (issue 2.6): the operator types, matching students
 * appear, and picking one fills the visible name AND stamps a hidden id — so the payment links to
 * the right student record instead of relying on a fragile typed-name match (which is how two
 * "Priya"s cross-credit). Free text is still allowed — a payer who has no student record yet keeps
 * their typed name and the id stays empty.
 *
 * Two plain inputs carry the values, so it's a drop-in inside any <form> with no client wiring on
 * the server: the visible <input name={nameText}> and a hidden <input name={nameValue}>.
 */
/**
 * `hint` is a secondary identifier shown beside the label and searchable with it — the
 * student code (§6.1), so two "Anna Smith" rows can be told apart in the dropdown and so
 * typing "B2-0007" finds the right one. It is deliberately NOT written into the text field
 * on pick: `nameText` feeds Income.studentName, and appending a code there would corrupt
 * every stored name and break the name-matching that links payments to students.
 */
export type ComboOption = { value: string; label: string; hint?: string };

type Props = {
  options: ComboOption[];
  /** form field for the free-text/display value */
  nameText: string;
  /** form field for the resolved id ("" when the text doesn't match a record) */
  nameValue: string;
  defaultText?: string;
  defaultValue?: string;
  placeholder?: string;
  required?: boolean;
  size?: ControlSize;
  className?: string;
  id?: string;
};

const MAX_MATCHES = 50;

export function ComboBox({
  options,
  nameText,
  nameValue,
  defaultText = "",
  defaultValue = "",
  placeholder,
  required,
  size = "md",
  className = "",
  id,
}: Props) {
  const { invalid, "aria-describedby": describedBy } = useControlProps();
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(defaultText);
  const [selected, setSelected] = useState(defaultValue);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();

  const q = text.trim().toLowerCase();
  const matches = (
    q
      ? options.filter(
          (o) => o.label.toLowerCase().includes(q) || (o.hint ?? "").toLowerCase().includes(q),
        )
      : options
  ).slice(0, MAX_MATCHES);

  function pick(o: ComboOption) {
    setText(o.label);
    setSelected(o.value);
    setOpen(false);
    inputRef.current?.focus();
  }

  function onKey(e: React.KeyboardEvent) {
    if (!open) {
      if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); }
      return;
    }
    switch (e.key) {
      case "ArrowDown": e.preventDefault(); setActive((a) => Math.min(a + 1, matches.length - 1)); return;
      case "ArrowUp": e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); return;
      case "Enter":
        if (matches[active]) { e.preventDefault(); pick(matches[active]); }
        return;
      case "Escape": e.preventDefault(); setOpen(false); return;
      case "Tab": setOpen(false); return;
    }
  }

  const cls = `${baseCls} ${invalid ? errCls : okCls} ${sizeCls[size]}`;

  return (
    <span className="relative block min-w-0">
      <input type="hidden" name={nameValue} value={selected} />
      <input
        ref={inputRef}
        id={id}
        name={nameText}
        value={text}
        required={required}
        placeholder={placeholder}
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        aria-controls={open ? listId : undefined}
        aria-describedby={describedBy}
        aria-invalid={invalid || undefined}
        onChange={(e) => {
          setText(e.currentTarget.value);
          setSelected(""); // typing invalidates any prior pick until it matches again
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKey}
        className={`${cls} ${className}`}
      />

      {open && (matches.length > 0 || q.length > 0) && (
        <Popover
          anchorRef={inputRef}
          open={open}
          onClose={() => setOpen(false)}
          role="listbox"
          className="max-h-64 overflow-auto py-1"
        >
          <div id={listId} role="listbox">
            {matches.length === 0 ? (
              <div className="px-2.5 py-1.5 text-sm text-ink-3">
                No student matches — “{text.trim()}” will be saved as typed.
              </div>
            ) : (
              matches.map((o, i) => {
                const isSel = o.value === selected;
                return (
                  <div
                    key={o.value}
                    role="option"
                    aria-selected={isSel}
                    onPointerEnter={() => setActive(i)}
                    onClick={() => pick(o)}
                    className={[
                      "flex items-center justify-between gap-2 rounded-btn px-2.5 py-1.5 text-sm",
                      i === active ? "cursor-pointer bg-surface-2 text-ink" : "cursor-pointer text-ink-2",
                      isSel ? "font-medium text-ink" : "",
                    ].join(" ")}
                  >
                    <span className="min-w-0 flex-1 truncate">{o.label}</span>
                    {o.hint && (
                      <span className="tnum flex-none text-caption text-ink-3">{o.hint}</span>
                    )}
                    {isSel && <Check size={15} className="flex-none text-primary" />}
                  </div>
                );
              })
            )}
          </div>
        </Popover>
      )}
    </span>
  );
}

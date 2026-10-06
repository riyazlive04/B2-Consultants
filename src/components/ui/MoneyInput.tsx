"use client";

import { forwardRef, useRef, useState, type InputHTMLAttributes } from "react";
import { sizeCls, useControlProps } from "@/components/ui/field-base";
import { caretAfterFormat, toCanonicalMoney, toDisplayMoney } from "@/lib/money-input";
import type { MoneyCurrency } from "@/lib/payment-methods";

/**
 * A money box that groups as you type, in its own currency's convention (§6):
 * ₹ as `1,25,000.50`, € as `125.000,50`.
 *
 * ── TWO INPUTS, ONE FIELD ─────────────────────────────────────────────────────────
 * The visible box holds DISPLAY text and carries no `name`, so it is never submitted. A hidden
 * input beside it carries the canonical `125000.50` under the field's real name. That split is
 * not tidiness: a euro amount groups with DOTS, and every server action reads a dot as a decimal
 * point (`majorStringToMinor`), so submitting "125.000,50" would store €125 - four orders of
 * magnitude out, silently, in the ledger. Nothing downstream changes, because what downstream
 * receives is exactly the plain string it always received.
 *
 * `disabled` disables BOTH, which is what keeps a mirrored/derived amount out of FormData - the
 * property AmountPair depends on to stop the converted figure being added on top of the real one.
 *
 * ── THE SYMBOL SITS IN THE BOX ────────────────────────────────────────────────────
 * Every screen that READS a figure back shows its currency (lib/format), but the boxes money is
 * typed INTO only said so in the label - and a label is not where the eye is while typing. A ₹
 * amount entered in the € box is not a mistake this app can detect afterwards: both are valid
 * numbers, they are stored in different columns, and the two columns ADD (lib/money).
 *
 * Built on `field-base` rather than on `TextInput` because TextInput sets its own `className`
 * after spreading props, so a caller's classes - including the padding that clears the symbol -
 * are discarded. The ARIA wiring and the one input surface are the same either way.
 *
 * Controlled, like the box it replaces: the parent owns the canonical value and gets it back from
 * `onValueChange`, so the arithmetic the forms do on amounts (dividing a fee across instalments)
 * keeps working on plain numbers and never sees a separator.
 */
export const MoneyInput = forwardRef<
  HTMLInputElement,
  // `size` is omitted because the native attribute is a NUMBER - ours is the control size the
  // rest of the form kit uses (§5.5), and leaving both in scope makes it `string | number`.
  Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "defaultValue" | "size"> & {
    currency: MoneyCurrency;
    /**
     * Canonical major-unit string ("125000.50"), or "" for "no amount in this currency".
     *
     * CONTROLLED when given, UNCONTROLLED when not - the same two modes a native input has.
     * The forms that do arithmetic on what is typed (dividing a fee across instalments) need to
     * own the value; a lone box that is only read on submit does not, and making those adopt
     * state they have no use for is how a one-line field becomes five.
     */
    value?: string;
    onValueChange?: (canonical: string) => void;
    /** Seed for the uncontrolled mode. Canonical, like `value`. */
    defaultValue?: string;
    /** Submitted under this name as the canonical value. Omit for a box that is read, not sent. */
    name?: string;
    /** `sm` for dense table rows, matching every other control (§5.5). */
    size?: "sm" | "md";
  }
>(function MoneyInput(
  {
    currency, value, onValueChange, defaultValue = "", name, disabled, placeholder,
    size = "md", className = "", ...rest
  },
  ref,
) {
  const { cls, "aria-describedby": ariaDescribedBy, "aria-invalid": ariaInvalid } = useControlProps();
  const boxRef = useRef<HTMLInputElement | null>(null);
  /**
   * What the box SHOWS. Derived from `value` on a parent-driven change (a mirrored conversion, a
   * form reset, an instalment share being filled in) but owned locally while typing, so a
   * half-entered "125," is not snapped back to "125" between keystrokes.
   */
  const controlled = value !== undefined;
  const [own, setOwn] = useState(controlled ? value : defaultValue);
  const canonical = controlled ? value : own;
  const [display, setDisplay] = useState(() => toDisplayMoney(canonical, currency));
  const [lastCanonical, setLastCanonical] = useState(canonical);
  if (canonical !== lastCanonical) {
    // The parent changed it under us - adopt it. (Render-phase sync, no effect: an effect here
    // would paint the stale value for a frame every time the two currencies mirror each other.)
    setLastCanonical(canonical);
    setDisplay(toDisplayMoney(canonical, currency));
  }

  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const el = e.currentTarget;
    const raw = el.value;
    const caret = el.selectionStart ?? raw.length;
    const typed = toCanonicalMoney(raw, currency);
    const next = toDisplayMoney(typed, currency);
    setDisplay(next);
    setLastCanonical(typed);
    if (!controlled) setOwn(typed);
    onValueChange?.(typed);
    // Restore the caret after React has written the new value, or editing the middle of a
    // grouped number jumps to the end on every keystroke.
    const pos = caretAfterFormat(next, caret, raw, currency);
    requestAnimationFrame(() => {
      if (el.isConnected) {
        try {
          el.setSelectionRange(pos, pos);
        } catch {
          /* selection unsupported - the caret stays where the browser put it */
        }
      }
    });
  };

  const symbol = currency === "EUR" ? "€" : "₹";
  // Clears the symbol. The `sm` variant's own px-2.5 is replaced for the same reason.
  const pad = size === "sm" ? "pl-7" : "pl-8";

  return (
    <div className={`relative ${className}`}>
      {/* `pointer-events-none` keeps the whole width clickable; `aria-hidden` because the
          field's label already names the currency - announcing it twice is noise. */}
      <span
        aria-hidden
        className={`pointer-events-none absolute left-3 top-1/2 z-[1] -translate-y-1/2 ${
          size === "sm" ? "text-xs" : "text-sm"
        } font-medium ${disabled ? "text-ink-disabled" : "text-ink-3"}`}
      >
        {symbol}
      </span>
      <input
        ref={(node) => {
          boxRef.current = node;
          if (typeof ref === "function") ref(node);
          else if (ref) ref.current = node;
        }}
        {...rest}
        aria-describedby={ariaDescribedBy}
        aria-invalid={ariaInvalid}
        // NOT kind="money": that filter strips the very separators this field adds. The parse in
        // `toCanonicalMoney` is the gate, and it is stricter - it also discards stray symbols.
        inputMode="decimal"
        autoComplete="off"
        maxLength={24}
        disabled={disabled}
        placeholder={placeholder ?? (currency === "EUR" ? "0,00" : "0.00")}
        value={display}
        onChange={onChange}
        className={`${cls} ${sizeCls[size]} ${pad}`}
      />
      {name && <input type="hidden" name={name} value={canonical} disabled={disabled} />}
    </div>
  );
});

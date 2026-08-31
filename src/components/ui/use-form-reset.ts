import { useEffect, useRef, type RefObject } from "react";

/**
 * Keep a custom control's mirror state in step with `form.reset()`.
 *
 * ── The bug this exists to stop ──────────────────────────────────────────────────
 * Every custom control in this app (DatePicker, SelectMenu, TimePicker, MonthPicker,
 * DateTimePicker, ComboBox) is a styled trigger in front of a REAL hidden native input or
 * select. The native one carries `name`/`value`/`required`, so it is the thing that actually
 * submits; the React state only decides what the trigger DISPLAYS.
 *
 * Twenty-odd call sites finish a successful save with `formRef.current?.reset()`. That resets
 * the NATIVE controls back to their `defaultValue` - and told the React state nothing. So the
 * hidden input quietly went back to today's date while the trigger still showed the date the
 * user had picked. The next entry then submitted the DEFAULT while displaying something else
 * entirely, which is exactly how it was reported: "the default options are saved though I
 * select a different date".
 *
 * It is silent by construction. The two halves of the same control disagree, and only the half
 * nobody can see is the half that gets submitted.
 *
 * `AmountPair` already carried a hand-rolled version of this fix with a comment describing the
 * same failure; this is that fix, generalised to the controls that were still missing it.
 *
 * ── Why the callback is deferred ─────────────────────────────────────────────────
 * `form.reset()` fires the `reset` event FIRST and resets the controls afterwards, so a handler
 * that reads `input.value` synchronously sees the OLD value - the very value we are trying to
 * stop trusting. `queueMicrotask` runs after `reset()` has returned and the controls have
 * actually been restored, so callers can simply read the native control back.
 */
export function useFormReset(anchor: RefObject<HTMLElement | null>, onReset: () => void): void {
  // Held in a ref so the listener is attached once, not re-bound on every render by a
  // callback identity that changes each time.
  const cb = useRef(onReset);
  useEffect(() => {
    cb.current = onReset;
  });

  useEffect(() => {
    const form = anchor.current?.closest("form");
    if (!form) return; // a control outside a form has nothing to follow
    const handler = () => queueMicrotask(() => cb.current());
    form.addEventListener("reset", handler);
    return () => form.removeEventListener("reset", handler);
  }, [anchor]);
}

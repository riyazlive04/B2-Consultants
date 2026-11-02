"use client";

/**
 * THE WEEKLY REPORT'S QUESTION FIELDS - one renderer for the one place it is answered.
 *
 * The form lives on the student's own dashboard and nowhere else. Kept as a component of its
 * own rather than inlined there because the matching rule in lib/weekly-form.ts validates
 * against the same question shape: a second copy of this switch is where the form would
 * quietly stop offering an "Other" box, or start accepting a decimal the validator refuses.
 *
 * The matching rule lives in lib/weekly-form.ts and runs on the server too. Nothing here is
 * a fence; it is the half of the form a person can see.
 */

import { Field, TextInput, TextArea, CheckboxField } from "@/components/ui/form";
import { SelectMenu } from "@/components/ui/SelectMenu";
import { WEEKLY_OTHER_VALUE, weeklyOtherField, type WeeklyQuestion } from "@/lib/weekly-form";

/**
 * An "Other" answer is stored as the typed text, not as a sentinel, so on a second visit it
 * no longer matches any option. That is the right thing to store - the dashboard shows what
 * the student wrote - and it means the only way to recognise it on the way back in is that
 * it matches nothing on the list.
 */
export function isOtherValue(q: WeeklyQuestion, value: string | string[] | undefined): boolean {
  if (!value || !q.allowOther || !q.options) return false;
  const known = new Set(q.options.map((o) => o.value));
  const list = Array.isArray(value) ? value : [value];
  return list.some((v) => !known.has(v));
}

function otherText(q: WeeklyQuestion, value: string | string[] | undefined): string {
  if (!value || !q.options || !isOtherValue(q, value)) return "";
  const known = new Set(q.options.map((o) => o.value));
  const list = Array.isArray(value) ? value : [value];
  return list.find((v) => !known.has(v)) ?? "";
}

export function QuestionField({
  q,
  error,
  initial,
  otherOpen,
  onOtherChange,
}: {
  q: WeeklyQuestion;
  error: string | null;
  initial: string | string[] | undefined;
  otherOpen: boolean;
  onOtherChange: (open: boolean) => void;
}) {
  const hint = q.helpText ?? undefined;
  const single = Array.isArray(initial) ? initial[0] : initial;

  switch (q.kind) {
    case "NUMBER":
      return (
        <Field label={q.label} hint={hint} error={error} required={q.required}>
          {/* Deliberately not type="number": its spinner is OS chrome the design system bans
              (§5.5), and `inputMode` already gives a phone the numeric keypad. The validator
              is what enforces digits, on both sides. */}
          <TextInput
            name={q.key}
            kind="int"
            inputMode="numeric"
            required={q.required}
            defaultValue={single ?? ""}
            placeholder="0"
          />
        </Field>
      );

    case "SCALE": {
      const min = q.min ?? 1;
      const max = q.max ?? 5;
      const steps = Array.from({ length: max - min + 1 }, (_, i) => min + i);
      return (
        <Field label={q.label} hint={hint} error={error} required={q.required}>
          <div className="flex flex-wrap gap-2">
            {steps.map((n) => (
              // Same device as CheckboxField: the real radio stays sr-only so it keeps focus
              // and the tab order, and the visible chip is a span.
              <label
                key={n}
                className="group relative inline-flex min-h-10 min-w-10 cursor-pointer items-center justify-center"
              >
                <input
                  type="radio"
                  name={q.key}
                  value={String(n)}
                  required={q.required}
                  defaultChecked={single === String(n)}
                  className="peer sr-only"
                />
                <span
                  aria-hidden
                  className="grid h-10 w-10 place-items-center rounded-field border border-line-strong bg-surface text-sm font-semibold text-ink transition-colors group-hover:border-primary-tint peer-checked:border-primary peer-checked:bg-primary peer-checked:text-on-accent peer-focus-visible:ring-2 peer-focus-visible:ring-primary-soft"
                >
                  {n}
                </span>
              </label>
            ))}
          </div>
        </Field>
      );
    }

    case "YES_NO":
      return (
        <Field label={q.label} hint={hint} error={error} required={q.required}>
          <SelectMenu
            name={q.key}
            required={q.required}
            placeholder="Choose"
            defaultValue={single ?? ""}
            options={[
              { value: "yes", label: "Yes" },
              { value: "no", label: "No" },
            ]}
          />
        </Field>
      );

    case "SINGLE_SELECT":
      return (
        <Field label={q.label} hint={hint} error={error} required={q.required}>
          <SelectMenu
            name={q.key}
            required={q.required}
            placeholder="Choose one"
            defaultValue={otherOpen ? WEEKLY_OTHER_VALUE : (single ?? "")}
            onChange={(e) => onOtherChange(e.currentTarget.value === WEEKLY_OTHER_VALUE)}
            options={[
              ...(q.options ?? []).map((o) => ({ value: o.value, label: o.label })),
              ...(q.allowOther ? [{ value: WEEKLY_OTHER_VALUE, label: "Something else" }] : []),
            ]}
          />
          {otherOpen && (
            <div className="mt-2">
              <TextInput
                name={weeklyOtherField(q.key)}
                kind="text"
                placeholder="Tell us in your own words"
                defaultValue={otherText(q, initial)}
              />
            </div>
          )}
        </Field>
      );

    case "MULTI_SELECT": {
      const chosen = new Set(Array.isArray(initial) ? initial : initial ? [initial] : []);
      return (
        <Field label={q.label} hint={hint} error={error} required={q.required}>
          <div className="space-y-0.5">
            {(q.options ?? []).map((o) => (
              <CheckboxField
                key={o.value}
                name={q.key}
                value={o.value}
                label={o.label}
                defaultChecked={chosen.has(o.value)}
              />
            ))}
            {q.allowOther && (
              <>
                <label className="group relative flex min-h-10 cursor-pointer items-center gap-2.5 py-2 text-sm font-medium">
                  <input
                    type="checkbox"
                    name={q.key}
                    value={WEEKLY_OTHER_VALUE}
                    defaultChecked={otherOpen}
                    onChange={(e) => onOtherChange(e.currentTarget.checked)}
                    className="peer sr-only"
                  />
                  <span
                    aria-hidden
                    className="grid h-5 w-5 flex-none place-items-center rounded-[6px] border border-line-strong bg-surface transition-colors peer-checked:border-primary peer-checked:bg-primary peer-focus-visible:ring-2 peer-focus-visible:ring-primary-soft"
                  />
                  <span>Something else</span>
                </label>
                {otherOpen && (
                  <TextInput
                    name={weeklyOtherField(q.key)}
                    kind="text"
                    placeholder="Tell us in your own words"
                    defaultValue={otherText(q, initial)}
                  />
                )}
              </>
            )}
          </div>
        </Field>
      );
    }

    case "TEXT":
      return (
        <Field label={q.label} hint={hint} error={error} required={q.required}>
          <TextInput name={q.key} kind="text" required={q.required} defaultValue={single ?? ""} />
        </Field>
      );

    case "LONG_TEXT":
      return (
        <Field label={q.label} hint={hint} error={error} required={q.required}>
          <TextArea name={q.key} kind="text" rows={3} required={q.required} defaultValue={single ?? ""} />
        </Field>
      );
  }
}

"use client";

import { useMemo, useState } from "react";
import { Loader2, CheckCircle2, ChevronDown, Star } from "lucide-react";
import type { PublicForm as PublicFormType } from "@/server/forms-metrics";
import {
  isStaticItem,
  nextPageIndex,
  pagesOf,
  validateAnswer,
  OTHER_VALUE,
  otherFieldName,
  type FormAnswers,
  type FormAnswerValue,
  type FormFieldType,
  type FormItem,
  type FormPage,
} from "@/lib/sites-types";
import { fieldKindProps } from "@/components/ui/field-base";
import type { FieldKind } from "@/lib/field-rules";
import { submitPublicForm } from "@/server/forms-actions";

/**
 * The public face of a form — Google Forms' respondent view.
 *
 * ── Why this is controlled rather than an uncontrolled <form> ────────────────────
 * It used to be a plain form read with `new FormData(e.currentTarget)`, which is the right shape
 * for a single page of independent inputs. It stops working the moment answers affect what the
 * respondent sees: branching needs to know the current answer to decide the next page, a multi-page
 * form must keep page 1's answers alive while page 2 is on screen, and per-question inline errors
 * need somewhere to live. So answers are state, and the DOM is a projection of them.
 *
 * ── Validation runs here AND on the server, from the same function ───────────────
 * `validateAnswer` is imported by this file and by the submit action. Client-side alone is
 * decoration (anyone can POST); server-side alone means every mistake costs a round trip and the
 * respondent loses their place. The rule has one definition, so the two cannot drift.
 *
 * ── Still native inputs ─────────────────────────────────────────────────────────
 * The app's themed DatePicker/SelectMenu popovers do not come to this page. It is the one surface
 * where a stranger on an unknown device is trying to give us money, so it uses controls their
 * browser and their assistive tech already know how to drive.
 */

/**
 * Character rules keyed off the field's DECLARED type (sites-types.ts), never off its key — the
 * founder names these fields, so guessing "this one is called `name`, so it takes no digits" would
 * eventually filter a field that legitimately holds digits.
 *
 * Two types are deliberately absent, because this is a PUBLIC lead-capture surface where a dropped
 * character costs a booking:
 *   - `number` — the builder offers one numeric type for both "how many staff" (2) and "budget"
 *     (2.5). `int` would silently rewrite 2.5 to 25, which is worse than not filtering at all.
 *   - `text`   — free text by definition; the type tells us nothing about what belongs in it.
 * Choice, scale and date types aren't free-text inputs and are handled on their own below.
 */
const KIND_BY_FIELD_TYPE: Partial<Record<FormFieldType, FieldKind>> = {
  email: "email",
  phone: "phone",
  textarea: "text",
};

const INPUT_CLS =
  "h-11 w-full rounded-field border border-line bg-surface px-3 text-sm outline-none focus:border-primary";

/** Fisher–Yates against a fixed seed, so a re-render does not reshuffle under the respondent. */
function shuffled<T>(list: readonly T[], seed: number): T[] {
  const out = [...list];
  let s = seed || 1;
  for (let i = out.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) % 2147483648;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export default function PublicForm({
  form,
  utm,
  preview = false,
}: {
  form: PublicFormType;
  utm?: Record<string, string>;
  /**
   * Builder preview. Renders and BRANCHES exactly as the live page does — same component, same
   * validation, same page walk — but stops at the submit. A preview built from a second, simpler
   * renderer is the kind that agrees with the real thing right up until the day it matters.
   */
  preview?: boolean;
}) {
  const [answers, setAnswers] = useState<FormAnswers>({});
  /** "Other:" free text, kept beside the answer because the option itself posts a sentinel. */
  const [otherText, setOtherText] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  // One seed for the life of the visit: order must be stable while the respondent is filling in.
  const [seed] = useState(() => Math.floor(Math.random() * 2 ** 31));

  const pages = useMemo(() => {
    const raw = pagesOf(form.fields);
    if (!form.settings.shuffleQuestions) return raw;
    return raw.map((p, i) => ({ ...p, items: shuffled(p.items, seed + i) }));
  }, [form.fields, form.settings.shuffleQuestions, seed]);

  const [pageIndex, setPageIndex] = useState(0);
  /** Pages actually visited, so Back retraces the real route rather than index − 1. */
  const [trail, setTrail] = useState<number[]>([]);

  const page: FormPage | undefined = pages[pageIndex];

  /**
   * Answers with "Other" folded in — what validation, branching and the eventual POST all reason
   * about. The raw state keeps the sentinel so the radio knows which row is selected.
   */
  const effective: FormAnswers = useMemo(() => {
    const out: FormAnswers = {};
    for (const [k, v] of Object.entries(answers)) {
      out[k] = Array.isArray(v)
        ? v.map((x) => (x === OTHER_VALUE ? (otherText[k] ?? "").trim() : x)).filter(Boolean)
        : v === OTHER_VALUE
          ? (otherText[k] ?? "").trim()
          : v;
    }
    return out;
  }, [answers, otherText]);

  function set(key: string, value: FormAnswerValue) {
    setAnswers((a) => ({ ...a, [key]: value }));
    setErrors((e) => (e[key] ? { ...e, [key]: "" } : e)); // clear on edit, not on blur
  }

  function toggleMulti(key: string, option: string, on: boolean) {
    const cur = answers[key];
    const list = Array.isArray(cur) ? cur : [];
    set(key, on ? [...list, option] : list.filter((x) => x !== option));
  }

  /** Validate just the questions on screen. Returns true when the page may be left. */
  function checkPage(p: FormPage): boolean {
    const found: Record<string, string> = {};
    for (const item of p.items) {
      const err = validateAnswer(item, effective[item.key]);
      if (err) found[item.key] = err;
    }
    setErrors(found);
    if (Object.keys(found).length) {
      setError("Please check the highlighted questions.");
      return false;
    }
    setError(null);
    return true;
  }

  async function goNext() {
    if (!page || !checkPage(page)) return;
    const next = nextPageIndex(page, effective, pages);
    if (next === "submit") return submit();
    setTrail((t) => [...t, pageIndex]);
    setPageIndex(next);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function goBack() {
    const prev = trail[trail.length - 1];
    if (prev == null) return;
    setPageIndex(prev);
    setTrail((t) => t.slice(0, -1));
    setError(null);
  }

  async function submit() {
    if (preview) {
      setDone(form.settings.successMessage || "Thanks!");
      return;
    }
    setBusy(true);
    setError(null);
    const fd = new FormData();
    // Post the RAW answers plus the companion "Other" text and let the server fold them — the
    // same fold, in one place, rather than a client copy the server has to trust.
    for (const item of form.fields) {
      if (isStaticItem(item.type)) continue;
      const v = answers[item.key];
      if (Array.isArray(v)) v.forEach((one) => fd.append(item.key, one));
      else if (v != null) fd.set(item.key, v);
      const other = otherText[item.key];
      if (other) fd.set(otherFieldName(item.key), other);
    }
    for (const [k, v] of Object.entries(utm ?? {})) fd.set(k, v);

    const res = await submitPublicForm(form.slug, fd);
    setBusy(false);
    if (!res.ok) return setError(res.error);
    if (res.redirectUrl) {
      window.location.href = res.redirectUrl;
      return;
    }
    setDone(res.message);
  }

  function restart() {
    setAnswers({});
    setOtherText({});
    setErrors({});
    setDone(null);
    setPageIndex(0);
    setTrail([]);
  }

  if (done) {
    return (
      <div className="rounded-card border border-line bg-surface p-8 text-center shadow-card">
        <CheckCircle2 className="mx-auto mb-3 text-good" size={32} />
        <p className="font-display text-h3 text-ink">{done}</p>
        {form.settings.showSubmitAnother && (
          <button type="button" onClick={restart} className="mt-4 text-sm font-semibold text-primary underline">
            Submit another response
          </button>
        )}
      </div>
    );
  }

  const multiPage = pages.length > 1;
  const isLast = page ? nextPageIndex(page, effective, pages) === "submit" : true;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void goNext();
      }}
      className="space-y-5 rounded-card border border-line bg-surface p-6 shadow-card"
    >
      {multiPage && form.settings.progressBar && (
        <div>
          <div className="mb-1.5 flex items-center justify-between text-caption text-ink-3">
            <span>
              Page {pageIndex + 1} of {pages.length}
            </span>
            {page?.section?.label && <span className="font-semibold text-ink-2">{page.section.label}</span>}
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2" role="presentation">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-300"
              style={{ width: `${((pageIndex + 1) / pages.length) * 100}%` }}
            />
          </div>
        </div>
      )}

      {page?.section && (
        <div>
          {!form.settings.progressBar && (
            <h2 className="font-display text-h3 text-ink">{page.section.label}</h2>
          )}
          {page.section.description && (
            <p className="mt-1 text-sm text-muted">{page.section.description}</p>
          )}
        </div>
      )}

      {page?.items.map((item) => (
        <Question
          key={item.id}
          item={item}
          value={answers[item.key]}
          otherText={otherText[item.key] ?? ""}
          error={errors[item.key]}
          seed={seed}
          onChange={(v) => set(item.key, v)}
          onToggle={(opt, on) => toggleMulti(item.key, opt, on)}
          onOther={(t) => setOtherText((o) => ({ ...o, [item.key]: t }))}
        />
      ))}

      {/* Honeypot (hidden from humans) */}
      <input type="text" name="company_website" tabIndex={-1} autoComplete="off" className="absolute left-[-9999px]" aria-hidden />

      {error && (
        <p role="alert" className="rounded-field bg-bad-soft px-3 py-2 text-sm font-medium text-bad">
          {error}
        </p>
      )}

      <div className="flex items-center gap-2">
        {trail.length > 0 && (
          <button
            type="button"
            onClick={goBack}
            className="inline-flex h-11 items-center justify-center rounded-btn border border-line px-4 text-sm font-semibold text-ink-2 hover:bg-surface-2"
          >
            Back
          </button>
        )}
        <button
          type="submit"
          disabled={busy}
          className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-btn bg-primary text-sm font-semibold text-on-accent hover:bg-primary-strong disabled:opacity-60"
        >
          {busy && <Loader2 size={16} className="animate-spin" />}
          {isLast ? form.settings.submitText || "Submit" : "Next"}
        </button>
      </div>
    </form>
  );
}

// ── One question ────────────────────────────────────────────────────────────────

function Question({
  item,
  value,
  otherText,
  error,
  seed,
  onChange,
  onToggle,
  onOther,
}: {
  item: FormItem;
  value: FormAnswerValue | undefined;
  otherText: string;
  error?: string;
  seed: number;
  onChange: (v: FormAnswerValue) => void;
  onToggle: (option: string, on: boolean) => void;
  onOther: (text: string) => void;
}) {
  const options = useMemo(() => {
    const list = item.options ?? [];
    return item.shuffle ? shuffled(list, seed) : list;
  }, [item.options, item.shuffle, seed]);

  // Static items collect nothing — they lay the page out.
  if (item.type === "heading") {
    return (
      <div className="border-t border-line pt-5 first:border-0 first:pt-0">
        <h2 className="font-display text-h3 text-ink">{item.label}</h2>
        {item.description && <p className="mt-1 text-sm text-muted">{item.description}</p>}
      </div>
    );
  }
  if (item.type === "image") {
    return item.imageUrl ? (
      // The URL is typed in by the form's author and can point anywhere, so next/image's
      // remotePatterns allow-list would reject exactly the images this item exists to show.
      // eslint-disable-next-line @next/next/no-img-element
      <img src={item.imageUrl} alt={item.imageAlt ?? item.label ?? ""} className="w-full rounded-field" />
    ) : null;
  }
  if (isStaticItem(item.type)) return null;

  const text = Array.isArray(value) ? "" : (value ?? "");
  const list = Array.isArray(value) ? value : [];
  const kind = KIND_BY_FIELD_TYPE[item.type];
  const errId = error ? `${item.id}-err` : undefined;

  const field = (() => {
    switch (item.type) {
      case "textarea": {
        const ta = fieldKindProps<HTMLTextAreaElement>(kind, (e) => onChange(e.target.value));
        return (
          <textarea
            {...ta.attrs}
            value={text}
            onChange={ta.onChange}
            rows={3}
            placeholder={item.placeholder}
            aria-describedby={errId}
            className="w-full rounded-field border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
          />
        );
      }

      case "select":
        return (
          // A REAL native <select>: maximum mobile/keyboard compatibility and no popover JS on the
          // intake path. The OS arrow is stripped per DS §5.5 and redrawn.
          <span className="relative block">
            <select
              value={text}
              onChange={(e) => onChange(e.target.value)}
              aria-describedby={errId}
              className="h-11 w-full cursor-pointer appearance-none rounded-field border border-line bg-surface px-3 pr-9 text-sm outline-none focus:border-primary"
            >
              <option value="">Choose…</option>
              {options.map((o) => (
                <option key={o.label} value={o.label}>
                  {o.label}
                </option>
              ))}
              {item.allowOther && <option value={OTHER_VALUE}>Other…</option>}
            </select>
            <ChevronDown size={16} aria-hidden className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-ink-3" />
          </span>
        );

      case "radio":
        return (
          <div className="space-y-1.5" role="radiogroup" aria-describedby={errId}>
            {options.map((o) => (
              <label key={o.label} className="flex cursor-pointer items-center gap-2.5 text-sm text-ink-2">
                <input
                  type="radio"
                  name={item.id}
                  checked={text === o.label}
                  onChange={() => onChange(o.label)}
                  className="h-4 w-4 accent-[var(--primary)]"
                />
                {o.label}
              </label>
            ))}
            {item.allowOther && (
              <label className="flex cursor-pointer items-center gap-2.5 text-sm text-ink-2">
                <input
                  type="radio"
                  name={item.id}
                  checked={text === OTHER_VALUE}
                  onChange={() => onChange(OTHER_VALUE)}
                  className="h-4 w-4 accent-[var(--primary)]"
                />
                <span>Other:</span>
                <input
                  value={otherText}
                  onChange={(e) => {
                    onOther(e.target.value);
                    onChange(OTHER_VALUE); // typing IS choosing it — Google does the same
                  }}
                  className="h-8 min-w-0 flex-1 rounded-field border-0 border-b border-line bg-transparent px-1 text-sm outline-none focus:border-primary"
                />
              </label>
            )}
          </div>
        );

      case "checkboxes":
        return (
          <div className="space-y-1.5" aria-describedby={errId}>
            {options.map((o) => (
              <label key={o.label} className="flex cursor-pointer items-center gap-2.5 text-sm text-ink-2">
                <input
                  type="checkbox"
                  checked={list.includes(o.label)}
                  onChange={(e) => onToggle(o.label, e.target.checked)}
                  className="h-4 w-4 accent-[var(--primary)]"
                />
                {o.label}
              </label>
            ))}
            {item.allowOther && (
              <label className="flex cursor-pointer items-center gap-2.5 text-sm text-ink-2">
                <input
                  type="checkbox"
                  checked={list.includes(OTHER_VALUE)}
                  onChange={(e) => onToggle(OTHER_VALUE, e.target.checked)}
                  className="h-4 w-4 accent-[var(--primary)]"
                />
                <span>Other:</span>
                <input
                  value={otherText}
                  onChange={(e) => onOther(e.target.value)}
                  className="h-8 min-w-0 flex-1 rounded-field border-0 border-b border-line bg-transparent px-1 text-sm outline-none focus:border-primary"
                />
              </label>
            )}
          </div>
        );

      case "checkbox":
        return (
          <label className="flex cursor-pointer items-center gap-2.5 text-sm text-ink-2">
            <input
              type="checkbox"
              checked={text === "Yes"}
              onChange={(e) => onChange(e.target.checked ? "Yes" : "")}
              aria-describedby={errId}
              className="h-4 w-4 accent-[var(--primary)]"
            />
            {item.placeholder || "Yes"}
          </label>
        );

      case "scale": {
        const min = item.scaleMin ?? 1;
        const max = item.scaleMax ?? 5;
        const steps = Array.from({ length: Math.max(0, max - min + 1) }, (_, i) => min + i);
        return (
          <div className="flex items-center gap-3" role="radiogroup" aria-describedby={errId}>
            {item.scaleMinLabel && <span className="flex-none text-caption text-ink-3">{item.scaleMinLabel}</span>}
            <div className="flex flex-1 flex-wrap justify-center gap-x-4 gap-y-2">
              {steps.map((n) => (
                <label key={n} className="flex cursor-pointer flex-col items-center gap-1 text-caption text-ink-2">
                  {n}
                  <input
                    type="radio"
                    name={item.id}
                    checked={text === String(n)}
                    onChange={() => onChange(String(n))}
                    className="h-4 w-4 accent-[var(--primary)]"
                  />
                </label>
              ))}
            </div>
            {item.scaleMaxLabel && <span className="flex-none text-caption text-ink-3">{item.scaleMaxLabel}</span>}
          </div>
        );
      }

      case "rating": {
        const max = item.scaleMax ?? 5;
        const current = Number(text) || 0;
        return (
          <div className="flex items-center gap-1" aria-describedby={errId}>
            {Array.from({ length: max }, (_, i) => i + 1).map((n) => (
              <button
                key={n}
                type="button"
                // Clicking the current rating clears it — otherwise an optional rating is
                // impossible to un-answer once touched.
                onClick={() => onChange(current === n ? "" : String(n))}
                aria-label={`${n} of ${max}`}
                aria-pressed={current >= n}
                className="rounded p-0.5 text-warn transition-transform hover:scale-110"
              >
                <Star size={26} fill={current >= n ? "currentColor" : "none"} strokeWidth={1.5} />
              </button>
            ))}
          </div>
        );
      }

      case "date":
        return (
          <input
            type={item.includeTime ? "datetime-local" : "date"}
            value={text}
            onChange={(e) => onChange(e.target.value)}
            aria-describedby={errId}
            className={INPUT_CLS}
          />
        );

      case "time":
        return (
          <input
            type="time"
            value={text}
            onChange={(e) => onChange(e.target.value)}
            aria-describedby={errId}
            className={INPUT_CLS}
          />
        );

      default: {
        const input = fieldKindProps<HTMLInputElement>(kind, (e) => onChange(e.target.value));
        return (
          <input
            {...input.attrs}
            value={text}
            onChange={input.onChange}
            // Still derived from the declared type: it matches what the kind sets for email/phone,
            // and it is the only thing giving `number` its numeric keypad.
            type={item.type === "phone" ? "tel" : item.type}
            placeholder={item.placeholder}
            aria-describedby={errId}
            className={INPUT_CLS}
          />
        );
      }
    }
  })();

  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-ink">
        {item.label}
        {item.required && <span className="text-bad"> *</span>}
      </label>
      {item.description && <p className="mb-2 text-caption text-muted">{item.description}</p>}
      {field}
      {error && (
        <p id={errId} className="mt-1.5 text-caption font-medium text-bad">
          {error}
        </p>
      )}
    </div>
  );
}

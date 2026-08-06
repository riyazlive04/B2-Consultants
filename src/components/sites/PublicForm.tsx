"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, CheckCircle2, ChevronDown, Star, Upload, X, Eraser } from "lucide-react";
import type { PublicForm as PublicFormType } from "@/server/forms-metrics";
import {
  isStaticItem,
  nextPageIndex,
  pagesOf,
  validateAnswer,
  hiddenValueFor,
  OTHER_VALUE,
  otherFieldName,
  type FormAnswers,
  type FormAnswerValue,
  type FormFieldType,
  type FormItem,
  type FormPage,
} from "@/lib/sites-types";
import {
  COUNTRIES, DEFAULT_COUNTRY, countryByIso, flagOf, joinPhone, splitPhone,
} from "@/lib/phone-countries";
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
  bare = false,
}: {
  form: PublicFormType;
  utm?: Record<string, string>;
  /**
   * Drop the form's own card (border, background, shadow) because something else is already
   * providing it — the popup, which IS a white card. Without this the dialog shows a card inside
   * a card, the visual tell of two components each assuming they own the surface.
   */
  bare?: boolean;
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
  const mountedAt = useRef(Date.now());

  /**
   * Seed the hidden fields from the visitor's own URL.
   *
   * Read here rather than threaded down from the page, because `hiddenFrom` may name ANY query
   * parameter — an ad id, a partner code — and the page only knows about the five `utm_*` keys.
   * Runs once: a hidden value is what the visitor arrived with, and re-reading it later would
   * mean a client-side navigation could quietly change what a half-filled form is about to say.
   */
  useEffect(() => {
    const hidden = form.fields.filter((f) => f.type === "hidden");
    if (hidden.length === 0) return;
    const params = new URLSearchParams(window.location.search);
    const incoming: Record<string, string> = {};
    params.forEach((v, k) => { incoming[k] = v; });
    setAnswers((a) => {
      const next = { ...a };
      for (const f of hidden) next[f.key] = hiddenValueFor(f, incoming);
      return next;
    });
  }, [form.fields]);

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
    // The "Bot Protection" element's timing half — see submitPublicForm. Stamped when the form
    // mounted, not when it was submitted, so it measures how long the page was actually open.
    fd.set("form_started_at", String(mountedAt.current));

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
      <div className={bare ? "p-2 text-center" : "rounded-card border border-line bg-surface p-8 text-center shadow-card"}>
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
      className={bare ? "space-y-5" : "space-y-5 rounded-card border border-line bg-surface p-6 shadow-card"}
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
          formSlug={form.slug}
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
  formSlug,
  onChange,
  onToggle,
  onOther,
}: {
  item: FormItem;
  value: FormAnswerValue | undefined;
  otherText: string;
  error?: string;
  seed: number;
  /** Needed by the file field: the upload endpoint refuses anything not bound to a real form. */
  formSlug: string;
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
  if (item.type === "html") {
    /**
     * Raw markup on a PUBLIC form, rendered unescaped — that IS the feature, the same contract as
     * the page builder's Custom HTML block. The boundary is at authoring time: only a signed-in
     * admin with the forms capability can put one here.
     */
    return item.html ? <div data-item={item.id} data-item-type="html" dangerouslySetInnerHTML={{ __html: item.html }} /> : null;
  }
  /**
   * The three invisible elements.
   *
   * They render as nothing on the live form — which is right there and useless in the BUILDER,
   * where an author cannot select what has no box. Each still emits `data-item-type` so the
   * canvas can style it into a labelled placeholder; see FormCanvas. Dropping the attribute here
   * would make a form's own machinery unselectable in the tool that is supposed to edit it.
   */
  if (item.type === "captcha") {
    // No visible control by design. The trap and the timestamp are on the <form>; this element's
    // only job is to say "this form is protected", which it does by existing.
    return <div data-item={item.id} data-item-type="captcha" className="sr-only" aria-hidden />;
  }
  if (item.type === "hidden") {
    // Rendered as nothing. Its value rides in the answers, seeded from the URL on mount.
    return <div data-item={item.id} data-item-type="hidden" className="hidden" aria-hidden />;
  }
  if (item.type === "score") {
    // Computed server-side at submit; nothing to show and nothing to post.
    return <div data-item={item.id} data-item-type="score" className="hidden" aria-hidden />;
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

      case "terms":
        return (
          <label className="flex cursor-pointer items-start gap-2.5 text-sm text-ink-2">
            <input
              type="checkbox"
              // "yes", not "Yes": the server checks this exact token, and the two spellings
              // drifting apart would silently reject every consent on the form.
              checked={text === "yes"}
              onChange={(e) => onChange(e.target.checked ? "yes" : "")}
              aria-describedby={errId}
              className="mt-0.5 h-4 w-4 flex-none accent-[var(--primary)]"
            />
            <span>
              {item.termsText || item.label}
              {item.termsUrl && (
                <>
                  {" "}
                  <a href={item.termsUrl} target="_blank" rel="noopener noreferrer" className="font-medium text-primary underline">
                    Read them
                  </a>
                </>
              )}
            </span>
          </label>
        );

      case "monetary": {
        const symbol = item.currency === "EUR" ? "€" : "₹";
        return (
          <span className="relative block">
            <span aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-ink-3">
              {symbol}
            </span>
            <input
              type="text"
              inputMode="decimal"
              value={text}
              onChange={(e) => onChange(e.target.value)}
              placeholder={item.placeholder ?? "0"}
              aria-describedby={errId}
              className={`${INPUT_CLS} pl-7`}
            />
          </span>
        );
      }

      case "file":
        return <FileField item={item} value={text} formSlug={formSlug} errId={errId} onChange={onChange} />;

      case "signature":
        return <SignatureField value={text} errId={errId} onChange={onChange} />;

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

      case "phone":
        return <PhoneField item={item} value={text} errId={errId} onChange={onChange} />;

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
            // Still derived from the declared type — it is what gives `number` its numeric
            // keypad. `phone` no longer reaches here: it has its own country-code control above.
            type={item.type}
            placeholder={item.placeholder}
            aria-describedby={errId}
            className={INPUT_CLS}
          />
        );
      }
    }
  })();

  return (
    /**
     * `data-item` is what lets the BUILDER edit this form by pointing at it.
     *
     * Same trick, and the same reasoning, as `data-n` on the page builder's blocks: the canvas
     * mounts this exact component — the production renderer — and derives selection from one
     * delegated click that walks up to the nearest `[data-item]`. The alternative is a second
     * "preview" renderer, and the two always drift. It costs a handful of bytes on the public
     * page and it is what keeps what-you-click identical to what-ships.
     */
    <div data-item={item.id} data-item-type={item.type}>
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

/**
 * Phone number with a country selector — the control the GHL opt-in uses, and the one people
 * expect the moment a form asks for a number they might be dialling from anywhere.
 *
 * ── Why one stored string, not two fields ─────────────────────────────────────────────────────
 * The answer stays `+91 9876543210`: a single string that every downstream consumer already
 * understands. `upsertIntakeLead` dedupes on a NORMALISED phone, WATI sends to a full
 * international number, and the sheet exports one column. Splitting the model in two would mean
 * teaching every one of those about a country column for no gain — so the split lives in the
 * control, and `splitPhone`/`joinPhone` are the only code that knows about it.
 *
 * ── Why a native <select> ─────────────────────────────────────────────────────────────────────
 * 240 options on an unknown device, on the intake path. The OS picker is searchable, scrollable
 * and already known to every screen reader and every thumb; a custom popover here would be a
 * rebuild of something the platform does better, on the one screen where a stranger is trying to
 * give us their details.
 */
function PhoneField({
  item, value, errId, onChange,
}: {
  item: FormItem;
  value: string;
  errId?: string;
  onChange: (v: FormAnswerValue) => void;
}) {
  const parsed = splitPhone(value, item.defaultCountry || DEFAULT_COUNTRY);
  // The chosen country is held locally as well as derived, so picking a country BEFORE typing a
  // number sticks. Derived alone, it would snap back the moment the (still empty) value re-parsed.
  const [iso2, setIso2] = useState(parsed.iso2);
  const current = countryByIso(iso2);

  return (
    <div className={`flex items-stretch overflow-hidden rounded-field border border-line bg-surface focus-within:border-primary`}>
      <span className="relative flex items-center border-r border-line pl-3 pr-1">
        <span aria-hidden className="pointer-events-none flex items-center gap-1 text-sm">
          <span className="text-base leading-none">{flagOf(current.iso2)}</span>
          <span className="text-ink-2">+{current.dial}</span>
          <ChevronDown size={13} className="text-ink-3" />
        </span>
        <select
          aria-label="Country code"
          value={iso2}
          onChange={(e) => {
            setIso2(e.target.value);
            // Recombine immediately so the stored answer follows the country even when the
            // number was typed first.
            onChange(joinPhone(e.target.value, parsed.national));
          }}
          className="absolute inset-0 cursor-pointer opacity-0"
        >
          {COUNTRIES.map((c) => (
            <option key={c.iso2} value={c.iso2}>
              {c.name} (+{c.dial})
            </option>
          ))}
        </select>
      </span>
      <input
        type="tel"
        inputMode="tel"
        autoComplete="tel-national"
        value={parsed.national}
        onChange={(e) => onChange(joinPhone(iso2, e.target.value))}
        placeholder={item.placeholder || "Enter Your Phone Number"}
        aria-describedby={errId}
        className="h-11 min-w-0 flex-1 bg-transparent px-3 text-sm outline-none"
      />
    </div>
  );
}

/**
 * File upload.
 *
 * Uploads IMMEDIATELY on choose rather than carrying the bytes to submit, because the submit path
 * is a server action and an action argument is serialised whole — a 10 MB CV would ride inside
 * the form post. So the answer this field holds is the resulting URL, and by the time anyone
 * presses submit the file is already stored.
 */
function FileField({
  item, value, formSlug, errId, onChange,
}: {
  item: FormItem;
  value: string;
  formSlug: string;
  errId?: string;
  onChange: (v: FormAnswerValue) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [err, setErr] = useState<string | null>(null);

  async function pick(file: File | undefined) {
    if (!file) return;
    setErr(null);
    setBusy(true);
    try {
      const fd = new FormData();
      fd.set("file", file);
      fd.set("form", formSlug);
      fd.set("item", item.id);
      const res = await fetch("/api/form-upload", { method: "POST", body: fd });
      const json = (await res.json()) as { ok: boolean; url?: string; name?: string; error?: string };
      if (!json.ok || !json.url) throw new Error(json.error || "Upload failed");
      onChange(json.url);
      setName(json.name ?? file.name);
    } catch (e) {
      // Shown here rather than thrown: the respondent can retry, and a failed attachment must not
      // look like a failed form.
      setErr(e instanceof Error ? e.message : "Upload failed");
      onChange("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      {value ? (
        <div className="flex items-center gap-2 rounded-field border border-line bg-surface-2 px-3 py-2 text-sm">
          <span className="min-w-0 flex-1 truncate text-ink-2">{name || "Uploaded"}</span>
          <button
            type="button"
            onClick={() => { onChange(""); setName(""); }}
            aria-label="Remove the file"
            className="text-ink-3 hover:text-bad"
          >
            <X size={15} />
          </button>
        </div>
      ) : (
        <label className="flex cursor-pointer items-center justify-center gap-2 rounded-field border border-dashed border-line bg-surface px-3 py-4 text-sm text-ink-2 hover:border-primary">
          {busy ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
          {busy ? "Uploading…" : item.placeholder || "Choose a file"}
          <input
            type="file"
            accept={item.accept}
            aria-describedby={errId}
            className="sr-only"
            onChange={(e) => void pick(e.target.files?.[0])}
            disabled={busy}
          />
        </label>
      )}
      <p className="text-caption text-muted">PDF, Word or image · up to {item.maxSizeMb ?? 10} MB</p>
      {err && <p className="text-caption font-medium text-bad">{err}</p>}
    </div>
  );
}

/**
 * Signature pad.
 *
 * Plain pointer events on a <canvas>, no library: the whole interaction is down-move-up, and a
 * dependency here would ship on a public landing page for the sake of forty lines.
 *
 * Pointer events rather than mouse+touch pairs so a stylus, a finger and a mouse are one code
 * path; `touch-none` stops the browser scrolling the page while someone is signing on a phone,
 * which otherwise makes the field impossible to use on exactly the device most people are on.
 */
function SignatureField({
  value, errId, onChange,
}: {
  value: string;
  errId?: string;
  onChange: (v: FormAnswerValue) => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);

  function pos(e: React.PointerEvent<HTMLCanvasElement>) {
    const c = ref.current!;
    const r = c.getBoundingClientRect();
    // The canvas is drawn at its backing-store size but laid out at CSS size; without this scale
    // the ink lands away from the fingertip on any display that isn't 1:1.
    return { x: (e.clientX - r.left) * (c.width / r.width), y: (e.clientY - r.top) * (c.height / r.height) };
  }

  function start(e: React.PointerEvent<HTMLCanvasElement>) {
    const c = ref.current;
    if (!c) return;
    drawing.current = true;
    c.setPointerCapture(e.pointerId);
    const ctx = c.getContext("2d")!;
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#111827";
    const { x, y } = pos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  }

  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const ctx = ref.current!.getContext("2d")!;
    const { x, y } = pos(e);
    ctx.lineTo(x, y);
    ctx.stroke();
  }

  function end() {
    if (!drawing.current) return;
    drawing.current = false;
    // Committed on stroke end, not per point: a data URL per pixel of movement would re-render
    // the whole form on every frame of the signature.
    onChange(ref.current!.toDataURL("image/png"));
  }

  function clear() {
    const c = ref.current;
    if (!c) return;
    c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
    onChange("");
  }

  return (
    <div className="space-y-2">
      <canvas
        ref={ref}
        width={600}
        height={180}
        aria-describedby={errId}
        aria-label="Sign here"
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerLeave={end}
        className="h-[140px] w-full touch-none rounded-field border border-line bg-surface"
      />
      <button type="button" onClick={clear} className="inline-flex items-center gap-1.5 text-caption font-semibold text-ink-3 hover:text-primary">
        <Eraser size={13} /> Clear
      </button>
      {!value && <p className="text-caption text-muted">Sign in the box above using your finger or mouse.</p>}
    </div>
  );
}

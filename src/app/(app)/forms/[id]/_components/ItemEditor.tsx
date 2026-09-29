"use client";

import {
  Copy,
  GripVertical,
  Trash2,
  ArrowUp,
  ArrowDown,
  Plus,
  X,
  CornerDownRight,
} from "lucide-react";
import {
  FIELD_TYPE_GROUPS,
  fieldTypeLabel,
  isChoiceItem,
  isStaticItem,
  type FormItem,
  type FormFieldType,
  type FormOption,
  type FormValidation,
} from "@/lib/sites-types";
import { COUNTRIES, DEFAULT_COUNTRY } from "@/lib/phone-countries";
import { Btn, IconButton, Switch } from "@/components/ui/controls";
import { Select } from "@/components/ui/form";

/**
 * One question card in the builder - Google Forms' expanding item.
 *
 * The old builder showed every question as the same four boxes (label, key, type, placeholder)
 * whatever the type was, which is precisely why picking "Checkbox" did not feel like picking a
 * checkbox: nothing about the editor changed, so nothing about the question appeared to change
 * either. Here the body of the card IS the type - choosing "Multiple choice" produces an option
 * list, choosing "Linear scale" produces bounds and end labels, and choosing "Section" produces a
 * page break with a destination.
 *
 * Collapsed cards show a one-line summary. A form with twenty questions is otherwise a scroll.
 */

const inputCls =
  "h-9 w-full rounded-field border border-line bg-surface px-3 text-sm outline-none focus:border-primary";
const labelCls = "block text-caption font-semibold uppercase tracking-wide text-ink-3";

/** Grouped type list, flattened with disabled headers - SelectMenu has no optgroup. */
const TYPE_OPTIONS = FIELD_TYPE_GROUPS.flatMap((g) => [
  { value: `__group_${g.group}`, label: `- ${g.group} -`, disabled: true },
  ...g.types.map((t) => ({ value: t.value, label: t.label })),
]);

export function ItemEditor({
  item,
  index,
  total,
  open,
  laterSections,
  onOpen,
  onChange,
  onMove,
  onDuplicate,
  onDelete,
  variant = "card",
  scoring = false,
}: {
  item: FormItem;
  index: number;
  total: number;
  open: boolean;
  /**
   * `card` is the stacked outline view: a collapsed header you click to open.
   * `panel` is the builder's right-hand inspector, where the selection has already been made by
   * clicking the field ON the form - so there is no header to click and nothing to collapse.
   *
   * A variant rather than a second component. These are ~240 lines of per-type editors, and the
   * one thing worse than a prop here would be two copies of them drifting apart, so that the
   * inspector quietly stops offering an option the outline view still has.
   */
  variant?: "card" | "panel";
  /** True when the form has a Score element, which is what makes per-option points meaningful. */
  scoring?: boolean;
  /** Sections after this item - the only legal branch targets. See sites-types. */
  laterSections: { id: string; label: string }[];
  onOpen: () => void;
  onChange: (patch: Partial<FormItem>) => void;
  onMove: (dir: -1 | 1) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const isSection = item.type === "section";
  const options = item.options ?? [];

  function setOption(i: number, patch: Partial<FormOption>) {
    onChange({ options: options.map((o, idx) => (idx === i ? { ...o, ...patch } : o)) });
  }
  function addOption() {
    onChange({ options: [...options, { label: `Option ${options.length + 1}` }] });
  }
  function removeOption(i: number) {
    onChange({ options: options.filter((_, idx) => idx !== i) });
  }

  const summary = isStaticItem(item.type)
    ? fieldTypeLabel(item.type)
    : `${fieldTypeLabel(item.type)}${item.required ? " · required" : ""} · ${item.key || "no key"}`;

  const panel = variant === "panel";

  return (
    <div
      className={
        panel
          ? "bg-transparent"
          : `rounded-card border bg-surface transition-shadow ${
              open ? "border-primary shadow-card" : "border-line hover:border-line-strong"
            } ${isSection ? "border-l-4 border-l-primary" : ""}`
      }
    >
      {/* Collapsed header - click anywhere to open. Absent in the inspector, where selecting the
          field on the canvas IS the act of opening it. */}
      {!panel && (
        <button
          type="button"
          onClick={onOpen}
          aria-expanded={open}
          className="flex w-full items-center gap-2 px-3 py-2.5 text-left"
        >
          <GripVertical size={15} aria-hidden className="flex-none text-ink-3" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-ink">
              {item.label || <span className="text-ink-3">Untitled</span>}
              {item.required && <span className="text-bad"> *</span>}
            </span>
            {!open && <span className="block truncate text-caption text-ink-3" title={summary}>{summary}</span>}
          </span>
        </button>
      )}

      {(open || panel) && (
        <div className={panel ? "space-y-3" : "space-y-3 border-t border-line p-3"}>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_200px]">
            <label className={labelCls}>
              {isSection ? "Section title" : item.type === "heading" ? "Title" : "Question"}
              <input
                className={inputCls}
                value={item.label}
                onChange={(e) => onChange({ label: e.target.value })}
                placeholder={isSection ? "Section title" : "What do you want to ask?"}
              />
            </label>
            <label className={labelCls}>
              Type
              <Select
                value={item.type}
                onChange={(e) => onChange(retypePatch(item, e.target.value as FormFieldType))}
                options={TYPE_OPTIONS}
              />
            </label>
          </div>

          <label className={labelCls}>
            Description <span className="font-normal normal-case text-ink-3">(optional help text)</span>
            <input
              className={inputCls}
              value={item.description ?? ""}
              onChange={(e) => onChange({ description: e.target.value })}
            />
          </label>

          {!isStaticItem(item.type) && (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <label className={labelCls}>
                Answer key
                <input
                  className={inputCls}
                  value={item.key}
                  onChange={(e) => onChange({ key: e.target.value })}
                />
              </label>
              {PLACEHOLDER_TYPES.has(item.type) && (
                <label className={labelCls}>
                  {item.type === "checkbox" ? "Tick-box wording" : "Placeholder"}
                  <input
                    className={inputCls}
                    value={item.placeholder ?? ""}
                    onChange={(e) => onChange({ placeholder: e.target.value })}
                  />
                </label>
              )}
            </div>
          )}

          {/* ── Per-type body ─────────────────────────────────────────────────── */}

          {isChoiceItem(item.type) && (
            <div className="rounded-field border border-line p-2.5">
              <p className={labelCls}>Options</p>
              <div className="mt-1.5 space-y-1.5">
                {options.map((o, i) => (
                  <div key={i} className="flex items-center gap-1.5">
                    <span aria-hidden className="flex-none text-ink-3">
                      {item.type === "checkboxes" ? "☐" : "○"}
                    </span>
                    <input
                      className={`${inputCls} flex-1`}
                      value={o.label}
                      onChange={(e) => setOption(i, { label: e.target.value })}
                    />
                    {/* Branching lives per OPTION, and only where picking one answer can
                        meaningfully route - a multi-select has no single destination. */}
                    {(item.type === "radio" || item.type === "select") && laterSections.length > 0 && (
                      <span className="flex flex-none items-center gap-1" title="Go to section based on this answer">
                        <CornerDownRight size={14} aria-hidden className="text-ink-3" />
                        <Select
                          size="sm"
                          value={o.goTo ?? ""}
                          onChange={(e) => setOption(i, { goTo: e.target.value || undefined })}
                          options={[
                            { value: "", label: "Continue" },
                            ...laterSections.map((s) => ({ value: s.id, label: `Go to ${s.label}` })),
                            { value: "submit", label: "Submit form" },
                          ]}
                        />
                      </span>
                    )}
                    {/* Points this option contributes to the form's Score element. Only shown
                        once such an element exists - a score box on every option of every form
                        would be noise on the 95% of forms that never score anything. */}
                    {scoring && (
                      <input
                        type="number"
                        title="Points this option adds to the score"
                        aria-label={`Points for ${o.label}`}
                        className="h-9 w-14 flex-none rounded-field border border-line bg-surface px-2 text-center text-sm tabular-nums outline-none focus:border-primary"
                        value={o.score ?? ""}
                        placeholder="0"
                        onChange={(e) => setOption(i, { score: e.target.value === "" ? undefined : Number(e.target.value) })}
                      />
                    )}
                    <IconButton label="Remove option" onClick={() => removeOption(i)}>
                      <X size={14} />
                    </IconButton>
                  </div>
                ))}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <Btn size="sm" variant="ghost" icon={<Plus size={14} />} onClick={addOption}>
                  Add option
                </Btn>
                <label className="flex items-center gap-2 text-sm text-ink-2">
                  <input
                    type="checkbox"
                    checked={!!item.allowOther}
                    onChange={(e) => onChange({ allowOther: e.target.checked })}
                    className="h-4 w-4 accent-[var(--primary)]"
                  />
                  Add “Other”
                </label>
                <label className="flex items-center gap-2 text-sm text-ink-2">
                  <input
                    type="checkbox"
                    checked={!!item.shuffle}
                    onChange={(e) => onChange({ shuffle: e.target.checked })}
                    className="h-4 w-4 accent-[var(--primary)]"
                  />
                  Shuffle order
                </label>
              </div>
            </div>
          )}

          {(item.type === "scale" || item.type === "rating") && (
            <div className="grid grid-cols-2 gap-2 rounded-field border border-line p-2.5 sm:grid-cols-4">
              {item.type === "scale" && (
                <label className={labelCls}>
                  From
                  <Select
                    value={String(item.scaleMin ?? 1)}
                    onChange={(e) => onChange({ scaleMin: Number(e.target.value) })}
                    options={[0, 1].map((n) => ({ value: String(n), label: String(n) }))}
                  />
                </label>
              )}
              <label className={labelCls}>
                To
                <Select
                  value={String(item.scaleMax ?? 5)}
                  onChange={(e) => onChange({ scaleMax: Number(e.target.value) })}
                  options={Array.from({ length: item.type === "rating" ? 8 : 9 }, (_, i) => i + 3).map((n) => ({
                    value: String(n),
                    label: String(n),
                  }))}
                />
              </label>
              {item.type === "scale" && (
                <>
                  <label className={labelCls}>
                    Label at {item.scaleMin ?? 1}
                    <input
                      className={inputCls}
                      value={item.scaleMinLabel ?? ""}
                      onChange={(e) => onChange({ scaleMinLabel: e.target.value })}
                    />
                  </label>
                  <label className={labelCls}>
                    Label at {item.scaleMax ?? 5}
                    <input
                      className={inputCls}
                      value={item.scaleMaxLabel ?? ""}
                      onChange={(e) => onChange({ scaleMaxLabel: e.target.value })}
                    />
                  </label>
                </>
              )}
            </div>
          )}

          {item.type === "date" && (
            <label className="flex items-center justify-between rounded-field border border-line p-2.5 text-sm font-medium text-ink">
              Include a time as well as a date
              <Switch checked={!!item.includeTime} onChange={(v) => onChange({ includeTime: v })} />
            </label>
          )}

          {item.type === "hidden" && (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <label className={labelCls}>
                Read from URL parameter
                <input
                  className={inputCls}
                  value={item.hiddenFrom ?? ""}
                  onChange={(e) => onChange({ hiddenFrom: e.target.value || undefined })}
                  placeholder="utm_source"
                />
              </label>
              <label className={labelCls}>
                Fallback value
                <input
                  className={inputCls}
                  value={item.hiddenValue ?? ""}
                  onChange={(e) => onChange({ hiddenValue: e.target.value || undefined })}
                  placeholder="Used when the URL carries nothing"
                />
              </label>
              <p className="text-caption text-ink-3 sm:col-span-2">
                Never shown to the respondent. Lands on the contact under the key <b>{item.key || "-"}</b>.
              </p>
            </div>
          )}

          {item.type === "score" && (
            <p className="rounded-field bg-primary-soft px-3 py-2 text-caption text-primary-strong">
              Set points per option on the choice questions above. The total is worked out when the form is
              submitted - it is never sent by the browser, so it can&apos;t be tampered with.
            </p>
          )}

          {item.type === "captcha" && (
            <p className="rounded-field bg-primary-soft px-3 py-2 text-caption text-primary-strong">
              Adds a hidden trap field and a timing check. Nothing is shown to the respondent and there is
              nothing to solve - no third-party captcha, no cookie banner.
            </p>
          )}

          {item.type === "phone" && (
            <label className={labelCls}>
              Country the picker opens on
              <Select
                value={item.defaultCountry ?? DEFAULT_COUNTRY}
                onChange={(e) => onChange({ defaultCountry: e.target.value })}
                options={COUNTRIES.map((c) => ({ value: c.iso2, label: `${c.name} (+${c.dial})` }))}
              />
              <span className="mt-1 block text-caption font-normal normal-case text-ink-3">
                Respondents can pick any country; this is only where the list starts.
              </span>
            </label>
          )}

          {item.type === "monetary" && (
            <label className={labelCls}>
              Currency
              <Select
                value={item.currency ?? "INR"}
                onChange={(e) => onChange({ currency: e.target.value === "EUR" ? "EUR" : "INR" })}
                options={[{ value: "INR", label: "₹ Indian rupee" }, { value: "EUR", label: "€ Euro" }]}
              />
            </label>
          )}

          {item.type === "file" && (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <label className={labelCls}>
                Accepted types
                <input
                  className={inputCls}
                  value={item.accept ?? ""}
                  onChange={(e) => onChange({ accept: e.target.value || undefined })}
                  placeholder=".pdf,.doc,.docx,image/*"
                />
              </label>
              <label className={labelCls}>
                Max size (MB)
                <input
                  type="number"
                  min={1}
                  max={10}
                  className={inputCls}
                  value={item.maxSizeMb ?? 10}
                  onChange={(e) => onChange({ maxSizeMb: Number(e.target.value) || 10 })}
                />
              </label>
              <p className="text-caption text-ink-3 sm:col-span-2">
                The server accepts PDF, Word and images up to 10 MB and checks the real file contents, so this
                box narrows what is offered rather than what is allowed.
              </p>
            </div>
          )}

          {item.type === "terms" && (
            <div className="grid grid-cols-1 gap-2">
              <label className={labelCls}>
                Consent wording
                <textarea
                  className={`${inputCls} h-auto py-2`}
                  rows={2}
                  value={item.termsText ?? ""}
                  onChange={(e) => onChange({ termsText: e.target.value })}
                />
              </label>
              <label className={labelCls}>
                Link to the terms (optional)
                <input
                  className={inputCls}
                  value={item.termsUrl ?? ""}
                  onChange={(e) => onChange({ termsUrl: e.target.value || undefined })}
                  placeholder="https://…/terms"
                />
              </label>
              <p className="text-caption text-ink-3">Always required - consent that can be skipped is not consent.</p>
            </div>
          )}

          {item.type === "html" && (
            <label className={labelCls}>
              HTML
              <textarea
                className={`${inputCls} h-auto py-2 font-mono text-xs`}
                rows={6}
                value={item.html ?? ""}
                onChange={(e) => onChange({ html: e.target.value })}
              />
              <span className="mt-1 block text-caption font-normal normal-case text-ink-3">
                Rendered exactly as written, scripts included. Only paste markup you trust - it runs on the live
                form with no sandbox.
              </span>
            </label>
          )}

          {item.type === "image" && (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <label className={labelCls}>
                Image URL
                <input
                  className={inputCls}
                  value={item.imageUrl ?? ""}
                  onChange={(e) => onChange({ imageUrl: e.target.value })}
                  placeholder="https://…"
                />
              </label>
              <label className={labelCls}>
                Alt text
                <input
                  className={inputCls}
                  value={item.imageAlt ?? ""}
                  onChange={(e) => onChange({ imageAlt: e.target.value })}
                />
              </label>
            </div>
          )}

          {isSection && (
            <label className={labelCls}>
              After this section
              <Select
                value={item.goTo ?? ""}
                onChange={(e) => onChange({ goTo: e.target.value || undefined })}
                options={[
                  { value: "", label: "Continue to the next section" },
                  ...laterSections.map((s) => ({ value: s.id, label: `Go to ${s.label}` })),
                  { value: "submit", label: "Submit the form" },
                ]}
              />
            </label>
          )}

          {!isStaticItem(item.type) && (
            <ValidationEditor item={item} onChange={(validation) => onChange({ validation })} />
          )}

          {/* ── Card footer ───────────────────────────────────────────────────── */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-2.5">
            {isStaticItem(item.type) ? (
              <span className="text-caption text-ink-3">Collects no answer</span>
            ) : (
              <label className="flex items-center gap-2 text-sm font-medium text-ink">
                Required
                <Switch checked={!!item.required} onChange={(v) => onChange({ required: v })} />
              </label>
            )}
            <div className="flex items-center gap-1">
              <IconButton label="Move up" onClick={() => onMove(-1)} disabled={index === 0}>
                <ArrowUp size={15} />
              </IconButton>
              <IconButton label="Move down" onClick={() => onMove(1)} disabled={index === total - 1}>
                <ArrowDown size={15} />
              </IconButton>
              <IconButton label="Duplicate" onClick={onDuplicate}>
                <Copy size={15} />
              </IconButton>
              <IconButton label="Delete" onClick={onDelete}>
                <Trash2 size={15} />
              </IconButton>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Types where a placeholder (or tick-box wording) is a real thing to set. */
const PLACEHOLDER_TYPES = new Set<FormFieldType>(["text", "textarea", "email", "phone", "number", "checkbox"]);

/**
 * Changing a question's type has to clean up after the old one.
 *
 * Leaving a stale `options` array on a question that is now a date, or a stale `scaleMax` on one
 * that is now free text, is invisible in the builder and then surfaces months later when someone
 * switches the type back and finds options they deleted. Blank the settings that no longer apply,
 * and seed the ones the new type needs.
 */
function retypePatch(item: FormItem, type: FormFieldType): Partial<FormItem> {
  const patch: Partial<FormItem> = { type };

  if (isChoiceItem(type)) {
    patch.options = (item.options ?? []).length ? item.options : [{ label: "Option 1" }];
  } else {
    patch.options = undefined;
    patch.allowOther = false;
    patch.shuffle = false;
  }
  if (type === "scale") {
    patch.scaleMin = item.scaleMin ?? 1;
    patch.scaleMax = item.scaleMax ?? 5;
  } else if (type === "rating") {
    patch.scaleMax = item.scaleMax ?? 5;
    patch.scaleMin = undefined;
    patch.scaleMinLabel = undefined;
    patch.scaleMaxLabel = undefined;
  } else {
    patch.scaleMin = undefined;
    patch.scaleMax = undefined;
    patch.scaleMinLabel = undefined;
    patch.scaleMaxLabel = undefined;
  }
  if (type !== "date") patch.includeTime = false;
  if (type !== "image") {
    patch.imageUrl = undefined;
    patch.imageAlt = undefined;
  }
  if (type !== "section") patch.goTo = undefined;
  if (isStaticItem(type)) {
    patch.key = "";
    patch.required = false;
  }
  // A rule that no longer applies to the new type would silently reject valid answers.
  if (!validationKindsFor(type).includes(item.validation?.kind ?? "none")) patch.validation = undefined;
  return patch;
}

type ValidationKind = FormValidation["kind"] | "none";

function validationKindsFor(type: FormFieldType): ValidationKind[] {
  if (type === "number") return ["none", "number"];
  if (type === "checkboxes") return ["none", "count"];
  if (type === "text" || type === "textarea") return ["none", "length", "regex"];
  return ["none"];
}

function ValidationEditor({
  item,
  onChange,
}: {
  item: FormItem;
  onChange: (v: FormValidation | undefined) => void;
}) {
  const kinds = validationKindsFor(item.type);
  if (kinds.length < 2) return null;
  const kind: ValidationKind = item.validation?.kind ?? "none";

  const numInput = (
    label: string,
    value: number | undefined,
    set: (n: number | undefined) => void,
  ) => (
    <label className={labelCls}>
      {label}
      <input
        type="number"
        className={inputCls}
        value={value ?? ""}
        onChange={(e) => set(e.target.value === "" ? undefined : Number(e.target.value))}
      />
    </label>
  );

  const v = item.validation;
  const patch = (next: Partial<FormValidation>) =>
    onChange({ ...(v as FormValidation), ...next } as FormValidation);

  return (
    <div className="rounded-field border border-line p-2.5">
      <label className={labelCls}>
        Response validation
        <Select
          value={kind}
          onChange={(e) => {
            const k = e.target.value as ValidationKind;
            if (k === "none") return onChange(undefined);
            if (k === "regex") return onChange({ kind: "regex", pattern: "", mustMatch: true });
            onChange({ kind: k } as FormValidation);
          }}
          options={kinds.map((k) => ({
            value: k,
            label: {
              none: "None",
              number: "Number",
              length: "Character length",
              regex: "Pattern (regular expression)",
              count: "Number of selections",
            }[k],
          }))}
        />
      </label>

      {v?.kind === "number" && (
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {numInput("At least", v.min, (n) => patch({ min: n }))}
          {numInput("At most", v.max, (n) => patch({ max: n }))}
          <label className="flex items-end gap-2 pb-2 text-sm text-ink-2">
            <input
              type="checkbox"
              checked={!!v.integer}
              onChange={(e) => patch({ integer: e.target.checked })}
              className="h-4 w-4 accent-[var(--primary)]"
            />
            Whole numbers
          </label>
        </div>
      )}

      {v?.kind === "length" && (
        <div className="mt-2 grid grid-cols-2 gap-2">
          {numInput("Min characters", v.min, (n) => patch({ min: n }))}
          {numInput("Max characters", v.max, (n) => patch({ max: n }))}
        </div>
      )}

      {v?.kind === "count" && (
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {numInput("Select at least", v.min, (n) => patch({ min: n }))}
          {numInput("Select at most", v.max, (n) => patch({ max: n }))}
          {numInput("Select exactly", v.exactly, (n) => patch({ exactly: n }))}
        </div>
      )}

      {v?.kind === "regex" && (
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_160px]">
          <label className={labelCls}>
            Pattern
            <input
              className={`${inputCls} font-mono`}
              value={v.pattern}
              onChange={(e) => patch({ pattern: e.target.value })}
              placeholder="^GN-\d{4}$"
            />
          </label>
          <label className={labelCls}>
            Must
            <Select
              value={v.mustMatch === false ? "no" : "yes"}
              onChange={(e) => patch({ mustMatch: e.target.value === "yes" })}
              options={[
                { value: "yes", label: "Match" },
                { value: "no", label: "Not match" },
              ]}
            />
          </label>
        </div>
      )}

      {v && (
        <label className={`${labelCls} mt-2`}>
          Error message shown to the respondent
          <input
            className={inputCls}
            value={v.message ?? ""}
            onChange={(e) => patch({ message: e.target.value })}
            placeholder="Leave blank for the default wording"
          />
        </label>
      )}
    </div>
  );
}

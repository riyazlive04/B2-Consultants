/**
 * Shared shapes for the Synamate Sites parity (Phase 2): Forms + Funnels.
 * These describe the JSON stored on Form.fields / Form.settings / FunnelStep.blocks.
 * Isomorphic — imported from both server (validation, rendering) and client (builders).
 */

// ─────────────────────────── Forms ───────────────────────────

/**
 * The item model behind the form builder — a Google Forms-shaped catalogue.
 *
 * ── Why this is one flat list and not sections-containing-fields ─────────────────
 * `section`, `heading` and `image` are ITEMS in the same ordered array as the questions, exactly
 * as Google models a page break. A nested `sections[].items[]` shape reads more tidily right up
 * until someone drags a question across a section boundary, at which point every reorder becomes a
 * splice between two arrays. One list, one index, one move function.
 *
 * ── Why "checkbox" still means a single tick ─────────────────────────────────────
 * It always did, and forms published against that meaning are live. `checkboxes` (plural) is the
 * new multi-select. Redefining the singular would have silently changed what an already-published
 * form collects, which is the one thing a schema change here must never do.
 *
 * Everything below is pure and isomorphic: the builder, the public renderer and the server action
 * import the same normaliser, the same branch walker and the same validator, so the browser and
 * the server cannot disagree about whether an answer is acceptable.
 */
export type FormFieldType =
  // free text — `email`/`phone`/`number` are separate types rather than "text with validation"
  // because their keys map onto the contact record and their keyboards differ on a phone
  | "text" | "email" | "phone" | "number" | "textarea"
  // choose from a list
  | "radio" | "checkboxes" | "select"
  // bounded numbers
  | "scale" | "rating"
  // when
  | "date" | "time"
  // a single yes/no tick (consent). PRE-DATES `checkboxes` — see the note above.
  | "checkbox"
  // static items that collect nothing
  | "section" | "heading" | "image";

/** Items that carry no answer: they lay the form out rather than ask anything. */
export const STATIC_ITEM_TYPES = ["section", "heading", "image"] as const;

export function isStaticItem(type: FormFieldType): boolean {
  return (STATIC_ITEM_TYPES as readonly string[]).includes(type);
}
/** Types that present a list of options. */
export function isChoiceItem(type: FormFieldType): boolean {
  return type === "radio" || type === "checkboxes" || type === "select";
}
/** Types whose answer is a list rather than a scalar. */
export function isMultiItem(type: FormFieldType): boolean {
  return type === "checkboxes";
}

/**
 * One option on a choice question.
 *
 * `goTo` is Google's "go to section based on answer". It may only name a LATER section (or
 * `"submit"`) — see `resolveGoTo`. That restriction is ours, not Google's, and it exists so that a
 * form with a cycle in it cannot be built in the first place.
 */
export type FormOption = { label: string; goTo?: string };

/** Response validation. One rule per question, mirroring Google's single validation row. */
export type FormValidation =
  | { kind: "number"; min?: number; max?: number; integer?: boolean; message?: string }
  | { kind: "length"; min?: number; max?: number; message?: string }
  | { kind: "regex"; pattern: string; mustMatch?: boolean; message?: string }
  /** checkboxes only — "select at least / at most / exactly N" */
  | { kind: "count"; min?: number; max?: number; exactly?: number; message?: string };

export type FormItem = {
  /** Stable within the form. Branch targets point at section ids, so this must not churn. */
  id: string;
  type: FormFieldType;
  /** The answer key. Empty for static items. Maps onto Lead.{name,email,phone,city,industry}. */
  key: string;
  label: string;
  /** Help text under the label. */
  description?: string;
  required?: boolean;
  placeholder?: string;

  // choice questions
  options?: FormOption[];
  /** Adds an "Other:" row with a free-text box. */
  allowOther?: boolean;
  /** Randomise option order per respondent. */
  shuffle?: boolean;

  // scale / rating
  scaleMin?: number;
  scaleMax?: number;
  scaleMinLabel?: string;
  scaleMaxLabel?: string;

  // date
  includeTime?: boolean;

  // image item
  imageUrl?: string;
  imageAlt?: string;

  /** Section items only: where to go after this page. A section id, or "submit". */
  goTo?: string;

  validation?: FormValidation;
};

/** Kept as the historical name — plenty of call sites still say `FormField`. */
export type FormField = FormItem;

/** An answer is a scalar, or a list for multi-select. */
export type FormAnswerValue = string | string[];
export type FormAnswers = Record<string, FormAnswerValue>;

/**
 * The wire value an "Other" choice posts, before the free text beside it is folded in.
 *
 * A sentinel rather than the typed text, because the two arrive as separate form controls and the
 * server has to know which radio was selected before it can decide whether the companion textbox
 * is even relevant. Deliberately not a plausible answer someone could type by hand.
 */
export const OTHER_VALUE = "__other__";
export function otherFieldName(key: string): string {
  return `${key}__other`;
}

export type FormSettings = {
  submitText: string;
  successMessage: string;
  redirectUrl?: string;
  tag?: string; // tag applied to the created contact
  leadSource: string; // a LeadSource value
  createOpportunity?: boolean;
  pipelineId?: string;
  stageId?: string;
  opportunityValueInr?: string;
  /** Show "Page 2 of 4" and a bar on a multi-page form. */
  progressBar?: boolean;
  /** Randomise question order within each page. */
  shuffleQuestions?: boolean;
  /**
   * Best-effort one-submission-per-browser. NOT a guarantee — there is no sign-in on a public
   * capture page, so this is a cookie. It stops the double-tap it is there for and nothing more;
   * the builder's help text says so in as many words.
   */
  limitOneResponse?: boolean;
  /** Offer a "Submit another response" link on the thank-you screen. */
  showSubmitAnother?: boolean;
};

// Field keys that map onto the Lead/Contact record (vs. free-form answers).
export const CONTACT_FIELD_KEYS = ["name", "email", "phone", "city", "industry"] as const;

export const FIELD_TYPE_GROUPS: {
  group: string;
  types: { value: FormFieldType; label: string; hint?: string }[];
}[] = [
  {
    group: "Text",
    types: [
      { value: "text", label: "Short answer" },
      { value: "textarea", label: "Paragraph" },
      { value: "email", label: "Email", hint: "Maps onto the contact" },
      { value: "phone", label: "Phone", hint: "Maps onto the contact" },
      { value: "number", label: "Number" },
    ],
  },
  {
    group: "Choice",
    types: [
      { value: "radio", label: "Multiple choice", hint: "Pick one" },
      { value: "checkboxes", label: "Checkboxes", hint: "Pick several" },
      { value: "select", label: "Dropdown", hint: "Pick one, from a list" },
      { value: "checkbox", label: "Checkbox — single", hint: "One tick, e.g. consent" },
    ],
  },
  {
    group: "Scale",
    types: [
      { value: "scale", label: "Linear scale" },
      { value: "rating", label: "Rating", hint: "Stars" },
    ],
  },
  {
    group: "When",
    types: [
      { value: "date", label: "Date" },
      { value: "time", label: "Time" },
    ],
  },
  {
    group: "Layout — collects nothing",
    types: [
      { value: "section", label: "Section / page break" },
      { value: "heading", label: "Title and description" },
      { value: "image", label: "Image" },
    ],
  },
];

export function fieldTypeLabel(type: FormFieldType): string {
  for (const g of FIELD_TYPE_GROUPS) {
    const hit = g.types.find((t) => t.value === type);
    if (hit) return hit.label;
  }
  return type;
}

// ── Normalisation ───────────────────────────────────────────────────────────────

const ALL_TYPES = new Set<string>(FIELD_TYPE_GROUPS.flatMap((g) => g.types.map((t) => t.value)));

function str(v: unknown, max = 500): string {
  return typeof v === "string" ? v.slice(0, max) : "";
}
function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function normaliseOptions(raw: unknown): FormOption[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: FormOption[] = [];
  for (const o of raw) {
    // Legacy rows stored options as a bare string[]; new rows store {label, goTo?}.
    if (typeof o === "string") out.push({ label: o.slice(0, 200) });
    else if (o && typeof o === "object") {
      const label = str((o as { label?: unknown }).label, 200);
      if (label) out.push({ label, goTo: str((o as { goTo?: unknown }).goTo, 60) || undefined });
    }
  }
  return out;
}

function normaliseValidation(raw: unknown): FormValidation | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const v = raw as Record<string, unknown>;
  const message = str(v.message, 200) || undefined;
  switch (v.kind) {
    case "number":
      return { kind: "number", min: num(v.min), max: num(v.max), integer: v.integer === true, message };
    case "length":
      return { kind: "length", min: num(v.min), max: num(v.max), message };
    case "regex": {
      const pattern = str(v.pattern, 200);
      return pattern ? { kind: "regex", pattern, mustMatch: v.mustMatch !== false, message } : undefined;
    }
    case "count":
      return { kind: "count", min: num(v.min), max: num(v.max), exactly: num(v.exactly), message };
    default:
      return undefined;
  }
}

/**
 * Turn whatever is in the `fields` JSON column into today's shape.
 *
 * Every read path goes through this — the builder, the public page and the submit action — so a
 * form saved before any of this existed renders and validates identically to one saved after. Old
 * rows have no `id` and no per-option objects; ids are derived from the INDEX rather than
 * generated, so re-reading an unsaved legacy form twice yields the same ids and React does not
 * remount every row.
 */
export function normaliseItems(raw: unknown): FormItem[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  return raw.flatMap((r, i): FormItem[] => {
    if (!r || typeof r !== "object") return [];
    const o = r as Record<string, unknown>;
    const type = (ALL_TYPES.has(String(o.type)) ? String(o.type) : "text") as FormFieldType;

    let id = str(o.id, 60) || `i${i}`;
    while (seen.has(id)) id = `${id}_${i}`; // ids must be unique or branch targets get ambiguous
    seen.add(id);

    const item: FormItem = {
      id,
      type,
      key: isStaticItem(type) ? "" : str(o.key, 60),
      label: str(o.label, 300),
      description: str(o.description, 1000) || undefined,
      required: o.required === true,
      placeholder: str(o.placeholder, 200) || undefined,
      options: isChoiceItem(type) ? normaliseOptions(o.options) ?? [] : undefined,
      allowOther: o.allowOther === true,
      shuffle: o.shuffle === true,
      scaleMin: num(o.scaleMin),
      scaleMax: num(o.scaleMax),
      scaleMinLabel: str(o.scaleMinLabel, 60) || undefined,
      scaleMaxLabel: str(o.scaleMaxLabel, 60) || undefined,
      includeTime: o.includeTime === true,
      imageUrl: str(o.imageUrl, 2000) || undefined,
      imageAlt: str(o.imageAlt, 200) || undefined,
      goTo: str(o.goTo, 60) || undefined,
      validation: normaliseValidation(o.validation),
    };
    if (type === "scale") {
      item.scaleMin = item.scaleMin ?? 1;
      item.scaleMax = item.scaleMax ?? 5;
    }
    if (type === "rating") item.scaleMax = item.scaleMax ?? 5;
    return [item];
  });
}

export function normaliseSettings(raw: unknown): FormSettings {
  const base = defaultFormSettings();
  if (!raw || typeof raw !== "object") return base;
  const o = raw as Record<string, unknown>;
  return {
    ...base,
    ...o,
    submitText: str(o.submitText, 60) || base.submitText,
    successMessage: str(o.successMessage, 500) || base.successMessage,
    leadSource: str(o.leadSource, 60) || base.leadSource,
  } as FormSettings;
}

/** A blank item of the requested type, ready to drop into the builder. */
export function newItem(type: FormFieldType, id: string, keySeed: number): FormItem {
  const base: FormItem = { id, type, key: isStaticItem(type) ? "" : `field_${keySeed}`, label: "" };
  switch (type) {
    case "section":
      return { ...base, label: "New section" };
    case "heading":
      return { ...base, label: "Title", description: "Description" };
    case "image":
      return { ...base, label: "Image" };
    case "radio":
    case "checkboxes":
    case "select":
      return { ...base, label: "Untitled question", options: [{ label: "Option 1" }] };
    case "scale":
      return { ...base, label: "Untitled question", scaleMin: 1, scaleMax: 5 };
    case "rating":
      return { ...base, label: "Untitled question", scaleMax: 5 };
    default:
      return { ...base, label: "Untitled question" };
  }
}

export function defaultFormFields(): FormItem[] {
  return [
    { id: "f_name", key: "name", label: "Full name", type: "text", required: true, placeholder: "Your name" },
    { id: "f_email", key: "email", label: "Email", type: "email", required: true, placeholder: "you@example.com" },
    { id: "f_phone", key: "phone", label: "Phone / WhatsApp", type: "phone", required: true, placeholder: "+91…" },
  ];
}

export function defaultFormSettings(): FormSettings {
  return {
    submitText: "Submit",
    successMessage: "Thanks! We'll be in touch shortly.",
    leadSource: "LANDING_PAGE",
    progressBar: true,
  };
}

// ── Pages and branching ─────────────────────────────────────────────────────────

export type FormPage = {
  index: number;
  /** The `section` item that opened this page. Null for the first page, which needs no break. */
  section: FormItem | null;
  items: FormItem[];
};

/** Split the flat item list into pages at each `section` item. Always returns at least one page. */
export function pagesOf(items: readonly FormItem[]): FormPage[] {
  const pages: FormPage[] = [{ index: 0, section: null, items: [] }];
  for (const it of items) {
    if (it.type === "section") pages.push({ index: pages.length, section: it, items: [] });
    else pages[pages.length - 1].items.push(it);
  }
  // A leading section item produces an empty first page; drop it rather than show a blank screen.
  if (pages.length > 1 && pages[0].items.length === 0) {
    return pages.slice(1).map((p, i) => ({ ...p, index: i }));
  }
  return pages;
}

function isAnswered(v: FormAnswerValue | undefined): boolean {
  return Array.isArray(v) ? v.length > 0 : typeof v === "string" && v.trim() !== "";
}

/**
 * Where a page sends the respondent next.
 *
 * Google's rule when several questions on one page carry branching: the LAST one answered wins.
 * We do the same, then fall back to the section's own "after this section" setting, then to the
 * next page. Targets that are not strictly forwards are ignored rather than honoured — that plus
 * the builder only offering later sections makes a loop unconstructable.
 */
export function nextPageIndex(
  page: FormPage,
  answers: FormAnswers,
  pages: readonly FormPage[],
): number | "submit" {
  let target: string | undefined;

  for (const it of page.items) {
    if (it.type !== "radio" && it.type !== "select") continue;
    const v = answers[it.key];
    if (!isAnswered(v)) continue;
    const chosen = Array.isArray(v) ? v[0] : v;
    const hit = it.options?.find((o) => o.label === chosen);
    if (hit?.goTo) target = hit.goTo; // later question overrides an earlier one
  }
  target ??= page.section?.goTo;

  if (target === "submit") return "submit";
  if (target) {
    const found = pages.findIndex((p) => p.section?.id === target);
    if (found > page.index) return found;
  }
  return page.index + 1 >= pages.length ? "submit" : page.index + 1;
}

/**
 * The items a respondent actually saw, given the answers they gave.
 *
 * The server calls this before enforcing `required`. Without it, a required question sitting in a
 * branch nobody was sent down makes the form permanently unsubmittable — the classic branching
 * bug, and one that only shows up after the form is live.
 */
export function reachableItems(items: readonly FormItem[], answers: FormAnswers): FormItem[] {
  const pages = pagesOf(items);
  const out: FormItem[] = [];
  let at: number | "submit" = 0;
  // Bounded by the page count: targets are forward-only, so this cannot revisit a page.
  for (let guard = 0; guard <= pages.length && at !== "submit"; guard++) {
    const page = pages[at];
    if (!page) break;
    out.push(...page.items);
    at = nextPageIndex(page, answers, pages);
  }
  return out;
}

// ── Answers ─────────────────────────────────────────────────────────────────────

/** One human-readable line for an answer — for tables, CSV and the contact's custom fields. */
export function answerToText(v: FormAnswerValue | undefined): string {
  if (v == null) return "";
  return Array.isArray(v) ? v.join(", ") : v;
}

/**
 * The single validation rule, applied to one answer. Returns an error message, or null.
 *
 * Shared by the public renderer and the submit action deliberately: a rule enforced only in the
 * browser is decoration, and a rule enforced only on the server is a form that fails after you
 * press submit. Same function, both sides.
 */
export function validateAnswer(item: FormItem, value: FormAnswerValue | undefined): string | null {
  if (isStaticItem(item.type)) return null;

  const list = Array.isArray(value) ? value.filter((s) => s.trim() !== "") : [];
  const text = Array.isArray(value) ? "" : (value ?? "").trim();
  const answered = isMultiItem(item.type) ? list.length > 0 : text !== "";
  const label = item.label || item.key;

  if (!answered) return item.required ? `${label} is required` : null;

  const v = item.validation;
  const fail = (fallback: string) => v?.message?.trim() || fallback;

  switch (item.type) {
    case "number": {
      const n = Number(text);
      if (!Number.isFinite(n)) return `${label} must be a number`;
      break;
    }
    case "scale":
    case "rating": {
      const n = Number(text);
      const min = item.type === "rating" ? 1 : item.scaleMin ?? 1;
      const max = item.scaleMax ?? 5;
      if (!Number.isInteger(n) || n < min || n > max) return `${label} must be between ${min} and ${max}`;
      break;
    }
    case "date":
      if (Number.isNaN(Date.parse(text))) return `${label} must be a date`;
      break;
    case "time":
      if (!/^\d{1,2}:\d{2}$/.test(text)) return `${label} must be a time`;
      break;
    case "radio":
    case "select":
      // With "Other" on, any text is legitimate — that is the entire point of the option.
      if (!item.allowOther && !(item.options ?? []).some((o) => o.label === text)) {
        return `${label}: pick one of the options`;
      }
      break;
    case "checkboxes":
      if (!item.allowOther) {
        const known = new Set((item.options ?? []).map((o) => o.label));
        if (list.some((x) => !known.has(x))) return `${label}: pick from the options`;
      }
      break;
  }

  if (!v) return null;
  switch (v.kind) {
    case "number": {
      const n = Number(text);
      if (!Number.isFinite(n)) return fail(`${label} must be a number`);
      if (v.integer && !Number.isInteger(n)) return fail(`${label} must be a whole number`);
      if (v.min != null && n < v.min) return fail(`${label} must be at least ${v.min}`);
      if (v.max != null && n > v.max) return fail(`${label} must be at most ${v.max}`);
      break;
    }
    case "length":
      if (v.min != null && text.length < v.min) return fail(`${label} must be at least ${v.min} characters`);
      if (v.max != null && text.length > v.max) return fail(`${label} must be at most ${v.max} characters`);
      break;
    case "regex": {
      // The pattern is authored by a signed-in founder, not by the public, and both it (200) and
      // the answer (2000) are length-capped — which is what keeps a pathological pattern from
      // becoming a way to hang the submit path. An uncompilable pattern is ignored, never thrown:
      // a typo in a validation rule must not take the public form down.
      let re: RegExp;
      try {
        re = new RegExp(v.pattern);
      } catch {
        break;
      }
      const matched = re.test(text);
      if (v.mustMatch !== false ? !matched : matched) return fail(`${label} is not in the expected format`);
      break;
    }
    case "count": {
      const n = list.length;
      if (v.exactly != null && n !== v.exactly) return fail(`${label}: select exactly ${v.exactly}`);
      if (v.min != null && n < v.min) return fail(`${label}: select at least ${v.min}`);
      if (v.max != null && n > v.max) return fail(`${label}: select at most ${v.max}`);
      break;
    }
  }
  return null;
}

// ─────────────────────────── Funnel page blocks ───────────────────────────

export type BlockType =
  | "heading" | "subheading" | "text" | "image" | "button" | "bullets"
  | "divider" | "spacer" | "video" | "form" | "row";

export type Block = {
  id: string;
  type: BlockType;
  text?: string;
  align?: "left" | "center" | "right";
  url?: string; // image src / video embed url
  alt?: string;
  label?: string; // button label
  href?: string; // button target
  variant?: "primary" | "soft" | "outline"; // button style
  items?: string[]; // bullets
  size?: number; // spacer height (px)
  formId?: string; // embedded form
  columns?: Block[][]; // "row" layout container — 2 (or more) columns, each a nested block list
};

export function blockLabel(type: BlockType): string {
  const map: Record<BlockType, string> = {
    heading: "Heading", subheading: "Subheading", text: "Paragraph", image: "Image",
    button: "Button / CTA", bullets: "Bullet list", divider: "Divider", spacer: "Spacer",
    video: "Video embed", form: "Form embed", row: "Row (2 columns)",
  };
  return map[type];
}

export function slugify(input: string): string {
  return input.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "untitled";
}

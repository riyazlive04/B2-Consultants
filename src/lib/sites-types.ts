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
  /**
   * An amount of money. Its own type rather than `number` with a prefix, because the answer has a
   * CURRENCY, and this project has learnt that lesson expensively: money is BigInt minor units
   * with an explicit currency everywhere else in the schema, and a bare float labelled "₹" is how
   * that discipline leaks away.
   */
  | "monetary"
  /**
   * A file the respondent uploads. Stored in object storage; the ANSWER is the resulting URL, so
   * a submission stays a row of strings and nothing has to stream bytes out of Postgres.
   */
  | "file"
  /** A drawn or typed signature. The answer is a PNG data URL — self-contained, no second fetch. */
  | "signature"
  /**
   * Consent, with the legal text beside it. Distinct from `checkbox` because it is a different
   * PROMISE: it renders the terms, it defaults to required, and its label is a sentence with a
   * link in it rather than a question. Collapsing the two would mean the day someone edits the
   * consent copy they are also editing an ordinary yes/no tick somewhere else.
   */
  | "terms"
  /**
   * A value carried with the submission but never shown — campaign, ad id, referrer. Prefilled
   * from a URL parameter or a fixed default. This is what the Synamate form calls a "Hidden"
   * field, and it is how a lead arrives already knowing where it came from.
   */
  | "hidden"
  /**
   * A running total derived from the options the respondent picked (`FormOption.score`). Not an
   * input: it is computed at submit, so it cannot be forged by editing the page — which is the
   * only way a score is worth anything for triage.
   */
  | "score"
  /**
   * Bot protection. Renders no visible control: it plants a honeypot and stamps the render time,
   * and the submit action rejects anything that fills the trap or answers impossibly fast.
   * Deliberately not a third-party captcha — no vendor, no cookie banner, nothing for a real
   * respondent on a phone to fail.
   */
  | "captcha"
  // static items that collect nothing
  | "section" | "heading" | "image" | "html";

/** Items that carry no answer: they lay the form out rather than ask anything. */
export const STATIC_ITEM_TYPES = ["section", "heading", "image", "html", "captcha"] as const;

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
export type FormOption = {
  label: string;
  goTo?: string;
  /** Points this option contributes to a `score` item. Absent = 0, so scoring is opt-in per option. */
  score?: number;
};

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

  // ── hidden ──
  /** Fixed value when the URL carries nothing. */
  hiddenValue?: string;
  /** Query parameter to read the value from — `?ad=spring` with `hiddenFrom: "ad"`. */
  hiddenFrom?: string;

  // ── file ──
  /** Accept attribute, e.g. ".pdf,.doc,image/*". Enforced again on the server. */
  accept?: string;
  /** Per-file cap in megabytes. Clamped server-side to MAX_UPLOAD_MB — a page can lie. */
  maxSizeMb?: number;

  // ── phone ──
  /** ISO-3166 alpha-2 the country selector opens on. Defaults to IN — the audience's origin. */
  defaultCountry?: string;

  // ── monetary ──
  currency?: "INR" | "EUR";

  // ── terms ──
  /** The sentence beside the tick. Plain text; `termsUrl` turns the last part into a link. */
  termsText?: string;
  termsUrl?: string;

  /** html items only — raw markup, rendered unescaped. Admin-authored, same contract as Block.html. */
  html?: string;

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
    group: "Money and files",
    types: [
      { value: "monetary", label: "Monetary", hint: "An amount, with a currency" },
      { value: "file", label: "File upload" },
      { value: "signature", label: "Signature" },
    ],
  },
  {
    group: "Behind the scenes",
    types: [
      { value: "hidden", label: "Hidden", hint: "Carried, never shown" },
      { value: "score", label: "Score", hint: "Computed from the answers" },
      { value: "terms", label: "Terms and conditions" },
    ],
  },
  {
    group: "Layout — collects nothing",
    types: [
      { value: "section", label: "Section / page break" },
      { value: "heading", label: "Title and description" },
      { value: "image", label: "Image" },
      { value: "html", label: "Custom HTML" },
      { value: "captcha", label: "Bot protection" },
    ],
  },
];

/**
 * The element palette — what the builder's left drawer offers, in Synamate's categories.
 *
 * ── Why this is separate from FIELD_TYPE_GROUPS ────────────────────────────────────────────────
 * That list is the MODEL: every field type exactly once, and it is what the normaliser validates
 * against. This is the AUTHORING catalogue, and the two are not the same shape — "First Name",
 * "Last Name", "City" and "Website" are all one type (`text`) with a different key, label and
 * keyboard. Collapsing them into the model would mean four near-identical types to validate and
 * render; collapsing the palette into the model would mean the drawer offering "Short answer"
 * four times and the author filling in the contact key by hand every time, which is exactly the
 * step the GHL palette exists to remove.
 *
 * `quick` marks the tiles on the "Quick Add" tab; the rest are "Add Object Fields" — the ones
 * that write a known key on the contact record.
 */
export type PaletteItem = {
  /** Tile caption. */
  label: string;
  type: FormFieldType;
  /** Lucide icon name, resolved by the builder — this file stays free of React. */
  icon: string;
  /** Defaults merged over `newItem(type)`. A preset is a type plus the fields that make it one. */
  preset?: Partial<FormItem>;
  /** Not offered yet, and says so on the tile rather than being silently missing. */
  soon?: boolean;
};

export const ELEMENT_PALETTE: { group: string; quick: boolean; items: PaletteItem[] }[] = [
  {
    group: "Personal Info",
    quick: false,
    items: [
      { label: "Full Name", type: "text", icon: "User", preset: { key: "name", label: "Full Name", placeholder: "Enter Your Full Name", required: true } },
      { label: "First Name", type: "text", icon: "User", preset: { key: "firstName", label: "First Name", placeholder: "Enter Your First Name", required: true } },
      { label: "Last Name", type: "text", icon: "User", preset: { key: "lastName", label: "Last Name", placeholder: "Enter Your Last Name" } },
      { label: "Date of Birth", type: "date", icon: "Cake", preset: { key: "dob", label: "Date of Birth" } },
      { label: "Phone", type: "phone", icon: "Phone", preset: { key: "phone", label: "Phone", placeholder: "Enter Your Phone Number", required: true } },
      { label: "Email", type: "email", icon: "Mail", preset: { key: "email", label: "Email", placeholder: "Enter Your Email Address", required: true } },
    ],
  },
  {
    group: "Address",
    quick: false,
    items: [
      { label: "Address", type: "text", icon: "MapPin", preset: { key: "address", label: "Address" } },
      { label: "City", type: "text", icon: "Building2", preset: { key: "city", label: "City" } },
      { label: "State", type: "text", icon: "Landmark", preset: { key: "state", label: "State" } },
      { label: "Country", type: "text", icon: "Globe", preset: { key: "country", label: "Country" } },
      { label: "Postal Code", type: "text", icon: "Mailbox", preset: { key: "postalCode", label: "Postal Code" } },
      { label: "Organization", type: "text", icon: "Briefcase", preset: { key: "industry", label: "Organization" } },
      { label: "Website", type: "text", icon: "Link", preset: { key: "website", label: "Website", placeholder: "https://…" } },
    ],
  },
  {
    group: "Text",
    quick: true,
    items: [
      { label: "Single Line", type: "text", icon: "Minus" },
      { label: "Multi Line", type: "textarea", icon: "AlignLeft" },
      { label: "Number", type: "number", icon: "Hash" },
    ],
  },
  {
    group: "Choice Elements",
    quick: true,
    items: [
      { label: "Single Dropdown", type: "select", icon: "ChevronDown" },
      { label: "Multi Select", type: "checkboxes", icon: "ListChecks" },
      { label: "Checkbox", type: "checkbox", icon: "CheckSquare" },
      { label: "Radio", type: "radio", icon: "CircleDot" },
    ],
  },
  {
    group: "Rating",
    quick: true,
    items: [
      { label: "Rating", type: "rating", icon: "Star" },
      { label: "Linear Scale", type: "scale", icon: "SlidersHorizontal" },
    ],
  },
  {
    group: "Customized",
    quick: true,
    items: [
      { label: "Text", type: "heading", icon: "Type" },
      { label: "HTML", type: "html", icon: "Code" },
      { label: "Bot Protection", type: "captcha", icon: "ShieldCheck" },
      { label: "Source", type: "hidden", icon: "Radio", preset: { key: "source", label: "Source", hiddenFrom: "utm_source" } },
      { label: "T & C", type: "terms", icon: "FileCheck" },
      { label: "Score", type: "score", icon: "Gauge" },
    ],
  },
  {
    group: "Other Elements",
    quick: true,
    items: [
      { label: "Image", type: "image", icon: "Image" },
      { label: "File Upload", type: "file", icon: "Upload" },
      { label: "Monetary", type: "monetary", icon: "IndianRupee" },
      { label: "Date Picker", type: "date", icon: "Calendar" },
      { label: "Signature", type: "signature", icon: "PenLine" },
      { label: "Page Break", type: "section", icon: "SeparatorHorizontal" },
    ],
  },
  {
    group: "Payments",
    quick: true,
    items: [
      // Shown and disabled rather than omitted: the team knows this palette from Synamate, and a
      // missing tile reads as "the tool can't", while a greyed one reads as "not yet". Building
      // them means a payment provider on a public form, which is its own piece of work.
      { label: "Sell Products", type: "monetary", icon: "Package", soon: true },
      { label: "Collect Payment", type: "monetary", icon: "CreditCard", soon: true },
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
      if (label) {
        out.push({
          label,
          goTo: str((o as { goTo?: unknown }).goTo, 60) || undefined,
          score: num((o as { score?: unknown }).score),
        });
      }
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
      hiddenValue: str(o.hiddenValue, 500) || undefined,
      hiddenFrom: str(o.hiddenFrom, 60) || undefined,
      accept: str(o.accept, 200) || undefined,
      maxSizeMb: num(o.maxSizeMb),
      currency: o.currency === "EUR" ? "EUR" : o.currency === "INR" ? "INR" : undefined,
      defaultCountry: /^[A-Za-z]{2}$/.test(String(o.defaultCountry ?? "")) ? String(o.defaultCountry).toUpperCase() : undefined,
      termsText: str(o.termsText, 2000) || undefined,
      termsUrl: str(o.termsUrl, 2000) || undefined,
      html: str(o.html, 20000) || undefined,
      validation: normaliseValidation(o.validation),
    };
    if (type === "scale") {
      item.scaleMin = item.scaleMin ?? 1;
      item.scaleMax = item.scaleMax ?? 5;
    }
    if (type === "rating") item.scaleMax = item.scaleMax ?? 5;
    if (type === "monetary") item.currency = item.currency ?? "INR";
    // Consent that is optional is not consent — it is a checkbox. An author who genuinely wants an
    // optional tick has `checkbox` for exactly that.
    if (type === "terms") item.required = true;
    // A score is computed at submit, never entered, so requiring it could only ever fail.
    if (type === "score") item.required = false;
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
    case "html":
      return { ...base, label: "Custom HTML", html: "<!-- paste your embed here -->" };
    case "captcha":
      return { ...base, label: "Bot protection" };
    case "hidden":
      return { ...base, label: "Hidden", key: `hidden_${keySeed}` };
    case "score":
      return { ...base, label: "Score", key: "score" };
    case "monetary":
      return { ...base, label: "Amount", currency: "INR" };
    case "file":
      return { ...base, label: "Upload a file", maxSizeMb: 10 };
    case "signature":
      return { ...base, label: "Signature", required: true };
    case "terms":
      return {
        ...base,
        key: "consent",
        label: "I agree to the terms and conditions",
        required: true,
        termsText: "I agree to the terms and conditions and the privacy policy.",
      };
    default:
      return { ...base, label: "Untitled question" };
  }
}

/**
 * The score a set of answers earns, from the per-option points the author set.
 *
 * Computed from the ITEMS and the ANSWERS at submit rather than tracked as the respondent goes,
 * because a number the browser accumulates is a number the browser can be told to accumulate
 * differently. A score is used to decide who gets called first; it has to be worth trusting.
 *
 * Returns null when the form has no `score` item, so the caller can tell "no scoring here" from
 * "scored zero" — a real distinction when the sales team sorts by it.
 */
export function computeScore(items: readonly FormItem[], answers: FormAnswers): number | null {
  if (!items.some((i) => i.type === "score")) return null;
  let total = 0;
  for (const item of items) {
    if (!isChoiceItem(item.type) || !item.options?.length) continue;
    const v = answers[item.key];
    const chosen = Array.isArray(v) ? v : v ? [v] : [];
    for (const label of chosen) {
      const hit = item.options.find((o) => o.label === label);
      if (hit?.score) total += hit.score;
    }
  }
  return total;
}

/**
 * The value a hidden field should carry: the URL parameter it names, else its fixed default.
 *
 * `incoming` is the visitor's own query string. This is how a lead arrives already knowing which
 * ad it came from without anyone typing anything.
 */
export function hiddenValueFor(item: FormItem, incoming: Record<string, string> | undefined): string {
  const fromUrl = item.hiddenFrom ? incoming?.[item.hiddenFrom] : undefined;
  return (fromUrl ?? item.hiddenValue ?? "").slice(0, 500);
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
  // Neither is entered by the respondent: `hidden` is stamped from the URL and `score` is derived
  // at submit. Running the required/format rules over them would reject a form on the strength of
  // a value the person filling it in cannot see, let alone correct.
  if (item.type === "hidden" || item.type === "score") return null;

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
    case "monetary": {
      const n = Number(text.replace(/[,\s]/g, ""));
      if (!Number.isFinite(n) || n < 0) return `${label} must be an amount`;
      break;
    }
    case "terms":
      // The tick posts "yes"; anything else means it was not ticked. `required` is forced on in
      // the normaliser, so an unanswered one is already caught above — this is the tampered case.
      if (text !== "yes") return `${label || "The terms"} must be accepted`;
      break;
    case "file":
      // The answer is the URL the upload endpoint returned. That endpoint is the thing that
      // enforced type and size; re-checking the extension here would only catch an honest client.
      if (!/^https?:\/\/|^\//.test(text)) return `${label}: upload did not complete`;
      break;
    case "signature":
      if (!text.startsWith("data:image/")) return `${label} is required`;
      break;
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

/**
 * ── The page document model ─────────────────────────────────────────────────────
 *
 * Mirrors the hierarchy the Synamate/GHL builder edits, because we are replacing that builder
 * and every page the team migrates was authored in its terms:
 *
 *     section  →  row  →  column  →  element
 *
 * `section` is a full-bleed horizontal band (this is what carries a background colour across the
 * viewport). `row` is a horizontal group inside it, `column` a vertical slice of that row, and
 * everything else is a leaf element. Containers are not decoration — they are where padding,
 * background and width live, exactly as in GHL, so a design can be expressed by nesting rather
 * than by one-off CSS per element.
 *
 * Leaves stay flat-renderable: a page authored before this model (a plain `Block[]` with no
 * sections) still renders, so nothing that exists today breaks. See `SiteBlocks`.
 */
export type BlockType =
  // ── containers ──
  | "section" | "row" | "column"
  // ── text ──
  | "heading" | "subheading" | "text" | "eyebrow" | "bullets"
  // ── media & action ──
  | "image" | "video" | "button" | "form"
  /**
   * An embedded discovery-call booker, scoped to ONE person's calendar.
   *
   * A sibling of `form`, not a variant of it: a form collects answers, this holds a slot. Both
   * resolve their data server-side and are handed down prefetched (see `getPublicStep`), because
   * availability has to be read at request time — a cached "19:00 is free" is how two people book
   * the same slot.
   */
  | "booking"
  // ── composites & spacing ──
  | "card" | "stat" | "divider" | "spacer"
  /**
   * A rounded label chip — "OUR GUARANTEE", "★ NEXT BATCH FILLING NOW", "PHASE 1 · WEEK 1–2",
   * the green "27 days" on a testimonial.
   *
   * Its own element rather than a styled `eyebrow` because it appears eight times on one page in
   * six different colours: expressing it as per-node background + radius + padding would mean
   * eight hand-tuned copies that drift the moment anyone edits one.
   */
  | "pill"
  /** Initials in a circle, as on each testimonial. Text is the initials; tone picks the colour. */
  | "avatar"
  /**
   * A small coloured disc marking a heading — the blue dot on each "everything included" tile.
   *
   * Not a one-item `bullets` list: the dot sits in its own column so the description below
   * lines up with the TITLE rather than under the marker, which is what the original does and
   * what a list cannot express.
   */
  | "dot"
  /**
   * Raw HTML/JS, the equivalent of GHL's "Custom HTML/Javascript" element — the training page
   * uses four of them, so a migration is impossible without it.
   *
   * DANGEROUS BY CONSTRUCTION: it renders unescaped markup on a PUBLIC page, so it is an XSS
   * sink by definition. Gated on the `pipeline.configure`-class admin capability at the editing
   * boundary, never on the render side — a page that already contains one must keep rendering
   * even when a non-admin views it.
   */
  | "html";

/**
 * Per-node presentation, the fields GHL's right-hand inspector edits.
 *
 * Deliberately a CLOSED set of primitives rather than free-form CSS: every value is validated and
 * rendered into a style object we control, so an editor cannot inject `position:fixed` over the
 * whole viewport, and a page stays readable when the theme changes. Colours accept a design token
 * name (`primary`, `ink`, …) or a literal hex — tokens survive a rebrand, hex is the escape hatch
 * when a design demands an exact value.
 */
export type NodeStyle = {
  background?: string;
  color?: string;
  /** Padding / margin in px, CSS shorthand order: [top, right, bottom, left]. */
  padding?: [number, number, number, number];
  margin?: [number, number, number, number];
  radius?: number;
  borderWidth?: number;
  borderColor?: string;
  /** Container width cap in px. Sections default to a readable measure; 0 means full width. */
  maxWidth?: number;
  /**
   * Explicit box size in px, and how an image fills it.
   *
   * Needed for the one shape `maxWidth` alone cannot express: a CIRCULAR portrait. `radius` on a
   * non-square image gives an ellipse, so a round avatar needs equal width and height plus
   * `objectFit: "cover"` to crop rather than squash. The team photos on the apply page are the
   * first use; it is a general facility, not a special case for them.
   */
  width?: number;
  height?: number;
  objectFit?: "cover" | "contain" | "fill";
  fontSize?: number;
  fontWeight?: number;
  lineHeight?: number;
  letterSpacing?: number;
  align?: "left" | "center" | "right";
  /** `column` only — flex growth, so a 70/30 split is expressible without hard widths. */
  grow?: number;
  /** Gap between children, px. */
  gap?: number;
  shadow?: "none" | "card" | "soft";
  /** Italic — the convention for a pulled quote, which is what every testimonial here is. */
  italic?: boolean;
  hidden?: boolean;
};

export type Block = {
  id: string;
  type: BlockType;
  text?: string;
  /**
   * Desktop styling, and the phone override applied on top of it.
   *
   * Two objects rather than one keyed by breakpoint because that is the only distinction the
   * builder's device toggle makes, and a page that reads correctly on a phone is not optional —
   * the funnel's traffic is a Meta ad audience, which is overwhelmingly mobile.
   */
  style?: NodeStyle;
  styleMobile?: Partial<NodeStyle>;
  /** `html` element only — raw markup, rendered unescaped. See the BlockType note. */
  html?: string;
  align?: "left" | "center" | "right";
  url?: string; // image src / video embed url
  alt?: string;
  label?: string; // button label; also the caption under a "stat"
  href?: string; // button target
  /**
   * Visual variant. Read per block type, so the same field means different things:
   *   button  — primary | soft | outline | accent (the amber CTA that sits on the dark band)
   *   bullets — "check" for ✔, "dash" for the em-dash lists the curriculum uses; default a disc
   */
  variant?: "primary" | "soft" | "outline" | "accent" | "check" | "dash";
  /**
   * Colour of a `pill` or `avatar`.
   *
   * A named set, not a free colour: these chips carry MEANING on the page — amber is the
   * guarantee, green is a result, blue/orange/green mark the three curriculum phases in order.
   * A palette keeps that consistent and survives a rebrand; a hex per chip would not.
   */
  tone?: "neutral" | "amber" | "blue" | "green" | "orange" | "navy" | "violet";
  items?: string[]; // bullets
  size?: number; // spacer height (px)
  formId?: string; // embedded form

  /**
   * Click opens this form in a POPUP instead of navigating — the CTA pattern the live Synamate
   * page uses, where "Apply for Guided Mode" and the video still both raise the same opt-in
   * dialog rather than sending the visitor to another page.
   *
   * Read on `button` and `image`. Set on a button it wins over `href` — a control cannot both
   * open a dialog and leave the page, and silently doing one while the author configured the
   * other is worse than either. `href` is deliberately NOT cleared when this is set, so switching
   * the behaviour back restores the link the author already typed.
   *
   * Why a form id on the node rather than a "popup" block containing a form: the popup has no
   * position in the page and no styling of its own. Modelling it as a block would put an
   * invisible node in the tree that the canvas has to render as something, which is how builders
   * end up with phantom empty bands nobody can explain.
   */
  opensFormId?: string;
  /**
   * `booking` blocks — WHOSE calendar this shows (a `User.id`).
   *
   * Required in practice: the whole point of a per-person disco page is that Asma's page offers
   * Asma's slots. Left unset the block falls back to every open slot, which is the old `/book`
   * behaviour and is better than rendering nothing, but it makes two "personalised" pages show
   * identical availability — so the authoring side should always set it.
   */
  bookingOwnerId?: string;
  /** `booking` blocks — the small label above the title ("DISCO"). */
  bookingEyebrow?: string;
  /** Popup headline. Falls back to the form's own name, so an unset field is never a blank dialog. */
  modalTitle?: string;
  /** The line under it — "20 minutes. Free. Changes everything." Optional. */
  modalSubtitle?: string;
  /**
   * LEGACY row layout: N columns as bare block lists, with no identity or style of their own.
   *
   * Superseded by `children` holding real `column` nodes, which is what lets a column carry its
   * own width, padding and background — the thing a 70/30 hero split needs. Kept because funnel
   * steps authored before the node model still hold this shape in their `blocks` JSON, and a
   * saved page must never stop rendering because the editor moved on. `normalizeRow` below is the
   * single place that reconciles the two, so no renderer or editor has to know both.
   */
  columns?: Block[][];
  /** Nested children of any container: a section's rows, a row's columns, a card's contents. */
  children?: Block[];
  /**
   * `section` only — the band's background PRESET. `dark` is the inverted CTA strip at the foot
   * of the page; `muted` is the alternating grey that separates one section from the next.
   *
   * A preset rather than a raw colour so a rebrand moves every band at once. `style.background`
   * overrides it when a design genuinely needs a one-off value.
   */
  background?: "plain" | "muted" | "dark" | "brand";
};

export function blockLabel(type: BlockType): string {
  const map: Record<BlockType, string> = {
    section: "Section band", row: "Row", column: "Column",
    heading: "Heading", subheading: "Subheading", text: "Paragraph",
    eyebrow: "Eyebrow label", bullets: "Bullet list",
    image: "Image", video: "Video embed", button: "Button / CTA", form: "Form embed",
    booking: "Booking calendar",
    card: "Card", stat: "Stat", divider: "Divider", spacer: "Spacer",
    pill: "Pill / badge", avatar: "Avatar", dot: "Dot marker",
    html: "Custom HTML / Javascript",
  };
  return map[type];
}

/** Container types hold other nodes; everything else is a leaf. Drives the builder's drop rules. */
export const CONTAINER_TYPES: readonly BlockType[] = ["section", "row", "column", "card"];

export function isContainer(type: BlockType): boolean {
  return CONTAINER_TYPES.includes(type);
}

/**
 * A row's columns, whichever way the page was authored.
 *
 * New pages nest real `column` nodes in `children`; pages from before the node model hold bare
 * block lists in `columns`. Everything that walks a row — renderer, builder, and any future
 * migration — goes through here, so the legacy shape is understood in exactly one place and can
 * be deleted in exactly one place once no stored page uses it.
 */
export function normalizeRow(row: Block): Block[] {
  const kids = row.children ?? [];
  if (kids.length) return kids.map((c) => (c.type === "column" ? c : { id: `${c.id}-col`, type: "column" as const, children: [c] }));
  return (row.columns ?? []).map((col, i) => ({ id: `${row.id}-c${i}`, type: "column" as const, children: col }));
}

export function slugify(input: string): string {
  return input.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "untitled";
}

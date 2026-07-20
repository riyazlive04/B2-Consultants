import { z } from "zod";

/**
 * One rule per field kind, shared by the browser and the server.
 *
 * Every kind carries three things that MUST agree:
 *   - `filter`  — drops characters that can never belong (runs on every keystroke/paste)
 *   - `attrs`   — the HTML surface (inputMode/autoComplete/maxLength) so keyboards + autofill fit
 *   - `schema`  — the zod check the server action re-runs
 *
 * The filter is UX ONLY. Server actions are public endpoints (submitBooking takes no session),
 * so anything the filter drops must also be rejected by `schema` — a crafted POST never touches
 * the browser. Keep the pair in sync: loosening one without the other is the bug this module
 * exists to prevent.
 *
 * Isomorphic on purpose — no "server-only", no libphonenumber (that metadata is ~150kB and stays
 * out of the client bundle; rigorous phone validation happens server-side in lib/phone.ts).
 */

// ─────────────────── character classes ───────────────────

/**
 * `\p{L}` (letters) + `\p{M}` (combining marks) rather than A-Z: B2's contacts are Indian and
 * German, so "Müller", "Nováková" and "अमीन" are all real names. An ASCII-only rule would reject
 * the customer, not the typo. `\p{M}` matters because "ü" can arrive as u + U+0308 (NFD) from a
 * Mac paste — stripping the mark silently mangles the name to "Muller".
 */
const NAME_OK = String.raw`\p{L}\p{M}`;
/**
 * Separators a person's name legitimately contains: "M. S. Dhoni", "O'Brien", "Müller-Schmidt".
 *
 * "," and "/" are here because B2's own lead table says so: real rows read "Rahaman, Ameenur"
 * (surname-first) and "R.mani S/o rajavel" ("son of", an everyday South Indian construction).
 * Neither can be mistaken for a digit, so allowing them costs nothing and refusing them would
 * reject the customer's actual name.
 */
const NAME_PUNCT = String.raw` .,'’/\-`;

const NOT_NAME = new RegExp(`[^${NAME_OK}${NAME_PUNCT}]`, "gu");
/** Phone "special variables" — the country-code plus and the grouping a person types by habit. */
const NOT_PHONE = new RegExp(String.raw`[^\d+()\s\-]`, "g");
const NOT_DIGIT = /\D/g;

/** Collapse runs of whitespace and trim — names/emails paste in with stray spacing. */
const squish = (s: string) => s.replace(/\s+/g, " ").trimStart();

// ─────────────────── filters ───────────────────

const filterName = (raw: string) => squish(raw.replace(NOT_NAME, ""));

/** A "+" is only meaningful as the leading country-code marker, so keep the first and drop the rest. */
function filterPhone(raw: string): string {
  const kept = raw.replace(NOT_PHONE, "");
  const plus = kept.startsWith("+");
  return (plus ? "+" : "") + kept.replace(/\+/g, "");
}

const filterInt = (raw: string) => raw.replace(NOT_DIGIT, "");

/** Digits + at most one "." + at most `dp` decimals. Typing a 2nd "." is a no-op, not a reset. */
function makeDecimalFilter(dp: number) {
  return (raw: string) => {
    const kept = raw.replace(/[^\d.]/g, "");
    const [head, ...rest] = kept.split(".");
    if (rest.length === 0) return head;
    return `${head}.${rest.join("").slice(0, dp)}`;
  };
}

const filterMoney = makeDecimalFilter(2);
const filterRate = makeDecimalFilter(2);

/** Emails have no spaces; that is the only character worth blocking as you type. */
const filterEmail = (raw: string) => raw.replace(/\s/g, "");
const filterUrl = (raw: string) => raw.replace(/\s/g, "");
/** Free text: block nothing (a note may contain anything) — the cap is enforced by maxLength. */
const filterText = (raw: string) => raw;

// ─────────────────── caps ───────────────────

const MAX = {
  name: 160,
  email: 254,
  phone: 32,
  city: 120,
  url: 300,
  money: 15,
  int: 9,
  rate: 6,
  text: 2000,
} as const;

// ─────────────────── the table ───────────────────

export type FieldKind =
  | "name"
  | "phone"
  | "email"
  | "city"
  | "url"
  | "money"
  | "int"
  | "rate"
  | "text";

export type FieldRule = {
  filter: (raw: string) => string;
  /** Spread onto the <input>. `pattern` is a belt-and-braces native check, not the real gate. */
  attrs: {
    inputMode?: "text" | "numeric" | "decimal" | "tel" | "email" | "url";
    autoComplete?: string;
    maxLength?: number;
    type?: string;
    spellCheck?: boolean;
  };
  /** The message shown when a crafted POST (or a paste we couldn't clean) reaches the server. */
  schema: z.ZodType<string>;
};

/**
 * Names are checked with `.regex()` rather than `.refine()` so the failure message names the
 * offending class — "can't contain numbers" is actionable, "Invalid" is not.
 */
const nameSchema = z
  .string()
  .trim()
  .transform(squish)
  .pipe(
    z
      .string()
      .min(1, "Name is required")
      .max(MAX.name, "Name is too long")
      .regex(new RegExp(`^[${NAME_OK}${NAME_PUNCT}]+$`, "u"), "Name can only contain letters")
      // A name made only of dots/dashes passes the class check but is not a name.
      .refine((v) => new RegExp(`[${NAME_OK}]`, "u").test(v), "Enter a real name"),
  );

/**
 * Shape-only: 7-15 digits is the E.164 range. The authoritative per-country check lives in
 * lib/phone.ts (libphonenumber `/max` metadata) and runs where the number is actually dialled —
 * duplicating it here would put 150kB of metadata in the browser to re-answer the same question.
 */
const phoneSchema = z
  .string()
  .trim()
  .max(MAX.phone, "Phone number is too long")
  .regex(/^\+?[\d\s()-]+$/, "Phone can only contain numbers, spaces and + ( ) -")
  .refine((v) => {
    const d = v.replace(NOT_DIGIT, "").length;
    return d >= 7 && d <= 15;
  }, "Enter a valid phone number with country code");

const moneySchema = z
  .string()
  .trim()
  .regex(/^\d{1,12}(\.\d{1,2})?$/, "Enter an amount using numbers only");

const intSchema = z.string().trim().regex(/^\d{1,9}$/, "Enter a whole number");

const rateSchema = z
  .string()
  .trim()
  .regex(/^\d{1,3}(\.\d{1,2})?$/, "Enter a number")
  .refine((v) => Number(v) <= 100, "Must be 100 or less");

export const FIELD_RULES: Record<FieldKind, FieldRule> = {
  name: {
    filter: filterName,
    attrs: { inputMode: "text", autoComplete: "name", maxLength: MAX.name, spellCheck: false },
    schema: nameSchema,
  },
  phone: {
    filter: filterPhone,
    attrs: { type: "tel", inputMode: "tel", autoComplete: "tel", maxLength: MAX.phone },
    schema: phoneSchema,
  },
  email: {
    filter: filterEmail,
    attrs: {
      type: "email",
      inputMode: "email",
      autoComplete: "email",
      maxLength: MAX.email,
      spellCheck: false,
    },
    // Folded to lowercase to match access-requests.ts / booking-actions.ts, where the address is
    // the key a lead is matched on and "A@x.com" vs "a@x.com" would read as two people.
    schema: z.string().trim().toLowerCase().email("Enter a valid email address").max(MAX.email),
  },
  city: {
    // A city is name-shaped but not a person: "Baden-Württemberg", never a digit.
    filter: filterName,
    attrs: { inputMode: "text", autoComplete: "address-level2", maxLength: MAX.city },
    schema: z
      .string()
      .trim()
      .max(MAX.city, "City is too long")
      .regex(new RegExp(`^[${NAME_OK}${NAME_PUNCT}]*$`, "u"), "City can only contain letters"),
  },
  url: {
    filter: filterUrl,
    // NOT `type="url"`: the native check demands a scheme, and this sits on the PUBLIC booking
    // form. Rejecting a lead's "linkedin.com/in/x" over a missing "https://" costs a booking —
    // so the schema below adds the scheme instead of refusing the value.
    attrs: { inputMode: "url", maxLength: MAX.url, spellCheck: false },
    schema: z
      .string()
      .trim()
      .max(MAX.url, "Link is too long")
      // "linkedin.com/in/x" -> "https://linkedin.com/in/x"; an explicit http(s):// is left alone.
      .transform((v) => (v && !/^[a-z][a-z\d+\-.]*:\/\//i.test(v) ? `https://${v}` : v))
      .pipe(z.string().url("Enter a valid link"))
      /**
       * http(s) ONLY. `z.string().url()` is not a safety check — it happily accepts
       * `javascript://x%0Aalert(1)`, which is a live XSS payload the moment a stored link is
       * assigned to `window.location.href` (forms' `redirectUrl` does exactly that): `//x`
       * opens a JS comment, `%0A` closes it, and the tail executes. `data:` and `vbscript:`
       * are the same class of problem. An allow-list is the only version of this that holds.
       */
      .refine((v) => {
        try {
          return ["http:", "https:"].includes(new URL(v).protocol);
        } catch {
          return false;
        }
      }, "Links must start with http:// or https://"),
  },
  money: {
    filter: filterMoney,
    attrs: { inputMode: "decimal", autoComplete: "off", maxLength: MAX.money },
    schema: moneySchema,
  },
  int: {
    filter: filterInt,
    attrs: { inputMode: "numeric", autoComplete: "off", maxLength: MAX.int },
    schema: intSchema,
  },
  rate: {
    filter: filterRate,
    attrs: { inputMode: "decimal", autoComplete: "off", maxLength: MAX.rate },
    schema: rateSchema,
  },
  text: {
    filter: filterText,
    attrs: { maxLength: MAX.text },
    schema: z.string().trim().max(MAX.text, "Please keep this under 2000 characters"),
  },
};

// ─────────────────── server-side helpers ───────────────────

/** `optional()` on a required-shaped schema, treating "" (an untouched input) as absent. */
export function blankToUndefined<T extends z.ZodType<string>>(s: T) {
  return z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), s.optional());
}

/** The schema for a kind, as a required field. */
export const rule = (k: FieldKind) => FIELD_RULES[k].schema;
/** The schema for a kind, where an empty box means "not provided". */
export const optionalRule = (k: FieldKind) => blankToUndefined(FIELD_RULES[k].schema);

/** Bounded integer (scores, percentages, counts with a known ceiling). */
export function intInRange(min: number, max: number, label = "Enter a whole number") {
  return intSchema.refine((v) => {
    const n = Number(v);
    return n >= min && n <= max;
  }, `${label} between ${min} and ${max}`);
}

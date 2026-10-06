/**
 * Reading the founder's payment-type list (lib/config-schema `paymentTypes`).
 *
 * Pure and isomorphic: the Console panel, the income forms and the server actions all decide
 * "what kind of payment is this" with these functions, so a type's behaviour cannot differ
 * between the form that captured it and the action that stored it.
 */

import {
  DEFAULT_PAYMENT_TYPES_CONFIG,
  LOCKED_PAYMENT_TYPES,
  type PaymentTypeKind,
  type PaymentTypeOption,
  type PaymentTypesConfig,
} from "./config-schema";

/** The types a form should offer - active ones, in the founder's order. */
export function activePaymentTypes(config: PaymentTypesConfig): PaymentTypeOption[] {
  return config.types.filter((t) => t.active);
}

/**
 * Select options for a form.
 *
 * `include` is the code currently ON THE ROW being edited. A type deactivated after that row was
 * saved still has to appear, or opening the row to fix a typo would silently re-file it as
 * something else the moment it saved.
 */
export function paymentTypeOptions(
  config: PaymentTypesConfig,
  include?: string | null,
): { value: string; label: string }[] {
  const active = activePaymentTypes(config);
  const extra =
    include && !active.some((t) => t.code === include)
      ? config.types.filter((t) => t.code === include)
      : [];
  return [...active, ...extra].map((t) => ({
    value: t.code,
    label: extra.some((e) => e.code === t.code) ? `${t.label} (no longer offered)` : t.label,
  }));
}

/**
 * What a stored code MEANS - the behaviour the rest of the app branches on.
 *
 * A code with no row behind it (one deleted straight out of the AppSetting JSON, or a row older
 * than the config) falls back to the shipped default list and then to FULL. FULL is the safe
 * reading: it asks for nothing further and raises no receivable, so an unrecognised type can
 * never invent a debt or start chasing a student.
 */
export function paymentTypeKind(config: PaymentTypesConfig, code: string): PaymentTypeKind {
  const row =
    config.types.find((t) => t.code === code) ??
    DEFAULT_PAYMENT_TYPES_CONFIG.types.find((t) => t.code === code);
  return row?.kind ?? "FULL";
}

/** The founder's name for a code, falling back to the code itself so nothing renders blank. */
export function paymentTypeLabel(config: PaymentTypesConfig, code: string): string {
  return (
    config.types.find((t) => t.code === code)?.label ??
    DEFAULT_PAYMENT_TYPES_CONFIG.types.find((t) => t.code === code)?.label ??
    code
  );
}

/** Whether a type is one of the two the app branches on by name - locked against delete/retype. */
export function isLockedPaymentType(code: string): boolean {
  return LOCKED_PAYMENT_TYPES.some((l) => l.code === code);
}

/** Human labels for the recurrence intervals (Prisma `RecurrenceInterval`). */
export const RECURRENCE_INTERVAL_LABELS: Record<string, string> = {
  WEEKLY: "Weekly",
  MONTHLY: "Monthly",
  QUARTERLY: "Quarterly",
  HALF_YEARLY: "Half-yearly",
  YEARLY: "Yearly",
};

export const RECURRENCE_INTERVALS = Object.keys(RECURRENCE_INTERVAL_LABELS) as [
  string,
  ...string[],
];

/** Days added to get from one billing date to the next - used to suggest the next date. */
const INTERVAL_DAYS: Record<string, number> = {
  WEEKLY: 7,
  MONTHLY: 30,
  QUARTERLY: 91,
  HALF_YEARLY: 182,
  YEARLY: 365,
};

/**
 * The next billing date an interval implies, from an IST `YYYY-MM-DD`.
 *
 * A SUGGESTION, filled into an editable box - real arrangements bill on the 1st, or on the day
 * the card was set up, and nothing here overrides a date somebody typed. "" when the inputs
 * cannot produce one, so the caller leaves the box alone rather than blanking it.
 */
export function suggestNextBillingDate(fromIso: string, interval: string): string {
  const days = INTERVAL_DAYS[interval];
  const t = Date.parse(`${fromIso.slice(0, 10)}T00:00:00Z`);
  if (!days || Number.isNaN(t)) return "";
  // Calendar months rather than 30 days where the interval is a month or a multiple of one -
  // billing "monthly" from 31 Jan means 28 Feb, not 2 March.
  const d = new Date(t);
  const months = interval === "MONTHLY" ? 1 : interval === "QUARTERLY" ? 3 : interval === "HALF_YEARLY" ? 6 : interval === "YEARLY" ? 12 : 0;
  if (months === 0) {
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  }
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d.toISOString().slice(0, 10);
}

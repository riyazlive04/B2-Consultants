/**
 * Dialling data for the phone-number country picker (issue 4.3), isomorphic (no libphonenumber —
 * that 150kB of metadata stays server-only in lib/phone.ts, which remains the AUTHORITATIVE
 * validator). The `min`/`max` national-digit ranges here drive the picker's per-country length
 * limit + a soft client-side check; they're deliberately generous mobile ranges, not exhaustive
 * plans. The country list mirrors lib/whatsapp.ts COUNTRY_OPTIONS.
 */
export type CountryDial = {
  iso: string; // ISO-3166 alpha-2 — the value phone.ts / WATI settings expect
  name: string;
  dial: string; // country calling code, no "+"
  min: number; // min national digits (leading trunk 0 excluded)
  max: number; // max national digits
  example: string;
};

export const COUNTRY_DIALS: CountryDial[] = [
  { iso: "IN", name: "India", dial: "91", min: 10, max: 10, example: "98765 43210" },
  { iso: "DE", name: "Germany", dial: "49", min: 10, max: 11, example: "1512 3456789" },
  { iso: "AT", name: "Austria", dial: "43", min: 10, max: 11, example: "664 1234567" },
  { iso: "CH", name: "Switzerland", dial: "41", min: 9, max: 9, example: "78 123 45 67" },
  { iso: "GB", name: "United Kingdom", dial: "44", min: 10, max: 10, example: "7400 123456" },
  { iso: "US", name: "United States", dial: "1", min: 10, max: 10, example: "201 555 0123" },
  { iso: "AE", name: "United Arab Emirates", dial: "971", min: 9, max: 9, example: "50 123 4567" },
];

export const DEFAULT_DIAL_ISO = "IN";

export function dialFor(iso: string): CountryDial {
  return COUNTRY_DIALS.find((c) => c.iso === iso) ?? COUNTRY_DIALS[0];
}

/** Options for a country <select>: "India (+91)". */
export const COUNTRY_DIAL_OPTIONS = COUNTRY_DIALS.map((c) => ({
  value: c.iso,
  label: `${c.name} (+${c.dial})`,
}));

/**
 * Best-effort split of a stored/E.164 number back into { iso, national } so an edit form can
 * pre-fill the picker. Matches the LONGEST dial prefix (so +1 doesn't shadow +91). Falls back to
 * the default country with the raw digits when nothing matches — the server still re-validates.
 */
export function splitE164(raw: string | null | undefined): { iso: string; national: string } {
  const digits = (raw ?? "").replace(/[^\d+]/g, "");
  if (!digits) return { iso: DEFAULT_DIAL_ISO, national: "" };
  const bare = digits.startsWith("+") ? digits.slice(1) : digits;
  // Try the explicit-"+" case first; a bare national number (no "+") is assumed to be the
  // default country already, so we don't strip a prefix that isn't a country code.
  if (digits.startsWith("+") || digits.startsWith("00")) {
    const e164 = digits.startsWith("00") ? bare.slice(1) : bare;
    const match = [...COUNTRY_DIALS]
      .sort((a, b) => b.dial.length - a.dial.length)
      .find((c) => e164.startsWith(c.dial));
    if (match) return { iso: match.iso, national: e164.slice(match.dial.length) };
  }
  return { iso: DEFAULT_DIAL_ISO, national: bare };
}

/** Combine a picked country + typed national number into an E.164 string ("+491512345678"). */
export function toE164(iso: string, national: string): string {
  const c = dialFor(iso);
  const digits = national.replace(/\D/g, "").replace(/^0+/, ""); // drop trunk 0 (e.g. German 0151)
  return digits ? `+${c.dial}${digits}` : "";
}

/** National-digit count is within the country's expected range (soft, UX-only check). */
export function nationalLengthOk(iso: string, national: string): boolean {
  const c = dialFor(iso);
  const n = national.replace(/\D/g, "").replace(/^0+/, "").length;
  return n >= c.min && n <= c.max;
}

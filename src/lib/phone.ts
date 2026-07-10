// `/max` metadata, NOT the default `/min`: min only checks *possible length*, so it happily
// validates "+91 15123456789" (a German local number mis-assigned to India). max carries the full
// per-country number patterns and rejects it. This module is server-only, so the bigger metadata
// bundle costs us nothing in the browser.
import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js/max";

/**
 * Phone normalization for WhatsApp (WATI wants E.164 digits, no leading "+").
 *
 * B2 messages Indian AND German contacts, so a single "default country code" that we blindly
 * prepend is unsafe: `0151 2345 6789` is a German mobile, `098765 43210` is an Indian one, and
 * both are "a number starting with 0". Guessing wrong doesn't fail loudly — it WhatsApps a
 * stranger. So we delegate to libphonenumber-js, which knows each country's trunk prefixes and
 * valid lengths, and we **fail closed**: anything that isn't a demonstrably valid number returns
 * null, the send is SKIPPED, and the operator sees "No valid WhatsApp number" and fixes it.
 *
 * Resolution order for a raw string:
 *   1. "+49 151 …"        → parsed as-is (explicit country wins, whatever the default is).
 *   2. "0049 151 …"       → "00" is the international access prefix → treated as "+49 …".
 *   3. "98765 43210"      → national number → parsed against `defaultCountry`.
 *   4. "919876543210"     → bare E.164 digits (this is WATI's inbound `waId` shape) → retried
 *                           with a "+" when the national parse fails.
 *
 * Note the one case nothing can save: a German local number typed WITHOUT its trunk 0 and without
 * "+" (e.g. "15123456789") is indistinguishable from a valid US E.164 number. That is exactly why
 * the booking form asks for the country code.
 */

// The country dropdown list lives in lib/whatsapp.ts (static data, no dependency) so the client
// settings form can render it without pulling libphonenumber-js into the browser bundle.

export const DEFAULT_COUNTRY: CountryCode = "IN";

function isCountryCode(v: string): v is CountryCode {
  return /^[A-Z]{2}$/.test(v);
}

/** Coerce a stored/settings value into a valid ISO country, falling back to India. */
export function toCountry(raw: string | null | undefined): CountryCode {
  const v = (raw ?? "").trim().toUpperCase();
  return isCountryCode(v) ? v : DEFAULT_COUNTRY;
}

/**
 * Normalize to E.164 digits WITHOUT the leading "+" (WATI's expected `whatsappNumber` format).
 * Returns null when the number is missing, malformed, or not valid for the resolved country —
 * callers must skip the send rather than dial garbage.
 */
export function normalizeWhatsappNumber(
  raw: string | null | undefined,
  defaultCountry: string = DEFAULT_COUNTRY,
): string | null {
  if (!raw) return null;
  const country = toCountry(defaultCountry);

  let s = raw.trim();
  if (!s) return null;
  // "00" is the international access prefix; libphonenumber only understands "+".
  if (!s.startsWith("+") && /^00\d/.test(s.replace(/[\s()-]/g, ""))) {
    s = `+${s.replace(/[\s()-]/g, "").slice(2)}`;
  }

  // 1) Parse against the default country (handles trunk prefixes + explicit "+CC").
  const national = parsePhoneNumberFromString(s, country);
  if (national?.isValid()) return national.number.replace(/^\+/, "");

  // 2) Bare E.164 digits (WATI's `waId`, e.g. "919876543210") — retry with a "+".
  const digits = s.replace(/\D/g, "");
  if (!s.startsWith("+") && digits.length >= 11) {
    const e164 = parsePhoneNumberFromString(`+${digits}`);
    if (e164?.isValid()) return e164.number.replace(/^\+/, "");
  }

  return null;
}

/** Pretty international form for display, e.g. "+91 98765 43210". Falls back to "+digits". */
export function displayWhatsappNumber(normalized: string | null | undefined): string {
  if (!normalized) return "—";
  const parsed = parsePhoneNumberFromString(`+${normalized}`);
  return parsed?.formatInternational() ?? `+${normalized}`;
}

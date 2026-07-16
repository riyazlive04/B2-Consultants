import "server-only";
import crypto from "node:crypto";
import type { LeadSource } from "@prisma/client";

/**
 * Shared parsing for the flat-JSON lead webhooks (FlexiFunnels, Pabbly, a bare landing page).
 *
 * These senders all POST "some object with the opt-in fields in it somewhere", with no schema
 * we control and field names that differ per sender and per form. So the rule here is: read
 * permissively, cap hard, and never trust a key's spelling. The alternative — one bespoke parser
 * per sender — is how the same off-by-one field-name bug gets fixed twice.
 */

/** Case-insensitive field read across a list of aliases; first non-empty alias wins. */
export function pick(obj: Record<string, unknown>, ...keys: string[]): string | undefined {
  const lower = new Map(Object.entries(obj).map(([k, v]) => [k.toLowerCase(), v]));
  for (const k of keys) {
    const v = lower.get(k);
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number") return String(v);
  }
  return undefined;
}

export const cap = (v: string | undefined, max: number) => (v ? v.slice(0, max) : v);

/** Constant-time secret compare — a plain !== leaks length/prefix timing. */
export function secretMatches(provided: string, secret: string): boolean {
  const a = crypto.createHash("sha256").update(provided).digest();
  const b = crypto.createHash("sha256").update(secret).digest();
  return crypto.timingSafeEqual(a, b);
}

/** Some builders nest the opt-in fields under `data`/`contact`/`fields`/`payload`. */
export function unwrap(body: Record<string, unknown>): Record<string, unknown> {
  const nested = (["data", "contact", "fields", "payload"] as const)
    .map((k) => body[k])
    .find((v) => v && typeof v === "object" && !Array.isArray(v)) as Record<string, unknown> | undefined;
  return nested ?? body;
}

/** Forward any utm_* fields present in the payload (bounded: 10 keys, 200 chars each). */
export function extractUtm(f: Record<string, unknown>): Record<string, string> {
  const utm: Record<string, string> = {};
  for (const [k, v] of Object.entries(f)) {
    if (Object.keys(utm).length >= 10) break;
    if (k.toLowerCase().startsWith("utm_") && typeof v === "string" && v) {
      utm[k.toLowerCase().slice(0, 64)] = v.slice(0, 200);
    }
  }
  return utm;
}

export type ContactFields = {
  name?: string;
  phone?: string;
  email?: string;
  city?: string;
  externalRef?: string;
};

/** The contact fields common to every flat-JSON sender, already length-capped. */
export function extractContact(f: Record<string, unknown>): ContactFields {
  const email = cap(pick(f, "email", "email_address"), 254);
  return {
    name: cap(pick(f, "name", "full_name", "fullname", "first_name", "fname"), 160),
    phone: cap(pick(f, "phone", "phone_number", "mobile", "whatsapp", "contact_number"), 32),
    email,
    city: cap(pick(f, "city", "location"), 120),
    // Falling back to the email keeps redelivery idempotent for senders that post no record id:
    // without SOME stable ref, every retry would rely on the phone-dedupe pass alone.
    externalRef: cap(
      pick(f, "id", "lead_id", "submission_id", "contact_id") ?? (email ? `email:${email}` : undefined),
      300,
    ),
  };
}

/**
 * Map a free-text origin hint onto the LeadSource enum.
 *
 * A relay like Pabbly carries leads from several origins down one pipe, so the origin arrives as
 * a string the sender chose ("Facebook Lead Ad", "ig", "webinar"). Unrecognized values become
 * OTHER rather than a guess: a wrong attribution silently corrupts funnel reporting, whereas
 * OTHER is visibly wrong and gets noticed. Callers should log misses so aliases can be added.
 */
const LEAD_SOURCE_ALIASES: Record<string, LeadSource> = {
  instagram: "INSTAGRAM",
  ig: "INSTAGRAM",
  insta: "INSTAGRAM",
  youtube: "YOUTUBE",
  yt: "YOUTUBE",
  linkedin: "LINKEDIN",
  li: "LINKEDIN",
  whatsapp: "WHATSAPP",
  wa: "WHATSAPP",
  wati: "WHATSAPP",
  referral: "REFERRAL",
  refer: "REFERRAL",
  summit: "SUMMIT",
  workshop: "WORKSHOP",
  webinar: "WORKSHOP",
  meta: "META_ADS",
  metaads: "META_ADS",
  facebook: "META_ADS",
  fb: "META_ADS",
  fbleadad: "META_ADS",
  facebookleadad: "META_ADS",
  leadad: "META_ADS",
  landingpage: "LANDING_PAGE",
  landing: "LANDING_PAGE",
  website: "LANDING_PAGE",
  funnel: "LANDING_PAGE",
  flexifunnels: "LANDING_PAGE",
  ghostedblueprint: "GHOSTED_BLUEPRINT",
};

export function toLeadSource(hint: string | undefined): LeadSource | null {
  if (!hint) return null;
  // Fold "Facebook Lead Ad", "facebook_lead_ad" and "FB-LeadAd" onto one key.
  const key = hint.toLowerCase().replace(/[^a-z]/g, "");
  return LEAD_SOURCE_ALIASES[key] ?? null;
}

/** Where a relay might state the lead's origin, in descending order of trust. */
export function pickLeadSourceHint(f: Record<string, unknown>): string | undefined {
  return pick(f, "lead_source", "leadsource", "source", "channel", "platform", "utm_source");
}

/**
 * Coaching agreement — isomorphic core. NO prisma, NO server-only, NO secrets, so the founder's
 * field form (client) and the PDF renderer + server actions all import the same truth.
 *
 * THE ONE RULE: `AgreementData` is a frozen snapshot. Once an agreement is issued, the document
 * renders from this object and nothing else — it never joins back to the mutable Student row.
 * A contract must show what was true at signing, not what the CRM says today. That is also why
 * the student's postal address and the programme batch live here rather than as Student columns:
 * they are terms of *this* document.
 *
 * Token minting, hashing and rendering live in `agreement-token.ts` / `server/agreement-render.ts`,
 * because they need node:crypto and must not reach the browser bundle.
 */

import { z } from "zod";

/** The git-pinned renderer. Bump when the clauses change; old agreements keep rendering their own. */
export const AGREEMENT_TEMPLATE_VERSION = "guided-v3";

/** How long a signing link stays live. Longer than an invite (7d) — a contract deserves a re-read. */
export const AGREEMENT_TTL_DAYS = 14;

/** OTP that binds the signature to control of the delivery number. */
export const OTP_TTL_MINUTES = 10;
export const OTP_MAX_ATTEMPTS = 5;

/** Fixed party. Not founder-editable: these are the terms of B2 Consultants as an entity, and a
 *  typo in an IBAN on an executed contract is not a UI problem you want to have. */
export const AGREEMENT_PROVIDER = {
  name: "Ameenur Rahaman Servarr Basha",
  address: "Alter Weg 49, 64385 Reichelsheim, Germany",
  entity: "B2 Consultants",
  mobile: "+49 1522 2311 374",
  email: "info@b2consultants.de",
  website: "www.b2consultants.de",
} as const;

export const AGREEMENT_BANKS = [
  {
    title: "ING DiBa Bank (Germany)",
    iban: "DE74 5001 0517 6000 2479 49",
    bic: "INGBDEFFXXX",
    holder: AGREEMENT_PROVIDER.name,
  },
  {
    title: "Wise (International)",
    iban: "BE21 9056 7838 8503",
    bic: "TRWIBEB1XXX",
    holder: AGREEMENT_PROVIDER.name,
  },
] as const;

// ───────────────────────────────── Field schema ─────────────────────────────────

/** Money travels as a decimal string of MINOR units (paise), matching the BigInt columns
 *  elsewhere. JSON has no BigInt, and `number` silently loses precision past 2^53. */
const minorUnits = z
  .string()
  .regex(/^\d{1,15}$/, "Enter a whole rupee amount")
  .refine((v) => BigInt(v) > BigInt(0), "Amount must be greater than zero");

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date");

const instalmentSchema = z.object({
  amountInrMinor: minorUnits,
  /** Free text: §7.2 says "Before commencement of Week 1", "Before the commencement of 2nd Sprint Week". */
  dueMilestone: z.string().trim().min(3).max(120),
});

export const agreementDataSchema = z
  .object({
    student: z.object({
      fullName: z.string().trim().min(2, "Enter the student's full name").max(120),
      /** §2 header. No home for this on Student — and it must be frozen at signing anyway. */
      address: z.string().trim().min(5, "Enter the student's postal address").max(300),
      /** Delivery + OTP target. Stored raw; normalized at send time by lib/phone.ts. */
      phone: z.string().trim().min(5, "Enter a WhatsApp number with country code").max(32),
      email: z.union([z.string().trim().email().max(200), z.literal("")]).default(""),
    }),
    batch: z.object({
      /** §2.1 "Batch 12". Free text: batches are not a first-class model (GnBatch is the LMS cohort). */
      number: z.string().trim().min(1, "Enter the batch").max(40),
      startDate: isoDate,
    }),
    payment: z.discriminatedUnion("option", [
      z.object({
        option: z.literal("FULL"),
        totalInrMinor: minorUnits,
        dueMilestone: z.string().trim().min(3).max(120).default("Before commencement of Week 1"),
      }),
      z.object({
        option: z.literal("INSTALMENT"),
        totalInrMinor: minorUnits,
        /** §7.2 caps the plan at two instalments. */
        instalments: z.array(instalmentSchema).min(2).max(2),
      }),
    ]),
  })
  .superRefine((d, ctx) => {
    if (d.payment.option !== "INSTALMENT") return;
    // The invariant a founder editing a form at 11pm will break. 43,999 + 26,000 = 69,999.
    const sum = d.payment.instalments.reduce((a, i) => a + BigInt(i.amountInrMinor), BigInt(0));
    if (sum !== BigInt(d.payment.totalInrMinor)) {
      ctx.addIssue({
        code: "custom",
        path: ["payment", "instalments"],
        message: `Instalments add up to ${formatInrPlain(sum)}, but the total fee is ${formatInrPlain(
          BigInt(d.payment.totalInrMinor),
        )}.`,
      });
    }
  });

export type AgreementData = z.infer<typeof agreementDataSchema>;

// ───────────────────────────────── Formatting ─────────────────────────────────

const inrGrouping = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });

/**
 * "69,999 INR" — Indian grouping, the word INR, and deliberately NO ₹ symbol.
 *
 * ₹ (U+20B9) does not exist in WinAnsi, the encoding of react-pdf's built-in Helvetica, so it
 * renders as a blank box in the PDF. The master agreement writes "69,999 INR" for the same
 * reason a typesetter would. `formatInrMinor` (₹1,00,000.99) stays correct for the dashboard.
 */
export function formatInrPlain(minor: bigint | string): string {
  const n = typeof minor === "string" ? BigInt(minor) : minor;
  const whole = n / BigInt(100);
  const paise = n % BigInt(100);
  const major = paise === BigInt(0) ? inrGrouping.format(whole) : inrGrouping.format(Number(n) / 100);
  return `${major} INR`;
}

/** "04.07.2026" — the German convention the master uses throughout, from an ISO yyyy-mm-dd. */
export function formatGermanDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

/** Same, for an instant. Rendered in IST because that is where the student signs. */
export function formatGermanDateOf(d: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get("day")}.${get("month")}.${get("year")}`;
}

// ───────────────────────────── Content hashing ─────────────────────────────

/**
 * Canonical JSON: keys sorted at every depth, no whitespace. Two structurally identical objects
 * always produce the same string, whatever order the form built them in.
 *
 * This is what gets hashed into `dataSha256` and printed on every page. It is the reproducible
 * half of the integrity story — the PDF bytes are NOT reproducible (PDFKit stamps a creation date
 * and a document id), so `pdfSha256` proves the stored file is untouched while this proves what
 * was agreed. Never try to re-derive `pdfSha256` by re-rendering.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

/** The exact bytes that get hashed. Template version is inside, so the same fields under a
 *  different clause set hash differently — which is the whole point. */
export function canonicalPayload(data: AgreementData, templateVersion: string): string {
  return canonicalJson({ templateVersion, data });
}

/** The footer form: short enough to read aloud, long enough that collisions aren't a worry. */
export function shortHash(sha256Hex: string): string {
  return sha256Hex.slice(0, 16);
}

// ───────────────────────────── Display helpers ─────────────────────────────

/** Type-only import: erased at compile time, so this file stays safe for client components. */
export const AGREEMENT_EVENT_LABELS: Record<import("@prisma/client").AgreementEventType, string> = {
  CREATED: "Agreement created",
  ISSUED: "Countersigned & issued",
  DELIVERY_SENT: "Link sent via WhatsApp",
  DELIVERY_SKIPPED: "WhatsApp delivery skipped",
  VIEWED: "Opened by student",
  OTP_SENT: "One-time code sent",
  OTP_VERIFIED: "One-time code verified",
  OTP_FAILED: "Incorrect code entered",
  SIGNED: "Signed by student",
  DECLINED: "Declined by student",
  VOIDED: "Voided",
  COPY_DOWNLOADED: "Signed copy downloaded",
};

export const AGREEMENT_STATUS_LABELS = {
  DRAFT: "Draft",
  SENT: "Awaiting signature",
  VIEWED: "Opened by student",
  SIGNED: "Signed",
  DECLINED: "Declined",
  VOIDED: "Voided",
  EXPIRED: "Expired",
} as const satisfies Record<string, string>;

export type AgreementStatusKey = keyof typeof AGREEMENT_STATUS_LABELS;

export function agreementStatusTone(s: AgreementStatusKey): "good" | "warn" | "bad" | "muted" {
  switch (s) {
    case "SIGNED":
      return "good";
    case "SENT":
    case "VIEWED":
      return "warn";
    case "DECLINED":
    case "EXPIRED":
      return "bad";
    default:
      return "muted"; // DRAFT / VOIDED
  }
}

/** The §7.2 default plan, so the form opens on the shape the master actually uses. */
export function defaultInstalments(totalInrMinor: string): AgreementData["payment"] {
  const total = BigInt(totalInrMinor);
  const first = (total * BigInt(63)) / BigInt(100) / BigInt(100) * BigInt(100); // ~63%, whole rupees
  return {
    option: "INSTALMENT",
    totalInrMinor,
    instalments: [
      { amountInrMinor: first.toString(), dueMilestone: "Before commencement of Week 1" },
      {
        amountInrMinor: (total - first).toString(),
        dueMilestone: "Before the commencement of 2nd Sprint Week",
      },
    ],
  };
}

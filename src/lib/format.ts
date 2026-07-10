/**
 * Cross-cutting formatting rules (CONTEXT §6 / PRD1 §6):
 *  - INR in Indian grouping  →  ₹1,00,000.99   (Intl en-IN)
 *  - EUR in German grouping  →  100.000,99 €   (Intl de-DE)
 *  - Dates DD/MM/YYYY, displayed in IST (Asia/Kolkata), stored UTC.
 *  - All money travels as integer minor units (paise / cents), BigInt-safe.
 */

const inrFormatter = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const eurFormatter = new Intl.NumberFormat("de-DE", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const inrCompact = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

const eurCompact = new Intl.NumberFormat("de-DE", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
});

export function formatInrMinor(minor: bigint | number, opts?: { compact?: boolean }): string {
  const major = Number(minor) / 100;
  return (opts?.compact ? inrCompact : inrFormatter).format(major);
}

export function formatEurMinor(minor: bigint | number, opts?: { compact?: boolean }): string {
  const major = Number(minor) / 100;
  return (opts?.compact ? eurCompact : eurFormatter).format(major);
}

/** DD/MM/YYYY in IST regardless of server/browser timezone. */
export function formatDate(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  }).format(date);
}

/** e.g. "July 2026" for the top bar / month pickers. */
export function formatMonth(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  return new Intl.DateTimeFormat("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  }).format(date);
}

/**
 * A slot instant rendered in a given IANA zone - e.g. "Tue 07 Jul, 3:30 PM".
 * Europe/Berlin correctly yields CET/CEST with DST; Asia/Kolkata yields IST.
 * (Wave-1 booking: prospects see their local IST time, the closer sees CET like Synamate.)
 */
export function formatDateTimeInZone(d: Date | string, timeZone: string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
    timeZone,
  }).format(date);
}

/** Percentage with one decimal, e.g. 72.5% */
export function formatPct(value: number): string {
  return `${(Math.round(value * 10) / 10).toLocaleString("en-IN")}%`;
}

/** Compact elapsed time, e.g. "8m", "2h", "1.3d" - used for speed-to-lead (Wave-1). */
export function formatDuration(ms: number): string {
  if (ms < 0) ms = 0;
  const mins = ms / 60000;
  if (mins < 60) return `${Math.max(1, Math.round(mins))}m`;
  const hours = mins / 60;
  if (hours < 24) return `${hours < 10 ? hours.toFixed(1) : Math.round(hours)}h`;
  const days = hours / 24;
  return `${days < 10 ? days.toFixed(1) : Math.round(days)}d`;
}

/** Major-unit string ("1500.50") → minor-unit BigInt (150050). Form-input helper.
 *  Rounds half-up past 2 decimals (never silently floors money) and only ever
 *  feeds digit-clean strings to BigInt. */
export function majorStringToMinor(input: string): bigint {
  const cleaned = input.replace(/[^\d.-]/g, "");
  if (!cleaned || cleaned === "-" || cleaned === ".") return BigInt(0);
  const [whole, fracRaw = ""] = cleaned.split(".");
  const frac = fracRaw.replace(/\D/g, ""); // strays like "1.-5" must not reach BigInt
  const fracPadded = (frac + "00").slice(0, 2);
  const roundUp = frac.length > 2 && Number(frac[2]) >= 5 ? BigInt(1) : BigInt(0);
  const negative = whole.startsWith("-");
  const wholeAbs = whole.replace(/\D/g, "") || "0";
  const minor = BigInt(wholeAbs) * BigInt(100) + BigInt(fracPadded || "0") + roundUp;
  return negative ? -minor : minor;
}

/** Minor-unit BigInt → plain major string for form defaults ("1500.50"). */
export function minorToMajorString(minor: bigint): string {
  const negative = minor < BigInt(0);
  const abs = negative ? -minor : minor;
  const whole = abs / BigInt(100);
  const frac = (abs % BigInt(100)).toString().padStart(2, "0");
  return `${negative ? "-" : ""}${whole}.${frac}`;
}

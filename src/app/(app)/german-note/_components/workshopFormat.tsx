import type { GnWorkshopProduct, GnWorkshopDayType, GnConversionStatus, GnWorkshopSource } from "@prisma/client";
import { formatInrMinor, formatPct } from "@/lib/format";

/**
 * Client-safe formatting + labels for the workshop screens. Kept out of the
 * server-only read module so both the server page and the client panels can
 * import it. Money arrives as INR paise `number`s.
 */

export const PRODUCT_LABELS: Record<GnWorkshopProduct, string> = {
  A1: "A1",
  A2: "A2",
  B1: "B1",
  A1_A2: "A1 · A2",
  A2_B1: "A2 · B1",
  A1_A2_B1: "A1 · A2 · B1",
};

export const PRODUCT_OPTIONS = (["A1", "A2", "B1", "A1_A2", "A2_B1", "A1_A2_B1"] as GnWorkshopProduct[]).map(
  (value) => ({ value, label: PRODUCT_LABELS[value] })
);

export const DAY_TYPE_OPTIONS = [
  { value: "WEEKDAY", label: "Weekday" },
  { value: "WEEKEND", label: "Weekend" },
];

export const CONV_STATUS_OPTIONS = [
  { value: "CONFIRMED", label: "Confirmed" },
  { value: "ON_HOLD", label: "On hold" },
];

export const SOURCE_OPTIONS = [
  { value: "AD", label: "Ad campaign" },
  { value: "ORGANIC", label: "Organic / referral" },
];

export const SOURCE_LABELS: Record<GnWorkshopSource, string> = {
  AD: "Ad",
  ORGANIC: "Organic",
};

export const DAY_TYPE_LABELS: Record<GnWorkshopDayType, string> = {
  WEEKDAY: "Weekday",
  WEEKEND: "Weekend",
};

export const CONV_STATUS_LABELS: Record<GnConversionStatus, string> = {
  CONFIRMED: "Confirmed",
  ON_HOLD: "On hold",
};

/** INR from paise. `compact` drops the paise for tiles/headers. */
export function inr(minor: number, compact = false): string {
  return formatInrMinor(minor, { compact });
}

/** A 0..1 fraction → "48.8%"; null → "—". */
export function pct(frac: number | null): string {
  return frac === null ? "—" : formatPct(frac * 100);
}

export function ProductChip({ product }: { product: GnWorkshopProduct }) {
  const bundle = product.includes("_");
  return (
    <span
      className={`rounded-full px-2.5 py-0.5 text-caption font-semibold text-ink ${
        bundle ? "bg-lvl-gn/20" : "bg-lvl-gn/10"
      }`}
    >
      {PRODUCT_LABELS[product]}
    </span>
  );
}

export function StatusChip({ status }: { status: GnConversionStatus }) {
  if (status === "CONFIRMED") return null;
  return (
    <span className="rounded-full bg-warn-soft px-2 py-0.5 text-caption font-semibold text-warn">On hold</span>
  );
}

/** Money in --good when ≥ 0, --bad when negative (net profit, balance). */
export function Signed({ minor, compact = false }: { minor: number; compact?: boolean }) {
  return <span className={minor < 0 ? "text-bad tnum" : "text-ink tnum"}>{inr(minor, compact)}</span>;
}

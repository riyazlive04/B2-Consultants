import { Prisma } from "@prisma/client";
import { eurMinorToInrMinor, inrMinorToEurMinor } from "./fx";
import { majorStringToMinor } from "./format";

/**
 * PRD1 money rule: each entry keeps INR and EUR separately AND aggregates in both
 * currencies at the live rate. Entry forms accept either (or both) amounts; the
 * missing side is derived once at save time and the rate used is stamped forever.
 */
export function resolveAmounts(
  inrInput: string | null | undefined,
  eurInput: string | null | undefined,
  inrPerEur: Prisma.Decimal,
): { inrMinor: bigint; eurMinor: bigint } {
  const inrMinor = inrInput?.trim() ? majorStringToMinor(inrInput) : BigInt(0);
  const eurMinor = eurInput?.trim() ? majorStringToMinor(eurInput) : BigInt(0);
  return { inrMinor, eurMinor };
}

/** Aggregate value of a record in INR minor units: INR part + EUR part converted. */
export function aggInrMinor(
  inrMinor: bigint,
  eurMinor: bigint,
  fxRateUsed: Prisma.Decimal | string,
): bigint {
  const rate = new Prisma.Decimal(fxRateUsed.toString());
  return inrMinor + eurMinorToInrMinor(eurMinor, rate);
}

/** Aggregate value of a record in EUR minor units: EUR part + INR part converted. */
export function aggEurMinor(
  inrMinor: bigint,
  eurMinor: bigint,
  fxRateUsed: Prisma.Decimal | string,
): bigint {
  const rate = new Prisma.Decimal(fxRateUsed.toString());
  return eurMinor + inrMinorToEurMinor(inrMinor, rate);
}

/** Sum aggregates across records, each at its own stored rate (history never shifts). */
export function sumAgg(
  rows: Array<{ amountInrMinor: bigint; amountEurMinor: bigint; fxRateUsed: Prisma.Decimal }>,
): { inr: bigint; eur: bigint } {
  let inr = BigInt(0);
  let eur = BigInt(0);
  for (const r of rows) {
    inr += aggInrMinor(r.amountInrMinor, r.amountEurMinor, r.fxRateUsed);
    eur += aggEurMinor(r.amountInrMinor, r.amountEurMinor, r.fxRateUsed);
  }
  return { inr, eur };
}

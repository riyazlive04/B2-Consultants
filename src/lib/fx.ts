import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";

const FX_API_URL = process.env.FX_API_URL ?? "https://api.frankfurter.app";

/** Last-resort rate if the API is down and the cache is empty (flagged in UI as stale). */
const FALLBACK_INR_PER_EUR = new Prisma.Decimal("90");

function utcDateOnly(d = new Date()): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/**
 * Daily ECB rate (frankfurter.app), cached in the fx_rate table - one row per day.
 * Every money record stamps `fxRateUsed` at write time, so history never shifts
 * when the rate moves (CONTEXT §6).
 */
export async function getTodayInrPerEur(): Promise<{
  rate: Prisma.Decimal;
  date: Date;
  stale: boolean;
}> {
  const today = utcDateOnly();

  const cached = await prisma.fxRate.findUnique({ where: { date: today } });
  if (cached) return { rate: cached.inrPerEur, date: cached.date, stale: false };

  try {
    const res = await fetch(`${FX_API_URL}/latest?from=EUR&to=INR`, {
      next: { revalidate: 0 },
    });
    if (!res.ok) throw new Error(`FX API ${res.status}`);
    const data = (await res.json()) as { rates: { INR: number }; date: string };
    const rate = new Prisma.Decimal(data.rates.INR.toFixed(6));
    const row = await prisma.fxRate.upsert({
      where: { date: today },
      update: { inrPerEur: rate },
      create: { date: today, inrPerEur: rate },
    });
    return { rate: row.inrPerEur, date: row.date, stale: false };
  } catch {
    // API down → newest cached rate; else hard fallback, marked stale either way.
    const latest = await prisma.fxRate.findFirst({ orderBy: { date: "desc" } });
    if (latest) return { rate: latest.inrPerEur, date: latest.date, stale: true };
    return { rate: FALLBACK_INR_PER_EUR, date: today, stale: true };
  }
}

/** Convert paise → cents at a given INR-per-EUR rate (both integer minor units). */
export function inrMinorToEurMinor(inrMinor: bigint, inrPerEur: Prisma.Decimal): bigint {
  const eur = new Prisma.Decimal(inrMinor.toString()).div(inrPerEur);
  return BigInt(eur.toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP).toFixed(0));
}

/** Convert cents → paise at a given INR-per-EUR rate. */
export function eurMinorToInrMinor(eurMinor: bigint, inrPerEur: Prisma.Decimal): bigint {
  const inr = new Prisma.Decimal(eurMinor.toString()).mul(inrPerEur);
  return BigInt(inr.toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP).toFixed(0));
}

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
type FxResult = { rate: Prisma.Decimal; date: Date; stale: boolean };

// The rate is constant for a whole UTC day - remember today's answer in-process
// so repeated callers skip even the indexed DB lookup. Stale results (API down)
// are not memoized, so recovery is retried on the next call.
let fxMemo: { dayKey: number; value: FxResult } | null = null;

export async function getTodayInrPerEur(): Promise<FxResult> {
  const today = utcDateOnly();
  if (fxMemo && fxMemo.dayKey === today.getTime()) return fxMemo.value;

  const cached = await prisma.fxRate.findUnique({ where: { date: today } });
  if (cached) {
    fxMemo = { dayKey: today.getTime(), value: { rate: cached.inrPerEur, date: cached.date, stale: false } };
    return fxMemo.value;
  }

  try {
    /**
     * Bounded, because this sits on a path a person waits on.
     *
     * An opportunity card stamps the day's rate at creation, and a card can be created by a
     * public form submission - so an unresponsive frankfurter.app used to hold that submission
     * open for as long as the OS would keep the socket alive. Four seconds is far longer than
     * the API's normal reply and far shorter than anyone's patience, and the timeout lands in
     * the same `catch` as an HTTP error: newest cached rate, else the flagged-stale fallback.
     * The first caller of each UTC day is the only one who can ever pay it, and the daily
     * `prewarmTodayFx` cron exists so that caller is a cron rather than a customer.
     */
    const res = await fetch(`${FX_API_URL}/latest?from=EUR&to=INR`, {
      next: { revalidate: 0 },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) throw new Error(`FX API ${res.status}`);
    const data = (await res.json()) as { rates: { INR: number }; date: string };
    const rate = new Prisma.Decimal(data.rates.INR.toFixed(6));
    const row = await prisma.fxRate.upsert({
      where: { date: today },
      update: { inrPerEur: rate },
      create: { date: today, inrPerEur: rate },
    });
    fxMemo = { dayKey: today.getTime(), value: { rate: row.inrPerEur, date: row.date, stale: false } };
    return fxMemo.value;
  } catch {
    // API down → newest cached rate; else hard fallback, marked stale either way.
    const latest = await prisma.fxRate.findFirst({ orderBy: { date: "desc" } });
    if (latest) return { rate: latest.inrPerEur, date: latest.date, stale: true };
    return { rate: FALLBACK_INR_PER_EUR, date: today, stale: true };
  }
}

/**
 * Warm today's rate ahead of the first user request (audit §C #18). getTodayInrPerEur already
 * fetches-and-caches lazily; the gap was that the FIRST caller of each UTC day paid the
 * frankfurter.app round-trip inline in their request, and if the API happened to be down at
 * that instant the whole day fell back to the stale/₹90 rate. A daily cron calls this just
 * after 00:00 UTC so a real person never eats the fetch and recovery is attempted early.
 * Idempotent and side-effect-free beyond the same upsert getTodayInrPerEur already does.
 */
export async function prewarmTodayFx(): Promise<{ rate: string; date: string; stale: boolean }> {
  const r = await getTodayInrPerEur();
  return { rate: r.rate.toString(), date: r.date.toISOString().slice(0, 10), stale: r.stale };
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

/**
 * The rate for a GIVEN date - what a back-dated payment has to be valued at (issue 14).
 *
 * A euro payment dated 16 January was being stored at TODAY'S rate, because every entry action
 * called `getTodayInrPerEur()` regardless of the date on the form. €100 in January came out as
 * ₹10,789 because that is what a euro is worth now, and the aggregate rupee figure for a past
 * month therefore moved every time the euro did - which is the exact thing stamping `fxRateUsed`
 * on each row was meant to prevent.
 *
 * Resolution order, cheapest first:
 *   1. today        → `getTodayInrPerEur()`, memo and all.
 *   2. a stored day → the `fx_rate` row for that date (one row per day, already indexed).
 *   3. the API      → frankfurter's historical endpoint for that exact day, then cached.
 *   4. fallback     → the newest stored rate AT OR BEFORE that date, flagged stale; failing
 *                     that, today's. A market holiday has no rate of its own, so "the rate in
 *                     force on that day" is the last one published before it - which is also
 *                     what the ECB means by it.
 *
 * A FUTURE date resolves to today's rate: there is no such rate yet, and refusing the entry
 * would block a legitimately post-dated receipt. `stale` is true whenever the answer is not the
 * rate actually published for the day asked for, so the form can say so.
 */
export async function getInrPerEurOn(date: Date): Promise<FxResult> {
  const day = utcDateOnly(date);
  const today = utcDateOnly();
  if (day.getTime() >= today.getTime()) return getTodayInrPerEur();

  const cached = await prisma.fxRate.findUnique({ where: { date: day } });
  if (cached) return { rate: cached.inrPerEur, date: cached.date, stale: false };

  const ymd = day.toISOString().slice(0, 10);
  try {
    // Same 4s bound as the live call: this sits on a path a person is waiting on, and a slow
    // historical lookup must not hold an entry form open.
    const res = await fetch(`${FX_API_URL}/${ymd}?from=EUR&to=INR`, {
      next: { revalidate: 0 },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) throw new Error(`FX API ${res.status}`);
    const data = (await res.json()) as { rates: { INR: number }; date: string };
    const rate = new Prisma.Decimal(data.rates.INR.toFixed(6));
    /**
     * Stored under the date ASKED FOR, not the date the API answered with.
     *
     * Frankfurter answers a weekend or a holiday with the previous business day's figures, so
     * keying the row by `data.date` would leave the requested day uncached and re-fetch it on
     * every single entry for that date, forever.
     */
    const row = await prisma.fxRate.upsert({
      where: { date: day },
      update: { inrPerEur: rate },
      create: { date: day, inrPerEur: rate },
    });
    return { rate: row.inrPerEur, date: row.date, stale: false };
  } catch {
    const before = await prisma.fxRate.findFirst({
      where: { date: { lte: day } },
      orderBy: { date: "desc" },
    });
    if (before) return { rate: before.inrPerEur, date: before.date, stale: true };
    const now = await getTodayInrPerEur();
    return { ...now, stale: true };
  }
}

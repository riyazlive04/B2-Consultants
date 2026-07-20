import "server-only";

import { cache } from "react";
import { prisma } from "@/lib/prisma";
import type {
  GnWorkshopProduct,
  GnWorkshopDayType,
  GnWorkshopStatus,
  GnConversionStatus,
  GnWorkshopSource,
} from "@prisma/client";
import {
  PRODUCT_LEVELS,
  PRODUCT_ORDER,
  SEAT_LEVELS,
  standardBooksCost,
  standardTutorCost,
  type SeatLevel,
} from "@/lib/gn-workshop-pricing";

/**
 * German Note — Workshops read layer (Admin-only; guarded in the page + actions).
 *
 * A workshop is a paid-ad taster intake; a share of attendees convert into a
 * level course (A1 / A2 / B1 or a discounted bundle). This module turns the
 * stored INPUTS (who bought what, what they actually paid, ad-driven vs organic)
 * into the founders' workbook view — by-level headline, batch capacity grid,
 * ad-performance funnel and P&L — computing every derived figure by rule:
 *
 *   COGS         = books + tutor     (DERIVED from the product cost model;
 *                                      lib/gn-workshop-pricing, overridable per row)
 *   ad spend     = workshop ad-set spend ÷ its AD conversions   (DERIVED, allocated)
 *   Gross Profit = final − COGS                     GP% = GP / final
 *   Total Exp    = COGS + adSpend + referral
 *   Net Profit   = final − Total Exp                NP% = NP / final
 *   ROAS         = final ÷ adSpend
 *   Balance      = paid − final   (negative = owed)
 *
 * Verified against the March rollup — COGS ₹404,708.41 → GP 48.83%, NP 45.76%.
 * Money crosses to client components as INR paise `number`s (BigInt isn't
 * JSON-serialisable; these figures stay well under Number.MAX_SAFE_INTEGER).
 */

export type { SeatLevel };
export { SEAT_LEVELS, PRODUCT_ORDER };

// ── computed shapes ────────────────────────────────────────────

/** A per-conversion P&L line, all money in paise. */
export type ConvPnl = {
  final: number;
  paid: number;
  balance: number;
  books: number;
  tutor: number;
  ads: number;
  referral: number;
  cogs: number;
  grossProfit: number;
  totalExp: number;
  netProfit: number;
  gpMargin: number | null; // fraction 0..1; null when final = 0 (free seat)
  npMargin: number | null;
  roas: number | null; // null when no ad spend allocated
};

/** Compose the P&L from the resolved money components (all paise). */
function pnlFrom(final: number, paid: number, books: number, tutor: number, ads: number, referral: number): ConvPnl {
  const cogs = books + tutor;
  const grossProfit = final - cogs;
  const totalExp = cogs + ads + referral;
  const netProfit = final - totalExp;
  return {
    final,
    paid,
    balance: paid - final,
    books,
    tutor,
    ads,
    referral,
    cogs,
    grossProfit,
    totalExp,
    netProfit,
    gpMargin: final > 0 ? grossProfit / final : null,
    npMargin: final > 0 ? netProfit / final : null,
    roas: ads > 0 ? final / ads : null,
  };
}

export type GnConversionRow = {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  product: GnWorkshopProduct;
  levels: SeatLevel[];
  dayType: GnWorkshopDayType;
  source: GnWorkshopSource;
  batches: { level: SeatLevel; batch: string | null; time: string | null }[];
  status: GnConversionStatus;
  isFreeSeat: boolean;
  paymentMethod: string | null;
  nextDueDate: string | null;
  notes: string | null;
  // whether this row's books/tutor came from an explicit override vs the model
  costOverridden: boolean;
  pnl: ConvPnl;
};

type ConversionRecord = {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  product: GnWorkshopProduct;
  dayType: GnWorkshopDayType;
  source: GnWorkshopSource;
  batchA1: string | null;
  timeA1: string | null;
  batchA2: string | null;
  timeA2: string | null;
  batchB1: string | null;
  timeB1: string | null;
  status: GnConversionStatus;
  isFreeSeat: boolean;
  paymentMethod: string | null;
  nextDueDate: Date | null;
  notes: string | null;
  finalPriceInrMinor: bigint;
  paidAmountInrMinor: bigint;
  booksCostOverrideInrMinor: bigint | null;
  tutorCostOverrideInrMinor: bigint | null;
  referralInrMinor: bigint;
};

type AdSetRecord = {
  id: string;
  label: string | null;
  adSpendInrMinor: bigint;
  reach: number;
  linkClicks: number;
  attended: number;
  conversions: number;
};

/**
 * Turn stored conversions + ad-sets into computed rows. Costs are DERIVED from
 * the product (override wins when present); ad spend is DERIVED by splitting the
 * workshop's total ad-set spend across its AD conversions.
 */
function buildRows(conversions: ConversionRecord[], adSets: AdSetRecord[]): GnConversionRow[] {
  const totalAdSpend = adSets.reduce((a, s) => a + Number(s.adSpendInrMinor), 0);
  const adConvCount = conversions.filter((c) => c.source === "AD").length;
  const adPerConversion = adConvCount > 0 ? totalAdSpend / adConvCount : 0;

  return conversions.map((c) => {
    const levels = PRODUCT_LEVELS[c.product];
    const batchFor: Record<SeatLevel, { batch: string | null; time: string | null }> = {
      A1: { batch: c.batchA1, time: c.timeA1 },
      A2: { batch: c.batchA2, time: c.timeA2 },
      B1: { batch: c.batchB1, time: c.timeB1 },
    };
    const booksOverride = c.booksCostOverrideInrMinor;
    const tutorOverride = c.tutorCostOverrideInrMinor;
    const books = booksOverride !== null ? Number(booksOverride) : standardBooksCost(c.product);
    const tutor = tutorOverride !== null ? Number(tutorOverride) : standardTutorCost(c.product);
    const ads = c.source === "AD" ? Math.round(adPerConversion) : 0;
    return {
      id: c.id,
      fullName: c.fullName,
      email: c.email,
      phone: c.phone,
      address: c.address,
      product: c.product,
      levels,
      dayType: c.dayType,
      source: c.source,
      batches: levels.map((level) => ({ level, ...batchFor[level] })),
      status: c.status,
      isFreeSeat: c.isFreeSeat,
      paymentMethod: c.paymentMethod,
      nextDueDate: c.nextDueDate ? c.nextDueDate.toISOString() : null,
      notes: c.notes,
      costOverridden: booksOverride !== null || tutorOverride !== null,
      pnl: pnlFrom(
        Number(c.finalPriceInrMinor),
        Number(c.paidAmountInrMinor),
        books,
        tutor,
        ads,
        Number(c.referralInrMinor)
      ),
    };
  });
}

/** Sum of a money selector over rows (paise). */
const sum = <T,>(rows: T[], sel: (r: T) => number) => rows.reduce((a, r) => a + sel(r), 0);

export type GnPnlRollup = {
  conversions: number;
  paying: number;
  freeSeats: number;
  onHold: number;
  adDriven: number;
  organic: number;
  revenue: number; // Σ final
  cashCollected: number; // Σ paid
  balance: number; // cash − revenue (negative = outstanding)
  books: number;
  tutor: number;
  cogs: number;
  ads: number;
  referral: number;
  grossProfit: number;
  gpMargin: number | null;
  totalExp: number;
  netProfit: number;
  npMargin: number | null;
  roas: number | null;
};

function rollup(rows: GnConversionRow[]): GnPnlRollup {
  const revenue = sum(rows, (r) => r.pnl.final);
  const cashCollected = sum(rows, (r) => r.pnl.paid);
  const books = sum(rows, (r) => r.pnl.books);
  const tutor = sum(rows, (r) => r.pnl.tutor);
  const ads = sum(rows, (r) => r.pnl.ads);
  const referral = sum(rows, (r) => r.pnl.referral);
  const cogs = books + tutor;
  const grossProfit = revenue - cogs;
  const totalExp = cogs + ads + referral;
  const netProfit = revenue - totalExp;
  return {
    conversions: rows.length,
    paying: rows.filter((r) => !r.isFreeSeat).length,
    freeSeats: rows.filter((r) => r.isFreeSeat).length,
    onHold: rows.filter((r) => r.status === "ON_HOLD").length,
    adDriven: rows.filter((r) => r.source === "AD").length,
    organic: rows.filter((r) => r.source === "ORGANIC").length,
    revenue,
    cashCollected,
    balance: cashCollected - revenue,
    books,
    tutor,
    cogs,
    ads,
    referral,
    grossProfit,
    gpMargin: revenue > 0 ? grossProfit / revenue : null,
    totalExp,
    netProfit,
    npMargin: revenue > 0 ? netProfit / revenue : null,
    roas: ads > 0 ? revenue / ads : null,
  };
}

/** The headline: for each product bought, how many converted and what revenue. */
export type GnByProduct = {
  product: GnWorkshopProduct;
  count: number;
  revenue: number;
  cashCollected: number;
};

function byProduct(rows: GnConversionRow[]): GnByProduct[] {
  return PRODUCT_ORDER.map((product) => {
    const rs = rows.filter((r) => r.product === product);
    return {
      product,
      count: rs.length,
      revenue: sum(rs, (r) => r.pnl.final),
      cashCollected: sum(rs, (r) => r.pnl.paid),
    };
  }).filter((p) => p.count > 0);
}

/** Seats per level, counting each level a bundle enrols into. */
export type GnBySeatLevel = { level: SeatLevel; seats: number };

function bySeatLevel(rows: GnConversionRow[]): GnBySeatLevel[] {
  return SEAT_LEVELS.map((level) => ({
    level,
    seats: rows.filter((r) => r.levels.includes(level)).length,
  }));
}

/** Batch capacity, derived from the conversions' own batch assignments. */
export type GnCapacityRow = {
  level: SeatLevel;
  dayType: GnWorkshopDayType;
  time: string | null;
  batch: string | null;
  seats: number;
};

function capacityGrid(rows: GnConversionRow[]): GnCapacityRow[] {
  const map = new Map<string, GnCapacityRow>();
  for (const r of rows) {
    for (const b of r.batches) {
      if (!b.batch && !b.time) continue; // unassigned — nothing to bucket
      const key = `${b.level}|${r.dayType}|${b.batch ?? ""}|${b.time ?? ""}`;
      const existing = map.get(key);
      if (existing) existing.seats += 1;
      else map.set(key, { level: b.level, dayType: r.dayType, time: b.time, batch: b.batch, seats: 1 });
    }
  }
  const levelRank: Record<SeatLevel, number> = { A1: 0, A2: 1, B1: 2 };
  return [...map.values()].sort(
    (a, b) =>
      levelRank[a.level] - levelRank[b.level] ||
      a.dayType.localeCompare(b.dayType) ||
      (a.batch ?? "").localeCompare(b.batch ?? "") ||
      (a.time ?? "").localeCompare(b.time ?? "")
  );
}

// ── ad performance ─────────────────────────────────────────────

export type GnAdSetRow = {
  id: string;
  label: string | null;
  adSpend: number; // paise
  reach: number;
  linkClicks: number;
  attended: number;
  conversions: number;
  ctr: number | null; // clicks / reach
  cpc: number | null; // spend / clicks (paise)
  showUpRate: number | null; // attended / clicks
  convRate: number | null; // conversions / attended
};

function adSetRow(a: AdSetRecord): GnAdSetRow {
  const adSpend = Number(a.adSpendInrMinor);
  return {
    id: a.id,
    label: a.label,
    adSpend,
    reach: a.reach,
    linkClicks: a.linkClicks,
    attended: a.attended,
    conversions: a.conversions,
    ctr: a.reach > 0 ? a.linkClicks / a.reach : null,
    cpc: a.linkClicks > 0 ? adSpend / a.linkClicks : null,
    showUpRate: a.linkClicks > 0 ? a.attended / a.linkClicks : null,
    convRate: a.attended > 0 ? a.conversions / a.attended : null,
  };
}

export type GnAdTotals = {
  adSpend: number;
  reach: number;
  linkClicks: number;
  attended: number;
  conversions: number;
  ctr: number | null;
  cpc: number | null;
  convRate: number | null;
};

function adTotals(sets: GnAdSetRow[]): GnAdTotals {
  const adSpend = sum(sets, (s) => s.adSpend);
  const reach = sum(sets, (s) => s.reach);
  const linkClicks = sum(sets, (s) => s.linkClicks);
  const attended = sum(sets, (s) => s.attended);
  const conversions = sum(sets, (s) => s.conversions);
  return {
    adSpend,
    reach,
    linkClicks,
    attended,
    conversions,
    ctr: reach > 0 ? linkClicks / reach : null,
    cpc: linkClicks > 0 ? adSpend / linkClicks : null,
    convRate: attended > 0 ? conversions / attended : null,
  };
}

// ── summary (Workshops tab list) ───────────────────────────────

export type GnWorkshopSummary = {
  id: string;
  name: string;
  month: string; // ISO date
  status: GnWorkshopStatus;
  notes: string | null;
  rollup: GnPnlRollup;
  seats: GnBySeatLevel[];
  adTotals: GnAdTotals;
};

export const getGnWorkshops = cache(async (): Promise<GnWorkshopSummary[]> => {
  const workshops = await prisma.gnWorkshop.findMany({
    orderBy: [{ status: "asc" }, { month: "desc" }],
    include: { conversions: true, adSets: true },
  });
  return workshops.map((w) => {
    const rows = buildRows(w.conversions, w.adSets);
    const sets = w.adSets.map(adSetRow);
    return {
      id: w.id,
      name: w.name,
      month: w.month.toISOString(),
      status: w.status,
      notes: w.notes,
      rollup: rollup(rows),
      seats: bySeatLevel(rows),
      adTotals: adTotals(sets),
    };
  });
});

// ── founder stats (the /german-note business block) ────────────

/** One person who still owes money, flattened across every workshop. */
export type GnDuesRow = {
  conversionId: string;
  fullName: string;
  workshopId: string;
  workshopName: string;
  /** POSITIVE paise still owed (pnl.balance is paid − final, so a debt is negative there) */
  owed: number;
  final: number;
  paid: number;
  nextDueDate: string | null;
  paymentMethod: string | null;
  status: GnConversionStatus;
};

/** One workshop, reduced to what the financials charts and list need. */
export type GnWorkshopBar = {
  id: string;
  name: string;
  month: string;
  status: GnWorkshopStatus;
  rollup: GnPnlRollup;
  /** POSITIVE paise still owed within this workshop */
  outstanding: number;
};

export type GnFounderStats = {
  workshops: number;
  /** rollup over EVERY conversion in every workshop */
  totals: GnPnlRollup;
  /**
   * Net profit on the CASH basis: collected − total expense.
   * `totals.netProfit` is the QUOTED basis (revenue − expense) and overstates
   * profit on money that has not arrived — docs F1, §6.7. Both are shown.
   */
  netProfitCash: number;
  /** POSITIVE paise outstanding across all workshops */
  outstanding: number;
  dues: GnDuesRow[];
  /** newest intake first — the order the charts and the list read in */
  perWorkshop: GnWorkshopBar[];
  /** seats across every workshop (a bundle counts once per level it enrols into) */
  seats: GnBySeatLevel[];
  /** exact product bought, across every workshop */
  byProduct: GnByProduct[];
};

/**
 * The founder's German Note money, across all workshops at once.
 *
 * Nothing else aggregates this — `getGnWorkshops` is per-workshop, so "who owes me
 * money right now" had no home. Rows are concatenated BEFORE `rollup` so each
 * workshop keeps its own ad-spend allocation (ads are split per workshop in `buildRows`).
 */
export const getGnFounderStats = cache(async (): Promise<GnFounderStats> => {
  const workshops = await prisma.gnWorkshop.findMany({
    include: { conversions: true, adSets: true },
  });

  const all: GnConversionRow[] = [];
  const dues: GnDuesRow[] = [];
  const perWorkshop: GnWorkshopBar[] = [];
  for (const w of workshops) {
    const rows = buildRows(w.conversions, w.adSets);
    all.push(...rows);
    let owedHere = 0;
    for (const r of rows) {
      if (r.pnl.balance >= 0) continue; // settled, or overpaid — not a debt
      owedHere += -r.pnl.balance;
      dues.push({
        conversionId: r.id,
        fullName: r.fullName,
        workshopId: w.id,
        workshopName: w.name,
        owed: -r.pnl.balance,
        final: r.pnl.final,
        paid: r.pnl.paid,
        nextDueDate: r.nextDueDate,
        paymentMethod: r.paymentMethod,
        status: r.status,
      });
    }
    perWorkshop.push({
      id: w.id,
      name: w.name,
      month: w.month.toISOString(),
      status: w.status,
      rollup: rollup(rows),
      outstanding: owedHere,
    });
  }
  // Newest intake first — charts read left-to-right as most-recent-first.
  perWorkshop.sort((a, b) => b.month.localeCompare(a.month));

  // Soonest due first; undated last. Ties broken by size, so the biggest debt leads.
  dues.sort((a, b) => {
    if (a.nextDueDate && b.nextDueDate) return a.nextDueDate.localeCompare(b.nextDueDate) || b.owed - a.owed;
    if (a.nextDueDate) return -1;
    if (b.nextDueDate) return 1;
    return b.owed - a.owed;
  });

  const totals = rollup(all);
  return {
    workshops: workshops.length,
    totals,
    netProfitCash: totals.cashCollected - totals.totalExp,
    outstanding: sum(dues, (d) => d.owed),
    dues,
    perWorkshop,
    seats: bySeatLevel(all),
    byProduct: byProduct(all),
  };
});

// ── detail (per-workshop page) ─────────────────────────────────

export type GnWorkshopDetail = {
  id: string;
  name: string;
  month: string;
  status: GnWorkshopStatus;
  notes: string | null;
  conversions: GnConversionRow[];
  adSets: GnAdSetRow[];
  adTotals: GnAdTotals;
  rollup: GnPnlRollup;
  byProduct: GnByProduct[];
  seats: GnBySeatLevel[];
  capacity: GnCapacityRow[];
};

export const getGnWorkshopDetail = cache(async (workshopId: string): Promise<GnWorkshopDetail | null> => {
  const w = await prisma.gnWorkshop.findUnique({
    where: { id: workshopId },
    include: {
      conversions: { orderBy: { createdAt: "asc" } },
      adSets: { orderBy: { orderIndex: "asc" } },
    },
  });
  if (!w) return null;
  const rows = buildRows(w.conversions, w.adSets);
  const sets = w.adSets.map(adSetRow);
  return {
    id: w.id,
    name: w.name,
    month: w.month.toISOString(),
    status: w.status,
    notes: w.notes,
    conversions: rows,
    adSets: sets,
    adTotals: adTotals(sets),
    rollup: rollup(rows),
    byProduct: byProduct(rows),
    seats: bySeatLevel(rows),
    capacity: capacityGrid(rows),
  };
});

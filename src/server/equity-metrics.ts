import "server-only";
import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { aggEurMinor, aggInrMinor } from "@/lib/money";
import { ACTIVE, ARCHIVED } from "@/lib/soft-delete";
import { MONEY_ACCOUNTS } from "@/lib/chart-of-accounts";

/**
 * OWNER'S EQUITY - who has put money into the business, who has taken it out, and what is left in.
 *
 * Everything is derived from the `EquityContribution` rows at their own stamped rates. There is no
 * stored "total contributed" for the same reason there is no stored "paid so far" on a receivable:
 * a total that is written down is a total that drifts from the rows it claims to summarise.
 *
 * A DRAWING counts NEGATIVE, so a contributor's figure is their net stake rather than a gross
 * "money that once passed through". Both halves are reported separately as well, because "put in
 * ₹5L, took out ₹2L" and "put in ₹3L" are different facts about the same ₹3L.
 */

export type EquityEntryRow = {
  id: string;
  date: string;
  contributorName: string;
  kind: "CONTRIBUTION" | "DRAWING";
  /** Both aggregates at this row's own stamped rate - the ₹/€ toggle picks a side. */
  agg: { inr: number; eur: number };
  /** The raw sides, which are what the edit form re-opens on. */
  amountInrRaw: string;
  amountEurRaw: string;
  accountCode: string;
  accountLabel: string;
  notes: string | null;
  /** True when this row carries no journal entry - recorded, but not in the trial balance. */
  unposted: boolean;
  enteredByName: string | null;
};

export type EquityContributorRow = {
  name: string;
  inInr: number;
  outInr: number;
  /** Contributions minus drawings - the stake actually standing in the business. */
  netInr: number;
  entries: number;
  lastDate: string | null;
};

export type EquityOverview = {
  rows: EquityEntryRow[];
  contributors: EquityContributorRow[];
  totals: { inInr: number; outInr: number; netInr: number };
  /** Rows recorded but never posted - a number the page can offer to explain. */
  unpostedCount: number;
  /** Archived entries, for the Archived view. */
  archived: EquityEntryRow[];
};

const LABELS = new Map<string, string>(MONEY_ACCOUNTS.map((a) => [a.code, a.label]));

export const getEquityOverview = cache(async (): Promise<EquityOverview> => {
  const [live, archived] = await Promise.all([
    prisma.equityContribution.findMany({
      where: ACTIVE,
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      include: { enteredBy: { select: { name: true } } },
    }),
    prisma.equityContribution.findMany({
      where: ARCHIVED,
      orderBy: [{ date: "desc" }],
      include: { enteredBy: { select: { name: true } } },
    }),
  ]);

  const toRow = (e: (typeof live)[number]): EquityEntryRow => ({
    id: e.id,
    date: e.date.toISOString(),
    contributorName: e.contributorName,
    kind: e.kind,
    agg: {
      inr: Number(aggInrMinor(e.amountInrMinor, e.amountEurMinor, e.fxRateUsed)),
      eur: Number(aggEurMinor(e.amountInrMinor, e.amountEurMinor, e.fxRateUsed)),
    },
    amountInrRaw: e.amountInrMinor.toString(),
    amountEurRaw: e.amountEurMinor.toString(),
    accountCode: e.accountCode,
    accountLabel: LABELS.get(e.accountCode) ?? e.accountCode,
    notes: e.notes,
    unposted: e.postedEntryId === null,
    enteredByName: e.enteredBy?.name ?? null,
  });

  const rows = live.map(toRow);

  /**
   * Grouped by name, case- and space-insensitively - the same normalisation every other pairing
   * in the app uses. The DISPLAY name is the one from the most recent entry, so a contributor who
   * was first typed in lower case is not stuck that way forever.
   */
  const key = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
  const byName = new Map<string, EquityContributorRow>();
  for (const r of rows) {
    const k = key(r.contributorName);
    const cur =
      byName.get(k) ??
      { name: r.contributorName, inInr: 0, outInr: 0, netInr: 0, entries: 0, lastDate: null };
    if (r.kind === "CONTRIBUTION") cur.inInr += r.agg.inr;
    else cur.outInr += r.agg.inr;
    cur.netInr = cur.inInr - cur.outInr;
    cur.entries += 1;
    // `rows` is newest-first, so the first one seen is the latest.
    if (!cur.lastDate) cur.lastDate = r.date;
    byName.set(k, cur);
  }
  const contributors = [...byName.values()].sort((a, b) => b.netInr - a.netInr);

  return {
    rows,
    contributors,
    totals: {
      inInr: contributors.reduce((a, c) => a + c.inInr, 0),
      outInr: contributors.reduce((a, c) => a + c.outInr, 0),
      netInr: contributors.reduce((a, c) => a + c.netInr, 0),
    },
    unpostedCount: rows.filter((r) => r.unposted).length,
    archived: archived.map(toRow),
  };
});

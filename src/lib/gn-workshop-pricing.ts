import type { GnWorkshopProduct } from "@prisma/client";

/**
 * German Note workshop economics - the reasoned model behind every conversion's
 * P&L. The workflow is a funnel: an ad drives reach → clicks → a free taster →
 * a share of attendees CONVERT into a level course (A1 / A2 / B1 or a bundle).
 *
 * What is an INPUT vs what is DERIVED (this is the whole point):
 *  - PRICE a client pays is an input - it moves per intake and per deal (EMI,
 *    negotiation, carry-over credit), so it is captured per conversion.
 *  - COST of delivery is structural and stable, so it is DERIVED here from the
 *    product, never re-keyed per client:
 *        COGS(product) = Σ over enrolled levels of (books + tutor)
 *  - AD SPEND per conversion is DERIVED at read time: a workshop's total ad
 *    spend split evenly across the conversions that came FROM the ad campaign
 *    (source = AD). Organic / referral / free seats carry no ad cost - exactly
 *    how the founders' workbook allocates it.
 *
 * A conversion may override books/tutor for a genuine exception (sponsored book,
 * discounted tutor); otherwise this model applies. All money in INR paise.
 */

export type SeatLevel = "A1" | "A2" | "B1";
export const SEAT_LEVELS: SeatLevel[] = ["A1", "A2", "B1"];

/** Which levels a product enrols a client into. Bundles enrol several. */
export const PRODUCT_LEVELS: Record<GnWorkshopProduct, SeatLevel[]> = {
  A1: ["A1"],
  A2: ["A2"],
  B1: ["B1"],
  A1_A2: ["A1", "A2"],
  A2_B1: ["A2", "B1"],
  A1_A2_B1: ["A1", "A2", "B1"],
};

export const PRODUCT_ORDER: GnWorkshopProduct[] = ["A1", "A2", "B1", "A1_A2", "A2_B1", "A1_A2_B1"];

const rupees = (n: number) => n * 100; // → integer paise

/** What one level costs to deliver, in paise. */
export type GnLevelCost = { books: number; tutor: number };
export type GnLevelCosts = Record<SeatLevel, GnLevelCost>;

/**
 * The FALLBACK delivery costs, in paise - not the live ones.
 *
 * The live numbers come from the programme catalogue (`Level.booksCostInrMinor` and
 * `tutorCostInrMinor` on GN_A1 / GN_A2 / GN_B1), which the founder already edits at
 * Console → Programme catalogue. These constants were a SECOND copy of the same three
 * figures - identical to the catalogue's today, and with nothing keeping them that way. A
 * founder who raised the B1 tutor fee on the catalogue would have changed what a B1 student
 * is invoiced and left every workshop P&L still costing them at the old rate, with no sign
 * that the two disagreed.
 *
 * Kept as the fallback because a catalogue row with a blank cost must not silently cost
 * zero, which would read as pure profit.
 */
export const GN_LEVEL_COST: GnLevelCosts = {
  A1: { books: rupees(1300), tutor: rupees(7000) },
  A2: { books: rupees(1300), tutor: rupees(8000) },
  B1: { books: rupees(1300), tutor: rupees(12000) },
};

/** The catalogue code that carries a seat level's delivery cost. */
export const gnLevelCode = (level: SeatLevel): string => `GN_${level}`;

/** Standard books cost for a product = Σ books over its levels (paise). */
export const standardBooksCost = (p: GnWorkshopProduct, costs: GnLevelCosts = GN_LEVEL_COST): number =>
  PRODUCT_LEVELS[p].reduce((a, l) => a + costs[l].books, 0);

/** Standard tutor cost for a product = Σ tutor over its levels (paise). */
export const standardTutorCost = (p: GnWorkshopProduct, costs: GnLevelCosts = GN_LEVEL_COST): number =>
  PRODUCT_LEVELS[p].reduce((a, l) => a + costs[l].tutor, 0);

/**
 * The catalogue's costs, with the fallback filling any blank - FIELD BY FIELD, not row by row.
 *
 * A level priced for books but not for a tutor is a half-filled row, and taking the whole
 * fallback for it would silently discard the one number the founder did set.
 */
export function gnLevelCostsFrom(
  catalogue: Map<string, { books: number | null; tutor: number | null }>,
): GnLevelCosts {
  const out = {} as GnLevelCosts;
  for (const level of SEAT_LEVELS) {
    const row = catalogue.get(gnLevelCode(level));
    out[level] = {
      books: row?.books ?? GN_LEVEL_COST[level].books,
      tutor: row?.tutor ?? GN_LEVEL_COST[level].tutor,
    };
  }
  return out;
}

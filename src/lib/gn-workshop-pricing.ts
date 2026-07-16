import type { GnWorkshopProduct } from "@prisma/client";

/**
 * German Note workshop economics — the reasoned model behind every conversion's
 * P&L. The workflow is a funnel: an ad drives reach → clicks → a free taster →
 * a share of attendees CONVERT into a level course (A1 / A2 / B1 or a bundle).
 *
 * What is an INPUT vs what is DERIVED (this is the whole point):
 *  - PRICE a client pays is an input — it moves per intake and per deal (EMI,
 *    negotiation, carry-over credit), so it is captured per conversion.
 *  - COST of delivery is structural and stable, so it is DERIVED here from the
 *    product, never re-keyed per client:
 *        COGS(product) = Σ over enrolled levels of (books + tutor)
 *  - AD SPEND per conversion is DERIVED at read time: a workshop's total ad
 *    spend split evenly across the conversions that came FROM the ad campaign
 *    (source = AD). Organic / referral / free seats carry no ad cost — exactly
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

/**
 * Delivery cost of running one level, in paise. Books ≈ one printed set; tutor =
 * the coach's fee for that level. Higher levels pay their tutor more.
 */
export const GN_LEVEL_COST: Record<SeatLevel, { books: number; tutor: number }> = {
  A1: { books: rupees(1300), tutor: rupees(7000) },
  A2: { books: rupees(1300), tutor: rupees(8000) },
  B1: { books: rupees(1300), tutor: rupees(12000) },
};

/** Standard books cost for a product = Σ books over its levels (paise). */
export const standardBooksCost = (p: GnWorkshopProduct): number =>
  PRODUCT_LEVELS[p].reduce((a, l) => a + GN_LEVEL_COST[l].books, 0);

/** Standard tutor cost for a product = Σ tutor over its levels (paise). */
export const standardTutorCost = (p: GnWorkshopProduct): number =>
  PRODUCT_LEVELS[p].reduce((a, l) => a + GN_LEVEL_COST[l].tutor, 0);

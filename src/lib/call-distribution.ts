/**
 * Splitting a batch of leads across the rotation by share.
 *
 * Pure, so the arithmetic can be argued about and tested without a database - and it is worth
 * arguing about, because "70/30 of 10 leads" has no exact answer and the wrong rounding quietly
 * loses work.
 */

export type ShareMember = {
  userId: string;
  name: string;
  /** Raw `firstCallSharePct`. Relative weights - they need not total 100. */
  sharePct: number;
};

export type Allocation = { userId: string; name: string; count: number };

/**
 * Divide `total` leads among members in proportion to their shares.
 *
 * ── Largest remainder, not naive rounding ────────────────────────────────────────
 * Rounding each person's exact share independently does not sum back to the total: 70/30 of 10 is
 * 7 and 3 (fine), but 1/1/1 of 10 rounds to 3+3+3 = 9 and one lead silently vanishes from a
 * hand-out the founder asked for. So every member first takes their whole part, and the leftover
 * is handed out one at a time to whoever was closest to earning another - the standard
 * largest-remainder apportionment. The parts always sum to exactly `total`.
 *
 * Ties in the remainder go to the LARGER share, then to the earlier member, so the result is
 * deterministic: the same inputs always produce the same split, and the founder's preview cannot
 * disagree with what actually runs.
 *
 * Members with a zero or negative share are excluded - that is what "not in the rotation" means
 * everywhere else in the app.
 */
export function allocateByShare(total: number, members: ShareMember[]): Allocation[] {
  const eligible = members.filter((m) => m.sharePct > 0);
  if (total <= 0 || eligible.length === 0) return [];

  const shareTotal = eligible.reduce((s, m) => s + m.sharePct, 0);

  const exact = eligible.map((m, index) => {
    const ideal = (m.sharePct / shareTotal) * total;
    const whole = Math.floor(ideal);
    return { ...m, index, count: whole, remainder: ideal - whole };
  });

  let left = total - exact.reduce((s, e) => s + e.count, 0);
  const byRemainder = [...exact].sort(
    (a, b) => b.remainder - a.remainder || b.sharePct - a.sharePct || a.index - b.index,
  );
  for (let i = 0; left > 0; i = (i + 1) % byRemainder.length) {
    byRemainder[i].count += 1;
    left -= 1;
  }

  return exact
    .filter((e) => e.count > 0)
    .map((e) => ({ userId: e.userId, name: e.name, count: e.count }));
}

/**
 * "Of the next 100 leads, who gets what" - the Console preview.
 *
 * Deliberately the SAME function the hand-out uses rather than a separate illustration, so the
 * founder cannot be shown a split the engine would not produce. 100 is a round number people
 * reason in, not a limit.
 */
export function previewSplit(members: ShareMember[], of = 100): Allocation[] {
  return allocateByShare(of, members);
}

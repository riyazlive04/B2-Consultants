/**
 * Rendering a notification's money into the reader's currency.
 *
 * Lives in lib/ - NOT beside `computeNotifications` - because `server/notifications.ts` is
 * `server-only`, and the two components that render a notification (the dashboard band and the
 * shell's bell) are both client components. Importing a value out of a server-only module from a
 * client component is a build error, so the shared piece has to be isomorphic.
 *
 * Money is not baked into a notification's title/body. A notification is read on a page with a
 * ₹/€ toggle, so the amount travels as both aggregates and is substituted here at render time -
 * a row saying "₹3,25,500" while every figure beside it said euros was the bug this replaced.
 */

/** Both aggregates of one amount, in minor units. Structurally identical to MoneyAgg. */
export type NotificationAmount = { inr: number; eur: number };

/**
 * Replace `{m0}`, `{m1}`… in a notification string with a formatted amount.
 *
 * An unmatched token is left as-is rather than blanked: a template/amounts mismatch then shows up
 * as visible text in review instead of silently dropping the number the row exists to report.
 */
export function renderNotificationText(
  text: string,
  amounts: NotificationAmount[] | undefined,
  format: (m: NotificationAmount) => string,
): string {
  if (!amounts?.length) return text;
  return text.replace(/\{m(\d+)\}/g, (whole, i) => {
    const m = amounts[Number(i)];
    return m ? format(m) : whole;
  });
}

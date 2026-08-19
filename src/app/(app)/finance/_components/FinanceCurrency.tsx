"use client";

/**
 * The ₹/€ preference moved to `components/ui/CurrencyToggle` when the home dashboard needed the
 * same toggle - one provider and one storage key, or the two pages drift apart.
 *
 * This file stays as the Finance-local alias so the page and its cards keep their existing
 * import, and so `useFinanceCcy` still reads naturally at those call sites.
 */

import type { ReactNode } from "react";

export { CurrencyToggle, useCcy as useFinanceCcy } from "@/components/ui/CurrencyToggle";
export type { Ccy } from "@/lib/money-display";

/**
 * A pass-through, deliberately.
 *
 * The real provider moved to the (app) layout so the notification bell - which sits in the shell,
 * outside every page - shares the reader's currency. Mounting a SECOND provider here would give
 * Finance its own isolated state: same localStorage key, but flipping the toggle on this page
 * would leave the bell above it on the previous currency until a reload.
 *
 * Kept as a no-op wrapper rather than deleted, because the Finance page's JSX uses it to mark the
 * region the toggle governs, and that reads better than an unexplained fragment.
 */
export function FinanceCurrencyProvider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

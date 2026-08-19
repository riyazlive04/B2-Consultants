"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { ArrowLeftRight } from "lucide-react";
import { money, moneyAlt, type Ccy, type MoneyAgg } from "@/lib/money-display";

/**
 * The app's one ₹/€ preference.
 *
 * It started inside `FinanceKpis`, so only the KPI grid flipped; then it moved up to a Finance
 * page context so the business-line totals and the revenue chart came with it. It now lives here,
 * in the shared kit, because the same question is asked on the HOME DASHBOARD - and two
 * providers reading the same localStorage key would drift apart the moment one page wrote it.
 *
 * The toggle does not convert anything. Every amount is stored as both an INR and a EUR
 * aggregate of the same money (lib/money.ts); this picks which one leads. So flipping it can
 * never change what a figure means, only which currency it is quoted in.
 *
 * The preference is remembered per device, and shared across pages by the storage key.
 */

const STORAGE_KEY = "b2_finance_ccy";

const CcyContext = createContext<{ ccy: Ccy; setCcy: (c: Ccy) => void } | null>(null);

export function CurrencyProvider({ children }: { children: ReactNode }) {
  // INR on the server and on first paint, then the saved choice - reading localStorage during
  // render would differ from the server HTML and throw a hydration mismatch.
  const [ccy, setCcyState] = useState<Ccy>("INR");

  useEffect(() => {
    try {
      const s = localStorage.getItem(STORAGE_KEY);
      if (s === "INR" || s === "EUR") setCcyState(s);
    } catch {
      /* private mode / storage disabled - the default is fine */
    }
  }, []);

  const setCcy = (c: Ccy) => {
    setCcyState(c);
    try {
      localStorage.setItem(STORAGE_KEY, c);
    } catch {
      /* ignore */
    }
  };

  return <CcyContext.Provider value={{ ccy, setCcy }}>{children}</CcyContext.Provider>;
}

/** Read the current currency. Falls back to INR outside a provider so a stray card never crashes. */
export function useCcy(): { ccy: Ccy; setCcy: (c: Ccy) => void } {
  return useContext(CcyContext) ?? { ccy: "INR", setCcy: () => {} };
}

/**
 * One amount, in whichever currency is selected.
 *
 * Exists so a SERVER component can still hand a currency-aware figure to a client card: the
 * dashboard's `MetricCard` takes `ReactNode`, so `value={<Money amount={x} />}` flips with the
 * toggle without the page itself becoming a client component.
 */
export function Money({ amount, compact = true }: { amount: MoneyAgg; compact?: boolean }) {
  const { ccy } = useCcy();
  return <>{money(amount, ccy, { compact })}</>;
}

/** The other currency's figure - the "· 460 €" tail beneath a primary amount. */
export function MoneyAlt({ amount, compact = true }: { amount: MoneyAgg; compact?: boolean }) {
  const { ccy } = useCcy();
  return <>{moneyAlt(amount, ccy, { compact })}</>;
}

/** The segmented ₹/€ control. Flips every figure on the page it heads. */
export function CurrencyToggle({ label = true }: { label?: boolean }) {
  const { ccy, setCcy } = useCcy();

  const seg = (c: Ccy, text: string) => (
    <button
      type="button"
      onClick={() => setCcy(c)}
      aria-pressed={ccy === c}
      className={`press h-8 rounded-full px-3 text-[13px] font-semibold transition-colors ${
        ccy === c ? "bg-primary text-on-accent" : "text-ink-2 hover:text-ink"
      }`}
    >
      {text}
    </button>
  );

  return (
    <div className="flex items-center gap-2">
      {label && (
        <span className="flex items-center gap-1.5 text-caption text-muted">
          <ArrowLeftRight size={13} /> Currency
        </span>
      )}
      <div
        role="group"
        aria-label="Show amounts in"
        className="flex flex-none items-center gap-0.5 rounded-full border border-line-strong bg-surface-2 p-0.5"
      >
        {seg("INR", "₹ INR")}
        {seg("EUR", "€ EUR")}
      </div>
    </div>
  );
}

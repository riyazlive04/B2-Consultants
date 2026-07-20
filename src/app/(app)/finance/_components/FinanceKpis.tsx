"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Wallet, Percent, PiggyBank, Package, CreditCard, Clock, CalendarRange, ArrowLeftRight } from "lucide-react";
import { MetricCard } from "@/components/ui/MetricCard";
import { Modal } from "@/components/ui/Modal";
import { formatEurMinor, formatInrMinor } from "@/lib/format";
import { signedColor, type SignalLevel } from "@/lib/signals";

/**
 * The Finance KPI grid, made interactive (two requests):
 *   1. A currency toggle — flip whether every figure reads INR-first (EUR beneath) or EUR-first
 *      (INR beneath). The preference is remembered per device.
 *   2. Every card is clickable and pops up the breakdown behind its number, in the same currency
 *      order. Non-money cards (profit margin) carry `valueText` and show their own components.
 *
 * The server hands down raw minor-unit figures for both currencies, so the toggle and the popups
 * re-render entirely on the client with no round-trip.
 */

export type KpiIcon = "wallet" | "percent" | "piggy" | "package" | "card" | "clock" | "calendar";

const ICONS: Record<KpiIcon, ReactNode> = {
  wallet: <Wallet size={18} />,
  percent: <Percent size={18} />,
  piggy: <PiggyBank size={18} />,
  package: <Package size={18} />,
  card: <CreditCard size={18} />,
  clock: <Clock size={18} />,
  calendar: <CalendarRange size={18} />,
};

/** A row inside a card's popup: a money pair (currency-aware) or a plain text value. */
export type KpiRow = { label: string; inrMinor?: number; eurMinor?: number; text?: string };

export type Kpi = {
  key: string;
  label: string;
  iconName: KpiIcon;
  /** Money figure (minor units); omit for a non-money card and use `valueText`. */
  inrMinor?: number;
  eurMinor?: number;
  /** For non-money cards (e.g. the profit-margin %). Wins over the money figure. */
  valueText?: string;
  signal?: SignalLevel;
  /**
   * When set, the headline digits are coloured by THIS value's sign (§5.1) — green
   * above zero, red below. Only passed for figures where the sign is a verdict (net
   * profit, gross profit, margin); revenue-style always-positive cards leave it unset
   * so the grid doesn't turn uniformly green.
   */
  signedValue?: number;
  tooltip?: string;
  detailTitle: string;
  detailNote?: string;
  detailRows: KpiRow[];
};

type Ccy = "INR" | "EUR";
const STORAGE_KEY = "b2_finance_ccy";

function money(inrMinor: number | undefined, eurMinor: number | undefined, ccy: Ccy, compact: boolean) {
  const inr = inrMinor !== undefined ? formatInrMinor(inrMinor, { compact }) : null;
  const eur = eurMinor !== undefined ? formatEurMinor(eurMinor, { compact }) : null;
  const primary = ccy === "INR" ? inr : eur;
  const secondary = ccy === "INR" ? eur : inr;
  return { primary: primary ?? secondary ?? "—", secondary: primary && secondary ? secondary : null };
}

export function FinanceKpis({ kpis }: { kpis: Kpi[] }) {
  const [ccy, setCcy] = useState<Ccy>("INR");
  const [open, setOpen] = useState<Kpi | null>(null);

  useEffect(() => {
    try {
      const s = localStorage.getItem(STORAGE_KEY);
      if (s === "INR" || s === "EUR") setCcy(s);
    } catch {
      /* ignore */
    }
  }, []);

  const pick = (c: Ccy) => {
    setCcy(c);
    try {
      localStorage.setItem(STORAGE_KEY, c);
    } catch {
      /* ignore */
    }
  };

  const seg = (c: Ccy, label: string) => (
    <button
      type="button"
      onClick={() => pick(c)}
      aria-pressed={ccy === c}
      className={`press h-8 rounded-full px-3 text-[13px] font-semibold transition-colors ${
        ccy === c ? "bg-primary text-on-accent" : "text-ink-2 hover:text-ink"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-4">
      {/* Currency toggle — flips primary/secondary for every figure below. */}
      <div className="flex items-center justify-between gap-3">
        <p className="flex items-center gap-1.5 text-caption text-muted">
          <ArrowLeftRight size={13} /> Showing{" "}
          <span className="font-semibold text-ink-2">{ccy === "INR" ? "₹ INR first" : "€ EUR first"}</span>
          {" "}· the other currency sits beneath. Tap any card for the breakdown.
        </p>
        <div className="flex flex-none items-center gap-0.5 rounded-full border border-line-strong bg-surface-2 p-0.5">
          {seg("INR", "₹ INR")}
          {seg("EUR", "€ EUR")}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {kpis.map((k) => {
          const m = k.valueText ? null : money(k.inrMinor, k.eurMinor, ccy, true);
          const tone = k.signedValue !== undefined ? signedColor(k.signedValue) : undefined;
          return (
            <MetricCard
              key={k.key}
              label={k.label}
              value={
                <span style={tone ? { color: tone } : undefined}>{k.valueText ?? m?.primary ?? "—"}</span>
              }
              secondary={k.valueText ? undefined : m?.secondary ?? undefined}
              signal={k.signal}
              tooltip={k.tooltip}
              icon={ICONS[k.iconName]}
              onClick={() => setOpen(k)}
            />
          );
        })}
      </div>

      <Modal open={open !== null} onClose={() => setOpen(null)} title={open?.detailTitle ?? ""} subtitle={open?.label} size="md">
        {open && (
          <div className="space-y-4">
            {/* The headline, in both currencies, order following the toggle. */}
            {!open.valueText && (
              <div className="rounded-card border border-line bg-surface-2 p-4">
                <p
                  className="font-display text-3xl font-bold tabular-nums text-ink"
                  style={
                    open.signedValue !== undefined && signedColor(open.signedValue)
                      ? { color: signedColor(open.signedValue) }
                      : undefined
                  }
                >
                  {money(open.inrMinor, open.eurMinor, ccy, false).primary}
                </p>
                {money(open.inrMinor, open.eurMinor, ccy, false).secondary && (
                  <p className="mt-0.5 text-sm text-muted tabular-nums">
                    {money(open.inrMinor, open.eurMinor, ccy, false).secondary}
                  </p>
                )}
              </div>
            )}
            {open.valueText && (
              <div className="rounded-card border border-line bg-surface-2 p-4">
                <p
                  className="font-display text-3xl font-bold tabular-nums text-ink"
                  style={
                    open.signedValue !== undefined && signedColor(open.signedValue)
                      ? { color: signedColor(open.signedValue) }
                      : undefined
                  }
                >
                  {open.valueText}
                </p>
              </div>
            )}

            <ul className="divide-y divide-line">
              {open.detailRows.map((r, i) => {
                const rm = r.inrMinor !== undefined || r.eurMinor !== undefined ? money(r.inrMinor, r.eurMinor, ccy, false) : null;
                return (
                  <li key={i} className="flex items-baseline justify-between gap-3 py-2.5">
                    <span className="text-sm text-ink-2">{r.label}</span>
                    <span className="text-right">
                      <span className="text-sm font-semibold tabular-nums text-ink">{rm ? rm.primary : r.text}</span>
                      {rm?.secondary && <span className="block text-caption text-muted tabular-nums">{rm.secondary}</span>}
                    </span>
                  </li>
                );
              })}
            </ul>

            {open.detailNote && <p className="text-caption text-muted">{open.detailNote}</p>}
          </div>
        )}
      </Modal>
    </div>
  );
}

import type { ReactNode } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Flag,
  Receipt,
  RefreshCw,
  Scale,
  Wallet,
} from "lucide-react";
import { Pill } from "@/components/ui/kit";
import { formatDate, formatEurMinor, formatInrMinor } from "@/lib/format";

/**
 * The Journal, redesigned (the old one was a flat wall of identical rows: no per-entry total, no
 * way to tell an income from an expense at a glance, and two sparse amount columns where one was
 * always blank).
 *
 * Now every entry reads as a block: a typed icon + colour on the left, its balancing TOTAL on the
 * right where the eye lands, and its debit/credit legs shown with explicit Dr/Cr chips down one
 * amount column instead of a half-empty two-column table. Voids and reversals keep their pills.
 * Still purely presentational and read-only — the ledger is never edited here.
 */

type Line = {
  id: string;
  account: { code: string; name: string; type: string };
  baseDebitMinor: bigint;
  baseCreditMinor: bigint;
  debitMinor: bigint;
  creditMinor: bigint;
  currency: string;
  fxRate: { toString: () => string };
  isCogs: boolean;
};

type Entry = {
  id: string;
  narration: string;
  status: string;
  reversalOfId: string | null;
  date: Date | string;
  sourceType: string;
  postedBy: { name: string | null } | null;
  lines: Line[];
};

const TYPE_META: Record<string, { label: string; icon: ReactNode; color: string; soft: string }> = {
  INCOME: { label: "Income", icon: <ArrowDownLeft size={15} />, color: "var(--good)", soft: "var(--good-bg)" },
  PAYMENT: { label: "Payment", icon: <ArrowDownLeft size={15} />, color: "var(--good)", soft: "var(--good-bg)" },
  INVOICE: { label: "Invoice", icon: <Receipt size={15} />, color: "var(--primary)", soft: "var(--primary-soft)" },
  EXPENSE: { label: "Expense", icon: <ArrowUpRight size={15} />, color: "var(--bad)", soft: "var(--bad-bg)" },
  FX_REVALUATION: { label: "FX", icon: <RefreshCw size={15} />, color: "var(--warn)", soft: "var(--warn-bg)" },
  OPENING_BALANCE: { label: "Opening", icon: <Flag size={15} />, color: "var(--ink-2)", soft: "var(--surface-2)" },
  MANUAL: { label: "Manual", icon: <Scale size={15} />, color: "var(--ink-2)", soft: "var(--surface-2)" },
};

const fallbackMeta = { label: "Entry", icon: <Wallet size={15} />, color: "var(--ink-2)", soft: "var(--surface-2)" };

export function JournalList({ entries }: { entries: Entry[] }) {
  return (
    <ul className="divide-y divide-line">
      {entries.map((e) => {
        const isVoid = e.status === "VOID";
        const meta = TYPE_META[e.sourceType] ?? fallbackMeta;
        // The entry total is the sum of the debit legs (which, in a balanced entry, equals the
        // sum of the credit legs). This is the "how much moved" number the header leads with.
        const totalMinor = e.lines.reduce((s, l) => s + l.baseDebitMinor, BigInt(0));
        // Void/reversal entries are visually quieted — they exist for the audit trail, not to be
        // read as live money.
        const muted = isVoid || !!e.reversalOfId;

        return (
          <li key={e.id} className="px-5 py-4 sm:px-6">
            {/* Header: typed icon · narration + pills · total */}
            <div className="flex items-start gap-3">
              <span
                aria-hidden
                className="mt-0.5 grid h-8 w-8 flex-none place-items-center rounded-full"
                style={{ background: muted ? "var(--surface-2)" : meta.soft, color: muted ? "var(--ink-3)" : meta.color }}
              >
                {meta.icon}
              </span>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`truncate text-sm font-semibold text-ink ${isVoid ? "text-muted line-through" : ""}`}>
                    {e.narration}
                  </span>
                  {isVoid && <Pill tone="bad">Void</Pill>}
                  {e.reversalOfId && <Pill tone="warn">Reversal</Pill>}
                </div>
                <p className="mt-0.5 text-caption text-muted">
                  {formatDate(e.date)} · {meta.label.toLowerCase()}
                  {e.postedBy?.name ? ` · posted by ${e.postedBy.name}` : ""}
                </p>
              </div>

              <div className="flex-none text-right">
                <p className={`tnum font-display text-base font-bold ${muted ? "text-muted" : "text-ink"}`}>
                  {formatInrMinor(totalMinor, { compact: true })}
                </p>
                <p className="text-caption text-ink-3">{e.lines.length} lines</p>
              </div>
            </div>

            {/* Legs: one amount column, Dr/Cr made explicit instead of inferred from position. */}
            <ul className="mt-3 space-y-1 border-l border-line pl-3 sm:ml-11">
              {e.lines.map((l) => {
                const isDebit = l.baseDebitMinor > BigInt(0);
                const base = isDebit ? l.baseDebitMinor : l.baseCreditMinor;
                const native = isDebit ? l.debitMinor : l.creditMinor;
                return (
                  <li key={l.id} className="flex items-center gap-2 text-sm">
                    <span
                      className="w-6 flex-none rounded px-1 text-center text-caption font-bold uppercase tnum"
                      style={{
                        background: isDebit ? "var(--primary-soft)" : "var(--surface-2)",
                        color: isDebit ? "var(--primary-strong)" : "var(--ink-2)",
                      }}
                      title={isDebit ? "Debit" : "Credit"}
                    >
                      {isDebit ? "Dr" : "Cr"}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-ink-2">
                      <span className="tnum text-muted">{l.account.code}</span> {l.account.name}
                      {l.isCogs && <span className="ml-1.5 text-caption text-muted">(COGS)</span>}
                    </span>
                    {l.currency === "EUR" && (
                      <span className="flex-none text-caption text-muted">
                        {formatEurMinor(native)} @ {l.fxRate.toString()}
                      </span>
                    )}
                    <span className="tnum w-24 flex-none text-right text-ink">{formatInrMinor(base)}</span>
                  </li>
                );
              })}
            </ul>
          </li>
        );
      })}
    </ul>
  );
}

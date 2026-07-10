import { PhoneCall, Gift, Percent, Wallet, Clock } from "lucide-react";
import { MetricCard } from "@/components/ui/MetricCard";
import { formatEurMinor, formatInrMinor } from "@/lib/format";
import { requireSection } from "@/lib/rbac";
import { getTelecallerBoard } from "@/server/telecaller-metrics";
import { TelecallerClient } from "./_components/TelecallerClient";

export const dynamic = "force-dynamic";

export default async function TelecallerPage({
  searchParams,
}: {
  searchParams: { month?: string };
}) {
  await requireSection("telecaller");
  const board = await getTelecallerBoard(searchParams.month);
  const { totals } = board;
  const compact = (m: number) => formatInrMinor(m, { compact: true });

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      {/* Header strip */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-line bg-surface px-5 py-4 shadow-card">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 flex-none place-items-center rounded-field bg-accent-soft text-accent">
            <PhoneCall size={20} />
          </span>
          <div>
            <h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">Telecaller Pay</h1>
            <p className="text-xs text-muted">
              Assign a bonus and/or commission to each telecaller — based on their calls or any other criteria.
            </p>
          </div>
        </div>
        {/* Month picker — plain GET form, works without client JS */}
        <form method="get" className="flex items-center gap-2">
          <input
            type="month"
            name="month"
            defaultValue={board.month}
            className="rounded-field border border-line-strong bg-surface px-3 py-1.5 text-sm text-ink outline-none focus:border-primary focus:ring-2 focus:ring-primary-soft"
          />
          <button
            type="submit"
            className="rounded-btn border border-line bg-surface-2 px-3 py-1.5 text-sm font-medium text-ink hover:bg-surface"
          >
            View
          </button>
        </form>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="Total assigned"
          value={compact(totals.totalInrMinor)}
          secondary={`${formatEurMinor(totals.totalEurMinor, { compact: true })} · ${board.monthLabel}`}
          icon={<Wallet size={18} />}
        />
        <MetricCard
          label="Bonuses"
          value={compact(totals.bonusInrMinor)}
          secondary={`${totals.rewardedCount} telecaller${totals.rewardedCount === 1 ? "" : "s"} rewarded`}
          icon={<Gift size={18} />}
        />
        <MetricCard
          label="Commission"
          value={compact(totals.commInrMinor)}
          secondary="from calls / criteria"
          icon={<Percent size={18} />}
        />
        <MetricCard
          label="Not yet paid"
          value={compact(totals.pendingInrMinor)}
          secondary={`${compact(totals.paidInrMinor)} already paid`}
          signal={totals.pendingInrMinor > 0 ? "watch" : "ok"}
          icon={<Clock size={18} />}
        />
      </div>

      <TelecallerClient board={board} />
    </div>
  );
}

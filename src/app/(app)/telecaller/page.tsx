import { PhoneCall, Gift, Percent, Wallet, Clock } from "lucide-react";
import { MetricCard } from "@/components/ui/MetricCard";
import { PageHeader } from "@/components/ui/kit";
import { Btn } from "@/components/ui/controls";
import { TextInput } from "@/components/ui/form";
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
    <div className="w-full space-y-6">
      {/* Month picker — plain GET form, works without client JS */}
      <PageHeader
        icon={<PhoneCall size={20} />}
        title="Telecaller Pay"
        subtitle="Assign a bonus and/or commission to each telecaller — based on their calls or any other criteria."
        actions={
          <form method="get" className="flex items-center gap-2">
            {/* type="month" keeps a native (now theme-corrected via color-scheme) popup;
                TextInput gives it the app field chrome. */}
            <TextInput type="month" name="month" defaultValue={board.month} aria-label="Month" className="w-44" />
            <Btn type="submit" variant="soft">View</Btn>
          </form>
        }
      />

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

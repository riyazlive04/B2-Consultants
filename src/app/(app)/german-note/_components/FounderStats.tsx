import Link from "next/link";
import { AlertCircle, BarChart3, TrendingUp, Users, Wallet } from "lucide-react";
import type { GnFounderStats } from "@/server/german-note-workshops";
import { formatDate } from "@/lib/format";
import { inr, pct } from "./workshopFormat";

/**
 * The German Note business, for Admin/Head only — the money the community page
 * never showed. Everything here already existed inside the workshop P&L engine;
 * it was just three clicks away and never aggregated across workshops.
 *
 * CASH is the headline, quoted sits beside it, and outstanding is the bridge
 * between the two (docs F1 / §6.7: the quoted basis overstates profit on money
 * that has not arrived — May's net profit falls ~78% on the cash basis).
 */
export function FounderStats({ stats }: { stats: GnFounderStats }) {
  const r = stats.totals;
  const dues = stats.dues;

  return (
    <section className="space-y-4">
      <div>
        <h2 className="font-display text-xl font-semibold">The business</h2>
        <p className="text-xs text-muted">
          Every workshop intake combined · {stats.workshops} workshop{stats.workshops === 1 ? "" : "s"} ·{" "}
          <span className="text-ink-2">cash basis</span> — quoted shown beside it
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Tile
          icon={<Wallet size={15} />}
          label="Cash collected"
          value={inr(r.cashCollected, true)}
          sub={`${inr(r.revenue, true)} quoted${stats.outstanding > 0 ? ` · ${inr(stats.outstanding, true)} outstanding` : " · all collected"}`}
        />
        <Tile
          icon={<TrendingUp size={15} />}
          label="Net profit (cash)"
          value={inr(stats.netProfitCash, true)}
          sub={`${inr(r.netProfit, true)} on quoted · NP ${pct(r.npMargin)}`}
        />
        <Tile
          icon={<Users size={15} />}
          label="Conversions"
          value={String(r.conversions)}
          sub={`${r.paying} paying${r.freeSeats ? ` · ${r.freeSeats} free` : ""}${r.onHold ? ` · ${r.onHold} on hold` : ""}`}
        />
        <Tile
          icon={<BarChart3 size={15} />}
          label="Ad spend"
          value={inr(r.ads, true)}
          sub={r.roas !== null ? `ROAS ${r.roas.toFixed(1)}× · ${r.adDriven} ad · ${r.organic} organic` : "no ad spend recorded"}
        />
      </div>

      {/* Outstanding payments — this existed per-conversion but was aggregated nowhere. */}
      <div className="rounded-card border border-line bg-surface shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold">
            <AlertCircle size={15} className={dues.length ? "text-[var(--signal-risk)]" : "text-muted"} />
            Outstanding payments
          </h3>
          {dues.length > 0 && (
            <span className="tnum text-sm font-semibold text-[var(--signal-risk)]">{inr(stats.outstanding)}</span>
          )}
        </div>

        {dues.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted">
            Nobody owes money — every conversion is paid in full.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-caption text-muted">
                  <th className="px-4 py-2 font-medium">Name</th>
                  <th className="px-4 py-2 font-medium">Workshop</th>
                  <th className="px-4 py-2 text-right font-medium">Owed</th>
                  <th className="px-4 py-2 text-right font-medium">Paid / quoted</th>
                  <th className="px-4 py-2 font-medium">Due</th>
                </tr>
              </thead>
              <tbody>
                {dues.map((d) => (
                  <tr key={d.conversionId} className="border-b border-line last:border-0">
                    <td className="px-4 py-2.5 font-medium">
                      {d.fullName}
                      {d.status === "ON_HOLD" && (
                        <span className="ml-1.5 rounded-full bg-ink/10 px-1.5 py-0.5 text-caption font-semibold text-muted">
                          on hold
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      <Link href={`/german-note/workshops/${d.workshopId}`} className="text-muted hover:text-ink hover:underline">
                        {d.workshopName}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 text-right tnum font-semibold text-[var(--signal-risk)]">{inr(d.owed)}</td>
                    <td className="px-4 py-2.5 text-right tnum text-muted">
                      {inr(d.paid)} / {inr(d.final)}
                    </td>
                    <td className="px-4 py-2.5 text-muted">
                      {d.nextDueDate ? formatDate(d.nextDueDate) : "—"}
                      {d.paymentMethod ? ` · ${d.paymentMethod}` : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

function Tile({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-card border border-line bg-surface p-4 shadow-card">
      <p className="flex items-center gap-1.5 text-caption font-medium text-muted">
        <span className="text-[var(--lvl-gn)]">{icon}</span> {label}
      </p>
      <p className="mt-1 font-display text-2xl font-bold tnum">{value}</p>
      {sub && <p className="mt-0.5 text-caption text-muted">{sub}</p>}
    </div>
  );
}

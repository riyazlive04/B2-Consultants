import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, BarChart3, TrendingUp, Users, Wallet } from "lucide-react";
import { requireAdmin, requireSection } from "@/lib/rbac";
import { getGnWorkshopDetail, type GnCapacityRow, type SeatLevel } from "@/server/german-note-workshops";
import { formatMonth } from "@/lib/format";
import { AdSetsPanel } from "../../_components/AdSetsPanel";
import { ConversionsPanel } from "../../_components/ConversionsPanel";
import {
  DAY_TYPE_LABELS,
  inr,
  pct,
  ProductChip,
  Signed,
} from "../../_components/workshopFormat";

export const dynamic = "force-dynamic";

export default async function WorkshopDetailPage({ params }: { params: { workshopId: string } }) {
  await requireSection("german-note");
  await requireAdmin();
  const w = await getGnWorkshopDetail(params.workshopId);
  if (!w) notFound();

  const r = w.rollup;

  return (
    <div className="w-full space-y-8">
      <div>
        <Link href="/german-note/manage" className="inline-flex items-center gap-1 text-xs font-medium text-muted hover:text-ink">
          <ArrowLeft size={13} /> Manage German Note
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-2.5">
          <h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">{w.name}</h1>
          <span className="text-sm text-muted">{formatMonth(w.month)}</span>
          {w.status === "ARCHIVED" && (
            <span className="rounded-full bg-ink/10 px-2.5 py-0.5 text-caption font-semibold text-muted">Archived</span>
          )}
        </div>
        <p className="mt-1 text-sm text-muted">
          Workshop taster intake — who converted, into which German level, and the money it made.
        </p>
        {w.notes && <p className="mt-2 rounded-field border border-line bg-surface-2 px-3 py-2 text-sm text-ink-2">{w.notes}</p>}
      </div>

      {/* headline tiles */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Tile icon={<Users size={15} />} label="Conversions" value={String(r.conversions)}
          sub={`${r.adDriven} ad · ${r.organic} organic${r.freeSeats ? ` · ${r.freeSeats} free` : ""}${r.onHold ? ` · ${r.onHold} on hold` : ""}`} />
        <Tile icon={<Wallet size={15} />} label="Revenue" value={inr(r.revenue, true)} sub={`${inr(r.cashCollected, true)} collected`} />
        <Tile icon={<TrendingUp size={15} />} label="Net profit" value={inr(r.netProfit, true)} sub={`NP ${pct(r.npMargin)}${r.roas !== null ? ` · ROAS ${r.roas.toFixed(1)}×` : ""}`} />
        <Tile icon={<BarChart3 size={15} />} label="Ad spend" value={inr(r.ads, true)} sub={w.adTotals.attended ? `${w.adTotals.attended.toLocaleString("en-IN")} attended` : "no ad data"} />
      </div>

      {/* the headline: conversions by level */}
      <section className="space-y-4">
        <div>
          <h2 className="font-display text-xl font-semibold">Conversions by level</h2>
          <p className="text-xs text-muted">Seats count each level a bundle enrols into; the table splits by exact product bought.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {w.seats.map((s) => (
            <div key={s.level} className="rounded-card border border-line bg-surface p-4 shadow-card">
              <div className="flex items-center justify-between">
                <span className="grid h-9 w-9 place-items-center rounded-full bg-lvl-gn/15 text-sm font-bold text-ink">{s.level}</span>
                <span className="font-display text-2xl font-bold tnum">{s.seats}</span>
              </div>
              <p className="mt-1 text-caption text-muted">seat{s.seats === 1 ? "" : "s"} enrolled in {s.level}</p>
            </div>
          ))}
        </div>

        <div className="overflow-x-auto rounded-card border border-line bg-surface shadow-card">
          <table className="w-full min-w-[420px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-caption uppercase tracking-wide text-muted">
                <th className="px-3 py-2.5 font-semibold">Product</th>
                <th className="px-3 py-2.5 text-right font-semibold">Conversions</th>
                <th className="px-3 py-2.5 text-right font-semibold">Revenue</th>
                <th className="px-3 py-2.5 text-right font-semibold">Collected</th>
              </tr>
            </thead>
            <tbody>
              {w.byProduct.map((p) => (
                <tr key={p.product} className="border-b border-line last:border-0">
                  <td className="px-3 py-2.5"><ProductChip product={p.product} /></td>
                  <td className="px-3 py-2.5 text-right tnum">{p.count}</td>
                  <td className="px-3 py-2.5 text-right tnum">{inr(p.revenue)}</td>
                  <td className="px-3 py-2.5 text-right tnum">{inr(p.cashCollected)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-line-strong font-semibold">
                <td className="px-3 py-2.5">Total</td>
                <td className="px-3 py-2.5 text-right tnum">{r.conversions}</td>
                <td className="px-3 py-2.5 text-right tnum">{inr(r.revenue)}</td>
                <td className="px-3 py-2.5 text-right tnum">{inr(r.cashCollected)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      {/* P&L rollup + batch capacity */}
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-card border border-line bg-surface p-4 shadow-card">
          <h2 className="font-display text-[15px] font-semibold">P&amp;L rollup</h2>
          <dl className="mt-3 space-y-1.5 text-sm">
            <PnlRow label="Revenue (billed)" value={inr(r.revenue)} />
            <PnlRow label="Cash collected" value={inr(r.cashCollected)} />
            <PnlRow label="Outstanding balance" node={<Signed minor={r.balance} />} />
            <div className="my-2 border-t border-line" />
            <PnlRow label="Books" value={inr(r.books)} muted />
            <PnlRow label="Tutor fees" value={inr(r.tutor)} muted />
            <PnlRow label="COGS (books + tutor)" value={inr(r.cogs)} />
            <PnlRow label={`Gross profit · ${pct(r.gpMargin)}`} node={<Signed minor={r.grossProfit} />} />
            <div className="my-2 border-t border-line" />
            <PnlRow label={`Ad spend (split across ${r.adDriven} ad conversion${r.adDriven === 1 ? "" : "s"})`} value={inr(r.ads)} muted />
            {r.referral > 0 && <PnlRow label="Referral" value={inr(r.referral)} muted />}
            <PnlRow label="Total expenses" value={inr(r.totalExp)} />
            <PnlRow label={`Net profit · ${pct(r.npMargin)}`} node={<Signed minor={r.netProfit} />} strong />
            {r.roas !== null && <PnlRow label="ROAS (revenue ÷ ad spend)" value={`${r.roas.toFixed(2)}×`} />}
          </dl>
        </section>

        <section className="rounded-card border border-line bg-surface p-4 shadow-card">
          <h2 className="font-display text-[15px] font-semibold">Batches &amp; seats</h2>
          <p className="text-xs text-muted">Live from the conversions&apos; batch assignments.</p>
          <CapacityGrid rows={w.capacity} />
        </section>
      </div>

      <AdSetsPanel workshopId={w.id} adSets={w.adSets} adTotals={w.adTotals} />
      <ConversionsPanel workshopId={w.id} conversions={w.conversions} />
    </div>
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

function PnlRow({ label, value, node, muted, strong }: { label: string; value?: string; node?: React.ReactNode; muted?: boolean; strong?: boolean }) {
  return (
    <div className={`flex items-center justify-between ${strong ? "font-semibold" : ""}`}>
      <dt className={muted ? "text-muted" : "text-ink-2"}>{label}</dt>
      <dd className={`tnum ${muted ? "text-muted" : "text-ink"}`}>{node ?? value}</dd>
    </div>
  );
}

function CapacityGrid({ rows }: { rows: GnCapacityRow[] }) {
  if (rows.length === 0) {
    return <p className="mt-3 text-sm text-muted">No batch assignments recorded yet.</p>;
  }
  const levels: SeatLevel[] = ["A1", "A2", "B1"];
  return (
    <div className="mt-3 space-y-3">
      {levels.map((level) => {
        const ls = rows.filter((r) => r.level === level);
        if (ls.length === 0) return null;
        return (
          <div key={level}>
            <p className="text-caption font-semibold uppercase tracking-wide text-muted">{level}</p>
            <ul className="mt-1 space-y-1">
              {ls.map((row, i) => (
                <li key={i} className="flex items-center justify-between rounded-field border border-line bg-surface-2 px-2.5 py-1.5 text-sm">
                  <span className="text-ink-2">
                    {row.batch ? <span className="font-semibold text-ink">{row.batch}</span> : "Unlabelled"}
                    {row.time ? ` · ${row.time}` : ""}
                    <span className="text-caption text-muted"> · {DAY_TYPE_LABELS[row.dayType]}</span>
                  </span>
                  <span className="tnum font-semibold">{row.seats}</span>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

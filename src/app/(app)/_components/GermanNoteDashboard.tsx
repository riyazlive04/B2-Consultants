import "server-only";
import Link from "next/link";
import {
  AlertCircle, BookOpen, CalendarClock, GraduationCap, Languages, TrendingUp, Users, Wallet,
} from "lucide-react";
import { MetricCard } from "@/components/ui/MetricCard";
import { Money } from "@/components/ui/CurrencyToggle";
import { Card, CardTitle, EmptyState, SectionHeading, ViewAll } from "@/components/ui/kit";
import { formatDate, formatPct } from "@/lib/format";
import { getTodayInrPerEur } from "@/lib/fx";
import { signedColor } from "@/lib/signals";
import { getGnHomeSnapshot } from "@/server/german-note-metrics";
import { getGnFounderStats } from "@/server/german-note-workshops";
import { PRODUCT_LABELS } from "@/app/(app)/german-note/_components/workshopFormat";

/**
 * The German Note dashboard (Error Log E3) — the second business, which had no dashboard of
 * its own and was visible only as a single tile on the founder's home page.
 *
 * Deliberately NOT a copy of the B2 dashboard's widgets. German Note does not have a sales
 * pipeline, discovery calls or a monthly collections target; it has workshop intakes, seats by
 * level, batches and tuition still owed. Mirroring B2's layout would have produced a page of
 * empty or meaningless cards — the spec's "same base dashboard UI" is about giving this
 * business a screen of the same QUALITY, not the same widgets.
 *
 * Every figure here already existed inside the workshop P&L engine; it was three clicks deep
 * and never aggregated onto a landing screen.
 */

export async function GermanNoteDashboard() {
  const [stats, snap, fx] = await Promise.all([
    getGnFounderStats(),
    getGnHomeSnapshot(),
    getTodayInrPerEur(),
  ]);
  const r = stats.totals;

  /**
   * German Note's economics are recorded in rupees end to end — Indian workshop fees, books and
   * tutor pay — so these figures have no stored EUR counterpart the way an Income row does. They
   * are paired at today's ECB rate purely so the page follows the ₹/€ toggle; the rupee figure is
   * the record, the euro one is a view of it.
   */
  const rate = Number(fx.rate);
  const compact = (v: number) => <Money amount={{ inr: v, eur: rate > 0 ? v / rate : 0 }} />;

  // Cash basis leads. Quoted revenue overstates profit on money that has not arrived — the
  // same rule the workshop screens already follow (docs F1 §6.7).
  const collectedPct = r.revenue > 0 ? (r.cashCollected / r.revenue) * 100 : null;
  const topDues = [...stats.dues].sort((a, b) => b.owed - a.owed).slice(0, 6);
  const recentWorkshops = stats.perWorkshop.slice(0, 4);

  return (
    <div className="w-full space-y-8">
      {/* 1 — Money, on the cash basis. */}
      <section className="space-y-4">
        <SectionHeading
          icon={<Wallet size={18} />}
          title="German Note — the business"
          description={`${stats.workshops} workshop intake${stats.workshops === 1 ? "" : "s"} · cash basis, quoted shown beside it`}
          action={<ViewAll href="/german-note/manage">Manage</ViewAll>}
        />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            label="Cash collected"
            value={compact(r.cashCollected)}
            secondary={
              collectedPct === null
                ? `${compact(r.revenue)} quoted`
                : `${formatPct(collectedPct)} of ${compact(r.revenue)} quoted`
            }
            tooltip="Money actually received across every workshop. The quoted figure is what was agreed — the gap is what is still owed."
            icon={<Wallet size={18} />}
            href="/german-note/manage"
            detail={{
              rows: recentWorkshops.map((w) => ({ label: w.name, value: compact(w.rollup.cashCollected) })),
              note:
                stats.perWorkshop.length > recentWorkshops.length
                  ? `Newest ${recentWorkshops.length} of ${stats.perWorkshop.length} workshops — see Manage for all.`
                  : undefined,
            }}
          />
          <MetricCard
            label="Net profit (cash)"
            value={compact(stats.netProfitCash)}
            secondary={`${compact(r.netProfit)} on quoted · NP ${pctOrDash(r.npMargin)}`}
            tooltip="Collected minus every cost — ads, books, tutor fees, referrals. The quoted-basis figure counts money that has not arrived, so it reads higher."
            icon={<TrendingUp size={18} />}
            href="/german-note/manage"
            // Sign is a verdict here, so it colours the number itself (Error Log D1).
            signal={stats.netProfitCash < 0 ? "risk" : undefined}
            detail={{
              rows: [
                { label: "Revenue (quoted)", value: compact(r.revenue) },
                { label: "COGS (books + tutor)", value: compact(r.cogs) },
                { label: "Ad spend", value: compact(r.ads) },
                { label: "Referral payouts", value: compact(r.referral) },
                { label: "Net profit (cash)", value: compact(stats.netProfitCash) },
              ],
            }}
          />
          <MetricCard
            label="Still owed"
            value={stats.outstanding > 0 ? compact(stats.outstanding) : "None"}
            signal={stats.outstanding > 0 ? "watch" : "ok"}
            secondary={
              stats.dues.length > 0
                ? `${stats.dues.length} learner${stats.dues.length === 1 ? "" : "s"} with a balance`
                : "Everything collected"
            }
            tooltip="Tuition agreed but not yet received, across all workshops."
            icon={<AlertCircle size={18} />}
            href="/german-note/manage"
            detail={{
              rows: topDues.map((d) => ({ label: d.fullName, value: compact(d.owed) })),
              note:
                stats.dues.length > topDues.length
                  ? `Largest ${topDues.length} of ${stats.dues.length} — full list below.`
                  : undefined,
            }}
          />
          <MetricCard
            label="Conversions"
            value={String(r.conversions)}
            secondary={`${r.paying} paying${r.freeSeats ? ` · ${r.freeSeats} free` : ""}${r.onHold ? ` · ${r.onHold} on hold` : ""}`}
            tooltip="Everyone who took a seat from a workshop, across every intake."
            icon={<GraduationCap size={18} />}
            href="/german-note/manage"
            detail={{
              rows: stats.byProduct.map((p) => ({ label: PRODUCT_LABELS[p.product], value: p.count })),
            }}
          />
        </div>
      </section>

      {/* 2 — Delivery: the live teaching operation, not the money. */}
      <section className="space-y-4">
        <SectionHeading
          icon={<Languages size={18} />}
          title="Delivery"
          description="Live batches and what is scheduled next"
          action={<ViewAll href="/german-note">Open German Note</ViewAll>}
        />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <MetricCard
            label="Active batches"
            value={String(snap.activeBatches)}
            secondary={snap.activeBatches === 0 ? "Nothing running" : `${snap.learners} learner${snap.learners === 1 ? "" : "s"} enrolled`}
            icon={<Users size={18} />}
            href="/german-note"
            detail={{
              rows: snap.byLevel
                .filter((b) => b.count > 0)
                .map((b) => ({ label: b.level, value: b.count })),
            }}
          />
          <MetricCard
            label="Next class"
            value={snap.nextEvent ? formatDate(snap.nextEvent.startsAt) : "None scheduled"}
            secondary={snap.nextEvent ? `${snap.nextEvent.title} · ${snap.nextEvent.batch.name}` : undefined}
            icon={<CalendarClock size={18} />}
            href="/german-note"
            detail={{
              rows: snap.upcoming.map((e) => ({
                label: `${e.batch.name} · ${e.title}`,
                value: formatDate(e.startsAt),
              })),
              note: snap.upcoming.length === 0 ? "Nothing scheduled yet." : undefined,
            }}
          />
          <MetricCard
            label="Seats by level"
            value={stats.seats.reduce((a, s) => a + s.seats, 0) + " seats"}
            secondary={
              stats.seats.filter((s) => s.seats > 0).map((s) => `${s.level} ${s.seats}`).join(" · ") ||
              "No seats yet"
            }
            tooltip="A bundle counts once per level it enrols into, so these add up to more than the conversion count."
            icon={<BookOpen size={18} />}
            href="/german-note/manage"
            detail={{
              rows: stats.seats
                .filter((s) => s.seats > 0)
                .map((s) => ({ label: s.level, value: `${s.seats} seat${s.seats === 1 ? "" : "s"}` })),
            }}
          />
        </div>
      </section>

      {/* 3 — Per-workshop P&L, newest intake first. */}
      <section className="space-y-4">
        <SectionHeading
          icon={<TrendingUp size={18} />}
          title="Recent workshops"
          description="Each intake's own profit and what it still has outstanding"
          action={<ViewAll href="/german-note/manage">All workshops</ViewAll>}
        />
        {recentWorkshops.length === 0 ? (
          <EmptyState
            title="No workshops yet"
            body="Create the first intake under Manage — conversions, seats and the P&L all follow from it."
          />
        ) : (
          <Card>
            <ul className="-mx-4 -mb-2">
              {recentWorkshops.map((w) => (
                <li
                  key={w.id}
                  className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3 last:border-0"
                >
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/german-note/workshops/${w.id}`}
                      className="font-medium text-ink hover:underline"
                    >
                      {w.name}
                    </Link>
                    <p className="text-caption text-muted">
                      {w.rollup.conversions} conversion{w.rollup.conversions === 1 ? "" : "s"} ·{" "}
                      {compact(w.rollup.cashCollected)} collected
                      {w.outstanding > 0 ? ` · ${compact(w.outstanding)} owed` : ""}
                    </p>
                  </div>
                  <span
                    className="tnum flex-none text-sm font-semibold"
                    style={{ color: signedColor(w.rollup.netProfit) ?? "var(--ink)" }}
                  >
                    {compact(w.rollup.netProfit)}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </section>

      {/* 4 — Who owes. The one list that turns this screen into an action. */}
      {topDues.length > 0 && (
        <section className="space-y-4">
          <SectionHeading
            icon={<AlertCircle size={18} />}
            title="Tuition still owed"
            description="Largest balances first — chase these before chasing new intakes"
          />
          <Card>
            <ul className="-mx-4 -mb-2">
              {topDues.map((d) => (
                <li
                  key={d.conversionId}
                  className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3 last:border-0"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-ink">{d.fullName}</p>
                    <p className="text-caption text-muted">
                      {d.workshopName} · paid {compact(d.paid)} of {compact(d.final)}
                      {d.nextDueDate ? ` · next due ${formatDate(d.nextDueDate)}` : ""}
                    </p>
                  </div>
                  <span className="tnum flex-none text-sm font-semibold" style={{ color: "var(--bad)" }}>
                    {compact(d.owed)}
                  </span>
                </li>
              ))}
            </ul>
            {stats.dues.length > topDues.length && (
              <p className="mt-3 text-caption text-muted">
                Showing the {topDues.length} largest of {stats.dues.length}.
              </p>
            )}
          </Card>
        </section>
      )}
    </div>
  );
}

/** A 0..1 margin → "36.9%", or an em dash when there is no revenue to divide by. */
function pctOrDash(frac: number | null): string {
  return frac === null ? "—" : formatPct(frac * 100);
}

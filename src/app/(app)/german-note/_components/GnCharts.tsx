import { BarRows, Columns, Donut, type DonutSlice } from "@/components/ui/charts";
import type { GnFounderStats } from "@/server/german-note-workshops";
import { formatMonth } from "@/lib/format";
import { inr, PRODUCT_LABELS } from "./workshopFormat";

/** Same ramp /finance uses for its category donut — GN reads as part of the app. */
const SHADES = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)", "var(--chart-6)"];

/**
 * The German Note money, visualised. Deliberately reuses the app's existing
 * chart primitives (the same ones /finance, /cash and /pipeline use) rather than
 * introducing a second chart language for one section.
 */
export function GnCharts({ stats }: { stats: GnFounderStats }) {
  // Cash actually collected per intake — the headline basis, so the chart matches the tiles.
  const cashByWorkshop = stats.perWorkshop.map((w) => ({
    label: formatMonth(w.month),
    value: w.rollup.cashCollected,
    display: inr(w.rollup.cashCollected, true),
    color: "var(--chart-1)",
  }));

  // Seats per level: a bundle (A1_A2) counts once in each level it enrols into.
  const seatSlices: DonutSlice[] = stats.seats.map((s, i) => ({
    label: s.level,
    value: s.seats,
    display: `${s.seats} seat${s.seats === 1 ? "" : "s"}`,
    color: SHADES[i % SHADES.length],
  }));
  const totalSeats = stats.seats.reduce((a, s) => a + s.seats, 0);

  // Exact product bought — revenue, not seat count, so bundles show their real weight.
  const productItems = stats.byProduct
    .filter((p) => p.count > 0)
    .map((p) => ({
      label: PRODUCT_LABELS[p.product],
      value: p.revenue,
      display: inr(p.revenue, true),
    }));

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Panel title="Cash collected by intake" hint="What each workshop has actually banked — not what it quoted.">
        <Columns items={cashByWorkshop} />
      </Panel>

      <Panel title="Seats by level" hint="A bundle counts once per level it enrols into, so seats exceed conversions.">
        <Donut
          slices={seatSlices}
          centerLabel="Total seats"
          centerValue={String(totalSeats)}
          size={168}
          thickness={24}
        />
      </Panel>

      <Panel title="Revenue by product" hint="Quoted revenue for the exact package bought.">
        {productItems.length > 0 ? (
          <BarRows items={productItems} />
        ) : (
          <p className="py-10 text-center text-sm text-muted">No conversions yet.</p>
        )}
      </Panel>
    </div>
  );
}

function Panel({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-card border border-line bg-surface p-4 shadow-card">
      <h3 className="text-sm font-semibold">{title}</h3>
      {hint && <p className="mb-3 mt-0.5 text-caption text-muted">{hint}</p>}
      {children}
    </div>
  );
}

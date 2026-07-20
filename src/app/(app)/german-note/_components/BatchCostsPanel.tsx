import Link from "next/link";
import { Users } from "lucide-react";
import type { BatchCostRow } from "@/server/pending-pool-metrics";

/**
 * What each active batch costs in tutor fees (spec Part 2 §5; test cases FIN-004/005).
 *
 * A server component: the numbers are derived, there is nothing to interact with, and the
 * whole table is a read.
 *
 * The band column is doing real work. The founders' rule is a cliff — one student joining a
 * 4-person batch drops the rate for EVERYONE in it, from ₹8,000/head to ₹7,000/head, and the
 * batch total moves in a direction that surprises people. Showing which side of the threshold
 * a batch sits on makes that legible instead of mysterious.
 */
export function BatchCostsPanel({ rows }: { rows: BatchCostRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-field border border-line bg-surface-2 px-4 py-8 text-center">
        <Users size={20} className="mx-auto text-ink-3" />
        <p className="mt-2 text-sm text-muted">
          No active batches at a priced level yet. Rates live in{" "}
          <Link href="/console" className="font-semibold text-accent hover:underline">
            Founder Console → Tutor Fee
          </Link>
          .
        </p>
      </div>
    );
  }

  const total = rows.reduce((a, r) => a + r.tutorFeeTotal, 0);
  const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;

  return (
    <div className="space-y-4">
      <p className="max-w-2xl text-sm text-muted">
        What we owe tutors for the batches running now. The per-head rate is set by{" "}
        <strong>batch size</strong>, not level — a batch at or above the threshold earns the
        volume rate. Edit the bands in{" "}
        <Link href="/console" className="font-semibold text-accent hover:underline">
          Founder Console → Tutor Fee
        </Link>
        .
      </p>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left text-caption uppercase text-ink-3">
              <th className="py-2 pr-4 font-medium">Batch</th>
              <th className="py-2 pr-4 font-medium">Level</th>
              <th className="py-2 pr-4 font-medium">Students</th>
              <th className="py-2 pr-4 font-medium">Band</th>
              <th className="py-2 pr-4 font-medium">Rate / head</th>
              <th className="py-2 font-medium">Tutor fee</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-line/60">
                <td className="py-2 pr-4">
                  <Link href={`/german-note/${r.id}`} className="font-medium text-ink hover:underline">
                    {r.name}
                  </Link>
                </td>
                <td className="py-2 pr-4 text-ink-2">{r.level}</td>
                <td className="py-2 pr-4 text-ink-2">
                  {r.headcount}
                  <span className="text-muted">/{r.targetStrength}</span>
                </td>
                <td className="py-2 pr-4">
                  <span
                    className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                      r.band === "at-or-above"
                        ? "bg-accent-soft text-ink"
                        : "border border-line bg-surface-2 text-ink-2"
                    }`}
                    title={
                      r.band === "at-or-above"
                        ? `${r.headcount} students is at or above the threshold of ${r.threshold} — volume rate.`
                        : `${r.headcount} students is under the threshold of ${r.threshold} — thin-batch rate. One more student would drop the rate for everyone in it.`
                    }
                  >
                    {r.band === "at-or-above" ? `${r.threshold}+` : `under ${r.threshold}`}
                  </span>
                </td>
                <td className="py-2 pr-4 text-ink-2">{inr(r.ratePerHead)}</td>
                <td className="py-2 font-semibold text-ink">{inr(r.tutorFeeTotal)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={5} className="py-2 pr-4 text-right text-caption font-semibold uppercase text-ink-3">
                Total, active batches
              </td>
              <td className="py-2 font-semibold text-ink">{inr(total)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

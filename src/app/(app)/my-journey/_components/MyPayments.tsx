import { CheckCircle2, CircleDot, Receipt } from "lucide-react";
import { Card } from "@/components/ui/kit";
import { formatDate, formatInrMinor } from "@/lib/format";
import type { StudentInstalment, StudentPayments } from "@/server/student-payments";

/**
 * The student's own payment plan and receipts (rebuild spec §10).
 *
 * Tone matters here more than on an internal screen: this is someone looking at what they owe for
 * a programme they are part-way through. So it states the position plainly — paid, outstanding,
 * next due — without dunning language, badges or red-by-default. An overdue instalment is marked
 * once, factually, and nothing else on the card shouts.
 *
 * Shows ONLY their own figures. Nothing here reveals margin, commission, LTV or what any other
 * student paid — see the header of `student-payments.ts` for exactly where that line sits.
 */

function InstalmentRow({ i }: { i: StudentInstalment }) {
  const paid = i.status === "PAID";
  return (
    <li className="flex items-center gap-3 py-2">
      {paid ? (
        <CheckCircle2 size={16} style={{ color: "var(--good)" }} aria-hidden />
      ) : (
        <CircleDot size={16} style={{ color: i.overdue ? "var(--warn)" : "var(--ink-3)" }} aria-hidden />
      )}
      <span className="flex-1 text-sm">
        <span className="font-medium text-ink">Instalment {i.seq}</span>
        <span className="ml-2 text-caption text-muted">
          {paid
            ? `paid ${i.paidDate ? formatDate(i.paidDate) : ""}`.trim()
            : `due ${formatDate(i.dueDate)}${i.overdue ? " · overdue" : ""}`}
        </span>
      </span>
      <span className="tnum text-sm font-semibold text-ink">{formatInrMinor(i.amountInrMinor)}</span>
    </li>
  );
}

export function MyPayments({ payments }: { payments: StudentPayments }) {
  if (!payments.hasAny) return null;

  return (
    <div className="space-y-6">
      {payments.plans.map((p, idx) => (
        <Card
          key={`${p.programLevel}-${idx}`}
          title="Your payment plan"
          subtitle={p.outstandingInrMinor === 0 ? "Fully paid — nothing outstanding." : undefined}
        >
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div>
              <p className="text-caption text-muted">Programme fee</p>
              <p className="tnum font-display text-xl font-bold text-ink">
                {formatInrMinor(p.totalFeeInrMinor)}
              </p>
            </div>
            <div>
              <p className="text-caption text-muted">Paid</p>
              <p className="tnum font-display text-xl font-bold" style={{ color: "var(--good)" }}>
                {formatInrMinor(p.paidInrMinor)}
              </p>
            </div>
            <div>
              <p className="text-caption text-muted">Outstanding</p>
              <p className="tnum font-display text-xl font-bold text-ink">
                {formatInrMinor(p.outstandingInrMinor)}
              </p>
            </div>
            <div>
              <p className="text-caption text-muted">Next due</p>
              <p className="font-display text-xl font-bold text-ink">
                {p.nextDueDate ? formatDate(p.nextDueDate) : "—"}
              </p>
              {p.nextDueAmountInrMinor !== null && (
                <p className="tnum text-caption text-muted">
                  {formatInrMinor(p.nextDueAmountInrMinor)}
                </p>
              )}
            </div>
          </div>

          {p.instalments.length > 0 && (
            <ul className="mt-4 divide-y divide-line border-t border-line">
              {p.instalments.map((i) => (
                <InstalmentRow key={i.seq} i={i} />
              ))}
            </ul>
          )}
        </Card>
      ))}

      {payments.receipts.length > 0 && (
        <Card
          title={<span className="flex items-center gap-2"><Receipt size={16} /> Payments received</span>}
          subtitle="Every payment we have recorded from you."
        >
          <ul className="divide-y divide-line">
            {payments.receipts.map((r) => (
              <li key={r.id} className="flex items-center justify-between py-2 text-sm">
                <span className="text-ink-2">{formatDate(r.date)}</span>
                <span className="tnum font-semibold text-ink">{formatInrMinor(r.amountInrMinor)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

import { CalendarClock, Info } from "lucide-react";
import { Card, CardTitle } from "@/components/ui/kit";
import { formatInrMinor } from "@/lib/format";

/**
 * Cash collected vs revenue earned, for the current month.
 *
 * WHY THIS CARD EXISTS: every other figure on this page is CASH — `Income.date` is the day money
 * arrived. So a 120-day Elite program paid up front books its whole fee in month one, and the
 * margin shown for that month is overstated by roughly four months of delivery cost that hasn't
 * been incurred yet. The founders notice in month four, when the cash stops and the costs don't.
 *
 * IT ADDS, IT DOES NOT REPLACE. Cash is shown first and given equal weight. Both numbers are true
 * and they answer different questions; a page that quietly swapped one for the other would be the
 * same error in the opposite direction, and would also disagree with the founders' bank balance —
 * which is how a finance screen loses its reader for good.
 *
 * INR ONLY, deliberately. This sits outside the ₹/€ toggle because recognition is computed over a
 * mixed-currency set aggregated at each row's stored rate; there is no meaningful "the same number
 * in euros" to switch to, and offering one would invent a figure.
 */
export function RecognitionCard({
  monthLabel,
  cashInrMinor,
  recognisedInrMinor,
  deferredInrMinor,
  confidence,
}: {
  monthLabel: string;
  cashInrMinor: number;
  recognisedInrMinor: number;
  deferredInrMinor: number;
  confidence: { level: "HIGH" | "PARTIAL" | "LOW"; note: string };
}) {
  const variance = recognisedInrMinor - cashInrMinor;

  return (
    <Card>
      <CardTitle icon={<CalendarClock size={16} />}>Earned vs collected — {monthLabel}</CardTitle>

      <dl className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div>
          <dt className="text-caption text-muted">Cash collected</dt>
          <dd className="font-display text-xl font-bold tabular-nums text-ink">
            {formatInrMinor(cashInrMinor)}
          </dd>
          <p className="mt-0.5 text-caption text-muted">Money that arrived this month.</p>
        </div>
        <div>
          <dt className="text-caption text-muted">Revenue earned</dt>
          <dd className="font-display text-xl font-bold tabular-nums text-ink">
            {formatInrMinor(recognisedInrMinor)}
          </dd>
          <p className="mt-0.5 text-caption text-muted">
            Spread straight-line across each program&apos;s length.
          </p>
        </div>
        <div>
          <dt className="text-caption text-muted">Deferred</dt>
          <dd className="font-display text-xl font-bold tabular-nums text-ink">
            {formatInrMinor(deferredInrMinor)}
          </dd>
          <p className="mt-0.5 text-caption text-muted">Collected, not yet delivered.</p>
        </div>
      </dl>

      {variance !== 0 && (
        <p className="mt-4 text-sm text-ink-2">
          {variance < 0 ? (
            <>
              You collected <strong>{formatInrMinor(-variance)}</strong> more than you earned this
              month — that difference is delivery you still owe.
            </>
          ) : (
            <>
              You earned <strong>{formatInrMinor(variance)}</strong> more than you collected —
              revenue from programs sold in earlier months.
            </>
          )}
        </p>
      )}

      {/* The honesty line. With most income unlinked from an enrollment, "earned" is nearly
          identical to "collected", and the reader should be told that rather than left to infer
          a sophistication the data doesn't support. */}
      <p
        className={`mt-3 flex items-start gap-1.5 text-caption ${
          confidence.level === "LOW" ? "text-warn" : "text-muted"
        }`}
      >
        <Info size={13} className="mt-0.5 shrink-0" aria-hidden />
        <span>{confidence.note}</span>
      </p>
    </Card>
  );
}

import { Wallet, Users } from "lucide-react";
import { Card, CardTitle, EmptyState, Pill, SectionHeading } from "@/components/ui/kit";
import { MetricCard } from "@/components/ui/MetricCard";
import { formatInrMinor } from "@/lib/format";
import type { OwnCommission as OwnCommissionData } from "@/server/commission-metrics";

/**
 * "What have I earned this month?" - rebuild spec §6 and §7, which both list own commission as
 * a working tool on the specialist's own desk.
 *
 * It was the one JD item with nowhere to live: the whole-team payout board (/telecaller) is
 * Admin/Head only and correctly closed to specialists, so neither Nilofer nor Asma could see
 * their own pay anywhere in the app - even though `lib/sections.ts` says in a comment that they
 * get it "on My Desk".
 *
 * Shared by both desks deliberately. The commission rules do not differ by level - the same
 * split/both-calls/closer arithmetic decides everyone's line - so two copies of this component
 * would be two places for the same number to be formatted differently.
 *
 * A server component: it renders figures the viewer is allowed to see and nothing else, and
 * shipping the row data to the client would be shipping it to a page that has no other reason
 * to hold money.
 */
export function OwnCommission({ data }: { data: OwnCommissionData }) {
  const monthLabel = new Date(`${data.month}-01T00:00:00Z`).toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

  return (
    <section className="space-y-4">
      <SectionHeading
        icon={<Wallet size={18} />}
        title="Your commission"
        description={`Earned on payments received in ${monthLabel} - your own share only`}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <MetricCard
          label={`Your commission - ${monthLabel}`}
          value={formatInrMinor(data.totalInrMinor)}
          icon={<Wallet size={18} />}
          detail={{
            rows: data.lines.slice(0, 8).map((l) => ({
              label: `${l.studentName}${l.sharedWith.length ? ` (shared)` : ""}`,
              value: `${formatInrMinor(l.amountInrMinor)} · ${l.pct}%`,
            })),
            note:
              data.lines.length > 8
                ? `Showing 8 of ${data.lines.length} - the full list is below.`
                : data.lines.length === 0
                  ? "No payments have been credited to you this month."
                  : undefined,
          }}
        />
        <MetricCard
          label="Deals paying you"
          value={String(data.deals)}
          secondary={data.deals === 1 ? "payment this month" : "payments this month"}
          icon={<Users size={18} />}
          detail={{
            rows: [
              { label: "Payments crediting you", value: data.deals },
              /* Their admin, not their performance - an unattributed payment credited nobody. */
              { label: "Payments crediting nobody", value: data.unattributedDeals },
            ],
            note:
              data.unattributedDeals > 0
                ? "A payment credits nobody when its lead has no owner or the discovery outcome was never recorded."
                : undefined,
          }}
        />
      </div>

      {data.lines.length === 0 ? (
        <EmptyState
          title="Nothing credited to you yet this month"
          body="Commission is calculated per payment received from a student you set or ran the discovery call for. It appears here the moment a payment lands against one of your leads."
        />
      ) : (
        <Card title={<CardTitle icon={<Wallet size={18} />}>Every payment crediting you</CardTitle>}>
          <ul className="-mx-4 -mb-2">
            {data.lines.map((l) => (
              <li
                key={l.incomeId}
                className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3 last:border-0"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate font-medium text-ink" title={l.studentName}>{l.studentName}</span>
                    {/* §6 asks for the split to be visible where a lead was shared. The
                        colleague is named; their amount deliberately is not. */}
                    {l.sharedWith.length > 0 && (
                      <Pill tone="neutral">Shared with {l.sharedWith.join(", ")}</Pill>
                    )}
                  </div>
                  <p className="mt-0.5 truncate text-caption text-muted">
                    {new Date(l.date).toLocaleDateString("en-GB", { timeZone: "Asia/Kolkata" })}
                    {l.programLevel ? ` · ${l.programLevel}` : ""} · {l.rule}
                  </p>
                </div>
                <div className="flex-none text-right">
                  <div className="tnum font-semibold text-ink">{formatInrMinor(l.amountInrMinor)}</div>
                  <div className="tnum text-caption text-muted">{l.pct}% share</div>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </section>
  );
}

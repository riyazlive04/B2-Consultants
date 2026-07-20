import Link from "next/link";
import { AlertTriangle, CheckCircle2, Scale, ShieldCheck } from "lucide-react";
import {
  Card,
  CardTitle,
  EmptyState,
  Grid,
  PageHeader,
  Panel,
  Stat,
} from "@/components/ui/kit";
import { formatInrMinor } from "@/lib/format";
// (formatDate/formatEurMinor moved into JournalList with the entry rendering)
import { requireSection } from "@/lib/rbac";
import { getJournal, getTrialBalance, verifyAuditChain } from "@/server/ledger";
import { TrialBalanceTable } from "./_components/TrialBalanceTable";
import { JournalList } from "./_components/JournalList";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;

/**
 * The read-only Ledger (SPEC §10.4).
 *
 * Its whole job is trust: every figure on Finance and Cash Health is a slice of what is
 * shown here, so the founder can follow any rupee back to a balanced entry. Nothing on
 * this page is editable — corrections happen in Finance and arrive here as a void plus a
 * restated entry, which is why voided entries stay visible rather than disappearing.
 */
export default async function LedgerPage({ searchParams }: { searchParams: { page?: string } }) {
  await requireSection("ledger");

  const page = Math.max(1, Number(searchParams.page ?? 1) || 1);
  const [trial, journal, chain] = await Promise.all([
    getTrialBalance(),
    getJournal({ take: PAGE_SIZE, skip: (page - 1) * PAGE_SIZE }),
    verifyAuditChain(),
  ]);

  const pages = Math.max(1, Math.ceil(journal.total / PAGE_SIZE));

  return (
    <div className="w-full space-y-6">
      <PageHeader
        icon={<Scale size={22} strokeWidth={1.8} />}
        eyebrow="Accounting"
        title="Ledger"
        subtitle="Every rupee on Finance and Cash Health traces to a balanced entry here. Read-only by design — corrections are posted, never edited."
      />

      <Grid cols={4}>
        <Panel>
          <Stat label="Total debits" value={formatInrMinor(trial.totalDebit)} />
        </Panel>
        <Panel>
          <Stat label="Total credits" value={formatInrMinor(trial.totalCredit)} />
        </Panel>
        <Panel>
          <Stat
            label="Trial balance"
            tone={trial.balanced ? "good" : "bad"}
            value={trial.balanced ? "Debits = Credits ✓" : "Unbalanced"}
          />
        </Panel>
        <Panel>
          <Stat
            label="Audit chain"
            tone={chain.ok ? "good" : "bad"}
            value={chain.ok ? `${chain.length} verified` : `Broken at #${chain.brokenAtSeq}`}
          />
        </Panel>
      </Grid>

      {/* The assertion the design system asks for (§5.10) — stated, not implied. */}
      {trial.balanced ? (
        <div className="flex items-center gap-2 rounded-field bg-good-soft px-4 py-3 text-sm font-medium text-good">
          <CheckCircle2 size={16} />
          Debits equal credits across {trial.rows.length} accounts. The books balance.
        </div>
      ) : (
        <div className="flex items-center gap-2 rounded-field bg-bad-soft px-4 py-3 text-sm font-medium text-bad">
          <AlertTriangle size={16} />
          The trial balance does not balance. Stop and investigate before trusting any figure on
          Finance or Cash Health.
        </div>
      )}

      {!chain.ok && (
        <div className="flex items-center gap-2 rounded-field bg-bad-soft px-4 py-3 text-sm font-medium text-bad">
          <ShieldCheck size={16} />
          The audit hash chain fails to verify from entry #{String(chain.brokenAtSeq)}. History has
          been altered outside the application.
        </div>
      )}

      <section>
        <h3 className="mb-1 flex items-center gap-2 font-display text-h3 text-ink">
          <span className="text-primary"><Scale size={17} /></span>
          Trial balance
        </h3>
        <p className="mb-3 text-caption text-muted">All entries, including voided ones and their reversals — which cancel each other out.</p>
        {trial.rows.length === 0 ? (
          <EmptyState
            title="Nothing posted yet"
            body="Record an income or expense in Finance, or run `npm run db:ledger` to backfill existing rows."
          />
        ) : (
          <>
            <TrialBalanceTable rows={trial.rows} />
            <p className="mt-2 text-xs text-muted">
              Total: <span className="tnum font-semibold text-ink">{formatInrMinor(trial.totalDebit)} debit</span> ·{" "}
              <span className="tnum font-semibold text-ink">{formatInrMinor(trial.totalCredit)} credit</span>
            </p>
          </>
        )}
      </section>

      <Card
        title={<CardTitle icon={<Scale size={17} />}>Journal</CardTitle>}
        subtitle={`${journal.total} entries · newest first`}
        flush
      >
        {journal.entries.length === 0 ? (
          <div className="p-6">
            <EmptyState title="No journal entries" body="Finance writes here on every income and expense." />
          </div>
        ) : (
          <JournalList entries={journal.entries} />
        )}

        {pages > 1 && (
          <div className="flex items-center justify-between border-t border-line px-6 py-3 text-sm">
            <span className="text-muted">
              Page {page} of {pages}
            </span>
            <div className="flex gap-2">
              {page > 1 && (
                <Link href={`/ledger?page=${page - 1}`} className="text-primary-strong hover:underline">
                  ← Newer
                </Link>
              )}
              {page < pages && (
                <Link href={`/ledger?page=${page + 1}`} className="text-primary-strong hover:underline">
                  Older →
                </Link>
              )}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

import Link from "next/link";
import { FileSignature, Plus } from "lucide-react";
import { MetricCard } from "@/components/ui/MetricCard";
import { requireSection } from "@/lib/rbac";
import { formatDate } from "@/lib/format";
import { formatInrPlain, type AgreementStatusKey } from "@/lib/agreement";
import { getAgreementCounts, listAgreements } from "@/server/agreement-metrics";
import { StatusBadge } from "./_components/StatusBadge";

export const dynamic = "force-dynamic";

export default async function AgreementsPage() {
  await requireSection("agreements");
  const [rows, counts] = await Promise.all([listAgreements(), getAgreementCounts()]);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-line bg-surface px-5 py-4 shadow-card">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 flex-none place-items-center rounded-field bg-accent-soft text-accent">
            <FileSignature size={20} />
          </span>
          <div>
            <h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">Agreements</h1>
            <p className="text-xs text-muted">
              Draft, countersign and issue coaching agreements — signed over WhatsApp.
            </p>
          </div>
        </div>
        <Link
          href="/agreements/new"
          className="inline-flex h-10 items-center gap-1.5 rounded-btn bg-primary px-4 text-sm font-semibold text-white transition-colors hover:bg-primary-strong"
        >
          <Plus size={16} /> New agreement
        </Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Drafts" value={counts.draft} />
        <MetricCard label="Awaiting signature" value={counts.awaiting} signal={counts.awaiting > 0 ? "watch" : undefined} />
        <MetricCard label="Signed" value={counts.signed} signal={counts.signed > 0 ? "ok" : undefined} />
        <MetricCard label="Voided / declined / expired" value={counts.other} />
      </div>

      <div className="overflow-hidden rounded-card border border-line bg-surface shadow-card">
        {rows.length === 0 ? (
          <p className="px-5 py-12 text-center text-sm text-muted">
            No agreements yet. Create one from a won lead.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                  <th className="px-4 py-3 font-medium">Document</th>
                  <th className="px-4 py-3 font-medium">Student</th>
                  <th className="px-4 py-3 font-medium">Batch</th>
                  <th className="px-4 py-3 font-medium">Fee</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Created</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const d = r.parsed.success ? r.parsed.data : null;
                  return (
                    <tr key={r.id} className="border-b border-line last:border-0 hover:bg-surface-2">
                      <td className="px-4 py-3">
                        <Link href={`/agreements/${r.id}`} className="font-medium text-primary hover:underline">
                          {r.documentNo}
                        </Link>
                      </td>
                      <td className="px-4 py-3">{d?.student.fullName ?? r.student?.fullName ?? "—"}</td>
                      <td className="px-4 py-3 text-muted">{d?.batch.number ?? "—"}</td>
                      <td className="px-4 py-3 tabular-nums">
                        {d ? formatInrPlain(d.payment.totalInrMinor) : "—"}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={r.status as AgreementStatusKey} />
                      </td>
                      <td className="px-4 py-3 text-muted">{formatDate(r.createdAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

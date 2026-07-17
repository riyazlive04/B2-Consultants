import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Download, ShieldCheck } from "lucide-react";
import { requireSection } from "@/lib/rbac";
import { formatDateTimeInZone, formatInrMinor } from "@/lib/format";
import {
  AGREEMENT_EVENT_LABELS,
  effectiveAgreementStatus,
  formatGermanDate,
} from "@/lib/agreement";
import { WHATSAPP_KIND_LABELS, WHATSAPP_STATUS_LABELS } from "@/lib/whatsapp";
import { getAgreementDetail } from "@/server/agreement-metrics";
import { readStoredDevice } from "@/server/agreement-core";
import { StatusBadge } from "../_components/StatusBadge";
import { AgreementActions } from "./_components/AgreementActions";
import { DevicePanel } from "./_components/DevicePanel";
import { AgreementForm } from "../_components/AgreementForm";

export const dynamic = "force-dynamic";

const ist = (d: Date) => formatDateTimeInZone(d, "Asia/Kolkata");

export default async function AgreementDetailPage({ params }: { params: { id: string } }) {
  await requireSection("agreements");
  const row = await getAgreementDetail(params.id);
  if (!row) notFound();

  if (!row.parsed.success) {
    return (
      <div className="mx-auto max-w-3xl rounded-card border border-line bg-surface p-6 text-sm">
        <p className="font-medium text-risk">This agreement’s stored fields no longer validate.</p>
        <p className="mt-2 text-muted">{row.parsed.error.issues[0]?.message}</p>
      </div>
    );
  }
  const data = row.parsed.data;
  // The elapsed-TTL correction: the row still says SENT, but the link is dead.
  const status = effectiveAgreementStatus(row);
  const isDraft = status === "DRAFT";
  const isSigned = status === "SIGNED";

  return (
    <div className="w-full space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link href="/agreements" className="text-muted transition-colors hover:text-ink">
            <ArrowLeft size={18} />
          </Link>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="font-display text-2xl font-bold tracking-tight">{row.documentNo}</h1>
              <StatusBadge status={status} />
            </div>
            <p className="text-xs text-muted">
              {data.student.fullName} · {data.batch.number} · starts {formatGermanDate(data.batch.startDate)} ·
              template {row.templateVersion}
            </p>
          </div>
        </div>
        <a
          href={`/api/agreements/${row.id}/pdf?download=1`}
          className="inline-flex h-10 items-center gap-1.5 rounded-btn border border-line px-4 text-sm font-medium transition-colors hover:border-primary hover:text-primary"
        >
          <Download size={15} /> Download {isSigned ? "signed copy" : "draft"}
        </a>
      </div>

      <div className="rounded-card border border-line bg-surface p-5 shadow-card">
        {/* Effective status, so an expired link offers "void & clone" rather than a "remind"
            button the server would only reject. */}
        <AgreementActions id={row.id} status={status} studentName={data.student.fullName} />
      </div>

      {/* Integrity — the two hashes, and why they are different things. */}
      <div className="rounded-card border border-line bg-surface p-5 shadow-card">
        <h2 className="mb-3 flex items-center gap-2 font-display text-h2 font-semibold">
          <ShieldCheck size={18} className="text-accent" /> Integrity
        </h2>
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted">Content hash (reproducible)</dt>
            <dd className="mt-1 break-all font-mono text-xs">{row.dataSha256}</dd>
            <p className="mt-1 text-xs text-muted">
              SHA-256 of the agreed terms + template version. Printed on every page.
            </p>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted">Sealed PDF hash</dt>
            <dd className="mt-1 break-all font-mono text-xs">
              {row.pdfSha256 ?? <span className="font-sans text-muted">Not sealed until signed</span>}
            </dd>
            <p className="mt-1 text-xs text-muted">
              {row.pdfSha256
                ? `SHA-256 of the ${row.pdfSize?.toLocaleString()} stored bytes. Taken once, at signing.`
                : "The PDF is rendered and hashed at the moment the student signs."}
            </p>
          </div>
        </dl>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="overflow-hidden rounded-card border border-line bg-surface shadow-card">
          <div className="border-b border-line px-5 py-3">
            <h2 className="font-display text-h2 font-semibold">{isSigned ? "Signed document" : "Preview"}</h2>
            <p className="text-xs text-muted">
              {isSigned
                ? "The sealed bytes, served exactly as they were hashed."
                : "Rendered live from the fields below — this is what the student will read."}
            </p>
          </div>
          <iframe
            src={`/api/agreements/${row.id}/pdf`}
            title={`Agreement ${row.documentNo}`}
            className="h-[820px] w-full bg-surface-2"
          />
        </div>

        <div className="space-y-6">
          <div className="rounded-card border border-line bg-surface p-5 shadow-card">
            <h2 className="mb-3 font-display text-h2 font-semibold">Terms</h2>
            <dl className="space-y-2 text-sm">
              <Row label="Student">{data.student.fullName}</Row>
              <Row label="Address">{data.student.address}</Row>
              <Row label="WhatsApp">{data.student.phone}</Row>
              <Row label="Batch">{data.batch.number}</Row>
              <Row label="Starts">{formatGermanDate(data.batch.startDate)}</Row>
              <Row label="Total fee">{formatInrMinor(BigInt(data.payment.totalInrMinor))}</Row>
              <Row label="Plan">
                {data.payment.option === "FULL"
                  ? "Option A — full payment"
                  : `Option B — ${data.payment.instalments
                      .map((i) => formatInrMinor(BigInt(i.amountInrMinor)))
                      .join(" + ")}`}
              </Row>
            </dl>
          </div>

          <DevicePanel
            title="Signer's device"
            device={readStoredDevice(row.signerDevice)}
            signedAt={row.signedAt}
          />

          {readStoredDevice(row.founderDevice) && (
            <DevicePanel
              title="Countersigning device"
              device={readStoredDevice(row.founderDevice)}
              signedAt={row.founderSignedAt}
            />
          )}

          <div className="rounded-card border border-line bg-surface p-5 shadow-card">
            <h2 className="mb-3 font-display text-h2 font-semibold">Audit trail</h2>
            <p className="mb-3 text-xs text-muted">
              Append-only, enforced by a database trigger. Reproduced in the certificate page of the signed PDF.
            </p>
            <ol className="space-y-2.5">
              {row.events.map((e) => (
                <li key={e.id} className="flex gap-3 text-sm">
                  <span className="mt-1.5 h-1.5 w-1.5 flex-none rounded-full bg-accent" />
                  <div className="min-w-0">
                    <p className="font-medium">{AGREEMENT_EVENT_LABELS[e.type]}</p>
                    <p className="text-xs text-muted">
                      {ist(e.createdAt)}
                      {e.ip && ` · ${e.ip}`}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </div>

          {row.whatsappMessages.length > 0 && (
            <div className="rounded-card border border-line bg-surface p-5 shadow-card">
              <h2 className="mb-3 font-display text-h2 font-semibold">WhatsApp</h2>
              <ul className="space-y-2.5">
                {row.whatsappMessages.map((m) => (
                  <li key={m.id} className="text-sm">
                    <p className="font-medium">{WHATSAPP_KIND_LABELS[m.kind]}</p>
                    <p className="text-xs text-muted">
                      {WHATSAPP_STATUS_LABELS[m.status]} · {ist(m.createdAt)}
                    </p>
                    {m.error && <p className="mt-0.5 text-xs text-risk">{m.error}</p>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>

      {isDraft && (
        <div className="space-y-3">
          <h2 className="font-display text-h2 font-semibold">Edit fields</h2>
          <p className="text-xs text-muted">
            Only a draft can be edited. Once issued, the terms are frozen — void and clone to revise.
          </p>
          <AgreementForm initial={data} mode={{ kind: "edit", id: row.id }} />
        </div>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <dt className="w-24 flex-none text-muted">{label}</dt>
      <dd className="min-w-0 flex-1">{children}</dd>
    </div>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";
import { Download, FileText, Paperclip, ShieldCheck } from "lucide-react";
import { requireSection } from "@/lib/rbac";
import { formatDateTimeInZone, formatInrMinor } from "@/lib/format";
import {
  AGREEMENT_EVENT_LABELS,
  effectiveAgreementStatus,
  formatGermanDate,
} from "@/lib/agreement";
import { WHATSAPP_KIND_LABELS, WHATSAPP_STATUS_LABELS } from "@/lib/whatsapp";
import { getAgreementDetail, getMeetingAttendees } from "@/server/agreement-metrics";
import { getInstalmentPlanConfig } from "@/server/founder-config";
import { agreementBatchOptions } from "@/server/batches";
import { readStoredDevice } from "@/server/agreement-core";
import { documentReadiness, parseBodyRow } from "@/server/agreement-body";
import { documentNeedsCoSigner, listAgreementSigners } from "@/server/agreement-signers";
import { listAgreementAttachments } from "@/server/agreement-attachments";
import { SIGNER_LABELS } from "@/lib/agreement-doc";
import { StatusBadge } from "../_components/StatusBadge";
import { AgreementActions } from "./_components/AgreementActions";
import { DevicePanel } from "./_components/DevicePanel";
import { EnrolPrompt } from "./_components/EnrolPrompt";
import { DocumentPanel } from "./_components/DocumentPanel";
import { CoSignerPanel } from "./_components/CoSignerPanel";
import { enrolmentState } from "@/lib/agreement-enrol";
import { AgreementForm } from "../_components/AgreementForm";
import { PageHeader } from "@/components/ui/kit";

export const dynamic = "force-dynamic";

const ist = (d: Date) => formatDateTimeInZone(d, "Asia/Kolkata");

/** What the header says this agreement is drawn up on. */
const DOCUMENT_KIND_NOTE: Record<"GUIDED" | "DOCX" | "PDF", string> = {
  GUIDED: "Guided Mode clause set",
  DOCX: "uploaded Word document",
  PDF: "uploaded PDF",
};

export default async function AgreementDetailPage({ params }: { params: { id: string } }) {
  await requireSection("agreements");
  const row = await getAgreementDetail(params.id);
  if (!row) notFound();
  // Only a draft shows the form, so neither of these is fetched for an issued agreement.
  const isEditable = row.status === "DRAFT";
  const [instalmentPlans, attendees, batches] = isEditable
    ? await Promise.all([getInstalmentPlanConfig(), getMeetingAttendees(), agreementBatchOptions()])
    : [undefined, [], []];

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

  /**
   * The uploaded document, for an agreement that has one. Parsed here rather than in the panel so
   * the readiness list the founder reads is computed by the SAME function `issueAgreement` gates
   * on - the screen must never say "ready to send" about something the server would refuse.
   */
  const [signers, attachments] = await Promise.all([
    listAgreementSigners(row.id),
    listAgreementAttachments(row.id),
  ]);

  const parsedBody = row.body ? parseBodyRow(row.body) : null;
  const docBody = parsedBody?.ok ? parsedBody.body : null;
  const docProblems = docBody
    ? (() => {
        const ready = documentReadiness(docBody);
        return ready.ok ? [] : ready.problems;
      })()
    : [];

  return (
    <div className="w-full space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <PageHeader
          back={{ href: "/agreements", label: "Agreements" }}
          title={row.documentNo}
          titleSuffix={<StatusBadge status={status} />}
          subtitle={`${data.student.fullName} · ${data.batch.number} · starts ${formatGermanDate(
            data.batch.startDate,
          )} · ${DOCUMENT_KIND_NOTE[row.documentKind]}`}
        />
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

      {/*
        Why the student said no. The reason was stored on decline (and in the DECLINED event) but
        rendered nowhere, so the founder saw "Declined" and had to ask the student again - the one
        piece of feedback the signing page exists to collect.
      */}
      {row.declinedAt && (
        <div className="rounded-card border border-risk/40 bg-surface p-5 shadow-card">
          <h2 className="font-display text-h2 font-semibold">Declined by the student</h2>
          <p className="mt-1 text-xs text-muted">{ist(row.declinedAt)}</p>
          {row.declineReason ? (
            <blockquote className="mt-3 whitespace-pre-wrap border-l-2 border-risk/60 pl-3 text-sm text-ink">
              {row.declineReason}
            </blockquote>
          ) : (
            <p className="mt-3 text-sm text-muted">No reason was given.</p>
          )}
        </div>
      )}

      {/* The signed-but-not-a-student gap. Only after signing: before that there is nothing to
          enrol from, and the agreement's own terms can still change. */}
      {isSigned && (
        <EnrolPrompt
          agreementId={row.id}
          studentName={data.student.fullName}
          state={enrolmentState(row)}
        />
      )}


      <DocumentPanel
        agreementId={row.id}
        isDraft={isDraft}
        documentKind={row.documentKind}
        body={docBody}
        bodyError={parsedBody && !parsedBody.ok ? parsedBody.error : null}
        templateName={row.body?.template?.name ?? null}
        templateLabel={row.body?.templateLabel ?? null}
        problems={docProblems}
      />

      <CoSignerPanel
        agreementId={row.id}
        isDraft={isDraft}
        required={!!docBody && documentNeedsCoSigner(docBody.fields)}
        signers={signers.map((s) => ({
          id: s.id,
          name: s.name,
          phone: s.phone,
          email: s.email,
          signedAt: s.signedAt,
          declinedAt: s.declinedAt,
          declineReason: s.declineReason,
        }))}
      />

      {attachments.length > 0 && (
        <div className="rounded-card border border-line bg-surface p-5 shadow-card">
          <h2 className="mb-1 flex items-center gap-2 font-display text-h2 font-semibold">
            <Paperclip size={18} className="text-accent" /> Files from the signers
          </h2>
          <p className="mb-3 text-xs text-muted">
            Uploaded into the document&apos;s file boxes during a signing ceremony. Each one&apos;s SHA-256
            is on the audit trail, so a file can be shown to be the one that was uploaded.
          </p>
          <ul className="space-y-2">
            {attachments.map((a) => (
              <li
                key={a.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-field border border-line bg-surface-2 px-3 py-2.5"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{a.filename}</p>
                  <p className="truncate text-xs text-muted">
                    {SIGNER_LABELS[a.signerRole as keyof typeof SIGNER_LABELS] ?? a.signerRole} ·{" "}
                    {(a.size / 1024).toFixed(0)} KB · {ist(a.uploadedAt)}
                  </p>
                  <p className="mt-0.5 break-all font-mono text-[11px] text-muted">{a.sha256}</p>
                </div>
                <a
                  href={`/api/agreements/${row.id}/attachments/${a.id}`}
                  className="inline-flex h-9 flex-none items-center gap-1.5 rounded-btn border border-line px-3 text-sm font-medium transition-colors hover:border-primary hover:text-primary"
                >
                  <Download size={14} /> Download
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="overflow-hidden rounded-card border border-line bg-surface shadow-card">
          <div className="border-b border-line px-5 py-3">
            <h2 className="font-display text-h2 font-semibold">{isSigned ? "Signed document" : "Preview"}</h2>
            <p className="text-xs text-muted">
              {isSigned
                ? "The sealed bytes, served exactly as they were hashed."
                : "Rendered live from the fields below - this is what the student will read."}
            </p>
          </div>
          {/*
            iOS and most Android browsers refuse to render a PDF inside an iframe. The frame was
            therefore 820px of empty grey on every phone - a third of the page saying nothing.
            On small screens it is not rendered at all and the link below becomes the control; on
            desktop, where the frame works, the link stays as the escape hatch it always was.
          */}
          <iframe
            src={`/api/agreements/${row.id}/pdf`}
            title={`Agreement ${row.documentNo}`}
            className="hidden h-[820px] w-full bg-surface-2 sm:block"
          />
          <div className="border-t border-line px-4 py-3 text-center">
            <a
              href={`/api/agreements/${row.id}/pdf`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-10 items-center gap-1.5 rounded-btn border border-line px-4 text-sm font-medium transition-colors hover:border-primary hover:text-primary sm:h-auto sm:border-0 sm:px-0 sm:text-xs sm:hover:underline"
            >
              <FileText size={15} className="sm:hidden" aria-hidden />
              <span className="sm:hidden">Open the document</span>
              <span className="hidden sm:inline">Not showing? Open the PDF in a new tab</span>
            </a>
          </div>
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
              <Row label="Total price (₹)">{formatInrMinor(BigInt(data.payment.totalInrMinor))}</Row>
              {/* The plan charge is a separate term from the fee - §7.1 prints it on its own
                  line, and summarising the two as one number here would hide what the student
                  is actually being asked to pay for choosing to spread it. */}
              {data.payment.option === "INSTALMENT" && data.payment.planExtraInrMinor && (
                <Row label="Plan charge">
                  {formatInrMinor(BigInt(data.payment.planExtraInrMinor))} · collects{" "}
                  {formatInrMinor(
                    BigInt(data.payment.totalInrMinor) + BigInt(data.payment.planExtraInrMinor),
                  )}
                </Row>
              )}
              <Row label="Plan">
                {data.payment.option === "FULL" ? (
                  "Option A - full payment"
                ) : (
                  // One line per instalment rather than "a + b + c": the dates are the half of
                  // the plan somebody checking this screen is actually chasing.
                  <ul className="space-y-0.5">
                    {data.payment.instalments.map((i, n) => (
                      <li key={n} className="tnum">
                        {formatInrMinor(BigInt(i.amountInrMinor))}
                        {i.dueDate ? ` · ${formatGermanDate(i.dueDate)}` : ""}
                        <span className="text-muted"> · {i.dueMilestone}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Row>
            </dl>
          </div>

        </div>
      </div>

      {/*
        ORDER IS THE POINT OF THIS PAGE.
        Somebody opening an agreement wants the document and its terms. What they got third was
        two 64-character hashes, then the device records, the trail and the message log - roughly
        half the page, every time, for facts that matter on the day of a dispute and on no other.
        All of it is still here in full, folded, below the thing itself.

        Open by default ONLY when something is wrong (a decline): a page that hides a problem is
        worse than one that buries a hash.
      */}
      <details className="rounded-card border border-line bg-surface shadow-card" open={!!row.declinedAt}>
        <summary className="flex cursor-pointer flex-wrap items-center gap-2 px-5 py-4 font-display text-h2 font-semibold">
          <ShieldCheck size={18} className="text-accent" aria-hidden /> Audit &amp; integrity
          <span className="ml-auto text-xs font-normal text-muted">
            {row.events.length} event{row.events.length === 1 ? "" : "s"}
            {row.pdfSha256 ? " · sealed" : ""}
            {row.tsAuthority ? " · timestamped" : ""}
          </span>
        </summary>

        <div className="grid gap-6 border-t border-line p-5 lg:grid-cols-2">
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
                    {e.type === "DECLINED" && declineReasonOf(e.meta) && (
                      <p className="mt-0.5 whitespace-pre-wrap text-xs text-ink-2">“{declineReasonOf(e.meta)}”</p>
                    )}
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

          <div className="lg:col-span-2">
            <h3 className="mb-3 font-display text-sm font-bold">Integrity</h3>
            <IntegrityPanel row={row} isSigned={isSigned} />
          </div>
        </div>
      </details>

      {isDraft && (
        <div className="space-y-3">
          <h2 className="font-display text-h2 font-semibold">Edit fields</h2>
          <p className="text-xs text-muted">
            Only a draft can be edited. Once issued, the terms are frozen - void and clone to revise.
          </p>
          <AgreementForm
            initial={data}
            instalmentPlans={instalmentPlans}
            attendees={attendees}
            batches={batches}
            /* Resolved by LABEL, not by a stored id: a draft holds the words §2.1 will print,
               and nothing links it to a `Batch` row. A draft typed before cohorts were offered
               therefore opens as the free text it is, which is what it should do. */
            batchId={batches.find((b) => b.label === data.batch.number)?.id ?? null}
            mode={{ kind: "edit", id: row.id }}
          />
        </div>
      )}
    </div>
  );
}

/**
 * The two hashes, and the third-party timestamp - the forensic record.
 *
 * Pulled out of the page body and into the folded "Audit & integrity" section. It is the most
 * technical thing on the screen and was occupying the third slot; a reader checking a contract
 * does not start with a SHA-256, and a reader who wants one knows to look for it.
 */
function IntegrityPanel({
  row,
  isSigned,
}: {
  row: NonNullable<Awaited<ReturnType<typeof getAgreementDetail>>>;
  isSigned: boolean;
}) {
  return (
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
        {/*
          The one claim on this record that B2 is not the source of.
          The other two hashes prove "what was agreed" and "the file is untouched" - but both are
          assertions kept in B2's own database. A timestamp token is a third party attesting that
          these exact bytes existed at a moment in time, which is the half B2 cannot assert about
          itself. Shown whenever the agreement is sealed, including when it is absent, because
          "not timestamped" and "we tried and the authority was down" are different facts.
        */}
        {isSigned && (
          <div className="sm:col-span-2">
            <dt className="text-xs uppercase tracking-wide text-muted">Trusted timestamp</dt>
            {row.tsAuthority ? (
              <>
                <dd className="mt-1 text-sm">
                  Attested by <span className="font-medium">{row.tsAuthority}</span>
                  {row.tsGenTime ? ` at ${ist(row.tsGenTime)}` : ""}
                </dd>
                <p className="mt-1 text-xs text-muted">
                  An RFC 3161 token over the sealed PDF hash, stored exactly as the authority
                  returned it. Verify it with{" "}
                  <code className="font-mono">openssl ts -verify</code> against their certificate -
                  it holds without reference to anything of B2&apos;s.
                </p>
                <a
                  href={`/api/agreements/${row.id}/timestamp`}
                  className="mt-2 inline-flex h-8 items-center gap-1.5 rounded-btn border border-line px-3 text-xs font-medium transition-colors hover:border-primary hover:text-primary"
                >
                  <Download size={13} /> Download the token (.tsr)
                </a>
              </>
            ) : (
              <dd className="mt-1 text-sm text-muted">
                {row.tsError
                  ? `Not timestamped - the last attempt failed: ${row.tsError}. The daily sweep retries it.`
                  : "Not timestamped. Set AGREEMENT_TSA_URL to have an authority attest to sealed agreements."}
              </dd>
            )}
          </div>
        )}
      </dl>
  );
}

/** The reason a DECLINED event carries in its meta - `{ reason }`, written by `declineAgreement`. */
function declineReasonOf(meta: unknown): string | null {
  if (!meta || typeof meta !== "object") return null;
  const reason = (meta as { reason?: unknown }).reason;
  return typeof reason === "string" && reason.trim() ? reason.trim() : null;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <dt className="w-24 flex-none text-muted">{label}</dt>
      <dd className="min-w-0 flex-1">{children}</dd>
    </div>
  );
}

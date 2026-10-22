import Link from "next/link";
import { Download, FileSignature, FileText, FileType } from "lucide-react";
import { describeFields, type DocBody } from "@/lib/agreement-doc";
import { DocumentEditor, ReadinessPanel } from "../../_components/document/DocumentEditor";
import { UploadBox } from "../../_components/document/UploadBox";
import { RevertToGuidedButton } from "./RevertToGuided";

/**
 * The document half of an agreement's detail screen.
 *
 * Three states, and they are genuinely different screens rather than one screen with things
 * greyed out:
 *
 *   DRAFT, guided    - an offer to attach an uploaded document instead.
 *   DRAFT, uploaded  - the full designer, plus replace and revert.
 *   ISSUED or later  - a read-only record of WHICH document this is. Nothing editable, because a
 *                      contract that mutates after it has been sent is not a contract (the same
 *                      reason there is no edit path for an issued agreement's terms).
 */
export function DocumentPanel({
  agreementId,
  isDraft,
  documentKind,
  body,
  bodyError,
  templateName,
  templateLabel,
  problems,
}: {
  agreementId: string;
  isDraft: boolean;
  documentKind: "GUIDED" | "DOCX" | "PDF";
  body: DocBody | null;
  bodyError: string | null;
  templateName: string | null;
  templateLabel: string | null;
  problems: string[];
}) {
  const fileUrl = `/api/agreements/${agreementId}/document/file`;

  // ── Guided ──
  if (documentKind === "GUIDED") {
    return (
      <section className="space-y-3">
        <Heading
          icon={<FileSignature size={18} />}
          title="Document"
          note="This agreement uses the built-in Guided Mode clause set."
        />
        <div className="rounded-card border border-line bg-surface p-5 shadow-card">
          <p className="text-sm text-ink-2">
            The clauses are typeset in the app and only the fields below vary. Nothing to mark up -
            the signature block is part of the document.
          </p>
          {isDraft ? (
            <div className="mt-4 border-t border-line pt-4">
              <h3 className="mb-1 font-display text-sm font-bold">Use your own document instead</h3>
              <p className="mb-3 text-xs text-muted">
                Upload the Word file or PDF you wrote for this client. It replaces the clause set for
                THIS agreement only. To reuse it, save it as a{" "}
                <Link href="/agreements/templates" className="text-primary hover:underline">
                  template
                </Link>{" "}
                instead.
              </p>
              <UploadBox
                action={`/api/agreements/${agreementId}/document`}
                submitLabel="Attach this document"
                hint="Up to 10 MB. A .docx becomes editable here; a .pdf keeps Word's exact layout."
              />
            </div>
          ) : (
            <p className="mt-3 text-xs text-muted">
              Issued agreements cannot change document. Void and clone to revise.
            </p>
          )}
        </div>
      </section>
    );
  }

  // ── Uploaded, but unreadable ──
  if (!body) {
    return (
      <section className="space-y-3">
        <Heading icon={<FileText size={18} />} title="Document" note="This document needs attention." />
        <div className="rounded-card border border-risk/40 bg-surface p-5 shadow-card">
          <p className="text-sm font-medium text-risk">
            {bodyError ?? "The uploaded document could not be read."}
          </p>
          <p className="mt-2 text-sm text-muted">
            {isDraft
              ? "Upload the file again below, or revert to the Guided Mode clause set."
              : "Nothing can be changed on an issued agreement - void and clone it to start again."}
          </p>
          {isDraft && (
            <div className="mt-4 space-y-3 border-t border-line pt-4">
              <UploadBox
                action={`/api/agreements/${agreementId}/document`}
                submitLabel="Replace the document"
              />
              <RevertToGuidedButton agreementId={agreementId} />
            </div>
          )}
        </div>
      </section>
    );
  }

  const kindLabel = body.kind === "DOCX" ? "Word document" : `PDF · ${body.pageCount ?? "?"} pages`;
  const provenance = templateName
    ? `From the template “${templateName}”${templateLabel ? ` (${templateLabel})` : ""}`
    : "Uploaded directly onto this agreement";

  // ── Issued or signed: the record, read-only ──
  if (!isDraft) {
    return (
      <section className="space-y-3">
        <Heading
          icon={body.kind === "PDF" ? <FileText size={18} /> : <FileType size={18} />}
          title="Document"
          note="What this agreement was drawn up on. Frozen once issued."
        />
        <div className="rounded-card border border-line bg-surface p-5 shadow-card">
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <Row label="File">{body.sourceName}</Row>
            <Row label="Kind">{kindLabel}</Row>
            <Row label="Origin">{provenance}</Row>
            <Row label="Fields">{describeFields(body.fields)}</Row>
            <div className="sm:col-span-2">
              <dt className="text-xs uppercase tracking-wide text-muted">Uploaded file hash</dt>
              <dd className="mt-1 break-all font-mono text-xs">{body.sourceSha256}</dd>
              <p className="mt-1 text-xs text-muted">
                SHA-256 of the file as uploaded. It is part of this agreement&apos;s content hash, so a
                different document could never carry the same one.
              </p>
            </div>
          </dl>
          <a
            href={`${fileUrl}?download=1`}
            className="mt-4 inline-flex h-9 items-center gap-1.5 rounded-btn border border-line px-3 text-sm font-medium transition-colors hover:border-primary hover:text-primary"
          >
            <Download size={14} /> Download the original
          </a>
        </div>
      </section>
    );
  }

  // ── Draft: the designer ──
  return (
    <section className="space-y-3">
      <Heading
        icon={body.kind === "PDF" ? <FileText size={18} /> : <FileType size={18} />}
        title="Document"
        note={`${kindLabel} · ${provenance}. Editing here never touches the template.`}
      />
      <ReadinessPanel problems={problems} />
      <DocumentEditor
        target={{ kind: "agreement", id: agreementId }}
        docKind={body.kind}
        initialBlocks={body.blocks ?? null}
        initialFields={body.fields}
        initialOptions={body.options ?? null}
        pageCount={body.pageCount ?? null}
        sourceName={body.sourceName}
        sourceSha256={body.sourceSha256}
        fileUrl={fileUrl}
      />
      <details className="rounded-card border border-line bg-surface p-5 shadow-card">
        <summary className="cursor-pointer font-display text-sm font-bold">
          Replace this document, or go back to the clause set
        </summary>
        <div className="mt-4 space-y-4">
          <div>
            <p className="mb-3 text-xs text-muted">
              Uploading again replaces the prose AND the fields placed on it - a new file has nothing
              for the old boxes to sit on. Revised the draft in Word? Download the original above, edit
              it, and upload it back.
            </p>
            <UploadBox
              action={`/api/agreements/${agreementId}/document`}
              submitLabel="Replace the document"
            />
          </div>
          <div className="border-t border-line pt-4">
            <RevertToGuidedButton agreementId={agreementId} />
          </div>
        </div>
      </details>
    </section>
  );
}

function Heading({
  icon,
  title,
  note,
}: {
  icon: React.ReactNode;
  title: string;
  note: string;
}) {
  return (
    <div>
      <h2 className="flex items-center gap-2 font-display text-h2 font-semibold">
        <span className="text-accent">{icon}</span> {title}
      </h2>
      <p className="text-xs text-muted">{note}</p>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted">{label}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  );
}

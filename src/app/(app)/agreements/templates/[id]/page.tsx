import { notFound } from "next/navigation";
import { FileStack } from "lucide-react";
import { PageHeader } from "@/components/ui/kit";
import { requireCapability, requireSection } from "@/lib/rbac";
import { formatDateTimeInZone } from "@/lib/format";
import { describeFields, docFieldsSchema } from "@/lib/agreement-doc";
import { getAgreementTemplate } from "@/server/agreement-templates";
import { DocumentEditor } from "../../_components/document/DocumentEditor";
import { UploadBox } from "../../_components/document/UploadBox";
import { MakeCurrentButton, TemplateAdmin } from "./_components/TemplateAdmin";

/**
 * One template: its versions, and the designer for the current one.
 *
 * ── WHY ONLY THE CURRENT VERSION IS EDITABLE ────────────────────────────────────────────────
 * An older version is history. Agreements were drawn from it, and while they each hold their own
 * copy of the document, the version row is the provenance those copies point at - "this contract
 * came from v2 of the GM agreement" has to stay true. So older versions are listed, downloadable
 * and promotable, and edited by promoting them first.
 */

export const dynamic = "force-dynamic";

const ist = (d: Date) => formatDateTimeInZone(d, "Asia/Kolkata");

export default async function AgreementTemplatePage({ params }: { params: { id: string } }) {
  await requireSection("agreements");
  await requireCapability("agreements.issue");

  const template = await getAgreementTemplate(params.id);
  if (!template) notFound();

  const current = template.current;
  const body = template.currentBody;

  return (
    <div className="w-full space-y-6">
      <PageHeader
        back={{ href: "/agreements/templates", label: "Templates" }}
        icon={<FileStack size={20} />}
        title={template.name}
        titleSuffix={
          template.archivedAt ? (
            <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-muted">
              Archived
            </span>
          ) : undefined
        }
        subtitle={
          <>
            {template.kind === "DOCX" ? "Word document" : "PDF"} ·{" "}
            {template.usedBy} agreement{template.usedBy === 1 ? "" : "s"} drawn from it
            {template.description ? ` · ${template.description}` : ""}
          </>
        }
      />

      <TemplateAdmin
        id={template.id}
        name={template.name}
        description={template.description}
        archived={!!template.archivedAt}
        usedBy={template.usedBy}
      />

      {/* ── The designer, on the current version ── */}
      {current && body?.ok ? (
        <section className="space-y-3">
          <div>
            <h2 className="font-display text-h2 font-semibold">
              Current document — v{current.version}
              {current.label ? ` · ${current.label}` : ""}
            </h2>
            <p className="text-xs text-muted">
              {template.kind === "DOCX"
                ? "Fix a line, move a signature zone, place the fields. New agreements take a copy of this."
                : "Drag each signature box onto the page where it belongs. New agreements take a copy of this."}
            </p>
          </div>
          <DocumentEditor
            target={{ kind: "template", versionId: current.id, templateId: template.id }}
            docKind={body.body.kind}
            initialBlocks={body.body.blocks ?? null}
            initialFields={body.body.fields}
        initialOptions={body.body.options ?? null}
            pageCount={body.body.pageCount ?? null}
            sourceName={body.body.sourceName}
            sourceSha256={body.body.sourceSha256}
            fileUrl={`/api/agreements/templates/${current.id}/file`}
            readOnly={!!template.archivedAt}
          />
        </section>
      ) : (
        <div className="rounded-card border border-warn/40 bg-warn-soft px-5 py-4 text-sm">
          <p className="font-semibold text-warn">
            {current ? "This version cannot be edited" : "No document uploaded yet"}
          </p>
          <p className="mt-1 text-ink-2">
            {body && !body.ok
              ? body.error
              : "Upload the Word file or PDF this template is built on, below."}
          </p>
        </div>
      )}

      {/* ── A new version ── */}
      <section className="rounded-card border border-line bg-surface p-5 shadow-card">
        <h2 className="mb-1 font-display text-h2 font-semibold">Upload a new version</h2>
        <p className="mb-4 text-xs text-muted">
          Edited the draft in Word again? Upload it as v{(current?.version ?? 0) + 1}. It becomes the
          version new agreements use; the older ones stay here. Agreements already drawn from this
          template are not affected, ever - they hold their own copy.
        </p>
        <UploadBoxForTemplate templateId={template.id} kind={template.kind} />
      </section>

      {/* ── History ── */}
      <section className="space-y-3">
        <h2 className="font-display text-h2 font-semibold">
          Versions <span className="text-sm font-normal text-muted">({template.versions.length})</span>
        </h2>
        <div className="overflow-hidden rounded-card border border-line bg-surface shadow-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-4 py-3 font-medium">Version</th>
                <th className="px-4 py-3 font-medium">File</th>
                <th className="px-4 py-3 font-medium">Fields</th>
                <th className="px-4 py-3 font-medium">Uploaded</th>
                <th className="px-4 py-3 font-medium" />
              </tr>
            </thead>
            <tbody>
              {template.versions.map((v) => {
                const parsed = docFieldsSchema.safeParse(v.fields);
                const isCurrent = v.id === template.currentVersionId;
                return (
                  <tr key={v.id} className="border-b border-line last:border-0">
                    <td className="px-4 py-3 font-medium">
                      v{v.version}
                      {isCurrent && (
                        <span className="ml-2 rounded-full bg-ok-soft px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-ok">
                          Current
                        </span>
                      )}
                      {v.label && <span className="ml-2 text-xs text-muted">{v.label}</span>}
                    </td>
                    <td className="px-4 py-3">
                      <a
                        href={`/api/agreements/templates/${v.id}/file?download=1`}
                        className="text-primary hover:underline"
                      >
                        {v.sourceName}
                      </a>
                      <span className="ml-2 text-xs text-muted">
                        {(v.sourceSize / 1024).toFixed(0)} KB
                        {v.pageCount ? ` · ${v.pageCount} pages` : ""}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted">
                      {parsed.success ? describeFields(parsed.data) : "Needs attention"}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted">
                      {ist(v.createdAt)}
                      {v.createdBy?.name ? ` · ${v.createdBy.name}` : ""}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {!isCurrent && !template.archivedAt && (
                        <MakeCurrentButton
                          templateId={template.id}
                          versionId={v.id}
                          version={v.version}
                        />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

/**
 * The upload box, pre-bound to this template so the route adds a VERSION rather than creating a
 * second template. `templateId` rides in the posted FormData, which is also what tells the route
 * to reject a file of the wrong kind - a template cannot change from Word to PDF.
 */
function UploadBoxForTemplate({ templateId, kind }: { templateId: string; kind: string }) {
  return (
    <UploadBox
      action="/api/agreements/templates/upload"
      extra={{ templateId }}
      submitLabel="Upload new version"
      label={kind === "DOCX" ? "Choose the updated .docx" : "Choose the updated .pdf"}
      hint={
        kind === "DOCX"
          ? "Must be a .docx - this template's fields sit in the text flow."
          : "Must be a .pdf - this template's fields are page coordinates."
      }
    />
  );
}

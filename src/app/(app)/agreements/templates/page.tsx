import Link from "next/link";
import { FileStack, FileText, FileType, Users } from "lucide-react";
import { PageHeader } from "@/components/ui/kit";
import { requireCapability, requireSection } from "@/lib/rbac";
import { formatDate } from "@/lib/format";
import { getDefaultTemplateChoice, listAgreementTemplates } from "@/server/agreement-templates";
import { AgreementNav } from "../_components/AgreementNav";
import { NewTemplate } from "./_components/NewTemplate";

/**
 * The agreement template library.
 *
 * A template is a document the founder wrote in Word, uploaded once, and marked up with where
 * each party signs. Every new agreement drawn from it gets its OWN COPY - so this screen is safe
 * to edit: nothing here can reach a contract that already exists.
 */

export const metadata = { title: "Agreement templates" };
export const dynamic = "force-dynamic";

export default async function AgreementTemplatesPage() {
  await requireSection("agreements");
  await requireCapability("agreements.issue");

  const [templates, defaultDoc] = await Promise.all([
    listAgreementTemplates({ includeArchived: true }),
    getDefaultTemplateChoice(),
  ]);
  const live = templates.filter((t) => !t.archivedAt);
  const archived = templates.filter((t) => t.archivedAt);

  return (
    <div className="w-full space-y-6">
      <PageHeader
        icon={<FileStack size={20} />}
        title="Agreement templates"
        subtitle="Write the draft in Word, upload it here, and mark up where each party signs."
        actions={live.length > 0 ? <NewTemplate /> : undefined}
      />

      <AgreementNav />

      {/* With nothing in the library the form IS the page, so it opens expanded. */}
      {live.length === 0 && archived.length === 0 ? (
        <>
          <EmptyState />
          <NewTemplate startOpen />
        </>
      ) : (
        <section className="space-y-3">
          <h2 className="font-display text-h2 font-semibold">
            In use <span className="text-sm font-normal text-muted">({live.length})</span>
          </h2>
          {live.length === 0 ? (
            <p className="rounded-card border border-line bg-surface px-5 py-8 text-center text-sm text-muted">
              Every template is archived. Restore one, or create a new one.
            </p>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2">
              {live.map((t) => (
                <li key={t.id}>
                  <Link
                    href={`/agreements/templates/${t.id}`}
                    className="block h-full rounded-card border border-line bg-surface p-4 shadow-card transition-colors hover:border-primary"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-primary">{t.name}</p>
                        {/* The one "Generate & send" uses on a contact record. Worth a line on the
                            card: it is the difference between one tap sending this and sending the
                            built-in clause set, and it is otherwise invisible from here. */}
                        {defaultDoc?.id === t.id && (
                          <p className="mt-0.5 text-[11px] font-semibold uppercase tracking-wide text-primary">
                            Sent by default
                          </p>
                        )}
                        {t.description && (
                          <p className="mt-0.5 line-clamp-2 text-xs text-muted">{t.description}</p>
                        )}
                      </div>
                      <span className="flex flex-none items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
                        {t.kind === "DOCX" ? <FileType size={11} /> : <FileText size={11} />}
                        {t.kind === "DOCX" ? "Word" : "PDF"}
                      </span>
                    </div>

                    {/*
                      A sentence, not a label grid. The old four-row dt/dd table made the reader
                      match labels to values for facts that read perfectly well in prose - and it
                      was the reason a card was twice as tall as it needed to be.
                    */}
                    <p className="mt-3 text-xs text-muted">
                      {t.currentVersion ? `v${t.currentVersion.version}` : "No document yet"}
                      {t.currentVersion?.label ? ` · ${t.currentVersion.label}` : ""} ·{" "}
                      {t.versionCount} version{t.versionCount === 1 ? "" : "s"} · updated{" "}
                      {formatDate(t.updatedAt)}
                    </p>
                    <p className="mt-1 text-xs font-medium text-ink-2">{t.fieldSummary}</p>
                    <p className="mt-1 text-xs text-muted">
                      {t.usedBy === 0
                        ? "Not used by any agreement yet"
                        : `Used by ${t.usedBy} agreement${t.usedBy === 1 ? "" : "s"}`}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {archived.length > 0 && (
        <section className="space-y-3">
          <h2 className="font-display text-h2 font-semibold">
            Archived <span className="text-sm font-normal text-muted">({archived.length})</span>
          </h2>
          <p className="text-xs text-muted">
            Out of the picker, still readable - the agreements drawn from these point at their
            versions for provenance.
          </p>
          <ul className="space-y-2">
            {archived.map((t) => (
              <li key={t.id}>
                <Link
                  href={`/agreements/templates/${t.id}`}
                  className="flex items-center justify-between gap-3 rounded-card border border-line bg-surface px-4 py-3 text-sm shadow-card transition-colors hover:border-primary"
                >
                  <span className="truncate font-medium">{t.name}</span>
                  <span className="flex-none text-xs text-muted">
                    archived {formatDate(t.archivedAt!)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/**
 * What a template is, for somebody who has never made one.
 *
 * Three steps rather than a paragraph: the point is that this is a Word workflow with two extra
 * stages, not a new editor to learn.
 */
function EmptyState() {
  const steps = [
    { n: 1, title: "Write it in Word", body: "Your own wording, your own layout - the tool you already use." },
    {
      n: 2,
      title: "Mark up who signs where",
      body: "Type [[sign:student]] in Word, or drag the boxes on after uploading.",
    },
    {
      n: 3,
      title: "Use it for everyone",
      body: "Each student's name, fee and dates are merged into their own copy.",
    },
  ];
  return (
    <div className="rounded-card border border-line bg-surface p-6 shadow-card">
      <h2 className="font-display text-h2 font-semibold">No templates yet</h2>
      <p className="mt-1 text-sm text-muted">
        You do not need one - the built-in Guided Mode clause set still works exactly as it always
        has. A template is for sending <em>your own</em> document instead.
      </p>
      <ol className="mt-4 grid gap-4 sm:grid-cols-3">
        {steps.map((s) => (
          <li key={s.n} className="flex gap-3">
            <span className="grid h-7 w-7 flex-none place-items-center rounded-full bg-primary-soft text-sm font-bold text-primary">
              {s.n}
            </span>
            <span>
              <span className="block text-sm font-semibold">{s.title}</span>
              <span className="mt-0.5 block text-xs text-muted">{s.body}</span>
            </span>
          </li>
        ))}
      </ol>
      <p className="mt-4 flex items-center gap-1.5 text-xs text-muted">
        <Users size={13} aria-hidden />
        Templates also power <Link href="/agreements/bulk" className="text-primary hover:underline">
          sending in bulk
        </Link>
        .
      </p>
    </div>
  );
}

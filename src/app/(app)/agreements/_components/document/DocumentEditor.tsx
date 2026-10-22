"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Download, Eye, Loader2, Plus, Save, Trash2 } from "lucide-react";
import { Btn } from "@/components/ui/controls";
import { Field, FormError, TextArea, TextInput } from "@/components/ui/form";
import { toast } from "@/components/ui/feedback";
import {
  FIELD_KIND_LABELS,
  MAX_CUSTOM_FIELDS,
  SIGNER_LABELS,
  customToken,
  defaultFieldLabel,
  describeFields,
  docCustomFieldSchema,
  nextFieldId,
  placedBox,
  validateDocBody,
  type DocBlock,
  type DocBody,
  type DocCustomField,
  type DocField,
  type DocOptions,
  type FieldKind,
} from "@/lib/agreement-doc";
import { mergeProblems } from "@/lib/agreement-merge";
import { saveTemplateVersionDocument } from "@/server/agreement-template-actions";
import { saveAgreementDocument } from "@/server/agreement-actions";
import { DocumentCanvas } from "./DocumentCanvas";
import { FieldInspector } from "./FieldInspector";
import { MergeTokens } from "./MergeTokens";
import { PdfFieldCanvas } from "./PdfFieldCanvas";

/**
 * The document designer. One component for both document kinds and both owners (a template
 * version, or one agreement's own copy), because they are the same job: edit the prose where
 * there is prose to edit, place the fields, and see whether the thing can be sent.
 *
 * ── WHAT IT REFUSES TO DO ───────────────────────────────────────────────────────────────────
 * Save silently. The readiness panel is live and unmissable, and it is deliberately NOT a
 * blocking validation: a half-marked-up document is a legitimate work-in-progress, so saving
 * always works and the panel says what is still outstanding. The actual refusal happens at issue,
 * where a document with no counterparty signature line is rejected outright.
 */

export type EditorTarget =
  | { kind: "template"; versionId: string; templateId: string }
  | { kind: "agreement"; id: string };

export function DocumentEditor({
  target,
  docKind,
  initialBlocks,
  initialFields,
  initialOptions,
  pageCount,
  sourceName,
  sourceSha256,
  fileUrl,
  readOnly = false,
}: {
  target: EditorTarget;
  docKind: "DOCX" | "PDF";
  initialBlocks: DocBlock[] | null;
  initialFields: DocField[];
  initialOptions: DocOptions | null;
  pageCount: number | null;
  sourceName: string;
  sourceSha256: string;
  /** The route serving the uploaded file - for the PDF canvas, and for the download link. */
  fileUrl: string;
  readOnly?: boolean;
}) {
  const router = useRouter();
  const [blocks, setBlocks] = useState<DocBlock[]>(initialBlocks ?? []);
  const [fields, setFields] = useState<DocField[]>(initialFields);
  const [options, setOptions] = useState<DocOptions>(initialOptions ?? {});
  const [selectedId, setSelectedId] = useState<string | null>(initialFields[0]?.id ?? null);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  /**
   * The same checks the server runs, run locally so the founder sees them as they work.
   *
   * Advisory by design - `documentReadiness` on the server is the gate. Duplicating the call
   * rather than the logic is what keeps the two answers the same: both go through
   * `validateDocBody` and `unresolvedMergeTokens`.
   */
  const problems = useMemo(() => {
    const body: DocBody = {
      kind: docKind,
      blocks: docKind === "DOCX" ? blocks : null,
      fields,
      options,
      sourceName,
      sourceSha256,
      pageCount,
    };
    return [
      ...validateDocBody(body).map((p) => p.message),
      ...mergeProblems(blocks, fields, options.custom),
    ];
  }, [blocks, fields, options, docKind, sourceName, sourceSha256, pageCount]);

  const touch = () => setDirty(true);

  const updateFields = (next: DocField[]) => {
    setFields(next);
    touch();
  };

  const updateBlocks = (next: DocBlock[]) => {
    setBlocks(next);
    /**
     * Deleting a zone in the page deletes its field.
     *
     * Otherwise selecting a signature zone, pressing Delete and carrying on would leave a field
     * with no anchor - which the readiness panel correctly reports as "not placed anywhere", and
     * which the founder then has to go and find in the sidebar to clear. The page is the document;
     * removing something from it should remove it.
     *
     * The FUNCTIONAL form is load-bearing: a field minted by `appendField` moments earlier is not
     * in this closure's `fields`, and pruning against a stale array would delete the zone the
     * founder has just inserted.
     */
    setFields((current) => {
      const anchored = new Set(
        next.filter((b) => b.type === "field").map((b) => (b as { fieldId: string }).fieldId),
      );
      const kept = current.filter((f) => anchored.has(f.id));
      return kept.length === current.length ? current : kept;
    });
    touch();
  };

  /**
   * Mint a field for the editor to anchor.
   *
   * The canvas writes the anchor itself, at the caret - the parent cannot know where the caret
   * is, and an index-based insert was the old block list's model. It returns the field
   * SYNCHRONOUSLY because the canvas needs the id to build the widget markup in the same tick;
   * waiting for a state update would mean inserting a zone with no id in it.
   */
  const appendField = (kind: FieldKind = "SIGNATURE"): DocField => {
    const field: DocField = { id: nextFieldId(fields), kind, signer: "STUDENT" };
    setFields([...fields, field]);
    touch();
    return field;
  };

  /**
   * The founder's own merge fields live INSIDE `options`, so editing them is editing options -
   * which is already saved by both editors, already copied onto an agreement drawn from this
   * template, and already inside the content hash. An empty list is DELETED rather than stored
   * as `[]`, by the same rule as every other option here: a document that never used one must
   * keep hashing exactly as it did before they existed.
   */
  const updateCustom = (next: DocCustomField[]) => {
    const withCustom: DocOptions = { ...options };
    if (next.length > 0) withCustom.custom = next;
    else delete withCustom.custom;
    setOptions(withCustom);
    touch();
  };

  /** Removing a field removes its anchor too, so the document can never show an orphaned zone. */
  const removeField = (id: string) => {
    setFields(fields.filter((f) => f.id !== id));
    setBlocks(blocks.filter((b) => !(b.type === "field" && b.fieldId === id)));
    if (selectedId === id) setSelectedId(null);
    touch();
  };

  const save = () => {
    setError(null);
    startTransition(async () => {
      const payload = { blocks: docKind === "DOCX" ? blocks : undefined, fields, options };
      const res =
        target.kind === "template"
          ? await saveTemplateVersionDocument(target.versionId, payload)
          : await saveAgreementDocument(target.id, payload);

      if (!res.ok) {
        setError(res.error);
        return;
      }
      setDirty(false);
      const outstanding = res.data?.problems.length ?? 0;
      // Saved is saved, so the toast is a success either way; what is still outstanding is in the
      // readiness panel, which stays on screen rather than fading after four seconds.
      toast(
        outstanding === 0
          ? "Document saved. It is ready to send."
          : `Document saved. ${outstanding} thing${outstanding === 1 ? "" : "s"} still to fix before it can be sent.`,
      );
      router.refresh();
    });
  };

  const selected = fields.find((f) => f.id === selectedId) ?? null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-line bg-surface p-4 shadow-card">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{sourceName}</p>
          <p className="text-xs text-muted">
            {docKind === "DOCX" ? "Word document, re-typeset here" : `PDF · ${pageCount ?? "?"} pages`} ·{" "}
            {describeFields(fields)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/*
            SEE WHAT IT PRODUCES. Until this link existed, the only way to find out what a template
            rendered to was to raise a real agreement against a real student and look at that - so
            a signature zone in the wrong place was discovered by a founder, late, on a document
            that had already gone somewhere.
          */}
          {target.kind === "template" && (
            <a
              href={`/api/agreements/templates/${target.versionId}/preview`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-9 items-center gap-1.5 rounded-btn border border-line px-3 text-sm font-medium transition-colors hover:border-primary hover:text-primary"
            >
              <Eye size={14} /> Preview
            </a>
          )}
          <a
            href={`${fileUrl}?download=1`}
            className="inline-flex h-9 items-center gap-1.5 rounded-btn border border-line px-3 text-sm font-medium transition-colors hover:border-primary hover:text-primary"
            title="The file this was uploaded from"
          >
            <Download size={14} /> Original
          </a>
          {!readOnly && (
            <Btn
              variant={dirty ? "primary" : "secondary"}
              icon={pending ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
              onClick={save}
              disabled={pending || !dirty}
              busy={pending}
            >
              {dirty ? "Save changes" : "Saved"}
            </Btn>
          )}
        </div>
      </div>

      <FormError message={error} />

      <ReadinessPanel problems={problems} />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-3">
          {docKind === "DOCX" ? (
            <DocumentCanvas
              blocks={initialBlocks ?? []}
              fields={fields}
              onBlocks={updateBlocks}
              onAddField={appendField}
              onFocusField={setSelectedId}
              selectedId={selectedId}
              disabled={readOnly || pending}
            />
          ) : (
            <PdfFieldCanvas
              fileUrl={fileUrl}
              fields={fields}
              onFields={updateFields}
              selectedId={selectedId}
              onSelect={setSelectedId}
              disabled={readOnly || pending}
            />
          )}
        </div>

        {/*
          Sticky on desktop: a 25-block document is thousands of pixels tall, and a field list that
          scrolls away means selecting a field and then hunting back up to edit it. `top-4` clears
          the app header. It stays in normal flow on small screens, where there is no room to pin
          anything and the natural order - document, then its fields - is the right one.
        */}
        <aside className="space-y-4 lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:self-start lg:overflow-y-auto">
          <div className="rounded-card border border-line bg-surface p-4 shadow-card">
            <h3 className="mb-3 font-display text-sm font-bold">Fields</h3>
            {fields.length === 0 ? (
              <p className="text-xs text-muted">
                {docKind === "DOCX"
                  ? "No signature zones yet. Add one from any block below the text it belongs under."
                  : "No fields yet. Pick a type and click the page where it goes."}
              </p>
            ) : (
              <ul className="space-y-1">
                {fields.map((f) => {
                  const box = placedBox(f);
                  return (
                    <li key={f.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(f.id)}
                        className={`flex w-full items-center justify-between gap-2 rounded-field px-2 py-1.5 text-left text-xs transition-colors ${
                          selectedId === f.id ? "bg-primary-soft text-primary" : "hover:bg-surface-2"
                        }`}
                      >
                        <span className="min-w-0">
                          <span className="block truncate font-medium">
                            {f.label?.trim() || defaultFieldLabel(f.kind, f.signer)}
                          </span>
                          <span className="block truncate text-muted">
                            {FIELD_KIND_LABELS[f.kind]} · {SIGNER_LABELS[f.signer]}
                          </span>
                        </span>
                        <span className="flex-none text-muted">
                          {docKind === "PDF" ? (box ? `p${box.page}` : "unplaced") : ""}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}

            {selected && !readOnly && (
              <div className="mt-3">
                <FieldInspector
                  field={selected}
                  pageNote={
                    docKind === "PDF"
                      ? placedBox(selected)
                        ? `page ${placedBox(selected)!.page}`
                        : "not placed"
                      : undefined
                  }
                  onChange={(next) => updateFields(fields.map((f) => (f.id === next.id ? next : f)))}
                  onRemove={() => removeField(selected.id)}
                />
              </div>
            )}
          </div>

          <div className="rounded-card border border-line bg-surface p-4 shadow-card">
            <h3 className="mb-3 font-display text-sm font-bold">Document options</h3>
            <label className="flex cursor-pointer items-start gap-2.5 text-xs">
              <input
                type="checkbox"
                checked={!!options.initialEveryPage}
                disabled={readOnly || pending}
                onChange={(e) => {
                  const next: DocOptions = { ...options };
                  if (e.target.checked) next.initialEveryPage = true;
                  // Deleted rather than set to false: an absent key keeps the content hash of a
                  // document that never used this option exactly as it was.
                  else delete next.initialEveryPage;
                  setOptions(next);
                  touch();
                }}
                className="mt-0.5 h-4 w-4 flex-none accent-[var(--primary)]"
              />
              <span>
                <span className="block font-semibold">Initial every page</span>
                <span className="block text-muted">
                  Stamps both parties&apos; marks in the footer of every page on the signed copy -
                  what the built-in clause set has always done.
                </span>
              </span>
            </label>
          </div>

          <CustomFieldsPanel
            custom={options.custom ?? []}
            onChange={updateCustom}
            disabled={readOnly || pending}
          />

          <div className="rounded-card border border-line bg-surface p-4 shadow-card">
            <MergeTokens custom={options.custom ?? []} showPlaceholders={docKind === "DOCX"} />
          </div>
        </aside>
      </div>
    </div>
  );
}

/**
 * THE FOUNDER'S OWN MERGE FIELDS.
 *
 * Declare a name, give it a value, and `{{custom.<name>}}` prints that value anywhere in the
 * document - prose, a table cell, or a CREATOR text box. It exists because the built-in token
 * list is deliberately closed (see `lib/agreement-merge`) while a contract regularly needs one
 * value this app has no opinion about: a visa appointment, a cohort code, a named university.
 * Typing it into the prose instead meant a new template version for every student.
 *
 * On a TEMPLATE the value is the default; on an agreement drawn from that template the same
 * panel edits the agreement's own copy, so one student's value never touches the template.
 *
 * The name is validated AS TYPED, against the same zod schema the server parses with - letting
 * `{{custom.Visa Date}}` be saved and reporting it at the issue gate would put the error a long
 * way from the typing.
 */
function CustomFieldsPanel({
  custom,
  onChange,
  disabled,
}: {
  custom: DocCustomField[];
  onChange: (next: DocCustomField[]) => void;
  disabled?: boolean;
}) {
  const patch = (i: number, next: Partial<DocCustomField>) =>
    onChange(custom.map((c, n) => (n === i ? { ...c, ...next } : c)));

  const tokenProblem = (field: DocCustomField, i: number): string | null => {
    const parsed = docCustomFieldSchema.shape.token.safeParse(field.token);
    if (!parsed.success) return parsed.error.issues[0]?.message ?? "That name cannot be used.";
    if (custom.some((c, n) => n !== i && c.token === field.token)) return "Two fields share this name.";
    return null;
  };

  return (
    <div className="rounded-card border border-line bg-surface p-4 shadow-card">
      <h3 className="font-display text-sm font-bold">Your own fields</h3>
      <p className="mt-1 text-xs text-muted">
        For values this app does not hold. Name one here and write{" "}
        <code className="font-mono text-ink-2">{"{{custom.name}}"}</code> wherever it should print.
      </p>

      {custom.length > 0 && (
        <ul className="mt-3 space-y-3">
          {custom.map((field, i) => {
            const problem = tokenProblem(field, i);
            return (
              <li key={i} className="space-y-2 rounded-field border border-line bg-surface-2 p-3">
                <div className="flex items-start justify-between gap-2">
                  <code className="min-w-0 truncate font-mono text-xs text-ink-2">
                    {`{{${customToken(field)}}}`}
                  </code>
                  <Btn
                    variant="ghost"
                    size="sm"
                    icon={<Trash2 size={14} />}
                    disabled={disabled}
                    onClick={() => onChange(custom.filter((_, n) => n !== i))}
                    title="Remove this field"
                  >
                    Remove
                  </Btn>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <Field label="Name" hint={problem ?? undefined}>
                    <TextInput
                      value={field.token}
                      maxLength={39}
                      disabled={disabled}
                      aria-invalid={problem ? true : undefined}
                      // Lower-cased and de-spaced as it is typed: a founder types "Visa Date",
                      // and refusing that outright teaches the rule by rejection.
                      onChange={(e) =>
                        patch(i, { token: e.target.value.toLowerCase().replace(/[^a-z0-9_]+/g, "_") })
                      }
                    />
                  </Field>
                  <Field label="What it is">
                    <TextInput
                      value={field.label}
                      maxLength={60}
                      disabled={disabled}
                      placeholder="Visa appointment date"
                      onChange={(e) => patch(i, { label: e.target.value })}
                    />
                  </Field>
                </div>
                <Field label="What it prints" hint="Blank is fine while drafting; it is refused at issue.">
                  <TextArea
                    rows={2}
                    value={field.value ?? ""}
                    maxLength={2000}
                    disabled={disabled}
                    onChange={(e) => {
                      const value = e.target.value;
                      const next: DocCustomField = { ...field };
                      if (value) next.value = value;
                      else delete next.value;
                      onChange(custom.map((c, n) => (n === i ? next : c)));
                    }}
                  />
                </Field>
              </li>
            );
          })}
        </ul>
      )}

      <Btn
        variant="secondary"
        size="sm"
        className="mt-3"
        icon={<Plus size={14} />}
        disabled={disabled || custom.length >= MAX_CUSTOM_FIELDS}
        onClick={() => onChange([...custom, { token: "", label: "" }])}
      >
        Add a field
      </Btn>
      {custom.length >= MAX_CUSTOM_FIELDS && (
        <p className="mt-1.5 text-xs text-muted">
          That is the most one document can declare ({MAX_CUSTOM_FIELDS}).
        </p>
      )}
    </div>
  );
}

/** What is still missing, in the words the server would use. Green when there is nothing. */
export function ReadinessPanel({ problems }: { problems: string[] }) {
  if (problems.length === 0) {
    return (
      <p className="flex items-center gap-2 rounded-card border border-ok/40 bg-ok-soft px-4 py-3 text-sm font-medium text-ok">
        <CheckCircle2 size={16} /> Both parties have somewhere to sign and every merge field resolves.
      </p>
    );
  }
  return (
    <div className="rounded-card border border-warn/40 bg-warn-soft px-4 py-3">
      <p className="flex items-center gap-2 text-sm font-semibold text-warn">
        <AlertTriangle size={16} /> Before this can be sent
      </p>
      <ul className="mt-2 space-y-1 text-sm text-ink-2">
        {problems.map((p) => (
          <li key={p} className="flex gap-2">
            <span aria-hidden>·</span>
            <span>{p}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

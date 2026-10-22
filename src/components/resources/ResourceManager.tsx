"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Pencil, Plus, Trash2 } from "lucide-react";
import type { ResourceView } from "@/server/resources";
import {
  RESOURCE_KINDS,
  RESOURCE_KIND_LABELS,
  guessKind,
  isSafeResourceUrl,
  type ResourceScope,
} from "@/lib/resources";
import { deleteResource, setResourceVisibility, upsertResource } from "@/server/resource-actions";
import { ResourceRow } from "./ResourceList";
import { askConfirm, toast } from "@/components/ui/feedback";
import { Btn, IconButton } from "@/components/ui/controls";
import { CheckboxField, Field, FormError, Select, SubmitButton, TextArea, TextInput } from "@/components/ui/form";
import { Modal } from "@/components/ui/Modal";
import { safeAction } from "@/lib/action-guard";

/**
 * Post, edit, hide and remove course material for one scope.
 *
 * The KIND picker is pre-answered from the pasted link (`guessKind`), because the realistic
 * interaction is "paste a Drive URL, type a name, done" - and a form that makes someone classify
 * their own link before saving it is a form people stop using.
 *
 * `canManage` is passed in rather than computed here: the server decides, and this only hides
 * controls the server would refuse. A hidden button is never the fence.
 */

const KIND_OPTIONS = RESOURCE_KINDS.map((k) => ({ value: k, label: RESOURCE_KIND_LABELS[k] }));

function Fields({ r }: { r?: ResourceView }) {
  const [url, setUrl] = useState(r?.url ?? "");
  const [kind, setKind] = useState(r?.kind ?? "LINK");
  const [touchedKind, setTouchedKind] = useState(!!r);
  const badUrl = url.trim().length > 0 && !isSafeResourceUrl(url);

  return (
    <div className="space-y-4">
      <Field
        label="Link"
        hint="Google Drive, Skool, Fathom, a job board - anything with an http(s) address."
      >
        <TextInput
          kind="url"
          name="url"
          required
          maxLength={2000}
          placeholder="https://drive.google.com/…"
          defaultValue={r?.url}
          onChange={(e) => {
            const v = e.currentTarget.value;
            setUrl(v);
            // Only guess until the person has made their own choice - after that, leave it alone.
            if (!touchedKind) setKind(guessKind(v));
          }}
        />
      </Field>
      {badUrl && (
        <p className="text-caption text-risk">
          That link must start with <code>http://</code> or <code>https://</code>.
        </p>
      )}
      <Field label="Name" hint="What a student will see on the shelf.">
        <TextInput
          kind="text"
          name="title"
          required
          maxLength={200}
          placeholder="German-format CV template"
          defaultValue={r?.title}
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Type">
          <Select
            name="kind"
            value={kind}
            onChange={(e) => {
              setKind(e.currentTarget.value as typeof kind);
              setTouchedKind(true);
            }}
            options={KIND_OPTIONS}
          />
        </Field>
        <Field label="Visible to students" hint="Untick to stage it and release it after the class.">
          <CheckboxField
            name="visibleToStudents"
            label="Students can see this"
            defaultChecked={r ? r.visibleToStudents : true}
          />
        </Field>
      </div>
      <Field label="Note (optional)" hint="One line on what it is for.">
        <TextArea kind="text" name="description" rows={2} maxLength={1000} defaultValue={r?.description ?? undefined} />
      </Field>
    </div>
  );
}

export function ResourceManager({
  scope,
  scopeId,
  resources,
  canManage,
  title,
  hint,
  /** Curriculum-level rows a cohort inherits - shown, never editable from here. */
  inherited,
}: {
  scope: ResourceScope;
  scopeId: string;
  resources: ResourceView[];
  canManage: boolean;
  title?: string;
  hint?: string;
  inherited?: ResourceView[];
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<ResourceView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = () => router.refresh();

  return (
    <div className="space-y-3">
      {(title || canManage) && (
        <div className="flex flex-wrap items-center gap-2">
          {title && <h4 className="text-label font-semibold uppercase text-ink-2">{title}</h4>}
          {canManage && (
            <span className="ml-auto">
              <Btn size="sm" variant="soft" onClick={() => { setAdding(true); setError(null); }}>
                <Plus size={14} /> Add a resource
              </Btn>
            </span>
          )}
        </div>
      )}
      {hint && <p className="text-caption text-muted">{hint}</p>}

      {inherited && inherited.length > 0 && (
        <div className="rounded-field bg-surface-2 p-2">
          <p className="mb-1 text-caption text-muted">
            From the curriculum - every cohort running this programme sees these. Edit them under
            Programs → Curriculum.
          </p>
          <ul className="space-y-0.5">
            {inherited.map((r) => (
              <ResourceRow key={r.id} r={r} showScope />
            ))}
          </ul>
        </div>
      )}

      {resources.length === 0 ? (
        <p className="text-caption text-muted">
          {canManage ? "Nothing posted here yet." : "No resources yet."}
        </p>
      ) : (
        <ul className="space-y-0.5">
          {resources.map((r) => (
            <ResourceRow
              key={r.id}
              r={r}
              showScope
              trailing={
                canManage ? (
                  <>
                    <IconButton
                      label={r.visibleToStudents ? `Hide ${r.title} from students` : `Release ${r.title} to students`}
                      size="sm"
                      onClick={async () => {
                        const res = await safeAction(() => setResourceVisibility(r.id, !r.visibleToStudents));
                        if (!res.ok) return toast(res.error, "error");
                        toast(r.visibleToStudents ? "Hidden from students" : "Released to students");
                        refresh();
                      }}
                    >
                      {r.visibleToStudents ? <Eye size={14} /> : <EyeOff size={14} />}
                    </IconButton>
                    <IconButton label={`Edit ${r.title}`} size="sm" onClick={() => { setEditing(r); setError(null); }}>
                      <Pencil size={14} />
                    </IconButton>
                    <IconButton
                      label={`Remove ${r.title}`}
                      size="sm"
                      tone="danger"
                      onClick={async () => {
                        const ok = await askConfirm({
                          title: `Remove “${r.title}”?`,
                          body: "This removes the link from the app. The file itself is untouched.",
                          confirmLabel: "Remove",
                          danger: true,
                        });
                        if (!ok) return;
                        const res = await safeAction(() => deleteResource(r.id));
                        if (!res.ok) return toast(res.error, "error");
                        toast("Resource removed");
                        refresh();
                      }}
                    >
                      <Trash2 size={14} />
                    </IconButton>
                  </>
                ) : null
              }
            />
          ))}
        </ul>
      )}

      {(adding || editing) && (
        <Modal
          open
          title={editing ? `Edit “${editing.title}”` : "Add a resource"}
          onClose={() => { setAdding(false); setEditing(null); }}
        >
          <form
            action={async (fd) => {
              const res = await safeAction(() =>
                upsertResource({ scope, id: scopeId }, editing?.id ?? null, fd),
              );
              if (!res.ok) return setError(res.error);
              toast(editing ? "Resource updated" : "Resource added");
              setAdding(false);
              setEditing(null);
              refresh();
            }}
            className="space-y-4"
          >
            <Fields key={editing?.id ?? "new"} r={editing ?? undefined} />
            <FormError message={error} />
            <SubmitButton>{editing ? "Save resource" : "Add resource"}</SubmitButton>
          </form>
        </Modal>
      )}
    </div>
  );
}

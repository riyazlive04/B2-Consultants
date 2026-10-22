"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore, Check, Loader2, Pencil } from "lucide-react";
import { Btn } from "@/components/ui/controls";
import { Field, FormError, TextArea, TextInput } from "@/components/ui/form";
import { askConfirm, toast } from "@/components/ui/feedback";
import {
  archiveAgreementTemplate,
  renameAgreementTemplate,
  setTemplateCurrentVersion,
} from "@/server/agreement-template-actions";

/** Rename, archive, and choose which version new agreements are drawn from. */
export function TemplateAdmin({
  id,
  name,
  description,
  archived,
  usedBy,
}: {
  id: string;
  name: string;
  description: string | null;
  archived: boolean;
  usedBy: number;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(name);
  const [draftDescription, setDraftDescription] = useState(description ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const rename = () => {
    setError(null);
    startTransition(async () => {
      const res = await renameAgreementTemplate(id, {
        name: draftName,
        description: draftDescription,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setEditing(false);
      toast("Template renamed.");
      router.refresh();
    });
  };

  const toggleArchive = () => {
    startTransition(async () => {
      if (!archived) {
        const ok = await askConfirm({
          title: "Archive this template?",
          body:
            usedBy > 0
              ? `It will stop appearing when you raise a new agreement. The ${usedBy} agreement${usedBy === 1 ? "" : "s"} already drawn from it are untouched - they each hold their own copy of the document.`
              : "It will stop appearing when you raise a new agreement. You can restore it at any time.",
          confirmLabel: "Archive",
        });
        if (!ok) return;
      }
      const res = await archiveAgreementTemplate(id, !archived);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      toast(archived ? "Template restored." : "Template archived.");
      router.refresh();
    });
  };

  return (
    <div className="space-y-3">
      <FormError message={error} />
      {editing ? (
        <div className="space-y-3 rounded-card border border-line bg-surface p-4 shadow-card">
          <Field label="Template name" required>
            <TextInput value={draftName} maxLength={120} onChange={(e) => setDraftName(e.target.value)} />
          </Field>
          <Field label="What it is for">
            <TextArea
              rows={2}
              value={draftDescription}
              maxLength={500}
              onChange={(e) => setDraftDescription(e.target.value)}
            />
          </Field>
          <div className="flex gap-2">
            <Btn
              variant="primary"
              icon={pending ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
              onClick={rename}
              disabled={pending}
              busy={pending}
            >
              Save
            </Btn>
            <Btn variant="ghost" onClick={() => setEditing(false)} disabled={pending}>
              Cancel
            </Btn>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Btn variant="secondary" icon={<Pencil size={14} />} onClick={() => setEditing(true)}>
            Rename
          </Btn>
          <Btn
            variant={archived ? "secondary" : "ghost"}
            icon={archived ? <ArchiveRestore size={14} /> : <Archive size={14} />}
            onClick={toggleArchive}
            disabled={pending}
          >
            {archived ? "Restore" : "Archive"}
          </Btn>
        </div>
      )}
    </div>
  );
}

/** "Make this the current version" - what a new agreement will instantiate. */
export function MakeCurrentButton({
  templateId,
  versionId,
  version,
}: {
  templateId: string;
  versionId: string;
  version: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <Btn
      size="sm"
      variant="secondary"
      disabled={pending}
      busy={pending}
      onClick={() =>
        startTransition(async () => {
          const res = await setTemplateCurrentVersion(templateId, versionId);
          if (!res.ok) {
            toast(res.error, "error");
            return;
          }
          toast(`New agreements will now use v${version}.`);
          router.refresh();
        })
      }
    >
      Make current
    </Btn>
  );
}

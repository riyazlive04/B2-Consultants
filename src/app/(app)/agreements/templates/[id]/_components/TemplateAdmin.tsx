"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore, Check, Loader2, Pencil, Star, StarOff } from "lucide-react";
import { Btn } from "@/components/ui/controls";
import { Field, FormError, TextArea, TextInput } from "@/components/ui/form";
import { askConfirm, toast } from "@/components/ui/feedback";
import {
  archiveAgreementTemplate,
  renameAgreementTemplate,
  setDefaultAgreementTemplate,
  setTemplateCurrentVersion,
} from "@/server/agreement-template-actions";

/** Rename, archive, make it the one-tap default, and choose which version is current. */
export function TemplateAdmin({
  id,
  name,
  description,
  archived,
  usedBy,
  isDefault,
  usable,
}: {
  id: string;
  name: string;
  description: string | null;
  archived: boolean;
  usedBy: number;
  /** Is this already the document "Generate & send" draws up? */
  isDefault: boolean;
  /** Has it a current version at all? An empty template cannot be anybody's default. */
  usable: boolean;
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

  /**
   * Make this the document the one-tap "Generate & send" uses - or hand that back to the guided
   * clause set.
   *
   * CONFIRMED when switching it ON, because the consequence is not local to this screen: every
   * contact record's card starts drawing up this contract instead, in one tap, with no further
   * prompt. Turning it off needs no confirmation - it restores the behaviour the app shipped with.
   */
  const toggleDefault = () => {
    startTransition(async () => {
      if (!isDefault) {
        const ok = await askConfirm({
          title: "Send this by default?",
          body:
            "“Generate & send” on a contact record will draw up this document from now on, in one " +
            "tap. You can still pick a different one for an individual agreement on the full form.",
          confirmLabel: "Make it the default",
        });
        if (!ok) return;
      }
      const res = await setDefaultAgreementTemplate(isDefault ? null : id);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      toast(
        isDefault
          ? "One-tap sends are back on the Guided Mode clause set."
          : "One-tap sends now use this document.",
      );
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
          {/* Not offered for an archived or empty template - `setDefaultAgreementTemplate` refuses
              both, and a button that always fails is worse than no button. */}
          {!archived && usable && (
            <Btn
              variant={isDefault ? "secondary" : "ghost"}
              icon={isDefault ? <StarOff size={14} /> : <Star size={14} />}
              onClick={toggleDefault}
              disabled={pending}
            >
              {isDefault ? "Stop sending by default" : "Send this by default"}
            </Btn>
          )}
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

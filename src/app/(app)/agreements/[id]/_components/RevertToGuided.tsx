"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Undo2 } from "lucide-react";
import { Btn } from "@/components/ui/controls";
import { askConfirm, toast } from "@/components/ui/feedback";
import { removeAgreementDocument } from "@/server/agreement-actions";

/**
 * Throw away the uploaded document and go back to the Guided Mode clause set.
 *
 * Confirmed, not a one-tap undo: the uploaded file is deleted with it, and the prose edits made
 * on this agreement's own copy go with it. `askConfirm` rather than `toastUndo` for exactly that
 * reason - there is nothing to restore afterwards.
 */
export function RevertToGuidedButton({ agreementId }: { agreementId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <div>
      <Btn
        variant="ghost"
        icon={<Undo2 size={14} />}
        disabled={pending}
        busy={pending}
        onClick={() =>
          startTransition(async () => {
            const ok = await askConfirm({
              title: "Go back to the Guided Mode clause set?",
              body:
                "The uploaded file, the signature boxes placed on it and any wording you changed here are deleted. This cannot be undone.",
              confirmLabel: "Remove the document",
              danger: true,
            });
            if (!ok) return;
            const res = await removeAgreementDocument(agreementId);
            if (!res.ok) {
              toast(res.error, "error");
              return;
            }
            toast("Back to the Guided Mode clause set.");
            router.refresh();
          })
        }
      >
        Remove the document
      </Btn>
      <p className="mt-1 text-xs text-muted">
        The agreement goes back to the built-in clauses. The terms you typed are kept.
      </p>
    </div>
  );
}

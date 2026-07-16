"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { Check, Copy, Loader2, PenLine, Send, Trash2 } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import type { SignatureValue } from "@/components/ui/SignaturePad";

// Canvas-drawing signature capture is client-only and not needed until the countersign modal
// opens, so keep it out of this route's initial bundle (BUILD_CHECKLIST §12).
const SignaturePad = dynamic(
  () => import("@/components/ui/SignaturePad").then((m) => m.SignaturePad),
  { ssr: false },
);
import { askConfirm, celebrate, toast } from "@/components/ui/feedback";
import {
  cloneAgreement,
  issueAgreement,
  resendAgreementLink,
  voidAgreement,
} from "@/server/agreement-actions";

/**
 * Issue / remind / void / clone.
 *
 * The signing URL is shown once, after issuing, and never again — the database keeps only its
 * SHA-256. If the WhatsApp send is skipped (WATI off, template unmapped, number opted out) this
 * panel is the founder's only route to the link, so it refuses to disappear on its own.
 */
export function AgreementActions({
  id,
  status,
  studentName,
}: {
  id: string;
  status: string;
  studentName: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [signOpen, setSignOpen] = useState(false);
  const [signature, setSignature] = useState<SignatureValue | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<{ url: string; delivery: string; sent: boolean } | null>(null);
  const [copied, setCopied] = useState(false);

  const isDraft = status === "DRAFT";
  const isPending = status === "SENT" || status === "VIEWED";

  function doIssue() {
    if (!signature) {
      setError("Draw your signature before sending.");
      return;
    }
    setError(null);
    startTransition(async () => {
      // The founder's own device is captured too: the certificate names both signatories.
      const res = await issueAgreement(id, signature.dataUrl, signature.device);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      const data = res.data!;
      setIssued({ url: data.signingUrl, delivery: data.delivery, sent: data.sent });
      setSignOpen(false);
      if (data.sent) celebrate();
      router.refresh();
    });
  }

  function doVoid() {
    startTransition(async () => {
      const ok = await askConfirm({
        title: "Void this agreement?",
        body: "The signing link stops working immediately. This cannot be undone.",
        confirmLabel: "Void",
        danger: true,
      });
      if (!ok) return;
      const res = await voidAgreement(id, "Voided by founder");
      if (!res.ok) return toast(res.error, "error");
      toast("Agreement voided");
      router.refresh();
    });
  }

  function doClone() {
    startTransition(async () => {
      const res = await cloneAgreement(id);
      if (!res.ok) return toast(res.error, "error");
      toast("New draft created");
      router.push(`/agreements/${res.data!.id}`);
      router.refresh();
    });
  }

  function doResend() {
    startTransition(async () => {
      const res = await resendAgreementLink(id);
      if (!res.ok) return toast(res.error, "error");
      toast(res.data!.delivery);
      router.refresh();
    });
  }

  async function copyLink(url: string) {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {isDraft && (
          <button
            onClick={() => setSignOpen(true)}
            disabled={pending}
            className="inline-flex h-10 items-center gap-1.5 rounded-btn bg-primary px-4 text-sm font-semibold text-on-accent transition-colors hover:bg-primary-strong disabled:opacity-60"
          >
            <PenLine size={15} /> Countersign &amp; send
          </button>
        )}
        {isPending && (
          <button
            onClick={doResend}
            disabled={pending}
            className="inline-flex h-10 items-center gap-1.5 rounded-btn border border-line px-4 text-sm font-medium transition-colors hover:border-primary hover:text-primary disabled:opacity-60"
          >
            {pending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />} Send reminder
          </button>
        )}
        {status !== "SIGNED" && status !== "VOIDED" && (
          <button
            onClick={doVoid}
            disabled={pending}
            className="inline-flex h-10 items-center gap-1.5 rounded-btn border border-line px-4 text-sm font-medium text-risk transition-colors hover:border-risk disabled:opacity-60"
          >
            <Trash2 size={15} /> Void
          </button>
        )}
        {!isDraft && (
          <button
            onClick={doClone}
            disabled={pending}
            className="inline-flex h-10 items-center gap-1.5 rounded-btn border border-line px-4 text-sm font-medium transition-colors hover:border-primary hover:text-primary disabled:opacity-60"
          >
            <Copy size={15} /> Void &amp; clone
          </button>
        )}
      </div>

      {issued && (
        <div className="mt-4 rounded-card border border-line bg-surface-2 p-4">
          <p className="text-sm font-medium" style={{ color: issued.sent ? "var(--good)" : "var(--warn)" }}>
            {issued.delivery}
          </p>
          <p className="mt-2 text-xs text-muted">
            This link is shown once. Only its hash is stored, so it cannot be recovered later.
          </p>
          <div className="mt-2 flex items-center gap-2">
            <code className="flex-1 overflow-x-auto rounded-field bg-surface px-3 py-2 text-xs">{issued.url}</code>
            <button
              onClick={() => copyLink(issued.url)}
              className="inline-flex h-9 flex-none items-center gap-1.5 rounded-btn border border-line px-3 text-xs font-medium hover:border-primary hover:text-primary"
            >
              {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
      )}

      <Modal
        open={signOpen}
        onClose={() => setSignOpen(false)}
        title="Countersign the agreement"
        subtitle={`You sign first, then ${studentName} receives the link on WhatsApp.`}
      >
        <div className="space-y-4">
          <SignaturePad onChange={(v) => setSignature(v)} disabled={pending} allowFullScreen={false} />
          {error && (
            <p role="alert" className="rounded-field bg-risk-soft px-3 py-2 text-sm font-medium text-risk">
              {error}
            </p>
          )}
          <div className="flex items-center justify-end gap-2">
            <button
              onClick={() => setSignOpen(false)}
              className="h-10 rounded-btn border border-line px-4 text-sm font-medium"
            >
              Cancel
            </button>
            <button
              onClick={doIssue}
              disabled={pending || !signature}
              className="inline-flex h-10 items-center gap-1.5 rounded-btn bg-primary px-4 text-sm font-semibold text-on-accent hover:bg-primary-strong disabled:opacity-60"
            >
              {pending && <Loader2 size={15} className="animate-spin" />}
              <Send size={15} /> Sign &amp; send
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}

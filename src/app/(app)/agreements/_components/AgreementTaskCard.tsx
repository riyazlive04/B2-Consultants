"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import {
  Check,
  Copy,
  Eye,
  FileSignature,
  Loader2,
  PenLine,
  RefreshCw,
  Send,
  SquareArrowOutUpRight,
} from "lucide-react";
import { Card } from "@/components/ui/kit";
import { Modal } from "@/components/ui/Modal";
import type { SignatureValue } from "@/components/ui/SignaturePad";
import { celebrate, toast } from "@/components/ui/feedback";
import { collectReportedDevice } from "@/lib/device";
import {
  agreementStateHeadline,
  agreementStateHint,
  isAgreementActionable,
  type AgreementSummary,
} from "@/lib/agreement-state";
import {
  generateAndSendAgreement,
  issueAgreementWithSavedSignature,
  saveFounderSignature,
} from "@/server/agreement-actions";
import { AgreementStateBadge } from "./AgreementStateBadge";

// This card renders on every contact profile. The canvas pad is only needed the one time the
// founder stores a signature, so keep it out of the profile's initial bundle.
const SignaturePad = dynamic(() => import("@/components/ui/SignaturePad").then((m) => m.SignaturePad), {
  ssr: false,
});

/**
 * "Agreement pending — ready to send", wherever the founder happens to be looking.
 *
 * Driven ENTIRELY by the derived state: it never asks the founder to know the next step, and never
 * offers an action the state can't support. The loud button belongs to actionable states only; the
 * rest stay quiet so the card reads as a status line rather than a nag.
 *
 * "Start anyway" is always available — readiness is a prompt, not a gate.
 */
export function AgreementTaskCard({ summary }: { summary: AgreementSummary }) {
  const { state, config, agreementId, documentNo, leadId, studentId } = summary;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [signOpen, setSignOpen] = useState(false);
  const [signature, setSignature] = useState<SignatureValue | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<{ url: string; delivery: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const newHref = `/agreements/new?${leadId ? `leadId=${leadId}` : `studentId=${studentId}`}`;
  const detailHref = agreementId ? `/agreements/${agreementId}` : newHref;

  /** Draft-if-needed → countersign with stored ink → send. One tap, when the CRM has every field. */
  function send() {
    setError(null);
    startTransition(async () => {
      const reported = collectReportedDevice();
      const res = agreementId
        ? await issueAgreementWithSavedSignature(agreementId, reported)
        : await generateAndSendAgreement({ leadId, studentId, reported });

      if (!res.ok) return toast(res.error, "error");
      const d = res.data!;

      if (d.kind === "needsSignature") {
        setSignOpen(true); // first ever send — store the ink, then this runs again
        return;
      }
      if (d.kind === "needsForm") {
        toast(`Still needed: ${d.missing.join(", ")}. Opening the form.`);
        router.push(d.href);
        return;
      }

      if (d.sent) {
        celebrate();
        toast(d.delivery);
        router.refresh(); // the card re-derives to "Sent"
        return;
      }
      // WhatsApp didn't go out. The database keeps only the token's HASH, so this response is the
      // only place the link will ever exist — show it instead of navigating away from it.
      setIssued({ url: d.signingUrl, delivery: d.delivery });
      router.refresh();
    });
  }

  function saveThenSend() {
    if (!signature) return setError("Draw your signature before saving.");
    setError(null);
    startTransition(async () => {
      const res = await saveFounderSignature(signature.dataUrl, signature.device);
      if (!res.ok) return setError(res.error);
      setSignOpen(false);
      toast("Signature saved — sending from now on is one tap.");
      send();
    });
  }

  async function copyLink(url: string) {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  const loud =
    "inline-flex h-9 items-center gap-1.5 rounded-btn bg-primary px-3 text-caption font-semibold text-on-accent transition-colors hover:bg-primary-strong disabled:opacity-60";
  const quiet =
    "inline-flex h-9 items-center gap-1.5 rounded-btn border border-line px-3 text-caption font-medium text-ink-2 transition-colors hover:border-primary hover:text-primary";

  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="grid h-8 w-8 flex-none place-items-center rounded-field bg-accent-soft text-accent">
            <FileSignature size={16} />
          </span>
          <div className="min-w-0">
            {/* Wraps rather than truncates: this card lives in the contact profile's 360px column,
                where "Agreement pending — ready to send" is exactly the sentence that gets cut. */}
            <p className="font-display text-sm font-semibold text-ink">{agreementStateHeadline(state)}</p>
            {documentNo && <p className="truncate text-caption text-muted">{documentNo}</p>}
          </div>
        </div>
        <AgreementStateBadge state={state} config={config} size="sm" />
      </div>

      <p className="mt-3 text-sm text-ink-2">{agreementStateHint(state, config)}</p>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {(state === "READY_TO_SEND" || state === "EXPIRED") && (
          <button onClick={send} disabled={pending} className={loud}>
            {pending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            {state === "EXPIRED" ? "Re-issue" : agreementId ? "Countersign & send" : "Generate & send"}
          </button>
        )}
        {(state === "SENT" || state === "VIEWED" || state === "SIGNED") && (
          <Link href={detailHref} className={loud}>
            <SquareArrowOutUpRight size={14} /> Open agreement
          </Link>
        )}

        {agreementId && (
          <a href={`/api/agreements/${agreementId}/pdf`} target="_blank" rel="noreferrer" className={quiet}>
            <Eye size={14} /> Preview
          </a>
        )}
        {agreementId && !isAgreementActionable(state) && (
          <Link href={detailHref} className={quiet}>
            <SquareArrowOutUpRight size={14} /> Track
          </Link>
        )}
        {/* The founder can always start one, whatever the prompt says. */}
        {!agreementId && state !== "READY_TO_SEND" && (
          <Link href={newHref} className={quiet}>
            <PenLine size={14} /> Start anyway
          </Link>
        )}
      </div>

      {issued && (
        <div className="mt-4 rounded-card border border-line bg-surface-2 p-3">
          <p className="text-caption font-medium" style={{ color: "var(--warn)" }}>
            {issued.delivery}
          </p>
          <p className="mt-1.5 text-caption text-muted">
            This link is shown once — only its hash is stored, so it cannot be recovered later.
          </p>
          <div className="mt-2 flex items-center gap-2">
            <code className="flex-1 overflow-x-auto rounded-field bg-surface px-2 py-1.5 text-caption">
              {issued.url}
            </code>
            <button onClick={() => copyLink(issued.url)} className={`${quiet} h-8`}>
              {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
      )}

      <Modal
        open={signOpen}
        onClose={() => setSignOpen(false)}
        title="Save your countersignature"
        subtitle="Draw it once. Every agreement after this one goes out in a single tap."
      >
        <div className="space-y-4">
          <SignaturePad onChange={(v) => setSignature(v)} disabled={pending} allowFullScreen={false} />
          <p className="text-caption text-muted">
            Only the signature image is reused. The device and IP we record are captured fresh each
            time you issue, and the audit trail always states that stored ink was used.
          </p>
          {error && (
            <p role="alert" className="rounded-field bg-risk-soft px-3 py-2 text-sm font-medium text-risk">
              {error}
            </p>
          )}
          <div className="flex items-center justify-end gap-2">
            <button onClick={() => setSignOpen(false)} className="h-10 rounded-btn border border-line px-4 text-sm font-medium">
              Cancel
            </button>
            <button
              onClick={saveThenSend}
              disabled={pending || !signature}
              className="inline-flex h-10 items-center gap-1.5 rounded-btn bg-primary px-4 text-sm font-semibold text-on-accent hover:bg-primary-strong disabled:opacity-60"
            >
              {pending && <Loader2 size={15} className="animate-spin" />}
              <Send size={15} /> Save &amp; send
            </button>
          </div>
        </div>
      </Modal>
    </Card>
  );
}

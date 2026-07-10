"use client";

import { useState, useTransition } from "react";
import { CheckCircle2, Loader2, MessageCircle, ShieldCheck } from "lucide-react";
import { SignaturePad } from "@/components/ui/SignaturePad";
import { declineAgreement, requestSignOtp, signAgreement } from "@/server/agreement-sign";

/**
 * The student's signing ceremony, in the order a signature has to happen:
 *   read the document → prove you hold the number → make your mark → declare intent.
 *
 * The consent checkbox is not decoration. Under eIDAS a simple electronic signature needs the
 * signatory's intent to sign; a drawn squiggle with no declaration is a drawing.
 */

type Step = "read" | "verify" | "sign" | "done";

export function SignCeremony({
  token,
  documentNo,
  studentName,
  maskedPhone,
}: {
  token: string;
  documentNo: string;
  studentName: string;
  maskedPhone: string;
}) {
  const [step, setStep] = useState<Step>("read");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [signature, setSignature] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [declineReason, setDeclineReason] = useState("");
  /** Localhost-only escape hatch; the server refuses to populate this anywhere else. */
  const [devCode, setDevCode] = useState<string | null>(null);

  function sendCode() {
    setError(null);
    startTransition(async () => {
      const res = await requestSignOtp(token);
      if (!res.ok) return setError(res.error);
      setDevCode(res.data?.devCode ?? null);
      setStep("verify");
    });
  }

  function submit() {
    setError(null);
    if (!signature) return setError("Please draw your signature.");
    if (!consent) return setError("Please confirm you agree to sign electronically.");
    startTransition(async () => {
      const res = await signAgreement({ token, code, signature, consent });
      if (!res.ok) return setError(res.error);
      setStep("done");
    });
  }

  function decline() {
    setError(null);
    startTransition(async () => {
      const res = await declineAgreement(token, declineReason);
      if (!res.ok) return setError(res.error);
      window.location.reload();
    });
  }

  if (step === "done") {
    return (
      <div className="rounded-card border border-line bg-surface p-8 text-center shadow-card">
        <CheckCircle2 size={40} className="mx-auto text-good" />
        <h2 className="mt-3 font-display text-xl font-bold">Agreement signed</h2>
        <p className="mt-2 text-sm text-muted">
          Thank you, {studentName.split(" ")[0]}. {documentNo} is now executed. B2 Consultants will send your
          countersigned copy on WhatsApp.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-card border border-line bg-surface p-5 shadow-card sm:p-6">
      {step === "read" && (
        <>
          <h2 className="font-display text-lg font-bold">Ready to sign?</h2>
          <p className="mt-1 text-sm text-muted">
            Read the full agreement above. When you are ready, we will send a 6-digit code to your WhatsApp
            number ending {maskedPhone.slice(-4)} to confirm it is you.
          </p>
          <button
            onClick={sendCode}
            disabled={pending}
            className="mt-4 inline-flex h-11 w-full items-center justify-center gap-2 rounded-btn bg-primary px-4 text-sm font-semibold text-white transition-colors hover:bg-primary-strong disabled:opacity-60 sm:w-auto"
          >
            {pending ? <Loader2 size={16} className="animate-spin" /> : <MessageCircle size={16} />}
            Send me the code
          </button>
        </>
      )}

      {(step === "verify" || step === "sign") && (
        <div className="space-y-5">
          <div>
            <h2 className="font-display text-lg font-bold">Confirm it’s you</h2>
            <p className="mt-1 text-sm text-muted">
              We sent a 6-digit code to {maskedPhone} on WhatsApp.
            </p>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="000000"
              className="mt-3 w-40 rounded-field border border-line-strong bg-surface px-3 py-2.5 text-center font-mono text-2xl tracking-[0.35em] outline-none focus:border-primary focus:ring-2 focus:ring-primary-soft"
            />
            <button
              onClick={sendCode}
              disabled={pending}
              className="ml-3 text-xs font-medium text-primary hover:underline disabled:opacity-50"
            >
              Resend
            </button>
            {devCode && (
              <p
                className="mt-3 rounded-field px-3 py-2 text-sm"
                style={{ background: "var(--warn-bg)", color: "var(--warn)" }}
              >
                <strong>Local testing only.</strong> WhatsApp could not deliver, so the code is shown
                here: <code className="font-mono text-base tracking-widest">{devCode}</code>. This never
                happens on a real deployment.
              </p>
            )}
          </div>

          <div>
            <h2 className="font-display text-lg font-bold">Your signature</h2>
            <div className="mt-2">
              <SignaturePad onChange={setSignature} disabled={pending} />
            </div>
          </div>

          <label className="flex items-start gap-2.5 text-sm">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-[var(--primary)]"
            />
            <span>
              I am {studentName}. I have read the agreement in full and I intend this electronic signature to
              bind me to it, with the same effect as a handwritten signature.
            </span>
          </label>

          {error && (
            <p role="alert" className="rounded-field bg-risk-soft px-3 py-2 text-sm font-medium text-risk">
              {error}
            </p>
          )}

          <button
            onClick={submit}
            disabled={pending || code.length !== 6 || !signature || !consent}
            className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-btn bg-primary px-4 text-sm font-semibold text-white transition-colors hover:bg-primary-strong disabled:opacity-60"
          >
            {pending ? <Loader2 size={16} className="animate-spin" /> : <ShieldCheck size={16} />}
            Sign {documentNo}
          </button>

          <div className="border-t border-line pt-4">
            {!declining ? (
              <button onClick={() => setDeclining(true)} className="text-xs text-muted hover:text-risk">
                I don’t want to sign this
              </button>
            ) : (
              <div className="space-y-2">
                <textarea
                  value={declineReason}
                  onChange={(e) => setDeclineReason(e.target.value)}
                  rows={2}
                  placeholder="Tell B2 Consultants why (optional)"
                  className="w-full rounded-field border border-line-strong bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
                />
                <div className="flex gap-2">
                  <button
                    onClick={decline}
                    disabled={pending}
                    className="h-9 rounded-btn border border-line px-3 text-xs font-medium text-risk hover:border-risk"
                  >
                    Decline agreement
                  </button>
                  <button onClick={() => setDeclining(false)} className="h-9 rounded-btn px-3 text-xs text-muted">
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {step === "read" && error && (
        <p role="alert" className="mt-3 rounded-field bg-risk-soft px-3 py-2 text-sm font-medium text-risk">
          {error}
        </p>
      )}
    </div>
  );
}

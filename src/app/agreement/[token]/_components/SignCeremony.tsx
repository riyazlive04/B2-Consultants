"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  FileText,
  Hourglass,
  Loader2,
  MessageCircle,
  ShieldCheck,
  Smartphone,
} from "lucide-react";
import { Btn } from "@/components/ui/controls";
import { SignaturePad, type SignatureValue } from "@/components/ui/SignaturePad";
import { describeDevice, type SigningDevice } from "@/lib/device";
import { declineAgreement, requestSignOtp, signAgreement } from "@/server/agreement-sign";
import { declineAsCoSigner, requestCoSignOtp, signAsCoSigner } from "@/server/agreement-cosign";
import { SignedCopyLinks } from "./SignedCopyLinks";
import { SignerFields } from "./SignerFields";
import { safeAction } from "@/lib/action-guard";
import { validateSignerValues, type DocField, type SignerValues } from "@/lib/agreement-doc";

/**
 * The signing ceremony, in the order a signature has to happen:
 *   read the document -> prove you hold the number -> fill your boxes -> make your mark -> declare intent.
 *
 * ── ONE COMPONENT, TWO SIGNERS ──────────────────────────────────────────────────────────────
 * The student and a co-signer (a parent or guardian) go through the identical ceremony, so this
 * is parameterised by `mode` rather than copied. What differs between them is three server actions
 * and some wording; what must NOT differ is the sequence - the one-time code before the signature,
 * the required boxes before the code is spent, the intent declaration last. A second copy of this
 * file would be a second chance to get that order wrong.
 *
 * The consent checkbox is not decoration. Under eIDAS a simple electronic signature needs the
 * signatory's intent to sign; a drawn squiggle with no declaration is a drawing.
 *
 * Every step scrolls itself into view on entry. That is not polish: the pad sits below the fold
 * on a phone, and a signature field the signer cannot see is a signature field they cannot use.
 */

const STEPS = ["Review", "Verify", "Sign"] as const;
type Step = 0 | 1 | 2 | 3; // 3 = done

/** Who is signing, and therefore which endpoints and which wording. */
export type CeremonyRole = "STUDENT" | "GUARDIAN";

export function SignCeremony({
  token,
  documentNo,
  studentName,
  maskedPhone,
  role = "STUDENT",
  signerName,
  inputFields = [],
  blocking = [],
}: {
  token: string;
  documentNo: string;
  /** Whose agreement this is - always the student, whoever is signing. */
  studentName: string;
  maskedPhone: string;
  role?: CeremonyRole;
  /** The person at the keyboard. Defaults to the student. */
  signerName?: string;
  /** The boxes this signer has to fill: consent ticks, text, uploads. */
  inputFields?: DocField[];
  /**
   * Why this signer cannot proceed yet - a guardian who has not co-signed, or who declined.
   * Non-empty replaces the whole ceremony with the explanation: there is nothing useful they can
   * do, and letting them draw a signature we would then refuse is worse than telling them.
   */
  blocking?: string[];
}) {
  const [step, setStep] = useState<Step>(0);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [signature, setSignature] = useState<SignatureValue | null>(null);
  const [consent, setConsent] = useState(false);
  const [fieldValues, setFieldValues] = useState<SignerValues>({});

  const whoIsSigning = signerName ?? studentName;
  const isCoSigner = role === "GUARDIAN";

  /** What this signer still has to fill. Advisory - the server checks the same thing. */
  const unfilled = validateSignerValues(inputFields, role, fieldValues);
  const [declining, setDeclining] = useState(false);
  const [declineReason, setDeclineReason] = useState("");
  /** Localhost-only escape hatch; the server refuses to populate this anywhere else. */
  const [devCode, setDevCode] = useState<string | null>(null);

  const topRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [step]);

  function sendCode() {
    setError(null);
    startTransition(async () => {
      const res = await safeAction(() => (isCoSigner ? requestCoSignOtp(token) : requestSignOtp(token)));
      if (!res.ok) return setError(res.error);
      setDevCode(res.data?.devCode ?? null);
      setStep(1);
    });
  }

  function submit() {
    setError(null);
    if (!signature) return setError("Please draw your signature.");
    if (!consent) return setError("Please confirm you agree to sign electronically.");
    // Checked here so a missed consent tick costs a click rather than the one-time code.
    if (unfilled.length > 0) return setError(unfilled[0]!.message);

    startTransition(async () => {
      const payload = {
        token,
        code,
        signature: signature.dataUrl,
        consent,
        device: signature.device,
        fieldValues,
      };
      const res = isCoSigner ? await signAsCoSigner(payload) : await signAgreement(payload);
      if (!res.ok) return setError(res.error);
      setStep(3);
    });
  }

  function decline() {
    setError(null);
    startTransition(async () => {
      const res = await safeAction(() =>
        isCoSigner ? declineAsCoSigner(token, declineReason) : declineAgreement(token, declineReason),
      );
      if (!res.ok) return setError(res.error);
      window.location.reload();
    });
  }

  if (blocking.length > 0) {
    return (
      <div ref={topRef} className="rounded-card border border-warn/40 bg-surface p-8 text-center shadow-card">
        <Hourglass size={40} className="mx-auto text-warn" />
        <h2 className="mt-3 font-display text-h1 text-ink">Not ready for you yet</h2>
        <ul className="mx-auto mt-3 max-w-md space-y-1 text-body text-ink-2">
          {blocking.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
        <p className="mx-auto mt-4 max-w-md text-caption text-faint">
          You can read {documentNo} above in the meantime. This page will let you sign as soon as it
          is your turn - keep the link.
        </p>
      </div>
    );
  }

  if (step === 3) {
    return (
      <div ref={topRef} className="rounded-card border border-line bg-surface p-8 text-center shadow-card">
        <CheckCircle2 size={44} className="mx-auto text-good" />
        <h2 className="mt-3 font-display text-h1 text-ink">
          {isCoSigner ? "Thank you - your part is signed" : "Agreement signed"}
        </h2>
        {isCoSigner ? (
          /**
           * A co-signer gets NO copy link here, and that is correct rather than mean: nothing has
           * been sealed yet. The document is rendered and hashed in the write that records the
           * STUDENT's signature, so until they sign there is no executed copy to hand anybody.
           */
          <p className="mx-auto mt-2 max-w-sm text-body text-ink-2">
            Thank you, {whoIsSigning.split(" ")[0]}. {documentNo} now goes to {studentName.split(" ")[0]} to
            sign. Once they have, B2 Consultants will send out the completed copy.
          </p>
        ) : (
          <>
            <p className="mx-auto mt-2 max-w-sm text-body text-ink-2">
              Thank you, {studentName.split(" ")[0]}. {documentNo} is now executed. Your countersigned copy is
              on its way to you - and you can take it now from here.
            </p>
            {/* The moment they most want the document is the moment they finish signing. The bytes
                are already sealed by the time this screen renders (the server seals inside the same
                write that burns the token), so the copy route is live and does not depend on the
                WhatsApp or email send, either of which may have been skipped. */}
            <SignedCopyLinks token={token} />
          </>
        )}
      </div>
    );
  }

  return (
    <div ref={topRef} className="rounded-card border border-line bg-surface shadow-card">
      <Stepper current={step} />

      <div className="p-5 sm:p-6">
        {step === 0 && (
          <>
            <StepHeading
              icon={<FileText size={18} />}
              title={isCoSigner ? "Review the agreement" : "Review the agreement"}
              subtitle={`Read ${documentNo} above in full${
                isCoSigner ? ` - it is ${studentName}'s coaching agreement` : ""
              }. When you are ready, we will send a 6-digit code to your WhatsApp number ending ${maskedPhone.slice(-4)} so we know it is you.`}
            />
            <Btn variant="primary" onClick={sendCode} busy={pending} icon={<MessageCircle size={16} />} className="mt-5 w-full sm:w-auto">
              Send me the code
            </Btn>
          </>
        )}

        {step === 1 && (
          <>
            <StepHeading
              icon={<ShieldCheck size={18} />}
              title="Confirm it’s you"
              subtitle={`We sent a 6-digit code to ${maskedPhone} on WhatsApp.`}
            />

            <div className="mt-5">
              <OtpInput value={code} onChange={setCode} disabled={pending} />
              <div className="mt-3 flex items-center gap-4">
                <button
                  type="button"
                  onClick={sendCode}
                  disabled={pending}
                  className="text-caption font-semibold text-primary hover:underline disabled:text-ink-disabled"
                >
                  Resend code
                </button>
                <button
                  type="button"
                  onClick={() => setStep(0)}
                  className="inline-flex items-center gap-1 text-caption text-ink-2 hover:text-ink"
                >
                  <ArrowLeft size={13} /> Back
                </button>
              </div>
            </div>

            {devCode && (
              <p className="mt-4 rounded-field bg-warn-soft px-3 py-2 text-caption text-warn">
                <strong>Local testing only.</strong> WhatsApp could not deliver, so the code is shown here:{" "}
                <code className="font-mono text-body-strong tracking-widest">{devCode}</code>. This never
                happens on a real deployment.
              </p>
            )}

            <ErrorNote message={error} />

            <Btn
              variant="primary"
              onClick={() => {
                setError(null);
                setStep(2);
              }}
              disabled={code.length !== 6}
              className="mt-5 w-full sm:w-auto"
            >
              Next
            </Btn>
          </>
        )}

        {step === 2 && (
          <>
            <StepHeading
              icon={<ShieldCheck size={18} />}
              title="Submit your signature"
              subtitle="Your signature will be affixed to the agreement and is mandatory."
            />

            <SignerFields
              token={token}
              fields={inputFields}
              values={fieldValues}
              onChange={(next) => {
                setFieldValues(next);
                setError(null);
              }}
              disabled={pending}
            />

            <div className="mt-5">
              <SignaturePad
                onChange={(value) => {
                  setSignature(value);
                  if (value) setError(null);
                }}
                disabled={pending}
              />
            </div>

            {signature && <DeviceNote device={signature.device} />}

            <label className="mt-5 flex items-start gap-3 text-body text-ink">
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
                className="mt-0.5 h-[18px] w-[18px] flex-none accent-[var(--primary)]"
              />
              <span>
                I am {whoIsSigning}. I have read the agreement in full and I intend this electronic signature
                to bind me to it, with the same effect as a handwritten signature.
                {isCoSigner && (
                  <>
                    {" "}
                    I confirm I am signing as {studentName}&apos;s parent, guardian or witness.
                  </>
                )}
              </span>
            </label>

            <p className="mt-3 text-caption text-faint">
              For everyone’s protection, the certificate attached to this agreement records the time you
              signed, your IP address, and the device you signed on.
            </p>

            <ErrorNote message={error} />

            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:items-center">
              <Btn variant="ghost" onClick={() => setStep(1)} icon={<ArrowLeft size={15} />}>
                Back
              </Btn>
              <Btn
                variant="action"
                onClick={submit}
                busy={pending}
                disabled={!signature || !consent || unfilled.length > 0}
                icon={<ShieldCheck size={16} />}
                className="w-full sm:w-auto"
              >
                Sign {documentNo}
              </Btn>
            </div>
          </>
        )}

        {step === 0 && <ErrorNote message={error} />}

        {/* Declining is always available, and never the loud option. */}
        <div className="mt-6 border-t border-line pt-4">
          {!declining ? (
            <button
              type="button"
              onClick={() => setDeclining(true)}
              className="text-caption text-faint hover:text-bad"
            >
              I don’t want to sign this
            </button>
          ) : (
            <div className="space-y-2">
              <textarea
                value={declineReason}
                onChange={(e) => setDeclineReason(e.target.value)}
                rows={2}
                // Free text - nothing is filtered. 500 matches declineAgreement, which silently
                // truncates there; without the cap the signer never learns half their reason went
                // nowhere. The OTP boxes below get no kind: they already filter to digits.
                maxLength={500}
                placeholder="Tell B2 Consultants why (optional)"
                className="w-full rounded-field border border-line-strong bg-surface px-3 py-2 text-body text-ink outline-none focus:border-primary focus:ring-2 focus:ring-primary-soft"
              />
              <div className="flex gap-2">
                <Btn variant="danger" size="sm" onClick={decline} busy={pending}>
                  Decline agreement
                </Btn>
                <Btn variant="ghost" size="sm" onClick={() => setDeclining(false)}>
                  Cancel
                </Btn>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ───────────────────────────── Pieces ─────────────────────────────

function Stepper({ current }: { current: Step }) {
  return (
    <ol className="flex items-center gap-2 border-b border-line px-5 py-3 sm:px-6">
      {STEPS.map((label, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li key={label} className="flex flex-1 items-center gap-2">
            <span
              aria-current={active ? "step" : undefined}
              className={`grid h-6 w-6 flex-none place-items-center rounded-full text-caption font-semibold ${
                done
                  ? "bg-good-soft text-good"
                  : active
                    ? "bg-primary text-on-accent"
                    : "bg-surface-2 text-faint"
              }`}
            >
              {done ? <CheckCircle2 size={14} /> : i + 1}
            </span>
            <span className={`text-caption ${active ? "font-semibold text-ink" : "text-faint"}`}>{label}</span>
            {i < STEPS.length - 1 && <span className="h-px flex-1 bg-line" />}
          </li>
        );
      })}
    </ol>
  );
}

function StepHeading({ icon, title, subtitle }: { icon: React.ReactNode; title: string; subtitle: string }) {
  return (
    <div className="flex gap-3">
      <span className="mt-0.5 grid h-9 w-9 flex-none place-items-center rounded-field bg-primary-soft text-primary">
        {icon}
      </span>
      <div>
        <h2 className="font-display text-h2 text-ink">{title}</h2>
        <p className="mt-1 text-body text-ink-2">{subtitle}</p>
      </div>
    </div>
  );
}

function ErrorNote({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="mt-4 rounded-field bg-bad-soft px-3 py-2 text-body-strong text-bad">
      {message}
    </p>
  );
}

/** Shows the signer what we are about to record. Disclosure, not decoration. */
function DeviceNote({ device }: { device: SigningDevice }) {
  return (
    <p className="mt-3 flex items-center gap-2 text-caption text-faint">
      <Smartphone size={13} className="flex-none" />
      {describeDevice(device)}
    </p>
  );
}

/**
 * Six boxes rather than one field. On a phone the numeric keypad and the one-time-code autofill
 * both behave, and a mistyped digit is obvious at a glance. Paste fills all six.
 */
function OtpInput({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  const refs = useRef<Array<HTMLInputElement | null>>([]);
  /**
   * The boxes are POSITIONAL and own their own state. Deriving them from the parent's compact
   * string would silently shuffle: clearing box 3 of "123456" joins to "12456", and box 4 would
   * inherit box 5's digit. The parent only ever sees the join, which is short - and therefore
   * correctly rejected - while any box is empty.
   */
  const [digits, setDigits] = useState<string[]>(() =>
    Array.from({ length: 6 }, (_, i) => value[i] ?? ""),
  );

  // The parent gets a code only when all six boxes are filled; a partial code is not a code.
  const write = (next: string[]) => {
    setDigits(next);
    onChange(next.every(Boolean) ? next.join("") : "");
  };

  return (
    <div
      className="flex gap-2"
      onPaste={(e) => {
        const text = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
        if (!text) return;
        e.preventDefault();
        write(Array.from({ length: 6 }, (_, i) => text[i] ?? ""));
        refs.current[Math.min(text.length, 5)]?.focus();
      }}
    >
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          value={d}
          inputMode="numeric"
          autoComplete={i === 0 ? "one-time-code" : "off"}
          maxLength={1}
          disabled={disabled}
          aria-label={`Digit ${i + 1} of 6`}
          onChange={(e) => {
            const ch = e.target.value.replace(/\D/g, "").slice(-1);
            if (!ch) return;
            const next = [...digits];
            next[i] = ch;
            write(next);
            refs.current[Math.min(i + 1, 5)]?.focus();
          }}
          onKeyDown={(e) => {
            if (e.key === "Backspace") {
              e.preventDefault();
              const next = [...digits];
              // Clear this box, or - when it is already empty - step back and clear that one.
              const target = d ? i : Math.max(0, i - 1);
              next[target] = "";
              write(next);
              refs.current[target]?.focus();
            }
            if (e.key === "ArrowLeft" && i > 0) refs.current[i - 1]?.focus();
            if (e.key === "ArrowRight" && i < 5) refs.current[i + 1]?.focus();
          }}
          className="h-14 w-11 rounded-field border border-line-strong bg-surface text-center font-mono text-h2 text-ink outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary-soft disabled:bg-surface-2 sm:w-12"
        />
      ))}
    </div>
  );
}

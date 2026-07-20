"use client";

import Link from "next/link";
import { useState } from "react";
import { Loader2, Mail } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { ThemeToggle } from "@/components/shell/ThemeToggle";
import { BrandLogo } from "@/components/shell/BrandLogo";
import { fieldKindProps } from "@/components/ui/field-base";

/**
 * Same two-pane shell as LoginForm (src/app/login/LoginForm.tsx) — same brand
 * panel, same field styling, same button treatment — just one field instead of
 * the sign-in/sign-up tab switcher.
 */

const fieldCls =
  "mt-1.5 w-full rounded-field border border-line-strong bg-surface px-3 py-2.5 text-sm text-ink outline-none transition-colors focus:border-primary";

export default function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  const emailField = fieldKindProps<HTMLInputElement>("email", (e) => setEmail(e.target.value));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await authClient.requestPasswordReset({
      email,
      redirectTo: "/reset-password",
    });
    setBusy(false);
    if (error) {
      setError(`Could not send the reset email: ${error.message ?? "server error"}`);
      return;
    }
    // Better Auth always returns success here, even for an email with no account,
    // so this form can never be used to check who has one.
    setSent(true);
  };

  return (
    <div className="flex min-h-screen items-stretch bg-surface">
      {/* brand panel — the one allowed gradient (hero-sky) */}
      <div className="hero-sky hidden flex-1 flex-col justify-between border-0 p-12 lg:flex">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <BrandLogo className="h-10 w-10 flex-none" />
            <span className="flex flex-col leading-tight">
              <span className="font-display text-[15px] font-bold text-ink">B2 Consultants</span>
              <span className="text-caption text-ink-2">Business cockpit</span>
            </span>
          </div>
          <ThemeToggle frosted />
        </div>

        <div className="max-w-md">
          <h1 className="font-display text-[34px] font-extrabold leading-[1.15] text-ink">
            Lost your password? No drama.
          </h1>
          <p className="mt-3.5 text-[15px] leading-relaxed text-ink-2">
            Tell us the email your account uses and we&apos;ll send a link to set a new one.
          </p>
        </div>

        <p className="text-caption text-ink-3">Internal tool · access by invitation</p>
      </div>

      {/* form pane */}
      <div className="flex min-w-0 flex-1 items-center justify-center overflow-y-auto px-6 py-10">
        <div className="w-full max-w-sm">
          {/* mobile brand row (brand panel is hidden below lg) */}
          <div className="mb-6 flex items-center justify-between lg:hidden">
            <div className="flex items-center gap-2.5">
              <BrandLogo className="h-9 w-9 flex-none" />
              <span className="flex flex-col leading-tight">
                <span className="font-display text-sm font-bold text-ink">B2 Consultants</span>
                <span className="text-caption text-ink-3">Business cockpit</span>
              </span>
            </div>
            <ThemeToggle />
          </div>

          <h2 className="font-display text-[23px] font-bold text-ink">Forgot password?</h2>
          <p className="mt-1 text-[13px] text-ink-2">
            Enter your work email and we&apos;ll send you a reset link.
          </p>

          {sent ? (
            <div className="mt-5 flex flex-col gap-4">
              <p role="status" className="rounded-field bg-good-soft px-3 py-2.5 text-xs font-medium text-good">
                If that email has an account, a reset link is on its way — check your inbox (and spam folder).
              </p>
              <Link
                href="/login"
                className="mt-1 inline-flex h-[46px] w-full items-center justify-center rounded-btn border border-line-strong text-[15px] font-semibold text-ink hover:bg-surface-2"
              >
                Back to sign in
              </Link>
            </div>
          ) : (
            <form onSubmit={submit} className="mt-5 flex flex-col gap-4">
              <label className="block text-xs font-semibold text-ink-2">
                Work email
                <input
                  {...emailField.attrs}
                  required
                  value={email}
                  onChange={emailField.onChange}
                  placeholder="you@b2consultants.in"
                  autoComplete="email"
                  autoFocus
                  className={fieldCls}
                />
              </label>

              {error && (
                <p role="alert" className="rounded-field bg-bad-soft px-3 py-2.5 text-xs font-medium text-bad">
                  ! {error}
                </p>
              )}

              <button
                type="submit"
                disabled={busy}
                className="mt-1 inline-flex h-[46px] w-full items-center justify-center gap-2 rounded-btn bg-primary text-[15px] font-semibold text-on-accent shadow-soft transition-colors hover:bg-primary-strong disabled:opacity-60"
              >
                {busy ? <Loader2 size={16} className="animate-spin" /> : <Mail size={15} />}
                {busy ? "Sending…" : "Send reset link"}
              </button>
            </form>
          )}

          <p className="mt-5 flex items-center justify-center gap-1.5 text-center text-[13px]">
            <span className="text-ink-3">Remembered it?</span>
            <Link href="/login" className="font-semibold text-primary-strong hover:underline">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}

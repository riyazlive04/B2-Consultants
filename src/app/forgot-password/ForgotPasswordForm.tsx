"use client";

import Link from "next/link";
import { useState } from "react";
import { Loader2, Mail } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { normalizeEmail } from "@/lib/credentials";
import { ThemeToggle } from "@/components/shell/ThemeToggle";
import { BrandLogo } from "@/components/shell/BrandLogo";
import { fieldKindProps } from "@/components/ui/field-base";

/**
 * Same two-pane shell as LoginForm (src/app/login/LoginForm.tsx) - same brand
 * panel, same field styling, same button treatment - just one field instead of
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
      // Folded exactly as the sign-in form folds it. `User.email` is a lowercase `@unique`
      // column, so a capitalised address here would quietly match no account - and Better Auth
      // reports success either way, so the person would wait for an email that was never sent.
      email: normalizeEmail(email),
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
    <div className="flex min-h-screen flex-col bg-surface">
      <div className="flex justify-end px-6 pt-5">
        <ThemeToggle />
      </div>

      <div className="flex flex-1 items-start justify-center overflow-y-auto px-6 pb-12 pt-4 sm:items-center sm:pt-0">
        <div className="w-full max-w-sm">
          <div className="mb-7 flex justify-center">
            <BrandLogo variant="full" className="h-[72px] flex-none" />
          </div>

          <h2 className="font-display text-[23px] font-bold text-ink">Forgot password?</h2>
          <p className="mt-1 text-[13px] text-ink-2">
            Enter the email your account uses and we&apos;ll send you a reset link.
          </p>

          {sent ? (
            <div className="mt-5 flex flex-col gap-4">
              <p role="status" className="rounded-field bg-good-soft px-3 py-2.5 text-xs font-medium text-good">
                If that email has an account, a reset link is on its way - check your inbox (and spam folder).
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
                Email
                <input
                  {...emailField.attrs}
                  required
                  value={email}
                  onChange={emailField.onChange}
                  placeholder="you@email.com"
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

          <p className="mt-6 text-center text-caption text-ink-3">
            No email after a few minutes? Ask your coach or your admin to resend your login.
          </p>
        </div>
      </div>
    </div>
  );
}

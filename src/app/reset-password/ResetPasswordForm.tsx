"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { KeyRound, Loader2 } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { ThemeToggle } from "@/components/shell/ThemeToggle";
import { BrandLogo } from "@/components/shell/BrandLogo";

/**
 * Same two-pane shell as LoginForm (src/app/login/LoginForm.tsx). `token` comes from
 * the page's `searchParams` (see page.tsx) — the query-string convention Better
 * Auth's own /reset-password/:token → callbackURL redirect uses.
 */

const fieldCls =
  "mt-1.5 w-full rounded-field border border-line-strong bg-surface px-3 py-2.5 text-sm text-ink outline-none transition-colors focus:border-primary";

export default function ResetPasswordForm({ token }: { token: string | null }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(
    token ? null : "This reset link is missing its token. Request a new one.",
  );
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    if (password !== confirm) {
      setError("The two passwords don't match");
      return;
    }
    setBusy(true);
    setError(null);
    const { error } = await authClient.resetPassword({ newPassword: password, token });
    setBusy(false);
    if (error) {
      // Better Auth reports an expired/consumed/unknown token as a 400.
      setError(
        error.status === 400
          ? "This reset link is invalid or has expired. Request a new one."
          : `Could not reset your password: ${error.message ?? "server error"}`,
      );
      return;
    }
    // resetPassword doesn't mint a session — send them to sign in with the new one.
    router.push("/login?reset=success");
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
            Set a new password.
          </h1>
          <p className="mt-3.5 text-[15px] leading-relaxed text-ink-2">
            Choose something you haven&apos;t used here before. You&apos;ll sign in with it right after.
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

          <h2 className="font-display text-[23px] font-bold text-ink">Choose a new password</h2>
          <p className="mt-1 text-[13px] text-ink-2">At least 8 characters.</p>

          {token ? (
            <form onSubmit={submit} className="mt-5 flex flex-col gap-4">
              <label className="block text-xs font-semibold text-ink-2">
                New password
                <input
                  type="password"
                  required
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="new-password"
                  autoFocus
                  className={fieldCls}
                />
              </label>

              <label className="block text-xs font-semibold text-ink-2">
                Confirm new password
                <input
                  type="password"
                  required
                  minLength={8}
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="new-password"
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
                {busy ? <Loader2 size={16} className="animate-spin" /> : <KeyRound size={15} />}
                {busy ? "Saving…" : "Set new password"}
              </button>
            </form>
          ) : (
            <div className="mt-5 flex flex-col gap-4">
              {error && (
                <p role="alert" className="rounded-field bg-bad-soft px-3 py-2.5 text-xs font-medium text-bad">
                  ! {error}
                </p>
              )}
              <Link
                href="/forgot-password"
                className="inline-flex h-[46px] w-full items-center justify-center rounded-btn bg-primary text-[15px] font-semibold text-on-accent shadow-soft hover:bg-primary-strong"
              >
                Request a new link
              </Link>
            </div>
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

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { KeyRound, Loader2 } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { normalizePassword } from "@/lib/credentials";
import { ThemeToggle } from "@/components/shell/ThemeToggle";
import { BrandLogo } from "@/components/shell/BrandLogo";

/**
 * Same two-pane shell as LoginForm (src/app/login/LoginForm.tsx). `token` comes from
 * the page's `searchParams` (see page.tsx) - the query-string convention Better
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
    /**
     * Trim BEFORE comparing and before storing.
     *
     * Setting a password is where a stray space does the most damage: it is baked into the
     * account, and the person can then never reproduce it - they type the visible characters
     * forever and are told they are wrong. Trimming here and at sign-in means the two agree.
     *
     * Comparing the TRIMMED values also stops the confirm field failing on an invisible
     * difference, which reads as "I typed the same thing twice and it says I didn't".
     */
    const next = normalizePassword(password);
    if (next !== normalizePassword(confirm)) {
      setError("The two passwords don't match");
      return;
    }
    if (next.length < 8) {
      setError("Your password must be at least 8 characters.");
      return;
    }
    setBusy(true);
    setError(null);
    const { error } = await authClient.resetPassword({ newPassword: next, token });
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
    // resetPassword doesn't mint a session - send them to sign in with the new one.
    router.push("/login?reset=success");
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

          <p className="mt-6 text-center text-caption text-ink-3">
            Your new password is known only to you.
          </p>
        </div>
      </div>
    </div>
  );
}

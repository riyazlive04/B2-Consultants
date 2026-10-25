"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { KeyRound, Loader2 } from "lucide-react";
import { ThemeToggle } from "@/components/shell/ThemeToggle";
import { BrandLogo } from "@/components/shell/BrandLogo";
import { changeOwnPassword } from "@/server/account-actions";
import { safeAction } from "@/lib/action-guard";

/**
 * Same two-pane shell as ResetPasswordForm - but this user IS signed in (with a password an admin
 * set), so it asks for the current password too and posts to a server action that changes it and
 * clears the forced-change flag in one step (O4).
 */

const fieldCls =
  "mt-1.5 w-full rounded-field border border-line-strong bg-surface px-3 py-2.5 text-sm text-ink outline-none transition-colors focus:border-primary";

export default function ChangePasswordForm() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    if (form.get("newPassword") !== form.get("confirm")) {
      setError("The two new passwords don't match.");
      return;
    }
    setBusy(true);
    setError(null);
    const res = await safeAction(() => changeOwnPassword(form));
    if (!res.ok) {
      setBusy(false);
      setError(res.error);
      return;
    }
    // Flag cleared server-side; the app is now reachable. Full navigation so the shell re-renders
    // with the guard satisfied rather than a client transition against a stale tree.
    router.push("/");
    router.refresh();
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

          <h2 className="font-display text-[23px] font-bold text-ink">Set your own password</h2>
          <p className="mt-1 text-[13px] text-ink-2">
            Enter the password you were given, then choose a new one. At least 8 characters.
          </p>

          <form onSubmit={submit} className="mt-5 flex flex-col gap-4">
            <label className="block text-xs font-semibold text-ink-2">
              Current password
              <input
                type="password"
                name="currentPassword"
                required
                autoComplete="current-password"
                autoFocus
                placeholder="••••••••"
                className={fieldCls}
              />
            </label>

            <label className="block text-xs font-semibold text-ink-2">
              New password
              <input
                type="password"
                name="newPassword"
                required
                minLength={8}
                autoComplete="new-password"
                placeholder="••••••••"
                className={fieldCls}
              />
            </label>

            <label className="block text-xs font-semibold text-ink-2">
              Confirm new password
              <input
                type="password"
                name="confirm"
                required
                minLength={8}
                autoComplete="new-password"
                placeholder="••••••••"
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
              {busy ? "Saving…" : "Set my password"}
            </button>
          </form>

          <p className="mt-6 text-center text-caption text-ink-3">
            Your new password is known only to you.
          </p>
        </div>
      </div>
    </div>
  );
}

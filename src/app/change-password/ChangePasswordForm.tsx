"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { KeyRound, Loader2 } from "lucide-react";
import { ThemeToggle } from "@/components/shell/ThemeToggle";
import { BrandLogo } from "@/components/shell/BrandLogo";
import { changeOwnPassword } from "@/server/account-actions";

/**
 * Same two-pane shell as ResetPasswordForm — but this user IS signed in (with a password an admin
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
    const res = await changeOwnPassword(form);
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
    <div className="flex min-h-screen items-stretch bg-surface">
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
            One quick step.
          </h1>
          <p className="mt-3.5 text-[15px] leading-relaxed text-ink-2">
            Your password was set for you. Choose your own now — only you will know it.
          </p>
        </div>

        <p className="text-caption text-ink-3">Internal tool · access by invitation</p>
      </div>

      <div className="flex min-w-0 flex-1 items-center justify-center overflow-y-auto px-6 py-10">
        <div className="w-full max-w-sm">
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
        </div>
      </div>
    </div>
  );
}

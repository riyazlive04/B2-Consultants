"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { KeyRound, Loader2, LogOut } from "lucide-react";
import { ThemeToggle } from "@/components/shell/ThemeToggle";
import { BrandLogo } from "@/components/shell/BrandLogo";
import { changeOwnPassword } from "@/server/account-actions";
import { safeAction } from "@/lib/action-guard";
import { authClient } from "@/lib/auth-client";
import { AGREEMENT_PROVIDER } from "@/lib/agreement";
import { MIN_PASSWORD_LENGTH, PASSWORD_HINT } from "@/lib/credentials";

/**
 * Same two-pane shell as ResetPasswordForm - but this user IS signed in (with a password an admin
 * set), so it asks for the current password too and posts to a server action that changes it and
 * clears the forced-change flag in one step (O4).
 *
 * ── WHY THERE IS A SIGN-OUT ON THIS SCREEN (issue A1) ───────────────────────────────────
 * This is the only page in the app that can be reached and not left. `requireSession` bounces
 * EVERY app route here while `mustChangePassword` is set, and this page sits under
 * `PublicLayout` rather than `AppShell` - which is where the app's only `signOut()` call lives.
 * So somebody who cannot complete the form had no exit at all:
 *
 *   · signed into the wrong account (temp passwords arrive on WhatsApp and get pasted on
 *     shared phones, so this is the common case, not the exotic one)
 *   · no longer holds the temporary password they were sent
 *   · the new password keeps being refused and they want to start over
 *
 * Their only recourse was clearing browser cookies, which nobody in this user base will do.
 * The sign-out below is therefore not a convenience: it is the escape hatch that stops a
 * guard from becoming a trap. The support line beside it is the second one, for the person who
 * cannot get back in at all once they have signed out.
 */

const fieldCls =
  "mt-1.5 w-full rounded-field border border-line-strong bg-surface px-3 py-2.5 text-sm text-ink outline-none transition-colors focus:border-primary";

export default function ChangePasswordForm() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Leave without changing it. `mustChangePassword` stays set on the user row - this abandons the
   * SESSION, not the requirement - so signing back in lands here again, which is correct: the
   * admin's instruction has not been satisfied.
   *
   * A hard `location.assign` rather than `router.push`: the session cookie is gone after
   * `signOut`, and a client transition would render the login screen against a tree built for a
   * signed-in user. Navigating properly also means a failed sign-out still ends up at the door
   * instead of silently doing nothing.
   */
  const signOut = async () => {
    setLeaving(true);
    setError(null);
    try {
      await authClient.signOut();
    } catch {
      // Best effort. Either way we leave: a stuck sign-out must not re-trap the person.
    }
    window.location.assign("/login");
  };

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
            Enter the password you were given, then choose a new one. {PASSWORD_HINT}
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
                minLength={MIN_PASSWORD_LENGTH}
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
                minLength={MIN_PASSWORD_LENGTH}
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
              disabled={busy || leaving}
              className="mt-1 inline-flex h-[46px] w-full items-center justify-center gap-2 rounded-btn bg-primary text-[15px] font-semibold text-on-accent shadow-soft transition-colors hover:bg-primary-strong disabled:opacity-60"
            >
              {busy ? <Loader2 size={16} className="animate-spin" /> : <KeyRound size={15} />}
              {busy ? "Saving…" : "Set my password"}
            </button>
          </form>

          {/* THE EXIT. See the note at the top of this file - without it this screen is a trap. */}
          <button
            type="button"
            onClick={signOut}
            disabled={busy || leaving}
            className="mt-3 inline-flex h-10 w-full items-center justify-center gap-2 rounded-btn border border-line text-[13px] font-semibold text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-60"
          >
            {leaving ? <Loader2 size={14} className="animate-spin" /> : <LogOut size={14} />}
            {leaving ? "Signing out…" : "Sign in as someone else"}
          </button>

          <p className="mt-6 text-center text-caption text-ink-3">
            Your new password is known only to you.
          </p>
          {/* The second escape hatch: for the person who cannot complete this AND cannot get
              back in. Spelling out the channels means "contact your admin" is actionable. */}
          <p className="mt-2 text-center text-caption text-ink-3">
            Stuck? Email{" "}
            <a href={`mailto:${AGREEMENT_PROVIDER.email}`} className="font-semibold text-primary-strong hover:underline">
              {AGREEMENT_PROVIDER.email}
            </a>{" "}
            or WhatsApp {AGREEMENT_PROVIDER.mobile}.
          </p>
        </div>
      </div>
    </div>
  );
}

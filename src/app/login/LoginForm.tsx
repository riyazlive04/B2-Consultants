"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { BookUser, Check, Eye, EyeOff, GraduationCap, Loader2, Lock, Phone, ShieldCheck, Users } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { normalizeEmail, normalizePassword, passwordWasTrimmed } from "@/lib/credentials";
import { ThemeToggle } from "@/components/shell/ThemeToggle";
import { BrandLogo } from "@/components/shell/BrandLogo";
import { fieldKindProps } from "@/components/ui/field-base";
import { submitAccessRequest } from "@/server/access-requests";
import { safeAction } from "@/lib/action-guard";

/**
 * Auth screen from the design file: brand panel on the sky gradient, form pane
 * with a Sign in / Sign up toggle. Sign-up doesn't create an account - it files
 * an access request the Admin approves in People → Users & access.
 */

type Mode = "login" | "signup";
type ReqRole = "HEAD" | "USER" | "TUTOR" | "STUDENT" | "COACH";

/**
 * The access a stranger may ASK for.
 *
 * "Founder / Admin" is deliberately absent. It used to be the first option on this list, which
 * meant anyone who found the login page could request full finance, compliance and all-teams
 * access - and the request landed in the same approval queue as a telecaller's, where one
 * mis-click grants it. An admin seat is created BY an admin, from People → Users & access; there
 * is no legitimate case for requesting one from a public form.
 *
 * Removing it here is only half the fix - `submitAccessRequest`'s own enum is the real gate,
 * since a crafted POST never runs this file. Both were narrowed together.
 *
 * Tutor and Student are new. Both roles already existed, already had working dashboards
 * (`/german-note`, `/my-journey`) and were already redirected there on sign-in - they simply had
 * no way to say who they were on the one screen that asks.
 */
const REQUEST_ROLES: { id: ReqRole; label: string; desc: string; icon: typeof ShieldCheck }[] = [
  { id: "HEAD", label: "Head coach", desc: "Delivery, students, pipeline & team", icon: Users },
  { id: "USER", label: "Telecaller", desc: "Telecaller board & daily log", icon: Phone },
  { id: "COACH", label: "Coach", desc: "Your coaching batches & students", icon: Users },
  { id: "TUTOR", label: "German Note tutor", desc: "Your batches, sessions & community", icon: GraduationCap },
  { id: "STUDENT", label: "Student", desc: "Your own journey, classroom & agreement", icon: BookUser },
];

const fieldCls =
  "mt-1.5 w-full rounded-field border border-line-strong bg-surface px-3 py-2.5 text-sm text-ink outline-none transition-colors focus:border-primary";

/**
 * Which door someone came in through.
 *
 * ── Why a variant and not a second auth screen ──────────────────────────────────
 * Tutors and students already had working logins, working roles and working dashboards - the
 * root page has redirected `TUTOR → /german-note` and `STUDENT → /my-journey` all along. What
 * was missing was any SIGN that this page was for them: the brand panel read "Business cockpit ·
 * internal tool · access by invitation" and the sign-up picker offered Admin/Head/Telecaller only.
 *
 * So `/portal` and `/tutor` render THIS component with different copy, not a second login
 * screen. One auth path, one set of guards, one place a credential bug can live. A second
 * implementation would be a second thing to keep secure for the sake of a heading.
 *
 * The `team` variant is NOT the team's variant any more - it is the SHARED door. `/login` is
 * where middleware bounces every unauthenticated request and where `sendLoginCredentials` points
 * a brand-new team, tutor or coach account, so its copy has to be true for all of them. The
 * business pitch that used to live here ("one cockpit for the whole business", "ledger-backed
 * numbers", "live speed-to-lead") was the first thing a student read on the screen they were
 * emailed. Role-specific copy belongs on the role doors below, which are opt-in.
 *
 * ── No brand panel ──────────────────────────────────────────────────────────────
 * There used to be a half-screen gradient pane carrying a headline, a paragraph and two chips.
 * It is gone: on a screen whose whole job is two fields, it was a half-page of marketing that
 * had to be re-written for every audience and got it wrong for most of them. What remains is
 * the lockup, the form, and nothing to maintain per role.
 */
export type LoginVariant = "team" | "student" | "tutor" | "coach";

const VARIANTS: Record<LoginVariant, {
  heading: string;
  blurb: string;
  /** Students are provisioned from a Student record - they cannot request a seat here. */
  allowSignup: boolean;
  next: string;
  /** Optional closing line. Omitted where the heading or the sign-up line already says it. */
  footnote?: string;
}> = {
  team: {
    heading: "Welcome back",
    blurb: "Sign in and you land on your own dashboard.",
    allowSignup: true,
    next: "/",
    // The one place the shared door still has to say who it is for: its heading cannot,
    // because it greets everybody.
    footnote: "One sign-in for students, tutors, coaches & team",
  },
  student: {
    heading: "Student portal",
    blurb: "Sign in to see your own journey, classroom and agreement.",
    // A student login is created FROM their student record by an admin (see portal-actions);
    // offering a request form here would collect requests nobody can action.
    allowSignup: false,
    next: "/my-journey",
  },
  coach: {
    heading: "Coach sign-in",
    blurb: "Sign in to the batches and students you coach.",
    allowSignup: true,
    next: "/coaching",
  },
  tutor: {
    heading: "Tutor sign-in",
    blurb: "Sign in to your German Note batches and community.",
    allowSignup: true,
    next: "/german-note",
  },
};

export default function LoginForm({ variant = "team" }: { variant?: LoginVariant } = {}) {
  const v = VARIANTS[variant];
  const router = useRouter();
  // requireSession() bounces a suspended account here rather than leaving them
  // staring at a login form that silently refuses them.
  const searchParams = useSearchParams();
  const suspended = searchParams.get("error") === "suspended";
  // ResetPasswordForm sends people back here (never auto-signed-in - resetting a
  // password doesn't mint a session) with this flag so they know it worked.
  const resetDone = searchParams.get("reset") === "success";
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [reqRole, setReqRole] = useState<ReqRole>("USER");
  const [error, setError] = useState<string | null>(
    suspended ? "This account has been suspended. Contact your admin." : null,
  );
  const [info, setInfo] = useState<string | null>(
    resetDone ? "Password updated - sign in with your new password." : null,
  );
  const [busy, setBusy] = useState(false);

  // Character rules for the sign-up fields (see lib/field-rules). The password below deliberately
  // gets none - a password must accept every character it was typed with.
  const nameField = fieldKindProps<HTMLInputElement>("name", (e) => setName(e.target.value));
  const emailField = fieldKindProps<HTMLInputElement>("email", (e) => setEmail(e.target.value));
  const noteField = fieldKindProps<HTMLTextAreaElement>("text", (e) => setNote(e.target.value));

  const switchMode = (m: Mode) => {
    setMode(m);
    setError(null);
    setInfo(null);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setInfo(null);

    /**
     * Normalise BOTH credentials before they leave the browser.
     *
     * The email input already strips whitespace as you type (`field-rules.filterEmail`), but
     * nothing lower-cased it and nothing touched a pasted value's invisible characters; the
     * password was never cleaned at all. Both are pasted out of WhatsApp or email by almost every
     * user of this app, and both routinely arrive with a trailing space that the field cannot
     * show them. The result was a "Invalid email or password." for a password that was correct.
     */
    const cleanEmail = normalizeEmail(email);
    const cleanPassword = normalizePassword(password);
    const trimmed = passwordWasTrimmed(password);

    if (mode === "signup") {
      const res = await safeAction(() => submitAccessRequest({ name, email: cleanEmail, role: reqRole, note }));
      setBusy(false);
      if (!res.ok) return setError(res.error);
      setMode("login");
      setName("");
      setNote("");
      setInfo("Access request sent - your admin will set up your account and share the login.");
      return;
    }

    const { error } = await authClient.signIn.email({ email: cleanEmail, password: cleanPassword });
    if (error) {
      // Only credential failures read as "invalid"; anything else (origin/config)
      // surfaces its real message so it can't masquerade as a wrong password.
      setError(
        error.status === 401
          ? // Say that we trimmed. A password that genuinely ends in a space is vanishingly
            // unlikely here (every one is admin-set or invite-chosen), but if someone has one,
            // this is the only sentence that tells them why they cannot get in.
            `Invalid email or password.${trimmed ? " We removed a stray space from the end of your password - if your password really ends in one, contact your admin." : ""}`
          : `Sign-in failed: ${error.message ?? "server error"}`,
      );
      setBusy(false);
      return;
    }
    /**
     * Honour `?next=` so the student and tutor entry points can land people on their own
     * dashboard. Same-origin PATHS only - an absolute URL here would turn the login screen into
     * an open redirect, which is a phishing primitive, not a convenience.
     */
    const next = searchParams.get("next");
    router.push(next && next.startsWith("/") && !next.startsWith("//") ? next : v.next);
    router.refresh();
  };

  const isSignup = mode === "signup";
  const tabCls = (m: Mode) =>
    `flex-1 rounded-[9px] py-2 text-[13px] font-semibold transition-colors ${
      mode === m ? "bg-surface text-primary-strong shadow-card" : "text-ink-3 hover:text-ink-2"
    }`;

  return (
    <div className="flex min-h-screen flex-col bg-surface">
      <div className="flex justify-end px-6 pt-5">
        <ThemeToggle />
      </div>

      <div className="flex flex-1 items-start justify-center overflow-y-auto px-6 pb-12 pt-4 sm:items-center sm:pt-0">
        <div className="w-full max-w-sm">
          {/* The FULL lockup, not the bracketed mark. The mark omits "CONSULTANTS" because it
              was designed to sit beside an HTML wordmark that said it instead; standing alone
              and centred, it just reads as a logo with its bottom cropped off. */}
          <div className="mb-7 flex justify-center">
            <BrandLogo variant="full" className="h-[72px] flex-none" />
          </div>

          {/* Hidden on the student portal: a student login is created FROM their student
              record by an admin, so a request form here would collect requests nobody can act on. */}
          {v.allowSignup && (
            <div className="mb-6 flex gap-1 rounded-btn border border-line bg-surface-2 p-1">
              <button type="button" onClick={() => switchMode("login")} className={tabCls("login")}>
                Sign in
              </button>
              <button type="button" onClick={() => switchMode("signup")} className={tabCls("signup")}>
                Sign up
              </button>
            </div>
          )}

          <h2 className="font-display text-[23px] font-bold text-ink">
            {isSignup ? "Request access" : v.heading}
          </h2>
          <p className="mt-1 text-[13px] text-ink-2">
            {isSignup ? "New accounts are approved by your admin. Tell us who you are." : v.blurb}
          </p>

          <form onSubmit={submit} className="mt-5 flex flex-col gap-4">
            {isSignup && (
              <div>
                <p className="text-label mb-2.5 mt-1 !text-caption font-semibold text-ink-3">
                  Access you need
                </p>
                <div className="flex flex-col gap-2">
                  {REQUEST_ROLES.map((r) => {
                    const active = reqRole === r.id;
                    const Icon = r.icon;
                    return (
                      <button
                        key={r.id}
                        type="button"
                        onClick={() => setReqRole(r.id)}
                        className={`flex w-full items-center gap-3 rounded-btn border p-3 text-left transition-colors ${
                          active
                            ? "border-primary bg-primary-soft"
                            : "border-line bg-surface hover:bg-surface-2"
                        }`}
                        style={active ? { borderWidth: 1.5 } : undefined}
                      >
                        <span
                          className={`grid h-[34px] w-[34px] flex-none place-items-center rounded-[9px] ${
                            active ? "bg-primary text-on-accent" : "bg-surface-2 text-ink-3"
                          }`}
                        >
                          <Icon size={18} strokeWidth={1.8} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-[13px] font-semibold text-ink">{r.label}</span>
                          <span className="mt-px block text-caption text-ink-3">{r.desc}</span>
                        </span>
                        {active && <Check size={18} strokeWidth={2.4} className="flex-none text-primary" />}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {isSignup && (
              <label className="block text-xs font-semibold text-ink-2">
                Full name
                <input
                  {...nameField.attrs}
                  required
                  value={name}
                  onChange={nameField.onChange}
                  placeholder="e.g. Sana Kapoor"
                  autoComplete="name"
                  className={fieldCls}
                />
              </label>
            )}

            {/* Not "Work email", and not a @b2consultants.in placeholder: a student or a tutor
                signs in with their personal address, and a label that calls it a work email is a
                label telling them they are on the wrong screen. */}
            <label className="block text-xs font-semibold text-ink-2">
              Email
              <input
                {...emailField.attrs}
                required
                value={email}
                onChange={emailField.onChange}
                placeholder="you@email.com"
                autoComplete="email"
                className={fieldCls}
              />
            </label>

            {!isSignup && (
              <label className="block text-xs font-semibold text-ink-2">
                <span className="flex items-center justify-between gap-2">
                  Password
                  <Link href="/forgot-password" className="font-semibold text-primary-strong hover:underline">
                    Forgot password?
                  </Link>
                </span>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    autoComplete="current-password"
                    className={`${fieldCls} pr-11`}
                  />
                  {/* Show/hide toggle - reveal what you're typing before signing in. */}
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    aria-pressed={showPassword}
                    title={showPassword ? "Hide password" : "Show password"}
                    className="absolute right-1.5 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-field text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink"
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </label>
            )}

            {isSignup && (
              <label className="block text-xs font-semibold text-ink-2">
                Why you need access <span className="font-normal text-ink-3">(optional)</span>
                <textarea
                  {...noteField.attrs}
                  /* 500, not the kind's 2000 cap: submitAccessRequest rejects anything longer,
                     and it reports that as "enter a valid email" - a dead end for the typist. */
                  maxLength={500}
                  value={note}
                  onChange={noteField.onChange}
                  placeholder="e.g. New telecaller, need the board & daily log…"
                  className={`${fieldCls} min-h-[60px] resize-y`}
                />
              </label>
            )}

            {error && (
              <p role="alert" className="rounded-field bg-bad-soft px-3 py-2.5 text-xs font-medium text-bad">
                ! {error}
              </p>
            )}
            {info && (
              <p role="status" className="rounded-field bg-good-soft px-3 py-2.5 text-xs font-medium text-good">
                {info}
              </p>
            )}

            <button
              type="submit"
              disabled={busy}
              className="mt-1 inline-flex h-[46px] w-full items-center justify-center gap-2 rounded-btn bg-primary text-[15px] font-semibold text-on-accent shadow-soft transition-colors hover:bg-primary-strong disabled:opacity-60"
            >
              {busy ? <Loader2 size={16} className="animate-spin" /> : <Lock size={15} />}
              {busy
                ? isSignup
                  ? "Sending…"
                  : "Signing in…"
                : isSignup
                  ? "Send request to admin"
                  : "Sign in"}
            </button>
          </form>

          {v.allowSignup ? (
            <p className="mt-5 flex items-center justify-center gap-1.5 text-center text-[13px]">
              <span className="text-ink-3">
                {isSignup ? "Already have an account?" : "Need access?"}
              </span>
              <button
                type="button"
                onClick={() => switchMode(isSignup ? "login" : "signup")}
                className="font-semibold text-primary-strong hover:underline"
              >
                {isSignup ? "Sign in" : "Request access"}
              </button>
            </p>
          ) : (
            <p className="mt-5 text-center text-[13px] text-ink-3">
              No login yet? Your coach sets one up from your student record - ask them.
            </p>
          )}

          {v.footnote && !isSignup && (
            <p className="mt-6 text-center text-caption text-ink-3">{v.footnote}</p>
          )}
        </div>
      </div>
    </div>
  );
}

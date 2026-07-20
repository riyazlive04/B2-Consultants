"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Check, Eye, EyeOff, Loader2, Lock, Phone, ShieldCheck, Users } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { ThemeToggle } from "@/components/shell/ThemeToggle";
import { BrandLogo } from "@/components/shell/BrandLogo";
import { fieldKindProps } from "@/components/ui/field-base";
import { submitAccessRequest } from "@/server/access-requests";

/**
 * Auth screen from the design file: brand panel on the sky gradient, form pane
 * with a Sign in / Sign up toggle. Sign-up doesn't create an account — it files
 * an access request the Admin approves in People → Users & access.
 */

type Mode = "login" | "signup";
type ReqRole = "ADMIN" | "HEAD" | "USER";

const REQUEST_ROLES: { id: ReqRole; label: string; desc: string; icon: typeof ShieldCheck }[] = [
  { id: "ADMIN", label: "Founder / Admin", desc: "Full access — finance, compliance, all teams", icon: ShieldCheck },
  { id: "HEAD", label: "Head coach", desc: "Delivery, students, pipeline & team", icon: Users },
  { id: "USER", label: "Telecaller", desc: "Telecaller board & daily log", icon: Phone },
];

const fieldCls =
  "mt-1.5 w-full rounded-field border border-line-strong bg-surface px-3 py-2.5 text-sm text-ink outline-none transition-colors focus:border-primary";

export default function LoginForm() {
  const router = useRouter();
  // requireSession() bounces a suspended account here rather than leaving them
  // staring at a login form that silently refuses them.
  const searchParams = useSearchParams();
  const suspended = searchParams.get("error") === "suspended";
  // ResetPasswordForm sends people back here (never auto-signed-in — resetting a
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
    resetDone ? "Password updated — sign in with your new password." : null,
  );
  const [busy, setBusy] = useState(false);

  // Character rules for the sign-up fields (see lib/field-rules). The password below deliberately
  // gets none — a password must accept every character it was typed with.
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

    if (mode === "signup") {
      const res = await submitAccessRequest({ name, email, role: reqRole, note });
      setBusy(false);
      if (!res.ok) return setError(res.error);
      setMode("login");
      setName("");
      setNote("");
      setInfo("Access request sent — your admin will set up your account and share the login.");
      return;
    }

    const { error } = await authClient.signIn.email({ email, password });
    if (error) {
      // Only credential failures read as "invalid"; anything else (origin/config)
      // surfaces its real message so it can't masquerade as a wrong password.
      setError(
        error.status === 401
          ? "Invalid email or password."
          : `Sign-in failed: ${error.message ?? "server error"}`,
      );
      setBusy(false);
      return;
    }
    router.push("/");
    router.refresh();
  };

  const isSignup = mode === "signup";
  const tabCls = (m: Mode) =>
    `flex-1 rounded-[9px] py-2 text-[13px] font-semibold transition-colors ${
      mode === m ? "bg-surface text-primary-strong shadow-card" : "text-ink-3 hover:text-ink-2"
    }`;

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
            One cockpit for the whole business.
          </h1>
          <p className="mt-3.5 text-[15px] leading-relaxed text-ink-2">
            Finance, pipeline, students and team — every number traced to a balanced ledger. Sign
            in with the role that matches your seat.
          </p>
          <div className="mt-6 flex flex-wrap gap-2">
            <span className="rounded-full bg-[var(--bg-frost)] px-3.5 py-1.5 text-xs font-semibold text-good">
              Ledger-backed numbers
            </span>
            <span className="rounded-full bg-[var(--bg-frost)] px-3.5 py-1.5 text-xs font-semibold text-primary-strong">
              Live speed-to-lead
            </span>
          </div>
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

          <div className="mb-6 flex gap-1 rounded-btn border border-line bg-surface-2 p-1">
            <button type="button" onClick={() => switchMode("login")} className={tabCls("login")}>
              Sign in
            </button>
            <button type="button" onClick={() => switchMode("signup")} className={tabCls("signup")}>
              Sign up
            </button>
          </div>

          <h2 className="font-display text-[23px] font-bold text-ink">
            {isSignup ? "Request access" : "Welcome back"}
          </h2>
          <p className="mt-1 text-[13px] text-ink-2">
            {isSignup
              ? "New accounts are approved by your admin. Tell us who you are."
              : "Sign in to your B2 Consultants workspace."}
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

            <label className="block text-xs font-semibold text-ink-2">
              Work email
              <input
                {...emailField.attrs}
                required
                value={email}
                onChange={emailField.onChange}
                placeholder="you@b2consultants.in"
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
                  {/* Show/hide toggle — reveal what you're typing before signing in. */}
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
                     and it reports that as "enter a valid email" — a dead end for the typist. */
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
        </div>
      </div>
    </div>
  );
}

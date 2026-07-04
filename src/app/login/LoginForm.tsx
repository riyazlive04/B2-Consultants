"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2, Lock } from "lucide-react";
import { authClient } from "@/lib/auth-client";

export default function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
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

  const fieldCls =
    "mt-1.5 w-full rounded-field border border-line bg-surface-2 px-3 py-2.5 text-sm outline-none transition-colors focus:border-accent focus:bg-surface";

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <span className="glow-accent grid h-14 w-14 place-items-center rounded-2xl bg-accent text-lg font-bold text-white">
            B2
          </span>
          <p className="mt-3 text-sm font-semibold text-ink">B2 Consultants</p>
          <p className="text-xs text-muted">Founder Dashboard</p>
        </div>
        <form onSubmit={submit} className="rise-in rounded-card border border-line bg-surface p-6 shadow-card">
          <label className="block text-sm font-medium">
            Email
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={fieldCls}
            />
          </label>
          <label className="mt-4 block text-sm font-medium">
            Password
            <input
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={fieldCls}
            />
          </label>
          {error && (
            <p className="mt-3 rounded-field bg-risk-soft px-3 py-2 text-sm font-medium text-risk">{error}</p>
          )}
          <button
            type="submit"
            disabled={busy}
            className="glow-accent mt-5 inline-flex w-full items-center justify-center gap-2 rounded-field bg-accent px-4 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-95 disabled:opacity-60"
          >
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Lock size={15} />}
            {busy ? "Signing in…" : "Sign in"}
          </button>
          <p className="mt-4 flex items-center justify-center gap-1.5 text-center text-xs text-muted">
            <Lock size={12} /> Private tool. Accounts are created by the Admin.
          </p>
        </form>
      </div>
    </div>
  );
}

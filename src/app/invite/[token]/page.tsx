import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { inspectInvite } from "@/server/invite-actions";
import { AcceptInviteForm } from "./AcceptInviteForm";

export const dynamic = "force-dynamic";

/**
 * Redeem an invite. Public (the invitee has no session yet) — the token in the URL is
 * the whole credential, and it is single-use. Someone who is already signed in has no
 * business here, so they go home.
 */

const REASONS: Record<string, { title: string; body: string }> = {
  invalid: {
    title: "This invite link isn't valid",
    body: "It may have been replaced by a newer invite. Ask whoever invited you to send a fresh link.",
  },
  used: {
    title: "This invite has already been used",
    body: "Your password is set — sign in with it. If that wasn't you, tell your admin straight away.",
  },
  expired: {
    title: "This invite has expired",
    body: "Invite links are good for a few days. Ask whoever invited you to send a new one.",
  },
  suspended: {
    title: "This account is suspended",
    body: "Your admin has suspended this account. Get in touch with them.",
  },
};

export default async function InvitePage({ params }: { params: { token: string } }) {
  const session = await auth.api.getSession({ headers: await Promise.resolve(headers()) });
  if (session) redirect("/");

  const invite = await inspectInvite(params.token);

  if (!invite.ok) {
    const { title, body } = REASONS[invite.reason];
    return (
      <Shell>
        <h1 className="font-display text-2xl font-bold tracking-tight">{title}</h1>
        <p className="mt-2 text-sm text-muted">{body}</p>
        <Link
          href="/login"
          className="mt-6 inline-flex h-10 items-center rounded-btn bg-primary px-4 text-sm font-semibold text-on-accent hover:bg-primary-strong"
        >
          Go to sign in
        </Link>
      </Shell>
    );
  }

  return (
    <Shell>
      <h1 className="font-display text-2xl font-bold tracking-tight">Welcome, {invite.name.split(" ")[0]}</h1>
      <p className="mt-2 text-sm text-muted">
        Set a password for <b className="text-ink">{invite.email}</b> and you&apos;re in. Nobody else — not
        even your admin — will ever see it.
      </p>
      <div className="mt-6">
        <AcceptInviteForm token={params.token} />
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="grid min-h-screen place-items-center bg-canvas px-4">
      <div className="w-full max-w-md rounded-card border border-line bg-surface p-8 shadow-card">
        <span className="mb-6 grid h-11 w-11 place-items-center rounded-btn bg-primary text-sm font-bold text-on-accent">
          B2
        </span>
        {children}
      </div>
    </main>
  );
}

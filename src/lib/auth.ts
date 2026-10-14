import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { prisma } from "./prisma";
import { brandEmailHeader, getEmailRuntime, sendResendEmail } from "./email";

/**
 * Base URL resolution: explicit BETTER_AUTH_URL wins; on Vercel fall back to the
 * platform-provided domains so sign-in works without extra configuration
 * (otherwise better-auth rejects the browser's origin → "Invalid origin").
 */
const baseURL =
  process.env.BETTER_AUTH_URL ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : undefined) ||
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined);

// Preview deployments get a unique *.vercel.app URL per deploy - trust it too.
// EXTRA_TRUSTED_ORIGINS (comma-separated) lets a temporary tunnel (e.g. ngrok) sign in
// WITHOUT repointing BETTER_AUTH_URL - so emailed/booking/agreement links keep using the
// real base URL. Leave it unset in production; it only widens the sign-in origin allow-list.
/**
 * Local development is trusted on ANY port, automatically.
 *
 * `BETTER_AUTH_URL` names one origin, and better-auth rejects every other - so running the dev
 * server on 3001 because 3000 was busy produced "Sign-in failed: Invalid origin", which reads
 * like a broken password rather than a config mismatch and sends you looking at the user table.
 * The ports below are what `next dev` actually walks through when one is taken.
 *
 * Gated on NODE_ENV, so this widens nothing in production.
 */
const devOrigins =
  process.env.NODE_ENV === "production"
    ? []
    : [3000, 3001, 3002, 3003].flatMap((p) => [`http://localhost:${p}`, `http://127.0.0.1:${p}`]);

/**
 * The deployed hostname, from the same variable the compose file and Caddy already require.
 *
 * Belt and braces with `baseURL`: those two are set in one file and WILL drift, and when they do
 * the symptom is that nobody can sign in to production. Trusting APP_DOMAIN as well means a
 * stale BETTER_AUTH_URL breaks emailed links - annoying, visible, fixable - instead of the front
 * door.
 */
const appDomainOrigin = process.env.APP_DOMAIN ? `https://${process.env.APP_DOMAIN.trim()}` : null;

const trustedOrigins = [
  process.env.VERCEL_PROJECT_PRODUCTION_URL && `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`,
  process.env.VERCEL_URL && `https://${process.env.VERCEL_URL}`,
  appDomainOrigin,
  ...devOrigins,
  ...(process.env.EXTRA_TRUSTED_ORIGINS?.split(",").map((o) => o.trim()) ?? []),
].filter((o): o is string => Boolean(o));

/**
 * Reset-password email body. Kept in this file (not messaging.ts) because this is a
 * system/account email to a User, not a CRM message to a Lead - messaging.ts's
 * sendEmailMessage() writes an append-only Message row keyed to a Lead, which doesn't
 * fit an auth event. It still goes through the exact same low-level send path
 * (getEmailRuntime + sendResendEmail from lib/email.ts) everything else uses.
 */
function resetPasswordEmailHtml(name: string, url: string): string {
  const first = (name || "").trim().split(/\s+/)[0] || "there";
  return `<div style="font-family:Inter,Arial,sans-serif;font-size:14px;color:#16203A;line-height:1.6">
    ${brandEmailHeader()}
    <p>Hi ${first},</p>
    <p>Someone asked to reset the password on your B2 Consultants account. If that was you, set a new one here - this link works once and expires in an hour:</p>
    <p><a href="${url}" style="color:#003C8C">Reset your password</a></p>
    <p>If you didn't request this, you can ignore this email - your password hasn't changed.</p>
  </div>`;
}

/**
 * Better Auth - email + password only, private app.
 * Public sign-up is DISABLED: Admin provisions accounts (seed script / admin tooling).
 * `role` lives on the user record (ADMIN | HEAD | USER) and is never user-editable.
 */
export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL,
  trustedOrigins,
  emailAndPassword: {
    enabled: true,
    disableSignUp: true,
    /**
     * Password RESET only - sign-up stays disabled above.
     *
     * ── Silence is not "failing closed" here ────────────────────────────────────
     * This used to `return` when email was switched off, described as failing closed
     * like every other email path. The difference is that every other email path is
     * something the APP decided to send; this one is something a locked-out person
     * ASKED for and is now waiting on. The form told them "a reset link is on its
     * way", nothing was attempted, and nothing anywhere recorded that they had tried -
     * this path calls `sendResendEmail` directly rather than the logged
     * `sendEmailMessage` seam, so it misses the delivery-health tally too.
     *
     * So it now throws. Better Auth turns that into an error on the response, the form
     * already renders it ("Could not send the reset email: …"), and the person learns
     * immediately to contact someone instead of watching an empty inbox.
     *
     * This does NOT leak whether an address exists: better-auth only reaches this
     * callback for a user that was found, but it answers the endpoint generically in
     * both cases, and the failure below is about OUR configuration, not about them -
     * an unknown address still gets the generic success.
     */
    sendResetPassword: async ({ user, url }) => {
      const rt = await getEmailRuntime();
      if (!rt.enabled) {
        const why = !rt.envEnabled
          ? "EMAIL_ENABLED is not set"
          : rt.paused
            ? "email sending is paused in settings"
            : "Resend is not configured (API key or from-address missing)";
        console.error(`[auth] password reset not sent - ${why}`);
        throw new Error("Password reset email is not available right now - contact B2 Consultants.");
      }
      const from = rt.fromName ? `${rt.fromName} <${rt.fromEmail}>` : rt.fromEmail;
      const res = await sendResendEmail({
        apiKey: rt.apiKey!,
        from,
        to: user.email,
        subject: "Reset your B2 Consultants password",
        html: resetPasswordEmailHtml(user.name, url),
      });
      // `sendResendEmail` resolves a result rather than throwing, so an accepted-looking
      // call that Resend actually rejected would otherwise read as success here too.
      if (!res.ok) {
        console.error(`[auth] password reset rejected by Resend - ${res.error ?? "unknown error"}`);
        throw new Error("Could not send the reset email - please contact B2 Consultants.");
      }
    },
  },
  user: {
    additionalFields: {
      role: {
        type: "string",
        defaultValue: "USER",
        input: false, // cannot be set from the client, ever
      },
      // What requireSession() guards on. getSession already loads the whole user row (session
      // join), so declaring these hands them back from that same query instead of a second
      // user.findUnique on every page - one fewer database round trip per request. All are
      // server-owned: input:false, so no auth endpoint can write them.
      sectionAccess: { type: "json", required: false, input: false },
      capabilities: { type: "json", required: false, input: false },
      status: { type: "string", required: false, input: false },
      themePreference: { type: "string", required: false, input: false },
      mustChangePassword: { type: "boolean", required: false, input: false },
    },
  },
  // NO session.cookieCache: it serialises the whole user (incl. data-URL avatars,
  // which can be >11KB) into a session_data cookie and overflows Node's 16KB
  // header limit → HTTP 431 on every request after login. requireSession() is
  // React.cache'd per request and already queries the DB for sectionAccess, so
  // the cookie cache saved nothing meaningful anyway.
  plugins: [nextCookies()],
  databaseHooks: {
    session: {
      create: {
        /**
         * A suspended account gets no session - the credentials may be perfect, but
         * sign-in stops here. This is the front door; `requireSession` is the back-stop
         * for sessions minted before the suspension landed.
         */
        async before(session) {
          const user = await prisma.user.findUnique({
            where: { id: session.userId },
            select: { status: true },
          });
          if (user?.status === "SUSPENDED") {
            throw new APIError("FORBIDDEN", { message: "This account has been suspended." });
          }
          return { data: session };
        },
      },
    },
  },
});

export type ServerSession = typeof auth.$Infer.Session;

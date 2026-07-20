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

// Preview deployments get a unique *.vercel.app URL per deploy — trust it too.
// EXTRA_TRUSTED_ORIGINS (comma-separated) lets a temporary tunnel (e.g. ngrok) sign in
// WITHOUT repointing BETTER_AUTH_URL — so emailed/booking/agreement links keep using the
// real base URL. Leave it unset in production; it only widens the sign-in origin allow-list.
const trustedOrigins = [
  process.env.VERCEL_PROJECT_PRODUCTION_URL && `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`,
  process.env.VERCEL_URL && `https://${process.env.VERCEL_URL}`,
  ...(process.env.EXTRA_TRUSTED_ORIGINS?.split(",").map((o) => o.trim()) ?? []),
].filter((o): o is string => Boolean(o));

/**
 * Reset-password email body. Kept in this file (not messaging.ts) because this is a
 * system/account email to a User, not a CRM message to a Lead — messaging.ts's
 * sendEmailMessage() writes an append-only Message row keyed to a Lead, which doesn't
 * fit an auth event. It still goes through the exact same low-level send path
 * (getEmailRuntime + sendResendEmail from lib/email.ts) everything else uses.
 */
function resetPasswordEmailHtml(name: string, url: string): string {
  const first = (name || "").trim().split(/\s+/)[0] || "there";
  return `<div style="font-family:Inter,Arial,sans-serif;font-size:14px;color:#16203A;line-height:1.6">
    ${brandEmailHeader()}
    <p>Hi ${first},</p>
    <p>Someone asked to reset the password on your B2 Consultants account. If that was you, set a new one here — this link works once and expires in an hour:</p>
    <p><a href="${url}" style="color:#3762F0">Reset your password</a></p>
    <p>If you didn't request this, you can ignore this email — your password hasn't changed.</p>
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
    // Password RESET only — sign-up stays disabled above. Fails closed exactly like
    // every other email path in this app: if EMAIL_ENABLED/RESEND_API_KEY aren't
    // set (or sending is paused), this silently no-ops instead of throwing into
    // better-auth's request handler. The request-password-reset endpoint always
    // returns a generic "check your email" response either way, so this never
    // leaks whether an address exists.
    sendResetPassword: async ({ user, url }) => {
      const rt = await getEmailRuntime();
      if (!rt.enabled) return;
      const from = rt.fromName ? `${rt.fromName} <${rt.fromEmail}>` : rt.fromEmail;
      await sendResendEmail({
        apiKey: rt.apiKey!,
        from,
        to: user.email,
        subject: "Reset your B2 Consultants password",
        html: resetPasswordEmailHtml(user.name, url),
      });
    },
  },
  user: {
    additionalFields: {
      role: {
        type: "string",
        defaultValue: "USER",
        input: false, // cannot be set from the client, ever
      },
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
         * A suspended account gets no session — the credentials may be perfect, but
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

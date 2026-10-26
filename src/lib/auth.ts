import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware, getIp } from "better-auth/api";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { prisma } from "./prisma";
import { brandEmailHeader, getEmailRuntime, sendResendEmail } from "./email";
import { takeTokens, type RateRule } from "./rate-limit";
import { MIN_PASSWORD_LENGTH } from "./credentials";

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

/**
 * EXTRA_TRUSTED_ORIGINS, now gated to non-production (issue B6).
 *
 * This variable widens the sign-in origin allow-list, which IS the CSRF boundary - better-auth
 * rejects a sign-in whose browser origin is not on the list, and that rejection is the thing
 * stopping another site from driving this one's auth endpoints with a victim's cookies.
 *
 * The only control on it was the comment above saying "leave it unset in production". A comment
 * is not a control: it is advice to whoever edits the compose file next, and it is advice that
 * is read once. `devOrigins` right above already gates itself on NODE_ENV for exactly this
 * reason, and the two should not have different standards.
 *
 * What this costs: a tunnel against a PRODUCTION build can no longer be trusted through this
 * variable. That is the intended loss - the use case named in the comment is a local ngrok
 * session, which runs `next dev`. Needing it against a production build means repointing
 * BETTER_AUTH_URL, deliberately, which is the visible act it should have been all along.
 */
const extraTrustedOrigins =
  process.env.NODE_ENV === "production"
    ? []
    : (process.env.EXTRA_TRUSTED_ORIGINS?.split(",").map((o) => o.trim()) ?? []);

if (process.env.NODE_ENV === "production" && process.env.EXTRA_TRUSTED_ORIGINS?.trim()) {
  // Loud, because silently ignoring it would send somebody hunting a sign-in failure in the
  // wrong file. It is ignored on purpose; say which variable to use instead.
  console.warn(
    "[auth] EXTRA_TRUSTED_ORIGINS is set but IGNORED in production - set BETTER_AUTH_URL or APP_DOMAIN instead.",
  );
}

const trustedOrigins = [
  process.env.VERCEL_PROJECT_PRODUCTION_URL && `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`,
  process.env.VERCEL_URL && `https://${process.env.VERCEL_URL}`,
  appDomainOrigin,
  ...devOrigins,
  ...extraTrustedOrigins,
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
 * ════════════════════════════════════════════════════════════════════════════════════════
 *  PER-ACCOUNT CREDENTIAL THROTTLE  (issue B1)
 * ════════════════════════════════════════════════════════════════════════════════════════
 *
 * Better Auth's own rate limiting (configured below) is keyed on `ip|path`, which is the right
 * primitive and the wrong one on its own: it stops ONE host hammering the door, and does nothing
 * about a guesser spread across a hundred addresses all working on the same admin mailbox. Per-IP
 * limiting bounds the noise; per-account limiting is what bounds the actual risk, because the
 * thing being attacked is a password, not an address.
 *
 * So the email is a second dimension, charged in the same all-or-nothing call as the IP (see
 * `takeTokens` - a request refused by one bucket must not be charged to the other, or a blocked
 * visitor is punished twice for one attempt).
 *
 * ── Why these numbers ───────────────────────────────────────────────────────────────────
 * Ten burst, then one every two minutes. Ten is generous for the real failure mode in this app:
 * credentials arrive by WhatsApp and get pasted, and `normalizePassword` already absorbs the
 * stray trailing space that used to account for most of them. Thirty a day sustained is not a
 * person working out which of their two passwords it was; it is a script.
 *
 * ── Why the bucket is keyed on the SUBMITTED email, not a resolved user ─────────────────
 * Deliberately before any lookup. Resolving the user first would mean an unknown address costs a
 * database round trip and a known one costs a different amount of work - which is an enumeration
 * oracle measured in milliseconds. A bucket on the raw string treats both identically.
 *
 * ── IN-MEMORY, like lib/rate-limit.ts, and the same caveat ──────────────────────────────
 * This app ships as a single Node container, so the buckets are effective. On a multi-instance
 * deploy it degrades to per-instance, and a restart clears it - neither of which an attacker can
 * cause. If that changes, the fix is a shared store for `lib/rate-limit.ts`, which is one file,
 * rather than a second mechanism here.
 */
const SIGN_IN_PER_EMAIL: RateRule = { capacity: 10, refillPerSec: 1 / 120 };

/** The endpoints where a guess is worth throttling per-account. */
const CREDENTIAL_PATHS = new Set([
  "/sign-in/email",
  // A reset request names an account too, and spraying it is how you find out which addresses
  // exist (by timing) and how you bury a real reset email under nine decoys.
  "/forget-password",
  "/request-password-reset",
]);

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
  /**
   * ══════════════════════════════════════════════════════════════════════════════════════
   *  RATE LIMITING ON THE AUTH ENDPOINTS  (issue B1)
   * ══════════════════════════════════════════════════════════════════════════════════════
   *
   * This block did not exist, so the library default applied: ~100 requests per 60 seconds per
   * IP, and - because better-auth only enables rate limiting in production - NOTHING in
   * development, which meant the limit was never once exercised before it mattered.
   *
   * A hundred guesses a minute against a known admin address is a real threat for an app holding
   * the company's ledger, its user management and the key that countersigns agreements. It is
   * also conspicuous beside `lib/rate-limit.ts`, which this codebase applies to twenty-odd
   * public routes including the client-error reporter - every open surface was braked except the
   * one that accepts passwords.
   *
   * `enabled: true` unconditionally, so the rule is the same in dev as in production and a
   * mistake in it shows up on somebody's laptop rather than on the live front door.
   *
   * ── Storage: memory, on purpose ─────────────────────────────────────────────────────────
   * `"database"` would survive restarts, and it would also put a write to Supabase Singapore
   * (~200ms round trip from this box) in front of every auth request. The thing memory storage
   * loses is state across a deploy, and an attacker cannot cause a deploy - so the trade buys
   * nothing and costs latency on every sign-in. Switch it to `"database"` (and migrate the
   * `rateLimit` model) only if this app ever runs more than one container.
   */
  rateLimit: {
    enabled: true,
    // The baseline for anything not named below: still far tighter than the 100/60s default.
    window: 60,
    max: 30,
    storage: "memory",
    customRules: {
      /**
       * Five a minute. A person who has mistyped their password five times in sixty seconds is
       * not about to get it right on the sixth; they need the reset link, and the per-email
       * bucket in `hooks.before` is what stops a distributed guesser regardless of address.
       */
      "/sign-in/email": { window: 60, max: 5 },
      /** Three a minute: a reset is one click and the email takes longer than that to arrive. */
      "/forget-password": { window: 60, max: 3 },
      "/request-password-reset": { window: 60, max: 3 },
      /** Consuming a reset token. Tight, because the token is the credential. */
      "/reset-password": { window: 60, max: 5 },
      /** Changing a known password. Ten, so a fumbled "current password" is not a lockout. */
      "/change-password": { window: 60, max: 10 },
    },
  },
  /**
   * The per-ACCOUNT brake, which the per-IP rules above cannot express. See SIGN_IN_PER_EMAIL.
   *
   * Runs as a `before` hook so it fires ahead of any password verification and ahead of any
   * user lookup - the refusal costs the attacker a round trip and tells them nothing about
   * whether the address exists.
   */
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      if (!CREDENTIAL_PATHS.has(ctx.path)) return;
      const email = (ctx.body as { email?: unknown } | undefined)?.email;
      if (typeof email !== "string" || !email) return;
      // Lower-cased so "Ameen@x.com" and "ameen@x.com" share one bucket. They are one account -
      // `normalizeEmail` folds case on the way in - so two buckets would double the allowance.
      const key = `auth:email:${email.trim().toLowerCase()}`;
      const ip = getIp(ctx.request ?? ctx.headers ?? new Headers(), {}) ?? "unknown";
      const verdict = takeTokens([
        { key, rule: SIGN_IN_PER_EMAIL },
        // Charged together with the email so one refusal does not spend the other's token.
        { key: `auth:ip:${ip}:${ctx.path}`, rule: { capacity: 20, refillPerSec: 1 / 30 } },
      ]);
      if (!verdict.ok) {
        throw new APIError("TOO_MANY_REQUESTS", {
          message: `Too many attempts for this account. Please wait ${Math.ceil(verdict.retryAfterSec / 60)} minute(s) and try again, or use "Forgot password?".`,
        });
      }
    }),
  },
  emailAndPassword: {
    enabled: true,
    disableSignUp: true,
    /**
     * Up from the library default of eight (issue B1), and read from `lib/credentials.ts` so the
     * library's check, the five server-side gates and every form hint state ONE rule. See the
     * note on `MIN_PASSWORD_LENGTH` for why twelve and why it is a single constant.
     *
     * The ceiling is left at the library default - a cap low enough to reject a passphrase would
     * be worse than no advice at all.
     */
    minPasswordLength: MIN_PASSWORD_LENGTH,
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

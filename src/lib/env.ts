import { z } from "zod";

/**
 * Boot-time environment validation.
 *
 * WHY THIS EXISTS: every var below fails *silently* when wrong, which is the worst
 * possible failure mode for a deploy:
 *
 *  - BETTER_AUTH_URL unset  → four separate betterAuth() instances fall back to
 *    "http://localhost:3000". Sign-in breaks with "Invalid origin", and invite /
 *    agreement / password-reset links are minted pointing at localhost and emailed
 *    to real people. Nothing throws.
 *  - BETTER_AUTH_SECRET unset → better-auth uses a default secret. Sessions all
 *    invalidate the moment it is later set. Nothing throws.
 *  - CRON_SECRET unset      → all four cron routes answer 503 and every automation
 *    stops. The app looks perfectly healthy.
 *  - DIRECT_URL unset       → `prisma migrate deploy` fails, but only at release time.
 *
 * So this converts "quietly broken in production" into "container refuses to start",
 * which is the only version of this you can actually notice. Called from
 * instrumentation.ts, which Next runs once per server boot.
 */

// Postgres only, and it must not be a placeholder. The pooler host is not enforced —
// a direct-URL DATABASE_URL is wrong for this app but works, and the deploy docs
// cover it; failing the boot on it would be over-reach.
const postgresUrl = z
  .string()
  .min(1)
  .refine((v) => v.startsWith("postgres://") || v.startsWith("postgresql://"), {
    message: "must be a postgres:// or postgresql:// connection string",
  });

const schema = z.object({
  DATABASE_URL: postgresUrl,
  // Not read by the runtime client, but a deploy without it cannot migrate. Better to
  // catch that here, at boot, than at 2am during a release.
  DIRECT_URL: postgresUrl,

  BETTER_AUTH_URL: z
    .string()
    .url("must be a full origin, e.g. https://app.example.com")
    .refine((v) => !v.endsWith("/"), {
      // auth.ts compares this against the browser's Origin header verbatim; a trailing
      // slash never matches and yields "Invalid origin" on every sign-in.
      message: "must not have a trailing slash",
    })
    .refine((v) => !/^https?:\/\/localhost(:|$)/.test(v), {
      message: "is still localhost — sign-in and every emailed link would break",
    })
    .refine((v) => v.startsWith("https://"), {
      // better-auth infers secure-cookie behaviour from this scheme. http:// in
      // production silently issues non-secure session cookies.
      message: "must be https:// in production (secure cookies are inferred from it)",
    }),

  // better-auth's default is a fixed fallback, so a short/blank value is a real
  // session-forgery risk rather than a style issue.
  BETTER_AUTH_SECRET: z.string().min(32, "must be at least 32 chars (openssl rand -base64 32)"),

  CRON_SECRET: z.string().min(16, "must be at least 16 chars — it is the only guard on /api/cron/*"),
});

/**
 * Validates and throws on failure. Production-only by design: local dev deliberately
 * runs on http://localhost:3000 with a loose .env, and this must not break that.
 */
export function validateEnv(): void {
  const result = schema.safeParse(process.env);
  if (result.success) return;

  const problems = result.error.issues
    .map((i) => `  - ${i.path.join(".") || "(root)"} ${i.message}`)
    .join("\n");

  // Never interpolate the values themselves — this lands in container logs.
  throw new Error(
    `Invalid production environment. The container is refusing to start because these ` +
      `would otherwise fail silently at runtime:\n${problems}\n\n` +
      `See .env.production.example and docs/DEPLOYMENT.md.`,
  );
}

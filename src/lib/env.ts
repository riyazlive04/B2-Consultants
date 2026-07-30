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
 * Half-configured outbound channels.
 *
 * Same principle as the schema above — refuse to boot rather than fail silently — but these are
 * OPT-IN: an unset channel is a legitimate deployment, so absence is never an error. What IS an
 * error is asking for a channel and not giving it what it needs, because the send path then
 * records a SKIPPED row and returns success. Nothing throws, nothing alerts, and the message
 * simply never arrives.
 *
 * This is not hypothetical. On 23 Jul 2026 production had 18 WhatsApp messages: 2 delivered, 3
 * failed, and 13 SKIPPED — five of them agreement OTPs, which is the code a student must receive
 * to sign. Signing had been impossible for weeks and the app looked entirely healthy.
 */
const CHANNELS: { flag: string; needs: string[]; consequence: string }[] = [
  {
    flag: "WATI_ENABLED",
    needs: ["WATI_API_ENDPOINT", "WATI_ACCESS_TOKEN"],
    consequence: "every WhatsApp send (agreement OTPs included) would record as SKIPPED",
  },
  {
    flag: "EMAIL_ENABLED",
    needs: ["RESEND_API_KEY"],
    consequence: "every outbound email would be dropped",
  },
  {
    flag: "SMS_ENABLED",
    needs: ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN"],
    consequence: "every outbound SMS would be dropped",
  },
];

/**
 * Per-channel arming state for the health probe: "off" (flag down — a valid deployment),
 * "armed" (flag up, credentials present), or "misconfigured" (flag up, credentials missing —
 * the state that fails silently). Booleans only; never the values themselves.
 */
export function channelStates(): Record<string, "off" | "armed" | "misconfigured"> {
  const on = (v: string | undefined) => v?.trim().toLowerCase() === "true";
  return Object.fromEntries(
    CHANNELS.map((c) => [
      c.flag.replace(/_ENABLED$/, "").toLowerCase(),
      !on(process.env[c.flag])
        ? ("off" as const)
        : c.needs.every((k) => process.env[k]?.trim())
          ? ("armed" as const)
          : ("misconfigured" as const),
    ]),
  );
}

function channelProblems(): string[] {
  const on = (v: string | undefined) => v?.trim().toLowerCase() === "true";
  const problems: string[] = [];
  for (const c of CHANNELS) {
    if (!on(process.env[c.flag])) continue;
    const missing = c.needs.filter((k) => !process.env[k]?.trim());
    if (missing.length) {
      problems.push(`  - ${c.flag} is true but ${missing.join(" and ")} ${missing.length > 1 ? "are" : "is"} unset — ${c.consequence}`);
    }
  }
  return problems;
}

/**
 * Validates and throws on failure. Production-only by design: local dev deliberately
 * runs on http://localhost:3000 with a loose .env, and this must not break that.
 */
export function validateEnv(): void {
  const result = schema.safeParse(process.env);
  const channels = channelProblems();
  if (result.success && !channels.length) return;

  const problems = [
    ...(result.success
      ? []
      : result.error.issues.map((i) => `  - ${i.path.join(".") || "(root)"} ${i.message}`)),
    ...channels,
  ].join("\n");

  // Never interpolate the values themselves — this lands in container logs.
  throw new Error(
    `Invalid production environment. The container is refusing to start because these ` +
      `would otherwise fail silently at runtime:\n${problems}\n\n` +
      `See .env.production.example and docs/DEPLOYMENT.md.`,
  );
}

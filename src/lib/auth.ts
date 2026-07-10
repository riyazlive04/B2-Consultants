import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { prisma } from "./prisma";

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
const trustedOrigins = [
  process.env.VERCEL_PROJECT_PRODUCTION_URL && `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`,
  process.env.VERCEL_URL && `https://${process.env.VERCEL_URL}`,
].filter((o): o is string => Boolean(o));

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

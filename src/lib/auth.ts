import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { prisma } from "./prisma";

/**
 * Better Auth - email + password only, private app.
 * Public sign-up is DISABLED: Admin provisions accounts (seed script / admin tooling).
 * `role` lives on the user record (ADMIN | HEAD | USER) and is never user-editable.
 */
export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL,
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
});

export type ServerSession = typeof auth.$Infer.Session;

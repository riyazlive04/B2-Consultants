/**
 * Create a local-only ADMIN login for browsing the app on the local database.
 *
 *   npx tsx scripts/local-demo-admin.ts            # create / reset, print the password
 *   npx tsx scripts/local-demo-admin.ts --remove   # delete the account and its sessions
 *
 * ── Why this exists alongside scripts/qa-temp-admin.ts ────────────────────────────
 * That script runs against whatever `.env` points at, which here is LIVE Supabase, and it relies
 * on a shell-set `DATABASE_URL` winning over dotenv to stay local. That assumption is true for
 * `dotenv/config` but it is NOT true for the Prisma CLI, and getting the two confused has
 * already put one migration on production by accident (see the note in docs/ and the memory).
 *
 * So this one takes the datasource EXPLICITLY and refuses to run against anything that is not a
 * local address. There is no shell state, no env precedence and no dotenv involved in the
 * decision - which means it cannot reach production even if invoked carelessly.
 */
import { randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";

const LOCAL_DB = "postgresql://b2:b2@localhost:5435/b2_dashboard?schema=public";

/** Fail closed: a non-local host is a mistake, not a configuration choice. */
const host = new URL(LOCAL_DB).hostname;
if (!["localhost", "127.0.0.1", "::1"].includes(host)) {
  console.error(`Refusing to run: ${host} is not a local database.`);
  process.exit(1);
}

const prisma = new PrismaClient({ datasources: { db: { url: LOCAL_DB } } });

const EMAIL = "local.demo@b2consultants.in";
const NAME = "LOCAL DEMO - delete me";

const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  // The dev server's own origin, so the session cookie it mints is accepted by better-auth.
  secret: process.env.BETTER_AUTH_SECRET ?? "local-demo-secret-not-for-production",
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
  emailAndPassword: { enabled: true },
  user: { additionalFields: { role: { type: "string", defaultValue: "USER", input: false } } },
});

const makePassword = () => `demo-${randomBytes(9).toString("hex")}`;

async function remove() {
  const user = await prisma.user.findUnique({ where: { email: EMAIL } });
  if (!user) return console.log("No local demo account exists - nothing to remove.");
  await prisma.session.deleteMany({ where: { userId: user.id } });
  await prisma.account.deleteMany({ where: { userId: user.id } });
  await prisma.user.delete({ where: { id: user.id } });
  console.log(`Removed ${EMAIL}.`);
}

async function create() {
  const password = makePassword();
  const ctx = await auth.$context;

  let user = await prisma.user.findUnique({ where: { email: EMAIL } });
  if (!user) {
    const res = await auth.api.signUpEmail({ body: { name: NAME, email: EMAIL, password } });
    user = await prisma.user.findUnique({ where: { id: res.user.id } });
    console.log("Created a new local demo admin.");
  } else {
    await ctx.internalAdapter.updatePassword(user.id, await ctx.password.hash(password));
    console.log("Local demo admin already existed - password reset.");
  }

  await prisma.user.update({
    where: { id: user!.id },
    // `mustChangePassword: false` so browsing is not interrupted by the change-password screen.
    data: { role: "ADMIN", emailVerified: true, status: "ACTIVE", mustChangePassword: false },
  });

  console.log(`\n  database ${host}:5435/b2_dashboard`);
  console.log(`  email    ${EMAIL}`);
  console.log(`  password ${password}\n`);
}

// Wrapped rather than top-level await: tsx transpiles scripts/ as CJS here, which has none.
(process.argv.includes("--remove") ? remove() : create())
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

/**
 * Create a local-only login for browsing the app on the local database.
 *
 *   npx tsx scripts/local-demo-admin.ts                # ADMIN, create / reset, print the password
 *   npx tsx scripts/local-demo-admin.ts --role=HEAD    # any role - see ROLES below
 *   npx tsx scripts/local-demo-admin.ts --remove       # delete the account(s) and their sessions
 *
 * ── Why the role flag ───────────────────────────────────────────────────────────────────
 * `npm run smoke` opens every screen, and as an admin it can open nearly all of them - which
 * means the role-gated half of the app goes unchecked. A page that assumes founder-shaped data
 * is a real class of bug and an admin sweep is blind to it. One account per role, each with its
 * own email, so they can be signed in side by side.
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

/** The roles a login can be created for - every role the app has. */
const ROLES = ["ADMIN", "HEAD", "USER", "COACH", "TUTOR", "STUDENT"] as const;
type DemoRole = (typeof ROLES)[number];

const roleArg = process.argv.find((a) => a.startsWith("--role="))?.split("=")[1]?.toUpperCase();
if (roleArg && !ROLES.includes(roleArg as DemoRole)) {
  console.error(`Unknown role "${roleArg}". One of: ${ROLES.join(", ")}`);
  process.exit(1);
}
const ROLE: DemoRole = (roleArg as DemoRole) ?? "ADMIN";

/** ADMIN keeps the original address so existing notes and scripts still work. */
const EMAIL =
  ROLE === "ADMIN" ? "local.demo@b2consultants.in" : `local.demo.${ROLE.toLowerCase()}@b2consultants.in`;
const NAME = `LOCAL DEMO ${ROLE} - delete me`;

const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  // The dev server's own origin, so the session cookie it mints is accepted by better-auth.
  secret: process.env.BETTER_AUTH_SECRET ?? "local-demo-secret-not-for-production",
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
  emailAndPassword: { enabled: true },
  user: { additionalFields: { role: { type: "string", defaultValue: "USER", input: false } } },
});

const makePassword = () => `demo-${randomBytes(9).toString("hex")}`;

/** `--remove` clears EVERY demo login, not just the one the role flag names. */
async function remove() {
  const emails = [
    "local.demo@b2consultants.in",
    ...ROLES.filter((r) => r !== "ADMIN").map((r) => `local.demo.${r.toLowerCase()}@b2consultants.in`),
  ];
  let removed = 0;
  for (const email of emails) {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) continue;
    await prisma.session.deleteMany({ where: { userId: user.id } });
    await prisma.account.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
    console.log(`Removed ${email}.`);
    removed += 1;
  }
  if (removed === 0) console.log("No local demo accounts exist - nothing to remove.");
}

async function create() {
  const password = makePassword();
  const ctx = await auth.$context;

  let user = await prisma.user.findUnique({ where: { email: EMAIL } });
  if (!user) {
    const res = await auth.api.signUpEmail({ body: { name: NAME, email: EMAIL, password } });
    user = await prisma.user.findUnique({ where: { id: res.user.id } });
    console.log(`Created a new local demo ${ROLE}.`);
  } else {
    await ctx.internalAdapter.updatePassword(user.id, await ctx.password.hash(password));
    console.log(`Local demo ${ROLE} already existed - password reset.`);
  }

  await prisma.user.update({
    where: { id: user!.id },
    // `mustChangePassword: false` so browsing is not interrupted by the change-password screen.
    data: { role: ROLE, emailVerified: true, status: "ACTIVE", mustChangePassword: false },
  });

  console.log(`\n  database ${host}:5435/b2_dashboard`);
  console.log(`  role     ${ROLE}`);
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

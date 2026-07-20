/**
 * Create (or remove) a TEMPORARY admin login used to visually verify a change.
 *
 *   npx tsx scripts/qa-temp-admin.ts            # create + print a fresh random password
 *   npx tsx scripts/qa-temp-admin.ts --remove   # delete the account and all its sessions
 *
 * This is a real ADMIN account on whatever database .env points at — which is production.
 * Three deliberate properties keep that honest:
 *   * the address and display name say TEMPORARY, so it can never be mistaken for a
 *     colleague's account in the Users list or in the activity log;
 *   * the password is randomly generated per run and never stored in the repo;
 *   * `--remove` is a first-class mode, so cleanup is one command and not a manual hunt.
 *
 * Delete it as soon as verification is done.
 */
import "dotenv/config";
import { randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";

const prisma = new PrismaClient();

const EMAIL = "qa.temp.verify@b2consultants.in";
const NAME = "QA TEMPORARY — delete me";

const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3021",
  emailAndPassword: { enabled: true },
  user: { additionalFields: { role: { type: "string", defaultValue: "USER", input: false } } },
});

/** Readable but high-entropy: 24 hex chars ≈ 96 bits. */
const makePassword = () => `qa-${randomBytes(12).toString("hex")}`;

async function remove() {
  const user = await prisma.user.findUnique({ where: { email: EMAIL } });
  if (!user) {
    console.log("No temporary QA account exists — nothing to remove.");
    return;
  }
  await prisma.session.deleteMany({ where: { userId: user.id } });
  await prisma.account.deleteMany({ where: { userId: user.id } });
  await prisma.user.delete({ where: { id: user.id } });
  console.log(`Removed ${EMAIL} and all of its sessions.`);
}

async function create() {
  const password = makePassword();
  const ctx = await auth.$context;

  let user = await prisma.user.findUnique({ where: { email: EMAIL } });
  if (!user) {
    const res = await auth.api.signUpEmail({ body: { name: NAME, email: EMAIL, password } });
    user = await prisma.user.findUnique({ where: { id: res.user.id } });
    console.log("Created a new temporary QA admin.");
  } else {
    await ctx.internalAdapter.updatePassword(user.id, await ctx.password.hash(password));
    console.log("Temporary QA admin already existed — password reset.");
  }

  await prisma.user.update({
    where: { id: user!.id },
    data: { role: "ADMIN", emailVerified: true, status: "ACTIVE" },
  });

  console.log("\n  email    " + EMAIL);
  console.log("  password " + password);
  console.log("\nRemove it when done:  npx tsx scripts/qa-temp-admin.ts --remove");
}

(process.argv.includes("--remove") ? remove() : create())
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

// TEMP: reset the demo tutor's password. Uses a MINIMAL better-auth instance
// (same prisma adapter + same default scrypt hasher) to avoid importing the app's
// auth.ts, which transitively pulls in `server-only`. Password hashing is
// independent of BETTER_AUTH_SECRET, so this hash validates in the real app.
import "dotenv/config";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  secret: process.env.BETTER_AUTH_SECRET || "temp-reset-secret",
  emailAndPassword: { enabled: true, disableSignUp: true },
});

const EMAIL = "tutor.demo@b2consultants.in";
const NEW_PASSWORD = process.env.RESET_PW || "tutor-demo-2026";

async function main() {
  const user = await prisma.user.findUnique({
    where: { email: EMAIL },
    select: { id: true, name: true, status: true, role: true },
  });
  if (!user) throw new Error(`No user found for ${EMAIL}`);

  const ctx = await auth.$context;
  const hashed = await ctx.password.hash(NEW_PASSWORD);
  await ctx.internalAdapter.updatePassword(user.id, hashed);

  const acct = await prisma.account.findFirst({
    where: { userId: user.id, providerId: "credential" },
    select: { password: true },
  });
  const ok = acct?.password
    ? await ctx.password.verify({ hash: acct.password, password: NEW_PASSWORD })
    : false;

  console.log(
    `\nReset OK -> ${user.name} <${EMAIL}> role=${user.role} status=${user.status}` +
      `\n   password: ${NEW_PASSWORD}` +
      `\n   verify:   ${ok ? "PASS" : "FAIL"}`
  );
}

main()
  .catch((e) => {
    console.error("RESET ERROR:", e?.message || e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

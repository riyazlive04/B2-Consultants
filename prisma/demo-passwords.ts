/**
 * Set known passwords on the LOCAL demo accounts, so a preview can actually be signed into.
 *
 *   npx tsx prisma/demo-passwords.ts
 *
 * LOCAL ONLY - refuses to run against anything but localhost:5435, for the obvious reason.
 * Also clears `mustChangePassword`, which would otherwise bounce every one of these logins to
 * /change-password on first use and make the credentials wrong the moment they were used.
 */
import { PrismaClient } from "@prisma/client";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";

const DB = process.env.DATABASE_URL ?? "";
if (!/localhost:5435|127\.0\.0\.1:5435/.test(DB)) {
  console.error(
    "REFUSING TO RUN - this resets passwords and is for the local database only.\n" +
      `  DATABASE_URL points at: ${DB.replace(/:[^:@/]+@/, ":***@") || "(unset)"}`,
  );
  process.exit(1);
}

const prisma = new PrismaClient();
const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
  emailAndPassword: { enabled: true },
  user: { additionalFields: { role: { type: "string", defaultValue: "USER", input: false } } },
});

const ACCOUNTS: { email: string; password: string; label: string; name?: string }[] = [
  { email: "local.demo@b2consultants.in", password: "admin-2026", label: "Admin / founder" },
  { email: "karthick@b2consultants.in", password: "head-2026", label: "Head coach" },
  { email: "coach.demo@b2consultants.in", password: "coach-2026", label: "Coach" },
  { email: "tutor.demo@b2consultants.in", password: "tutor-2026", label: "German Note tutor" },
  // The User row still carries whichever student this login was attached to previously; the
  // demo cohort has since re-pointed it, so correct the display name too.
  { email: "student.demo@b2consultants.in", password: "journey-2026", label: "Student (B2 coaching)", name: "Priya Nair" },
  { email: "gn.student.demo@b2consultants.in", password: "journey-2026", label: "Student (German Note)" },
];

async function main() {
  const ctx = await auth.$context;
  const rows: string[] = [];
  for (const a of ACCOUNTS) {
    const user = await prisma.user.findUnique({ where: { email: a.email }, select: { id: true, role: true } });
    if (!user) {
      rows.push(`  (missing)  ${a.email}`);
      continue;
    }
    await ctx.internalAdapter.updatePassword(user.id, await ctx.password.hash(a.password));
    await prisma.user.update({
      where: { id: user.id },
      data: { mustChangePassword: false, status: "ACTIVE", ...(a.name ? { name: a.name } : {}) },
    });
    rows.push(`  ${a.label.padEnd(24)} ${a.email.padEnd(34)} ${a.password}`);
  }
  console.log("\n─────────── http://localhost:3000 ───────────");
  console.log(rows.join("\n"));
  console.log("─────────────────────────────────────────────\n");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

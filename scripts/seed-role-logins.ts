/**
 * Targeted, non-destructive seed for the TUTOR + GN-student portal logins so the
 * app can be explored by role locally. Unlike `npm run db:demo`, this touches only
 * these two accounts (and one batch membership) — it never truncates or rebuilds
 * demo data, so it is safe to run against a database you care about.
 *
 * Idempotent: existing accounts have their password re-set; missing ones are created.
 *
 *   npx tsx scripts/seed-role-logins.ts
 *
 * Credentials come from .env (SEED_TUTOR_* / SEED_GN_STUDENT_*), falling back to the
 * same defaults demo-data.ts uses.
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";

const prisma = new PrismaClient();

const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
  emailAndPassword: { enabled: true },
  user: { additionalFields: { role: { type: "string", defaultValue: "USER", input: false } } },
});

async function main() {
  const ctx = await auth.$context;

  // ── mirror demo-data.ts ensureUser: create-or-reset, then set role ──
  const ensureUser = async (name: string, email: string, password: string, role: "TUTOR" | "STUDENT") => {
    let user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      const res = await auth.api.signUpEmail({ body: { name, email, password } });
      user = await prisma.user.findUnique({ where: { id: res.user.id } });
      console.log(`  created ${role} ${email}`);
    } else {
      await ctx.internalAdapter.updatePassword(user.id, await ctx.password.hash(password));
      console.log(`  reset password for existing ${role} ${email}`);
    }
    await prisma.user.update({ where: { id: user!.id }, data: { role, emailVerified: true } });
    return user!.id;
  };

  // 1) Tutor login (Lena Fischer) — align to the standard local password.
  const tutorEmail = process.env.SEED_TUTOR_EMAIL || "tutor.demo@b2consultants.in";
  const tutorPassword = process.env.SEED_TUTOR_PASSWORD || "deutsch-2026";
  await ensureUser("Lena Fischer", tutorEmail, tutorPassword, "TUTOR");

  // 2) GN-student portal login (Meghna Suresh) — create the account, link it to her
  //    existing Student record, and make sure she is in a GN batch so the portal isn't empty.
  const gnEmail = process.env.SEED_GN_STUDENT_EMAIL || "gn.student.demo@b2consultants.in";
  const gnPassword = process.env.SEED_GN_STUDENT_PASSWORD || "hallo-2026";
  const gnUserId = await ensureUser("Meghna Suresh", gnEmail, gnPassword, "STUDENT");

  let student = await prisma.student.findFirst({ where: { fullName: "Meghna Suresh" } });
  if (!student) {
    student = await prisma.student.create({
      data: { fullName: "Meghna Suresh", email: gnEmail, phone: "+91 98111 55001", leadSource: "WORKSHOP" },
    });
    console.log("  created Student record for Meghna Suresh");
  }
  if (student.userId !== gnUserId) {
    await prisma.student.update({ where: { id: student.id }, data: { userId: gnUserId } });
    console.log("  linked Meghna's Student record to her portal login");
  }

  // Add to the first ACTIVE A1 batch if she isn't already a member (unique [batchId, studentId]).
  const batch = await prisma.gnBatch.findFirst({ where: { level: "GN_A1", status: "ACTIVE" }, orderBy: { createdAt: "asc" } });
  if (batch) {
    const existing = await prisma.gnBatchMember.findUnique({
      where: { batchId_studentId: { batchId: batch.id, studentId: student.id } },
    });
    if (!existing) {
      await prisma.gnBatchMember.create({ data: { batchId: batch.id, studentId: student.id } });
      console.log(`  added Meghna to batch "${batch.name}"`);
    } else {
      console.log(`  Meghna already in batch "${batch.name}"`);
    }
  } else {
    console.log("  (no ACTIVE GN_A1 batch found — portal will show no batch)");
  }

  console.log("\nRole logins ready:");
  console.log(`  TUTOR      ${tutorEmail}  /  ${tutorPassword}`);
  console.log(`  GN STUDENT ${gnEmail}  /  ${gnPassword}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

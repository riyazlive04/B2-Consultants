/**
 * One-off: provision a DEMO student portal login for testing /my-journey.
 * Picks the active Guided/Elite student with the most milestone history.
 * Run: npx tsx prisma/provision-portal-demo.ts
 */
import { PrismaClient } from "@prisma/client";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";

const prisma = new PrismaClient();

const portalAuth = betterAuth({
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
  emailAndPassword: { enabled: true },
  user: {
    additionalFields: {
      role: { type: "string", defaultValue: "USER", input: false },
    },
  },
});

async function main() {
  const email = process.env.SEED_STUDENT_EMAIL || "student.demo@b2consultants.in";
  const password = process.env.SEED_STUDENT_PASSWORD || "journey-2026";

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`= ${email} already exists (linked student: ${
      (await prisma.student.findUnique({ where: { userId: existing.id } }))?.fullName ?? "none"
    })`);
    return;
  }

  const student = await prisma.student.findFirst({
    where: {
      userId: null,
      enrollments: { some: { status: "ACTIVE", programLevel: { in: ["GUIDED", "ELITE"] } } },
    },
    orderBy: { createdAt: "asc" },
    include: { enrollments: { include: { milestoneLogs: true } } },
  });
  if (!student) throw new Error("No active Guided/Elite student without a login found");

  const res = await portalAuth.api.signUpEmail({
    body: { name: student.fullName, email, password },
  });
  await prisma.user.update({ where: { id: res.user.id }, data: { role: "STUDENT", emailVerified: true } });
  await prisma.student.update({ where: { id: student.id }, data: { userId: res.user.id } });
  console.log(`+ portal login for "${student.fullName}" → ${email} / ${password}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

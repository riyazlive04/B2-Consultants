/**
 * One-time provisioning: the four real users (CONTEXT §2) + team profiles.
 * Passwords come from env — change them after first login.
 * Run: npm run db:seed
 */
import { PrismaClient } from "@prisma/client";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";

const prisma = new PrismaClient();

// Local auth instance WITH sign-up enabled (the app itself keeps sign-up disabled).
const seedAuth = betterAuth({
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

type SeedUser = {
  name: string;
  email: string;
  password: string;
  role: "ADMIN" | "HEAD" | "USER";
  roleTitle: string;
  logVariant: "DISCOVERY_SPECIALIST" | "APPOINTMENT_SETTER" | "DELIVERY_COACH";
  orderIndex: number;
};

function env(key: string, fallback: string): string {
  return process.env[key] || fallback;
}

const USERS: SeedUser[] = [
  {
    name: "Ameen",
    email: env("SEED_ADMIN_EMAIL", "ameen@b2consultants.in"),
    password: env("SEED_ADMIN_PASSWORD", "change-me-now"),
    role: "ADMIN",
    roleTitle: "Founder",
    logVariant: "DELIVERY_COACH", // Admin has no daily-log duty; variant unused
    orderIndex: 0,
  },
  {
    name: "Karthick",
    email: env("SEED_HEAD_EMAIL", "karthick@b2consultants.in"),
    password: env("SEED_HEAD_PASSWORD", "change-me-now"),
    role: "HEAD",
    roleTitle: "Program Delivery Coach",
    logVariant: "DELIVERY_COACH",
    orderIndex: 1,
  },
  {
    name: "Asma",
    email: env("SEED_USER1_EMAIL", "asma@b2consultants.in"),
    password: env("SEED_USER1_PASSWORD", "change-me-now"),
    role: "USER",
    roleTitle: "Discovery Call Specialist",
    logVariant: "DISCOVERY_SPECIALIST",
    orderIndex: 2,
  },
  {
    name: "Nilofer",
    email: env("SEED_USER2_EMAIL", "nilofer@b2consultants.in"),
    password: env("SEED_USER2_PASSWORD", "change-me-now"),
    role: "USER",
    roleTitle: "Appointment Setter",
    logVariant: "APPOINTMENT_SETTER",
    orderIndex: 3,
  },
];

async function main() {
  for (const u of USERS) {
    const existing = await prisma.user.findUnique({ where: { email: u.email } });
    let userId: string;

    if (existing) {
      userId = existing.id;
      console.log(`= ${u.email} already exists`);
    } else {
      const res = await seedAuth.api.signUpEmail({
        body: { name: u.name, email: u.email, password: u.password },
      });
      userId = res.user.id;
      console.log(`+ created ${u.email}`);
    }

    await prisma.user.update({
      where: { id: userId },
      data: { role: u.role, emailVerified: true },
    });

    await prisma.teamProfile.upsert({
      where: { userId },
      update: { dashboardRole: u.role },
      create: {
        userId,
        fullName: u.name,
        roleTitle: u.roleTitle,
        dashboardRole: u.role,
        email: u.email,
        logVariant: u.logVariant,
        orderIndex: u.orderIndex,
        status: "ACTIVE",
      },
    });
  }
  console.log("Seed complete. Change the default passwords after first login.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

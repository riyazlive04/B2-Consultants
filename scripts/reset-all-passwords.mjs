/**
 * Bulk password reset for every login on the CONNECTED database.
 *
 * This is a break-glass tool. It exists because email is off (EMAIL_ENABLED="false"), so the
 * Forgot-password flow cannot deliver a reset link - leaving no in-app way back into an account
 * whose password is lost.
 *
 *   node --env-file=.env scripts/reset-all-passwords.mjs                    # dry run
 *   node --env-file=.env scripts/reset-all-passwords.mjs --apply --i-mean-it
 *
 * Two flags, not one, and the second cannot be guessed by muscle memory. Every person on the
 * system is locked out the instant this runs; that should take a deliberate second keystroke.
 *
 * Every account gets `mustChangePassword`, so the value printed here works exactly ONCE and is
 * replaced by something this script never saw. That is the whole reason it is safe to print them.
 */

import { PrismaClient } from "@prisma/client";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { randomInt } from "node:crypto";

const APPLY = process.argv.includes("--apply") && process.argv.includes("--i-mean-it");
const DRY = !APPLY;

// No 0/O/1/l/I: these get read off a screen and typed into a phone, and an ambiguous glyph turns
// a reset into a support call.
const ALPHABET = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function password(len = 14) {
  let out = "";
  for (let i = 0; i < len; i++) out += ALPHABET[randomInt(ALPHABET.length)];
  return `B2-${out.slice(0, 5)}-${out.slice(5, 10)}-${out.slice(10)}`;
}

const prisma = new PrismaClient();
const target = (process.env.DATABASE_URL ?? "").replace(/:[^:@/]+@/, ":****@");
const isLocal = /@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? "");

console.log(`Target: ${target}`);
console.log(`        ${isLocal ? "LOCAL database" : "*** NOT LOCAL - this is a live system ***"}\n`);

const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
  emailAndPassword: { enabled: true },
  user: { additionalFields: { role: { type: "string", defaultValue: "USER", input: false } } },
});
const ctx = await auth.$context;

const users = await prisma.user.findMany({
  select: { id: true, email: true, name: true, role: true },
  orderBy: [{ role: "asc" }, { email: "asc" }],
});

const rows = [];
for (const u of users) {
  const pw = password();
  rows.push({ email: u.email, name: u.name, role: u.role, pw });
  if (DRY) continue;
  await ctx.internalAdapter.updatePassword(u.id, await ctx.password.hash(pw));
  await prisma.user.update({ where: { id: u.id }, data: { mustChangePassword: true } });
}

const w = Math.max(...rows.map((r) => (r.email ?? "").length));
console.log(`${"EMAIL".padEnd(w)}  ${"ROLE".padEnd(8)}  PASSWORD`);
for (const r of rows) {
  console.log(`${(r.email ?? "").padEnd(w)}  ${String(r.role).padEnd(8)}  ${r.pw}`);
}

console.log(
  DRY
    ? "\nDRY RUN - nothing changed. Re-run with --apply --i-mean-it to write these."
    : "\nDone. Every account must set a new password at first sign-in.",
);
await prisma.$disconnect();

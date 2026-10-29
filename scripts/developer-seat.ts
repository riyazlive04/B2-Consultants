/**
 * Create the DEVELOPER SEAT - a login that can read and work the Improvements queue, and
 * nothing else.
 *
 *   node --conditions=react-server --import tsx scripts/developer-seat.ts
 *   …  --email=dev@example.com --name="Dev" --password=…      # override the defaults
 *   …  --remove                                                # delete the seat and its sessions
 *
 * ── Why a script and not just the People screen ──────────────────────────────────────────
 * It can be done entirely from People → Users & access, and after this runs it still can be:
 * the row this writes is byte-for-byte the shape that screen saves (`parseSectionAccess` and
 * `parseCapabilities` in server/users-actions.ts both store an explicit true/false for EVERY
 * key, so this does too). What the screen cannot do is be repeated identically on another
 * database six months from now, or explain itself. This exists so the seat is reproducible
 * and so the reasoning below lives next to it.
 *
 * ── What the seat is ────────────────────────────────────────────────────────────────────
 * Role USER - the lowest staff role - plus two per-person overrides:
 *
 *   sectionAccess  { improvements: true, … everything else false }   what they may SEE
 *   capabilities   { "improvements.triage": true, … rest false }     what they may DO
 *
 * It is NOT an ADMIN, and that is the point: `improvements` is deliberately the one Admin-group
 * section that is not `locked` (see the note on its catalogue entry), precisely so it can be
 * handed to one person without handing them the founder's console. `sectionAllowed` consults the
 * per-person override before the role list, so this works without widening the section to the
 * whole USER role.
 *
 * ── Why `my-desk` is left ON ────────────────────────────────────────────────────────────
 * Not generosity - it is this account's HOME. `app/(app)/page.tsx` redirects every USER to
 * /my-desk, and with the section revoked that redirect lands on a refusal and bounces back with
 * a denial toast: a confusing first screen for somebody who was just handed a working login. The
 * desk itself resolves from `TeamProfile.logVariant`, and this account has no TeamProfile, so it
 * renders `NoProfile` - an explanation and no business data. If this account is ever given a
 * TeamProfile it will start showing a real telecaller desk, so do not give it one.
 *
 * `guide` is on for the same class of reason: it is the app's own documentation, the single most
 * useful thing a new developer can open, and it carries no customer data.
 *
 * ── What the seat deliberately cannot reach ─────────────────────────────────────────────
 * Console → System health (recent server errors, cron health, the armed/not-armed table) lives
 * inside `console`, which IS `locked` - always on, always ADMIN, grantable to nobody. So this
 * seat sees server errors only through the "Recent server errors" panel attached to a filed
 * improvement, never the live console. Widening that would mean unlocking the console, which is
 * a different and much larger decision than creating a login.
 *
 * It also does not get the notification bell counts: `computeNotifications` keys the improvement
 * items on the ADMIN role rather than on the capability (a deliberate trade - it is memoised per
 * role:userId across three call sites). The queue and the emails are unaffected.
 *
 * ── Safety ──────────────────────────────────────────────────────────────────────────────
 * The datasource is read from the environment and PRINTED, and a non-local host is refused
 * unless `--remote` is passed. `.env` on this machine points at live Supabase, so a script that
 * silently inherited it would be a loaded gun; see the header of scripts/local-demo-admin.ts for
 * the accidental production migration that rule exists because of.
 */
import "dotenv/config";
import { randomBytes } from "node:crypto";
import { PrismaClient, Prisma } from "@prisma/client";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { SECTION_CATALOGUE } from "@/lib/sections";
import { CAPABILITIES } from "@/lib/capabilities";

const arg = (name: string) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
const flag = (name: string) => process.argv.includes(`--${name}`);

const EMAIL = (arg("email") ?? "developer@b2consultants.in").toLowerCase();
const NAME = arg("name") ?? "Developer";
/** The sections this seat holds. Every other catalogue key is stored as an explicit false. */
const GRANTED_SECTIONS = new Set(["improvements", "my-desk", "guide"]);
const GRANTED_CAPABILITIES = new Set(["improvements.triage"]);

const DB = process.env.DATABASE_URL ?? "";
if (!DB) {
  console.error("DATABASE_URL is not set. Point it at the database this seat belongs on.");
  process.exit(1);
}
const host = new URL(DB).hostname;
const isLocal = ["localhost", "127.0.0.1", "::1"].includes(host);
if (!isLocal && !flag("remote")) {
  console.error(
    `Refusing to run against ${host} - that is not a local database.\n` +
      "  If that is genuinely where the developer seat belongs, re-run with --remote.",
  );
  process.exit(1);
}

const prisma = new PrismaClient({ datasources: { db: { url: DB } } });
const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
  emailAndPassword: { enabled: true },
  user: { additionalFields: { role: { type: "string", defaultValue: "USER", input: false } } },
});

/** Mixed case, digits and a symbol, because the live password policy asks for them. */
const makePassword = () => `Dev-${randomBytes(8).toString("base64url")}-26`;

async function remove() {
  const user = await prisma.user.findUnique({ where: { email: EMAIL } });
  if (!user) {
    console.log(`No account at ${EMAIL} - nothing to remove.`);
    return;
  }
  await prisma.session.deleteMany({ where: { userId: user.id } });
  await prisma.account.deleteMany({ where: { userId: user.id } });
  await prisma.user.delete({ where: { id: user.id } });
  console.log(`Removed ${EMAIL} and its sessions.`);
}

async function create() {
  const password = arg("password") ?? makePassword();
  const ctx = await auth.$context;

  let user = await prisma.user.findUnique({ where: { email: EMAIL } });
  const existed = !!user;
  if (!user) {
    const res = await auth.api.signUpEmail({ body: { name: NAME, email: EMAIL, password } });
    user = await prisma.user.findUnique({ where: { id: res.user.id } });
  } else {
    if (user.role === "ADMIN") {
      // Narrowing an Admin into this seat would silently take the founder's own access away.
      console.error(`${EMAIL} is an ADMIN. Refusing to narrow an Admin account into the developer seat.`);
      process.exitCode = 1;
      return;
    }
    await ctx.internalAdapter.updatePassword(user.id, await ctx.password.hash(password));
  }

  // Explicit true/false for every key, exactly as the People screen saves it. A MISSING key
  // falls back to the ROLE default, which for a USER would quietly hand over Pipeline,
  // Contacts, Students, Agreements and Reports.
  const sectionAccess: Record<string, boolean> = {};
  for (const s of SECTION_CATALOGUE) sectionAccess[s.key] = GRANTED_SECTIONS.has(s.key);
  const capabilities: Record<string, boolean> = {};
  for (const c of CAPABILITIES) capabilities[c.key] = GRANTED_CAPABILITIES.has(c.key);

  await prisma.user.update({
    where: { id: user!.id },
    data: {
      name: NAME,
      role: "USER",
      status: "ACTIVE",
      emailVerified: true,
      // A local preview is for clicking. Anywhere else, the person who picked the password is
      // not the person who will use it, so they replace it on first sign-in (O4).
      mustChangePassword: !isLocal,
      sectionAccess: sectionAccess as Prisma.InputJsonValue,
      capabilities: capabilities as Prisma.InputJsonValue,
    },
  });

  const sections = Object.entries(sectionAccess).filter(([, v]) => v).map(([k]) => k);
  const caps = Object.entries(capabilities).filter(([, v]) => v).map(([k]) => k);
  console.log(`\n  ${existed ? "Updated" : "Created"} the developer seat.\n`);
  console.log(`  database   ${host}`);
  console.log(`  role       USER  (not ADMIN - see the header of this file)`);
  console.log(`  email      ${EMAIL}`);
  console.log(`  password   ${password}${isLocal ? "" : "   (must be changed on first sign-in)"}`);
  console.log(`  sees       ${sections.join(", ")}`);
  console.log(`  can do     ${caps.join(", ")}`);
  console.log(`  start at   /improvements\n`);
}

(flag("remove") ? remove() : create())
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

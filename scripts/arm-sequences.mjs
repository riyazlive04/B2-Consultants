// Turn on every WhatsApp touchpoint in AppSetting("watiConfig") and report the email side.
//
//   node -r dotenv/config scripts/arm-sequences.mjs           # show current state
//   node -r dotenv/config scripts/arm-sequences.mjs --apply   # arm them
//
// These toggles live in the SHARED database, so they apply to local and production alike.
// What still differs per environment is the env master switch (WATI_ENABLED) and the
// OUTBOUND_ALLOWLIST, which is set locally and unset in production.
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

const KEY = "watiConfig";
const row = await prisma.appSetting.findUnique({ where: { key: KEY } });
if (!row) {
  console.error(`ERROR: AppSetting("${KEY}") does not exist. Save WhatsApp settings once in /whatsapp first.`);
  process.exit(1);
}

const cfg = row.value;
const before = { ...cfg.cadence };

// The six touchpoint switches, plus the EMI rehearsal flag. `emiPreDueDryRun` is the odd one
// out: it is inverted, so "armed" means false. It ships true on purpose - it is the flag that
// stops a corrupted settings blob from WhatsApping every paying student - and turning it off
// is a deliberate act, which is why it is listed here explicitly rather than folded into the
// loop above it.
const TOUCHPOINTS = [
  "discoEnabled",
  "bookingReminderEnabled",
  "noShowEnabled",
  "paymentEnabled",
  "emiPreDueEnabled",
  "studentNudgesEnabled",
];

const next = { ...cfg, cadence: { ...cfg.cadence } };
for (const k of TOUCHPOINTS) next.cadence[k] = true;
next.cadence.emiPreDueDryRun = false;
next.paused = false;

const label = (k, v) => `${k.padEnd(24)} ${String(before[k] ?? "(unset)").padEnd(8)} -> ${v}`;
console.log("WhatsApp touchpoints:");
for (const k of TOUCHPOINTS) console.log("  " + label(k, next.cadence[k]));
console.log("  " + label("emiPreDueDryRun", next.cadence.emiPreDueDryRun) + "   (false = real sends, not rehearsal)");
console.log(`  ${"paused".padEnd(24)} ${String(cfg.paused).padEnd(8)} -> ${next.paused}`);

if (APPLY) {
  await prisma.appSetting.update({ where: { key: KEY }, data: { value: next } });
  console.log("\nAPPLIED.");
} else {
  console.log("\nDRY RUN - nothing written. Re-run with --apply.");
}

// The outreach SOP ladder is a separate engine with its own config; report it so "all
// sequences" can be verified rather than assumed.
const outreach = await prisma.appSetting.findUnique({ where: { key: "outreachConfig" } });
const o = outreach?.value ?? {};
console.log(`\nOutreach SOP ladder: enabled=${o.enabled}`);
console.log(`  autoSend: ${Object.entries(o.autoSend ?? {}).map(([k, v]) => `${k}=${v}`).join(" ")}`);

const email = await prisma.appSetting.findUnique({ where: { key: "emailConfig" } });
const e = email?.value ?? {};
console.log(
  `\nEmail: paused=${e.paused} from=${e.fromEmail ?? "(unset)"} ` +
    `| EMAIL_ENABLED=${process.env.EMAIL_ENABLED} RESEND_API_KEY=${process.env.RESEND_API_KEY ? "set" : "EMPTY"}`,
);

await prisma.$disconnect();

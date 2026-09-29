// Full read-only export of every business table, written before the dev-data purge.
//
//   node -r dotenv/config scripts/backup-before-purge.mjs
//
// Reads nothing but SELECTs. The output file is the entire safety net for the purge that
// follows, so this runs first and the purge refuses to start unless the file exists.
// `prelaunch-reset-backup-*.json` is already in .gitignore, so the dump never reaches git.
import { PrismaClient } from "@prisma/client";
import { writeFileSync } from "node:fs";

const prisma = new PrismaClient();

// Everything that holds business data. Auth (user/session/account), AppSetting and the
// reference tables (level, product, ledgerAccount) are deliberately absent: the purge does
// not touch them, so backing them up would only bloat the file.
const TABLES = [
  "lead", "leadStageHistory", "leadAnswer", "discoveryOutcome", "callLog", "opportunity",
  "outreachJourney", "outreachStepLog", "consentRecord", "contactNote", "contactTask",
  "bookingRequest", "formSubmission", "whatsAppMessage", "whatsAppOptOut", "message",
  "student", "enrollment", "sprintWeek", "milestoneLog", "signalChangeLog", "satisfactionScore",
  "jobApplication", "batchMember", "agreement", "agreementEvent",
  "pendingPayment", "instalment", "dunningEvent", "income", "expense", "payable",
  "cashPosition", "invoice", "invoiceLineItem", "invoicePayment", "subscription",
  "weeklyFunnelSnapshot", "workshopRegistration", "resume", "bookOrder", "gnPendingJoiner",
];

const dump = { exportedAt: new Date().toISOString(), tables: {} };
let total = 0;

for (const t of TABLES) {
  try {
    const rows = await prisma[t].findMany();
    dump.tables[t] = rows;
    total += rows.length;
    if (rows.length) console.log(`  ${t.padEnd(24)} ${rows.length}`);
  } catch (e) {
    // A model that does not exist is a typo in TABLES, not a reason to lose the whole dump.
    dump.tables[t] = { ERROR: String(e).slice(0, 200) };
    console.error(`  ${t.padEnd(24)} FAILED: ${String(e).slice(0, 120)}`);
  }
}

// BigInt money and Decimal fx rates have no JSON representation - stringify both rather than
// let JSON.stringify throw and leave us with no backup at all. Bytes columns (agreement PDFs,
// signature PNGs) serialise as base64 through the Buffer branch.
const json = JSON.stringify(
  dump,
  (_k, v) => {
    if (typeof v === "bigint") return v.toString();
    if (v && typeof v === "object" && v.constructor?.name === "Decimal") return v.toString();
    if (v && typeof v === "object" && v.type === "Buffer" && Array.isArray(v.data)) {
      return { __bytes_base64: Buffer.from(v.data).toString("base64") };
    }
    return v;
  },
  1,
);

const path = `prelaunch-reset-backup-${dump.exportedAt.slice(0, 10)}.json`;
writeFileSync(path, json);
console.log(`\n${total} rows across ${TABLES.length} tables -> ${path} (${(json.length / 1024 / 1024).toFixed(1)} MB)`);

await prisma.$disconnect();

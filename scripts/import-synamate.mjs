// Import the Synamate (GoHighLevel) contact export into B2 as Leads.
//
//   node scripts/import-synamate.mjs --csv "<path>" --target "<DIRECT_URL>" --dry-run
//   node scripts/import-synamate.mjs --csv "<path>" --target "<DIRECT_URL>" --commit
//
// Source: Synamate -> Contacts -> Select all -> Export (the app's own bulk export, not a
// DOM scrape, so the row count is exact). Columns are ONLY what the smart list shows:
//   Contact Id, First Name, Last Name, Phone, Email, Business Name, Created, Last Activity, Tags
// There is NO source, pipeline stage, or opportunity value in the export. The lfmvp-*
// tags are therefore the only funnel signal we have, and the stage map below is inferred
// from them — it is a decision, not data.
//
// ─────────────────── Two things worth knowing before reading on ───────────────────
//
// 1. DELETING THE DEMO LEADS FIGHTS THE SCHEMA, ON PURPOSE.
//    `lead_stage_history` is append-only (a BEFORE UPDATE OR DELETE trigger raises), and
//    it CASCADEs from `lead` — so a plain `DELETE FROM lead` is refused by the cascade.
//    We do NOT use `session_replication_role = replica` here (the data-migration script
//    does): that disables FK triggers too, so the 9 CASCADE children would be orphaned
//    and the 8 SET NULL children would keep dangling ids. Instead we disable exactly ONE
//    named trigger for the duration, leaving referential integrity fully enforced.
//
// 2. DEDUPE IS ON E.164 PHONE, NOT RAW TEXT.
//    Synamate stores "+91 98404 20666"; B2's webhook leads store E.164. Comparing raw
//    strings would duplicate every real lead that arrived via Pabbly/FlexiFunnels.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Papa from "papaparse";
import { parsePhoneNumberFromString } from "libphonenumber-js";
import { PrismaClient } from "@prisma/client";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const opt = (n) => {
  const i = args.indexOf(`--${n}`);
  return i !== -1 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : null;
};

const CSV = opt("csv");
const TARGET = opt("target") ?? process.env.SUPABASE_DIRECT_URL;
const COMMIT = flag("commit");
const DRY = !COMMIT;

if (!CSV || !existsSync(CSV)) {
  console.error(`ERROR: --csv missing or not found: ${CSV}`);
  process.exit(1);
}
if (!TARGET) {
  console.error("ERROR: --target (or SUPABASE_DIRECT_URL) required");
  process.exit(1);
}

// ─────────────────── mapping ───────────────────

// Tag -> stage. Precedence matters: a contact tagged both `optin` and `applied-for-call`
// is further down the funnel, so the LAST match by this order wins.
const STAGE_BY_TAG = [
  ["lfmvp-optin", "NEW_LEAD"],
  ["lfmvp-visited-but-didn't-applied", "LOST"], // 8,365 — opted in, never applied
  ["workshop-follow-up", "WORKSHOP_FOLLOWUP"],
  ["lfmvp-applied-for-call", "DISCO_BOOKED"], // 2,429 — highest intent, wins over the rest
];
const RANK = Object.fromEntries(STAGE_BY_TAG.map(([t], i) => [t, i]));

// The export has no source column, so attribution is inferred from the tag family.
// lfmvp-* is the landing-page funnel; everything untagged is honestly OTHER.
const SOURCE_BY_TAG = [
  ["lfmvp-", "LANDING_PAGE"],
  ["workshop-", "WORKSHOP"],
  ["summit-", "SUMMIT"],
  ["optin-wa-", "WHATSAPP"],
];

const norm = (s) => (s ?? "").trim();

function toE164(raw) {
  const v = norm(raw);
  if (!v) return null;
  // Synamate numbers are stored with a country code; default IN for any bare local number.
  const p = parsePhoneNumberFromString(v, "IN");
  return p && p.isValid() ? p.number : null;
}

function mapRow(r) {
  const tags = norm(r.Tags)
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);

  let stage = "NEW_LEAD";
  let best = -1;
  for (const t of tags) {
    if (RANK[t] !== undefined && RANK[t] > best) {
      best = RANK[t];
      stage = STAGE_BY_TAG[RANK[t]][1];
    }
  }

  let leadSource = "OTHER";
  for (const [prefix, src] of SOURCE_BY_TAG) {
    if (tags.some((t) => t.startsWith(prefix))) { leadSource = src; break; }
  }

  const name = [norm(r["First Name"]), norm(r["Last Name"])].filter(Boolean).join(" ").trim();
  const created = norm(r.Created) ? new Date(r.Created) : new Date();

  return {
    name: name || norm(r.Email) || norm(r.Phone) || "(no name)", // name is NOT NULL
    phone: toE164(r.Phone), // nullable since 20260716160000_lead_phone_nullable
    email: norm(r.Email) || null,
    leadSource,
    dateIn: isNaN(created) ? new Date() : created,
    stage,
    source: "SYNAMATE",
    externalRef: norm(r["Contact Id"]) || null, // GHL id — the idempotency key
    notes: tags.length ? `Synamate tags: ${tags.join(", ")}` : null,
    createdAt: isNaN(created) ? new Date() : created,
  };
}

// ─────────────────── load + map ───────────────────

console.log(`\nParsing ${path.basename(CSV)} …`);
const parsed = Papa.parse(readFileSync(CSV, "utf8"), { header: true, skipEmptyLines: true });
const rows = parsed.data.filter((r) => r["Contact Id"]);
console.log(`  ${rows.length} contacts in export`);

const mapped = rows.map(mapRow);

const stats = {};
for (const m of mapped) stats[m.stage] = (stats[m.stage] ?? 0) + 1;
const withPhone = mapped.filter((m) => m.phone).length;
const badPhone = mapped.filter((m) => !m.phone && norm(m.rawPhone)).length;

console.log("\nStage mapping:");
for (const [s, n] of Object.entries(stats).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${s.padEnd(20)} ${n}`);
}
console.log(`\nPhone: ${withPhone} parsed to E.164 · ${mapped.length - withPhone} without a usable phone`);

// Dedupe WITHIN the export, on phone (keep the earliest record for a person).
const byPhone = new Map();
const noPhone = [];
for (const m of mapped) {
  if (!m.phone) { noPhone.push(m); continue; }
  const prev = byPhone.get(m.phone);
  if (!prev || m.createdAt < prev.createdAt) byPhone.set(m.phone, m);
}
const intraDupes = withPhone - byPhone.size;
console.log(`Intra-export duplicates collapsed on phone: ${intraDupes}`);

const prisma = new PrismaClient({ datasources: { db: { url: TARGET } } });

try {
  // ─────────────────── plan against the live DB ───────────────────

  const demo = await prisma.lead.findMany({ where: { source: "MANUAL" }, select: { id: true } });
  const existing = await prisma.lead.findMany({
    where: { source: { not: "MANUAL" } },
    select: { id: true, phone: true, source: true },
  });
  const existingByPhone = new Map(existing.filter((e) => e.phone).map((e) => [e.phone, e]));

  const toUpdate = [];
  const toInsert = [];
  for (const m of byPhone.values()) {
    if (existingByPhone.has(m.phone)) toUpdate.push({ ...m, id: existingByPhone.get(m.phone).id });
    else toInsert.push(m);
  }

  console.log(`\nAgainst the target:`);
  console.log(`  demo leads to DELETE (source=MANUAL) : ${demo.length}`);
  console.log(`  real leads kept & matched by phone   : ${toUpdate.length} (of ${existing.length} existing)`);
  console.log(`  new leads to INSERT (with phone)     : ${toInsert.length}`);
  console.log(`  new leads to INSERT (no phone)       : ${noPhone.length}`);
  console.log(`  TOTAL after import                   : ${toInsert.length + noPhone.length + existing.length}`);

  if (DRY) {
    const out = path.join(ROOT, ".migration", "synamate-plan.json");
    writeFileSync(out, JSON.stringify({ stats, toUpdate: toUpdate.length, toInsert: toInsert.length, noPhone: noPhone.length }, null, 2));
    console.log(`\n--dry-run: nothing written. Plan -> ${path.relative(ROOT, out)}`);
    console.log("Re-run with --commit to apply.");
    process.exit(0);
  }

  // ─────────────────── commit ───────────────────

  console.log("\nDeleting demo leads …");
  // lead_stage_history is append-only and CASCADEs from lead, so the cascade is refused
  // unless that ONE guard stands down. We do NOT touch FK triggers — the 9 CASCADE and
  // 8 SET NULL children must still be maintained correctly.
  await prisma.$executeRawUnsafe(`ALTER TABLE "lead_stage_history" DISABLE TRIGGER "lead_stage_history_append_only"`);
  try {
    const del = await prisma.lead.deleteMany({ where: { source: "MANUAL" } });
    console.log(`  deleted ${del.count} demo leads (children cascaded normally)`);
  } finally {
    // Always re-arm, even if the delete threw — leaving this off would silently make the
    // ledger's sibling guarantee unenforced for the rest of the connection's life.
    await prisma.$executeRawUnsafe(`ALTER TABLE "lead_stage_history" ENABLE TRIGGER "lead_stage_history_append_only"`);
    console.log("  append-only guard re-armed");
  }

  console.log("\nUpdating existing real leads matched by phone …");
  for (const u of toUpdate) {
    const { id, ...data } = u;
    // Do NOT overwrite `source` — these arrived via PABBLY/FLEXIFUNNELS/NATIVE_FORM and
    // that provenance is the truth about how they reached us.
    delete data.source;
    await prisma.lead.update({ where: { id }, data: { externalRef: data.externalRef, notes: data.notes } });
  }
  console.log(`  updated ${toUpdate.length}`);

  console.log("\nInserting …");
  const all = [...toInsert, ...noPhone];
  const BATCH = 1000;
  let done = 0;
  for (let i = 0; i < all.length; i += BATCH) {
    const chunk = all.slice(i, i + BATCH);
    const res = await prisma.lead.createMany({ data: chunk, skipDuplicates: true });
    done += res.count;
    process.stdout.write(`\r  ${done}/${all.length}`);
  }
  console.log(`\n  inserted ${done}`);

  const total = await prisma.lead.count();
  const bySource = await prisma.lead.groupBy({ by: ["source"], _count: true });
  const byStage = await prisma.lead.groupBy({ by: ["stage"], _count: true });
  console.log(`\nDONE — ${total} leads in Supabase`);
  console.log("  by source:", bySource.map((s) => `${s.source}=${s._count}`).join(" "));
  console.log("  by stage :", byStage.map((s) => `${s.stage}=${s._count}`).join(" "));
} finally {
  await prisma.$disconnect();
}

// Backup with a TESTED restore.
//
// "Backups are enabled" is not a backup. A dump file that has never been restored is a file you
// believe in, and the belief is only tested on the day it matters. This script therefore does the
// whole loop every run:
//
//   1. pg_dump the production database
//   2. count every table in the SOURCE
//   3. restore the dump into a throwaway scratch database
//   4. count every table in the RESTORE
//   5. diff the two - any mismatch fails the run with a non-zero exit code
//   6. drop the scratch database, prune old dumps
//
// Step 5 is the point. Steps 1–4 are what most "backup scripts" stop at.
//
// USAGE
//   node scripts/backup-verify.mjs                # dump + restore + verify
//   node scripts/backup-verify.mjs --no-verify    # dump only (faster; NOT a tested backup)
//   node scripts/backup-verify.mjs --keep-scratch # leave the restored DB for inspection
//   node scripts/backup-verify.mjs --retain 14    # prune dumps older than N days (default 14)
//
// ENVIRONMENT
//   DIRECT_URL / DATABASE_URL   source. DIRECT_URL is preferred and usually REQUIRED -
//                               see the note on pooled connections below.
//   BACKUP_SCRATCH_URL          where to restore. Defaults to the project's local PG
//                               (postgresql://b2:b2@localhost:5435/postgres).
//   BACKUP_DIR                  output directory. Defaults to ./backups.
//   PG_BIN                      directory holding pg_dump/pg_restore/psql, if not on PATH.
//
// WHY THE SCRATCH DATABASE IS LOCAL BY DEFAULT: a restore that lands on the production server is
// a way to destroy the thing you are protecting. The default target is the local instance
// scripts/local-db.mjs already manages, and the script refuses to restore into the same host+
// database it dumped from.

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// ───────────────────────────── args ─────────────────────────────

const argv = process.argv.slice(2);
const has = (flag) => argv.includes(flag);
const valueOf = (flag, fallback) => {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

const DO_VERIFY = !has("--no-verify");
const KEEP_SCRATCH = has("--keep-scratch");
const RETAIN_DAYS = Number(valueOf("--retain", "14"));

// ───────────────────────────── binaries ─────────────────────────────

/**
 * Same discovery strategy as scripts/local-db.mjs - PostgreSQL on Windows installs to Program
 * Files and does NOT add itself to PATH, so "pg_dump: command not found" is the normal first
 * experience rather than an exceptional one.
 */
function findBinDir() {
  if (process.env.PG_BIN) return process.env.PG_BIN;
  const roots =
    process.platform === "win32"
      ? ["C:\\Program Files\\PostgreSQL"]
      : ["/usr/lib/postgresql", "/opt/homebrew/opt", "/usr/local/opt"];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    const versions = readdirSync(root)
      .filter((v) => /^\d/.test(v))
      .sort((a, b) => parseFloat(b) - parseFloat(a));
    for (const v of versions) {
      const bin = path.join(root, v, "bin");
      if (existsSync(bin)) return bin;
    }
  }
  return "";
}

const BIN = findBinDir();
const tool = (name) => (BIN ? path.join(BIN, process.platform === "win32" ? `${name}.exe` : name) : name);

function requireTools() {
  const missing = ["pg_dump", "pg_restore", "psql"].filter((t) => {
    const r = spawnSync(tool(t), ["--version"], { encoding: "utf8" });
    return r.error != null;
  });
  if (missing.length) {
    fail(
      `Can't find ${missing.join(", ")}.\n` +
        `Install the PostgreSQL client tools, or set PG_BIN to the directory containing them.\n` +
        (BIN ? `Looked in: ${BIN}` : "PG_BIN is unset and nothing was found on PATH."),
    );
  }
}

// ───────────────────────────── output ─────────────────────────────

const t0 = Date.now();
const say = (msg) => console.log(msg);
const step = (msg) => console.log(`\n▶ ${msg}`);

function fail(msg) {
  console.error(`\n✖ ${msg}`);
  process.exit(1);
}

/** Redacts the password so a printed URL can go in a log or a CI transcript. */
function safeUrl(url) {
  try {
    const u = new URL(url);
    if (u.password) u.password = "***";
    return u.toString();
  } catch {
    return "[unparseable url]";
  }
}

// ───────────────────────────── connection ─────────────────────────────

/**
 * PgBouncer (Supabase's pooler, port 6543) cannot serve pg_dump: the dump needs a session-level
 * connection to hold a consistent snapshot, and a transaction-pooled connection cannot give it
 * one. The failure is a confusing mid-dump error rather than a refusal, so this is checked and
 * explained up front. DIRECT_URL exists in this project precisely for this class of work.
 */
function sourceUrl() {
  const direct = process.env.DIRECT_URL?.trim();
  const pooled = process.env.DATABASE_URL?.trim();
  const url = direct || pooled;
  if (!url) fail("Neither DIRECT_URL nor DATABASE_URL is set. Load your .env before running this.");

  if (!direct && pooled && /(?::6543)|pooler/i.test(pooled)) {
    fail(
      "DATABASE_URL points at the connection POOLER, which pg_dump cannot use.\n" +
        "Set DIRECT_URL to the direct (port 5432) connection string and re-run.",
    );
  }
  return url;
}

function parts(url) {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: u.port || "5432",
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: u.pathname.replace(/^\//, "") || "postgres",
  };
}

/**
 * Runs a libpq tool. The password goes in the ENVIRONMENT, never on the command line - argv is
 * world-readable on most systems (`ps aux`), and this password is the production database's.
 */
function pg(binary, args, { password, input, allowFail = false } = {}) {
  const res = spawnSync(tool(binary), args, {
    encoding: "utf8",
    input,
    maxBuffer: 1024 * 1024 * 64,
    env: { ...process.env, PGPASSWORD: password ?? "", PGCONNECT_TIMEOUT: "20" },
  });
  if (res.error) fail(`${binary} failed to start: ${res.error.message}`);
  if (res.status !== 0 && !allowFail) {
    fail(`${binary} exited ${res.status}\n${(res.stderr || "").trim().slice(0, 4000)}`);
  }
  return res;
}

/** One-shot SQL, returned as raw rows (tab-separated, unaligned). */
function query(conn, sql, { database } = {}) {
  const res = pg(
    "psql",
    [
      "-h", conn.host, "-p", conn.port, "-U", conn.user,
      "-d", database ?? conn.database,
      "-v", "ON_ERROR_STOP=1", "-At", "-F", "\t", "-c", sql,
    ],
    { password: conn.password },
  );
  return res.stdout.trim();
}

// ───────────────────────────── row counts ─────────────────────────────

/**
 * EXACT counts, table by table.
 *
 * Deliberately NOT `pg_class.reltuples`, which is the fast answer and an ESTIMATE maintained by
 * ANALYZE. An estimate cannot distinguish "restored correctly" from "restored 23,400 of 23,435
 * leads", and that distinction is the entire product of this script. It costs a sequential scan
 * per table; on this database that is seconds, and it runs once a day.
 */
function tableCounts(conn, database) {
  const tables = query(
    conn,
    `SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename NOT LIKE '\\_prisma%'
      ORDER BY tablename`,
    { database },
  )
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

  if (!tables.length) return new Map();

  // One statement, one round trip. Building it as a UNION ALL beats N psql invocations by a
  // wide margin on a remote database - the round-trip to Supabase Singapore is ~205ms.
  const sql = tables
    .map((t) => `SELECT '${t}' AS t, count(*) AS n FROM public."${t}"`)
    .join(" UNION ALL ");

  const out = query(conn, `${sql} ORDER BY 1`, { database });
  const counts = new Map();
  for (const line of out.split("\n").filter(Boolean)) {
    const [name, n] = line.split("\t");
    counts.set(name, Number(n));
  }
  return counts;
}

// ───────────────────────────── main ─────────────────────────────

requireTools();

const SRC_URL = sourceUrl();
const src = parts(SRC_URL);
const SCRATCH_URL =
  process.env.BACKUP_SCRATCH_URL?.trim() || "postgresql://b2:b2@localhost:5435/postgres";
const scratch = parts(SCRATCH_URL);

const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const outDir = process.env.BACKUP_DIR?.trim() || path.join(ROOT, "backups");
mkdirSync(outDir, { recursive: true });
const dumpFile = path.join(outDir, `b2-${stamp}.dump`);
const scratchDb = `b2_restore_check_${stamp.replace(/[^0-9]/g, "")}`;

say(`Source : ${safeUrl(SRC_URL)}`);
say(`Dump   : ${dumpFile}`);
if (DO_VERIFY) say(`Scratch: ${safeUrl(SCRATCH_URL)} → ${scratchDb}`);

// A restore into the source is the one outcome that turns a backup script into an outage.
if (DO_VERIFY && scratch.host === src.host && scratch.port === src.port) {
  fail(
    `Refusing to run: the scratch target is the SAME server as the source (${src.host}:${src.port}).\n` +
      `Point BACKUP_SCRATCH_URL at a different instance - the local one from ` +
      `\`npm run db:local\` is the intended target.`,
  );
}

// ── 1. dump ──────────────────────────────────────────────────────────
step("Dumping");
pg(
  "pg_dump",
  [
    "-h", src.host, "-p", src.port, "-U", src.user, "-d", src.database,
    // Custom format: compressed, and pg_restore can then run in parallel and skip objects.
    "-Fc",
    "--no-owner",
    "--no-acl",
    // Supabase's managed roles and extension schemas are not ours to recreate; a restore that
    // tries to would fail on a plain local instance for reasons that have nothing to do with
    // whether our data survived.
    "--schema=public",
    "-f", dumpFile,
  ],
  { password: src.password },
);

const dumpBytes = statSync(dumpFile).size;
say(`  ${(dumpBytes / 1024 / 1024).toFixed(2)} MB written`);
// A dump can "succeed" and be empty if the schema filter matched nothing.
if (dumpBytes < 1024) fail("The dump is suspiciously small (<1 KB). Treating this as a failure.");

if (!DO_VERIFY) {
  say("\n--no-verify: skipping the restore. This is a dump, NOT a tested backup.");
  prune();
  done(true);
}

// ── 2. source counts ────────────────────────────────────────────────
step("Counting rows in the source");
const before = tableCounts(src);
say(`  ${before.size} tables, ${[...before.values()].reduce((a, b) => a + b, 0).toLocaleString()} rows`);

// ── 3. restore ──────────────────────────────────────────────────────
step("Restoring into a scratch database");
// `postgres` is the maintenance DB; CREATE DATABASE cannot run inside the DB being created.
query(scratch, `CREATE DATABASE "${scratchDb}"`, { database: "postgres" });
// A new database already has a `public` schema, and the dump contains `CREATE SCHEMA public`.
// Left alone, pg_restore reports an error and exits non-zero on an otherwise perfect restore -
// noise that trains you to ignore the exit code, which is the one signal a scheduled backup has.
// Dropping it first lets the dump recreate it and keeps a clean run genuinely clean.
query(scratch, "DROP SCHEMA IF EXISTS public CASCADE", { database: scratchDb });

let restoreOk = true;
try {
  const res = pg(
    "pg_restore",
    [
      "-h", scratch.host, "-p", scratch.port, "-U", scratch.user, "-d", scratchDb,
      "--no-owner", "--no-acl", "-j", "4",
      dumpFile,
    ],
    { password: scratch.password, allowFail: true },
  );
  // pg_restore exits non-zero for benign things too (a missing role to reassign, a comment on
  // an extension we didn't create). The row counts below are the real verdict, so a warning
  // here is reported and then judged on the data rather than trusted or panicked over.
  if (res.status !== 0) {
    say(`  pg_restore reported warnings (exit ${res.status}) - the row diff below is the verdict:`);
    say(
      (res.stderr || "")
        .split("\n")
        .filter(Boolean)
        .slice(0, 8)
        .map((l) => `    ${l}`)
        .join("\n"),
    );
  }

  // ── 4. compare ────────────────────────────────────────────────────
  step("Comparing row counts");
  const after = tableCounts(scratch, scratchDb);

  const problems = [];
  for (const [table, n] of before) {
    const got = after.get(table);
    if (got === undefined) problems.push(`${table}: MISSING from the restore (source has ${n})`);
    else if (got !== n) problems.push(`${table}: ${n} in source, ${got} restored`);
  }
  for (const table of after.keys()) {
    if (!before.has(table)) problems.push(`${table}: present in the restore but not in the source`);
  }

  if (problems.length) {
    restoreOk = false;
    console.error(`\n✖ ${problems.length} table(s) did not match:`);
    for (const p of problems.slice(0, 40)) console.error(`    ${p}`);
    if (problems.length > 40) console.error(`    … and ${problems.length - 40} more`);
  } else {
    say(`  ✔ all ${before.size} tables match exactly`);
  }
} finally {
  if (KEEP_SCRATCH) {
    say(`\n--keep-scratch: left ${scratchDb} in place for inspection.`);
  } else {
    step("Dropping the scratch database");
    // WITH (FORCE) terminates leftover backends - without it a stray psql session makes the
    // drop fail and the next run inherits a half-populated database named after today.
    query(scratch, `DROP DATABASE IF EXISTS "${scratchDb}" WITH (FORCE)`, { database: "postgres" });
  }
}

prune();
done(restoreOk);

// ───────────────────────────── housekeeping ─────────────────────────────

function prune() {
  if (!Number.isFinite(RETAIN_DAYS) || RETAIN_DAYS <= 0) return;
  const cutoff = Date.now() - RETAIN_DAYS * 86_400_000;
  const stale = readdirSync(outDir)
    .filter((f) => /^b2-.*\.dump$/.test(f))
    .map((f) => path.join(outDir, f))
    // Never prune the dump this run just produced, whatever the clock says.
    .filter((f) => f !== dumpFile && statSync(f).mtimeMs < cutoff);

  for (const f of stale) unlinkSync(f);
  if (stale.length) say(`\nPruned ${stale.length} dump(s) older than ${RETAIN_DAYS} days.`);
}

function done(ok) {
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  if (ok) {
    say(`\n✔ Backup verified in ${secs}s → ${dumpFile}`);
    process.exit(0);
  }
  // Non-zero so a scheduled task, a CI job or a monitoring wrapper can alert on it. A backup
  // script that fails quietly is the same problem as a backup that was never tested.
  console.error(`\n✖ Backup FAILED verification after ${secs}s. Do not trust this dump.`);
  process.exit(1);
}

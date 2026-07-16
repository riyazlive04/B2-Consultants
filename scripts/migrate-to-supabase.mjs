// Migrate the local b2_dashboard database into Supabase.
//
// WHY NOT A PLAIN pg_dump | psql:
//   Local dev runs Postgres 18; Supabase runs 17 (or 15 on older projects). A full dump
//   restored into an older server is a DOWNGRADE — pg_dump emits DDL the target cannot
//   parse. So we split the job:
//
//     schema  ->  `prisma migrate deploy` runs the 40 migrations natively on the target.
//                 This is strictly better than shipping DDL: it recreates all 12 integrity
//                 triggers, the append-only guards, and the ledger CHECK constraints as the
//                 target's own version compiles them.
//     data    ->  `pg_dump --data-only` emits COPY blocks, which are version-portable.
//
// WHY session_replication_role = replica:
//   A data-only load inserts rows in table order, not FK order — and this schema has
//   append-only + immutability triggers (journal_entry, agreement_seal, lead_stage_history)
//   that exist precisely to reject writes like these. `replica` suspends BOTH user triggers
//   and FK checks for the session. Supabase grants the `postgres` role this setting; a
//   plain `pg_restore --disable-triggers` would need superuser, which Supabase does not give.
//   Constraints are re-validated by the verify step, and the triggers govern the app's
//   writes from the moment the session ends.
//
// Usage:
//   node scripts/migrate-to-supabase.mjs --target "postgresql://postgres:PW@db.xxx.supabase.co:5432/postgres"
//   node scripts/migrate-to-supabase.mjs --target "..." --dry-run     # preflight only, writes nothing
//   node scripts/migrate-to-supabase.mjs --target "..." --force       # allow a non-empty target
//
// The target MUST be the DIRECT connection (port 5432), not the pooler (6543):
// migrations need session-level statements the transaction pooler cannot carry.

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT_DIR = path.join(ROOT, ".migration");
const DATA_SQL = path.join(OUT_DIR, "data.sql");
const LOCKDOWN_SQL = path.join(ROOT, "scripts", "supabase-lockdown.sql");

const SOURCE_URL =
  process.env.SOURCE_DATABASE_URL ??
  "postgresql://b2:b2@localhost:5435/b2_dashboard?schema=public";

// Prisma owns this table and `migrate deploy` populates it on the target. Copying the
// source's rows over the target's would claim migrations ran that never did.
const EXCLUDED = ["_prisma_migrations"];

// ─────────────────── args ───────────────────

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : null;
};

const DRY_RUN = flag("dry-run");
const FORCE = flag("force");
const LOCKDOWN_ONLY = flag("lockdown-only");

// A bare node script gets no .env (Next.js loads it, node does not), and `$DIRECT_URL`
// in an npm script does not expand on Windows. So read .env ourselves — this is what
// makes `npm run db:lockdown` work with no arguments, cross-platform.
function envFromDotEnv(key) {
  const f = path.join(ROOT, ".env");
  if (!existsSync(f)) return null;
  const m = readFileSync(f, "utf8").match(new RegExp(`^\\s*${key}\\s*=\\s*(.+)\\s*$`, "m"));
  return m ? m[1].trim().replace(/^["']|["']$/g, "") : null;
}

const TARGET_URL =
  opt("target") ??
  process.env.SUPABASE_DIRECT_URL ??
  (LOCKDOWN_ONLY ? envFromDotEnv("DIRECT_URL") : null);

if (!TARGET_URL) {
  console.error(
    "ERROR: no target.\n" +
      '  node scripts/migrate-to-supabase.mjs --target "postgresql://postgres.REF:PW@aws-0-REGION.pooler.supabase.com:5432/postgres"\n' +
      "  (or set SUPABASE_DIRECT_URL; --lockdown-only also falls back to DIRECT_URL in .env)"
  );
  process.exit(1);
}

if (/:6543/.test(TARGET_URL)) {
  console.error(
    "ERROR: that is the transaction pooler (:6543). Migrations need the DIRECT connection (:5432).\n" +
      "  Supabase dashboard -> Project Settings -> Database -> Connection string -> URI"
  );
  process.exit(1);
}

// ─────────────────── postgres binaries ───────────────────

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
const tool = (n) => (BIN ? path.join(BIN, n) : n);

const redact = (url) => url.replace(/:\/\/([^:]+):[^@]+@/, "://$1:****@");

// Prisma accepts connection params libpq does not — `?schema=public` makes psql exit with
// `invalid URI query parameter`, and the Supabase pooler URL carries `?pgbouncer=true`.
// Strip the Prisma-only ones so the same string works for both Prisma and psql/pg_dump.
// Dropping `schema=public` is safe: public is already first in the default search_path.
const PRISMA_ONLY = new Set([
  "schema",
  "pgbouncer",
  "connection_limit",
  "pool_timeout",
  "socket_timeout",
  "statement_cache_size",
  "sslidentity",
  "sslpassword",
]);

function toLibpqUrl(url) {
  const u = new URL(url);
  for (const k of [...u.searchParams.keys()]) {
    if (PRISMA_ONLY.has(k)) u.searchParams.delete(k);
  }
  return u.toString();
}

function psql(url, sql) {
  const res = spawnSync(
    tool("psql"),
    [toLibpqUrl(url), "-t", "-A", "-X", "-v", "ON_ERROR_STOP=1", "-c", sql],
    { encoding: "utf8" }
  );
  if (res.status !== 0) throw new Error(res.stderr?.trim() || `psql failed (${res.status})`);
  return res.stdout.trim();
}

const step = (msg) => console.log(`\n[${new Date().toISOString().slice(11, 19)}] ${msg}`);

// Row counts per table via query_to_xml — pg_stat_user_tables.n_live_tup is an
// estimate that reads 0 on a freshly loaded table and would fake a passing verify.
const COUNTS_SQL = `
  SELECT table_name || '=' || (xpath('/row/c/text()',
      query_to_xml(format('SELECT count(*) AS c FROM %I.%I', table_schema, table_name),
                   false, true, '')))[1]::text
  FROM information_schema.tables
  WHERE table_schema='public' AND table_type='BASE TABLE'
    AND table_name <> ALL(ARRAY[${EXCLUDED.map((t) => `'${t}'`).join(",")}])
  ORDER BY table_name;`;

const parseCounts = (raw) =>
  Object.fromEntries(
    raw
      .split("\n")
      .filter(Boolean)
      .map((l) => {
        const [t, c] = l.split("=");
        return [t, Number(c)];
      })
  );

// ─────────────────── lockdown (also runnable standalone) ───────────────────

// Must run AFTER migrate deploy, never AS a migration: a timestamped migration only
// covers the tables that exist when it runs, so every migration written later ships an
// exposed table. Re-run after each deploy: `npm run db:lockdown`.
function runLockdown() {
  step("Locking down the Data API (revoke anon/authenticated + RLS deny-all)");
  const res = spawnSync(
    tool("psql"),
    [toLibpqUrl(TARGET_URL), "-X", "-v", "ON_ERROR_STOP=1", "--single-transaction", "-f", LOCKDOWN_SQL],
    { encoding: "utf8", stdio: ["ignore", "inherit", "inherit"] }
  );
  if (res.status !== 0) {
    console.error(
      "\nERROR: lockdown failed — the Data API may be OPEN.\n" +
        "Do not expose this project until `npm run db:lockdown` succeeds."
    );
    process.exit(1);
  }
}

if (LOCKDOWN_ONLY) {
  console.log(`  target : ${redact(TARGET_URL)}`);
  runLockdown();
  console.log("\nDONE — lockdown applied and verified.");
  process.exit(0);
}

// ─────────────────── 1. preflight ───────────────────

step("Preflight");

const sourceVersion = psql(SOURCE_URL, "SHOW server_version;");
console.log(`  source : ${redact(SOURCE_URL)}  (Postgres ${sourceVersion})`);

let targetVersion;
try {
  targetVersion = psql(TARGET_URL, "SHOW server_version;");
} catch (e) {
  console.error(`\nERROR: cannot reach the target.\n  ${e.message}`);
  process.exit(1);
}
console.log(`  target : ${redact(TARGET_URL)}  (Postgres ${targetVersion})`);

const sourceCounts = parseCounts(psql(SOURCE_URL, COUNTS_SQL));
const sourceTotal = Object.values(sourceCounts).reduce((a, b) => a + b, 0);
const populated = Object.entries(sourceCounts).filter(([, c]) => c > 0);
console.log(`  source holds ${sourceTotal} rows across ${populated.length} populated tables`);

// The whole point of the exercise — call it out by name so a silent miss is visible.
const LMS = ["student", "enrollment", "gn_batch", "gn_module", "gn_recording", "gn_post", "gn_workshop"];
console.log(`  LMS    : ${LMS.map((t) => `${t}=${sourceCounts[t] ?? 0}`).join("  ")}`);

if (Number(sourceTotal) === 0) {
  console.error("\nERROR: source is empty. Is the local db running? (npm run db:local)");
  process.exit(1);
}

if (DRY_RUN) {
  console.log("\n--dry-run: preflight passed, nothing written.");
  process.exit(0);
}

// ─────────────────── 2. schema via migrations ───────────────────

step("Applying 40 migrations to the target (schema + triggers + constraints)");

const migrate = spawnSync("npx", ["prisma", "migrate", "deploy"], {
  cwd: ROOT,
  encoding: "utf8",
  stdio: "inherit",
  shell: process.platform === "win32",
  // migrate deploy reads DIRECT_URL for DDL; pin both so a stale .env cannot
  // point this at the local database and "migrate" it onto itself.
  env: { ...process.env, DATABASE_URL: TARGET_URL, DIRECT_URL: TARGET_URL },
});
if (migrate.status !== 0) {
  console.error("\nERROR: prisma migrate deploy failed. Target left with schema only, no data.");
  process.exit(1);
}

// ─────────────────── 3. guard: refuse to double-load ───────────────────

step("Checking the target is empty");

const preCounts = parseCounts(psql(TARGET_URL, COUNTS_SQL));
const preTotal = Object.values(preCounts).reduce((a, b) => a + b, 0);

if (preTotal > 0 && !FORCE) {
  const nonEmpty = Object.entries(preCounts)
    .filter(([, c]) => c > 0)
    .map(([t, c]) => `${t}=${c}`)
    .join(", ");
  console.error(
    `\nERROR: target already holds ${preTotal} rows (${nonEmpty}).\n` +
      "Loading again would duplicate them. Re-run with --force only if you intend that,\n" +
      "or reset the target first: npx prisma migrate reset"
  );
  process.exit(1);
}
console.log(`  target is empty (${preTotal} rows) — safe to load`);

// ─────────────────── 4. dump data only ───────────────────

step("Dumping data from source (data-only; portable across versions)");

mkdirSync(OUT_DIR, { recursive: true });

execFileSync(
  tool("pg_dump"),
  [
    toLibpqUrl(SOURCE_URL),
    "--data-only",
    "--no-owner",
    "--no-privileges",
    "--no-comments",
    ...EXCLUDED.flatMap((t) => ["--exclude-table", t]),
    "-f",
    DATA_SQL,
  ],
  { stdio: "inherit" }
);
console.log(`  wrote ${path.relative(ROOT, DATA_SQL)}`);

// ─────────────────── 5. load ───────────────────

step("Loading into the target (triggers + FK checks suspended for the session)");

// One transaction: either every table lands or the target stays empty. A partial load
// of a double-entry ledger is worse than no load.
const load = spawnSync(
  tool("psql"),
  [
    toLibpqUrl(TARGET_URL),
    "-X",
    "-v",
    "ON_ERROR_STOP=1",
    "--single-transaction",
    "-c",
    "SET session_replication_role = replica;",
    "-f",
    DATA_SQL,
  ],
  { encoding: "utf8", stdio: ["ignore", "inherit", "pipe"] }
);
if (load.status !== 0) {
  console.error(`\nERROR: load failed, transaction rolled back — target still has no data.\n${load.stderr}`);
  process.exit(1);
}

// ─────────────────── 6. verify ───────────────────

step("Verifying row-count parity");

const targetCounts = parseCounts(psql(TARGET_URL, COUNTS_SQL));
const mismatches = Object.entries(sourceCounts).filter(([t, c]) => (targetCounts[t] ?? 0) !== c);

for (const [t, c] of populated) {
  const got = targetCounts[t] ?? 0;
  console.log(`  ${got === c ? "ok  " : "FAIL"} ${t.padEnd(28)} ${String(c).padStart(5)} -> ${got}`);
}

if (mismatches.length > 0) {
  console.error(`\nFAILED: ${mismatches.length} table(s) do not match.`);
  process.exit(1);
}

// Sequences are NOT advanced by a data-only COPY. This schema uses cuid() text ids
// almost everywhere, but any serial column left at 1 would collide on the next insert.
step("Resyncing sequences");
const seqFixed = psql(
  TARGET_URL,
  `DO $$
   DECLARE r record; last bigint;
   BEGIN
     FOR r IN
       SELECT s.relname AS seq, t.relname AS tbl, a.attname AS col
       FROM pg_class s
       JOIN pg_depend d ON d.objid = s.oid AND d.deptype = 'a'
       JOIN pg_class t ON t.oid = d.refobjid
       JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = d.refobjsubid
       WHERE s.relkind = 'S' AND t.relnamespace = 'public'::regnamespace
     LOOP
       EXECUTE format('SELECT COALESCE(max(%I), 0) FROM public.%I', r.col, r.tbl) INTO last;
       -- Pass values as arguments, not through format(): %s on a boolean renders
       -- Postgres's f/t, which is not a valid SQL literal.
       -- last = 0 (empty table) -> is_called false, so nextval() still returns 1.
       PERFORM setval(format('public.%I', r.seq)::regclass, GREATEST(last, 1), last > 0);
     END LOOP;
   END $$;
   SELECT count(*) FROM pg_class WHERE relkind='S' AND relnamespace='public'::regnamespace;`
);
// psql echoes the DO block's "DO" tag before the SELECT result; keep the count.
console.log(`  ${seqFixed.split("\n").pop().trim()} sequence(s) resynced`);

// ─────────────────── 7. lock down the Data API ───────────────────

runLockdown();

console.log(
  `\nDONE — ${sourceTotal} rows in Supabase, verified table by table.\n\n` +
    "Next:\n" +
    "  1. Point .env at Supabase (see .env.supabase.example) — app DATABASE_URL uses the\n" +
    "     POOLER (:6543) with ?pgbouncer=true; DIRECT_URL keeps :5432 for migrations.\n" +
    "  2. Confirm the lockdown took: Data API should see nothing.\n" +
    "       psql <target> -c \"SET ROLE anon; SELECT count(*) FROM lead;\"   -- expect: permission denied\n" +
    "  3. Rotate every secret in .env — they have lived in a local file.\n"
);

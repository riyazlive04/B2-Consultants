// Local dev Postgres WITHOUT Docker.
//
// Uses the binaries of an existing PostgreSQL installation (initdb/pg_ctl/psql)
// to run a project-local instance with its own data directory (.pgdata/), on
// the same port and credentials as the docker-compose db service — so the
// DATABASE_URL from .env.example works unchanged:
//
//   postgresql://b2:b2@localhost:5435/b2_dashboard?schema=public
//
// Usage:
//   node scripts/local-db.mjs start    # initdb on first run, then start + create db
//   node scripts/local-db.mjs stop
//   node scripts/local-db.mjs status
//
// Binary discovery: $PG_BIN if set, else newest version under the platform's
// default install root, else whatever is on PATH.

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DATA_DIR = path.join(ROOT, ".pgdata");
const LOG_FILE = path.join(DATA_DIR, "server.log");
const PORT = process.env.PG_LOCAL_PORT ?? "5435";
const SUPERUSER = "b2";
const DB_NAME = "b2_dashboard";

function findBinDir() {
  if (process.env.PG_BIN) return process.env.PG_BIN;
  const installRoots =
    process.platform === "win32"
      ? ["C:\\Program Files\\PostgreSQL"]
      : ["/usr/lib/postgresql", "/opt/homebrew/opt", "/usr/local/opt"];
  for (const root of installRoots) {
    if (!existsSync(root)) continue;
    const versions = readdirSync(root)
      .filter((v) => /^\d/.test(v))
      .sort((a, b) => parseFloat(b) - parseFloat(a));
    for (const v of versions) {
      const bin = path.join(root, v, "bin");
      if (existsSync(bin)) return bin;
    }
  }
  return ""; // fall back to PATH
}

const BIN = findBinDir();
const tool = (name) => (BIN ? path.join(BIN, name) : name);

function run(name, args, opts = {}) {
  return execFileSync(tool(name), args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts });
}

function isRunning() {
  try {
    run("pg_ctl", ["status", "-D", DATA_DIR]);
    return true;
  } catch {
    return false;
  }
}

function start() {
  if (!existsSync(path.join(DATA_DIR, "PG_VERSION"))) {
    console.log(`Initializing ${DATA_DIR} ...`);
    // trust auth: local-only dev instance; the b2/b2 password in DATABASE_URL is simply ignored
    run("initdb", ["-D", DATA_DIR, "-U", SUPERUSER, "-A", "trust", "-E", "UTF8", "--locale=C"]);
  }
  if (isRunning()) {
    console.log("Postgres already running.");
  } else {
    console.log(`Starting Postgres on port ${PORT} ...`);
    run("pg_ctl", ["start", "-D", DATA_DIR, "-l", LOG_FILE, "-o", `-p ${PORT}`]);
  }
  const exists = run("psql", [
    "-h", "localhost", "-p", PORT, "-U", SUPERUSER, "-d", "postgres",
    "-tAc", `SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'`,
  ]).trim();
  if (exists !== "1") {
    console.log(`Creating database ${DB_NAME} ...`);
    run("createdb", ["-h", "localhost", "-p", PORT, "-U", SUPERUSER, DB_NAME]);
  }
  console.log(`Ready: postgresql://${SUPERUSER}:${SUPERUSER}@localhost:${PORT}/${DB_NAME}`);
}

function stop() {
  if (!isRunning()) {
    console.log("Postgres is not running.");
    return;
  }
  run("pg_ctl", ["stop", "-D", DATA_DIR, "-m", "fast"]);
  console.log("Stopped.");
}

const cmd = process.argv[2];
try {
  if (cmd === "start") start();
  else if (cmd === "stop") stop();
  else if (cmd === "status") console.log(isRunning() ? "running" : "stopped");
  else {
    console.error("Usage: node scripts/local-db.mjs <start|stop|status>");
    process.exit(1);
  }
} catch (err) {
  console.error(err.stderr?.toString() || err.message);
  process.exit(1);
}

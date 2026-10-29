// Generate the secrets for a self-hosted Supabase stack.
//
// ── WHY THIS SCRIPT EXISTS ────────────────────────────────────────────────────────────────────
// `supabase/docker/.env.example` ships a WORKING `ANON_KEY` and `SERVICE_ROLE_KEY`. They are not
// placeholders in the way `your-super-secret-...` is a placeholder - they are valid HS256 JWTs
// with `"iss": "supabase-demo"`, signed by the example `JWT_SECRET`, and they are published in
// every copy of the Supabase repository on earth.
//
// So a stack brought up on the defaults is not "insecure pending hardening". It is a database
// anyone can read and write as `service_role`, which is BYPASSRLS - row-level security does not
// apply to it, and neither does the `anon` revocation in scripts/supabase-lockdown.sql. The only
// thing standing between the internet and `lead` (PII), `agreement` (home addresses, IBANs) and
// the whole `journal_line` ledger would be whether anyone has portscanned the box yet.
//
// The keys must therefore be regenerated, and regenerating them by hand is the kind of task that
// produces a silent failure: a JWT with the wrong claim shape authenticates fine against the
// gateway and then fails deep inside PostgREST with a role error, or worse, works today and
// breaks on a gotrue upgrade. So: one script, no dependencies, verifiable output.
//
// ── WHY NO JWT LIBRARY ────────────────────────────────────────────────────────────────────────
// An HS256 JWT is three base64url segments and one HMAC. `node:crypto` does all of it. Adding
// `jsonwebtoken` to devDependencies to run this once per deployment is not a trade worth making,
// and the same precedent is already set by lib/supabase-storage.ts (raw fetch, no SDK).
//
// Usage:
//   node scripts/gen-supabase-keys.mjs                 # fresh everything, prints an .env block
//   node scripts/gen-supabase-keys.mjs --verify         # re-derive from an existing JWT_SECRET
//
// With --verify, JWT_SECRET is read from the environment and the ANON_KEY / SERVICE_ROLE_KEY it
// implies are printed. Use it to check that a stack's keys actually match its secret, which is
// the one thing you cannot tell by looking at them.

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const VERIFY = process.argv.includes("--verify");

// ─────────────────────────── JWT ───────────────────────────

const b64url = (buf) =>
  Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/**
 * Sign an HS256 JWT.
 *
 * The claim shape deliberately MIRRORS the demo keys rather than improving on them: `role`,
 * `iss`, `iat`, `exp` and nothing else. PostgREST reads `role` to decide which Postgres role to
 * `SET ROLE` to; gotrue and storage-api read `role` to recognise a service call. Extra claims are
 * at best ignored and at worst (`aud`, `sub`) interpreted - an `aud` mismatch is a 401 whose
 * message names the audience, not the cause.
 */
function signJwt(secret, role, { years = 10 } = {}) {
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + Math.floor(years * 365.25 * 24 * 60 * 60);
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify({ role, iss: "supabase", iat, exp }));
  const body = `${header}.${payload}`;
  const sig = b64url(createHmac("sha256", secret).update(body).digest());
  return { token: `${body}.${sig}`, exp };
}

/** Decode without verifying - for printing what a key actually claims. */
function decode(token) {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(Buffer.from(parts[1].replace(/-/g, "+").replace(/_/g, "/"), "base64"));
  } catch {
    return null;
  }
}

// ─────────────────────────── secrets ───────────────────────────

/**
 * Base64 without the characters that break a `.env` file or a libpq URL.
 *
 * `POSTGRES_PASSWORD` ends up inside `postgresql://postgres:PW@db:5432/postgres`, where `@`, `:`,
 * `/`, `#` and `?` are all structural. docs/SUPABASE_MIGRATION.md documents percent-encoding as
 * trap #3 for exactly this reason, and the error it produces points at DNS, not at the password.
 * Generating a password that cannot trip the trap is cheaper than documenting the trap again.
 * 32 bytes of base64url is ~192 bits of entropy; losing a few symbols costs nothing real.
 */
const safeSecret = (bytes = 32) =>
  randomBytes(bytes).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** Hex, for the fixed-length keys that are measured in characters rather than bits. */
const hexSecret = (chars) => randomBytes(Math.ceil(chars / 2)).toString("hex").slice(0, chars);

// ─────────────────────────── main ───────────────────────────

if (VERIFY) {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    console.error(
      "ERROR: --verify needs JWT_SECRET in the environment.\n" +
        "  On the box:  set -a; . ./.env; set +a; node scripts/gen-supabase-keys.mjs --verify"
    );
    process.exit(1);
  }
  if (secret.length < 32) {
    console.error(`ERROR: JWT_SECRET is ${secret.length} chars; gotrue requires at least 32.`);
    process.exit(1);
  }

  console.log(`JWT_SECRET is ${secret.length} chars. Keys it implies:\n`);
  for (const role of ["anon", "service_role"]) {
    const { token } = signJwt(secret, role);
    console.log(`${role.toUpperCase().padEnd(13)} ${token}`);
  }

  // The actual check: do the keys in the environment match the secret in the environment?
  let mismatch = false;
  for (const [name, role] of [
    ["ANON_KEY", "anon"],
    ["SERVICE_ROLE_KEY", "service_role"],
  ]) {
    const actual = process.env[name];
    if (!actual) continue;
    const claims = decode(actual);
    const [h, p, s] = actual.split(".");
    const expected = b64url(createHmac("sha256", secret).update(`${h}.${p}`).digest());
    const sigOk =
      s?.length === expected.length && timingSafeEqual(Buffer.from(s), Buffer.from(expected));

    console.log(`\n${name}:`);
    console.log(`  iss       ${claims?.iss ?? "(unreadable)"}`);
    console.log(`  role      ${claims?.role ?? "(unreadable)"}`);
    console.log(`  expires   ${claims?.exp ? new Date(claims.exp * 1000).toISOString() : "?"}`);
    console.log(`  signature ${sigOk ? "VALID for this JWT_SECRET" : "DOES NOT MATCH JWT_SECRET"}`);

    if (!sigOk) mismatch = true;
    if (claims?.iss === "supabase-demo") {
      console.log(
        `  ⚠  iss is "supabase-demo" - this is the PUBLISHED example key. Anyone can mint it.`
      );
      mismatch = true;
    }
    if (claims?.role !== role) {
      console.log(`  ⚠  role is "${claims?.role}", expected "${role}"`);
      mismatch = true;
    }
  }

  if (mismatch) {
    console.error("\nFAIL: at least one key is wrong. Do not expose this stack.");
    process.exit(1);
  }
  console.log("\nOK: keys match the secret and none is a demo key.");
  process.exit(0);
}

// Fresh generation.
const jwtSecret = hexSecret(64); // 64 hex chars - comfortably over gotrue's 32-char floor
const anon = signJwt(jwtSecret, "anon");
const service = signJwt(jwtSecret, "service_role");

console.log(`# Generated ${new Date().toISOString()} by scripts/gen-supabase-keys.mjs
# Paste into the self-hosted stack's .env (/root/supabase/docker/.env on the VPS).
#
# These REPLACE the published demo values. Do not commit this output; do not reuse it
# between environments. Every one of them is a credential.

POSTGRES_PASSWORD=${safeSecret(32)}
JWT_SECRET=${jwtSecret}
ANON_KEY=${anon.token}
SERVICE_ROLE_KEY=${service.token}

# Studio's only gate. Envoy enforces basic auth with these; there is no second factor
# and no lockout, so treat the dashboard as reachable by anyone who learns them.
DASHBOARD_USERNAME=b2admin
DASHBOARD_PASSWORD=${safeSecret(24)}

# Phoenix signing salt (realtime) - unused by this app, but realtime refuses to boot without it.
SECRET_KEY_BASE=${safeSecret(48)}
# EXACTLY 16 CHARACTERS. Realtime feeds this straight into :crypto as an aes_128_ecb key,
# and AES-128 takes a 16-BYTE key. Anything else dies at boot in a restart loop with
# "Bad key size" pointing at api_ng.c, which reads like a broken image rather than a bad
# value. Upstream's own default is the 16-char literal `supabaserealtime` - that is the tell.
REALTIME_DB_ENC_KEY=${hexSecret(16)}
# Exactly 32 characters, enforced by the pgsodium vault.
VAULT_ENC_KEY=${hexSecret(32)}
# postgres-meta's column-encryption key, 32 char minimum.
PG_META_CRYPTO_KEY=${hexSecret(32)}

# Logflare is no longer a service in the upstream compose, but the vars are still read
# by its .env and left empty breaks substitution on some compose versions.
LOGFLARE_PUBLIC_ACCESS_TOKEN=${hexSecret(32)}
LOGFLARE_PRIVATE_ACCESS_TOKEN=${hexSecret(32)}
`);

console.log(`# ANON_KEY expires     ${new Date(anon.exp * 1000).toISOString()}
# SERVICE_ROLE_KEY exp  ${new Date(service.exp * 1000).toISOString()}
#
# Ten years. These are not rotated on a schedule anywhere in this stack, and an expiry
# that lands mid-incident is worse than a long-lived key held properly. Diarise it or
# accept it, but know which you did.`);

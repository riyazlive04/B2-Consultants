import * as fs from "fs";
import { IS_PROD } from "./target";

type Cred = { email: string; password: string; role: string };

/** The role keys every spec signs in as. Local keys map to the seeded demo accounts. */
const KEYS = ["admin", "head", "asma", "nilofer", "student", "tutor", "gnStudent"] as const;
export type RoleKey = (typeof KEYS)[number];

/**
 * Credentials never live in code, for either target.
 *
 * The local demo passwords are the ones `scripts/set-local-passwords.mjs` sets, and at least
 * one of them has also been used on a real production account. Committing them here would
 * publish a working production login, so both files are gitignored:
 *
 *   creds.local.json  - the seeded local accounts (see README for the shape)
 *   creds.prod.json   - admin supplied by the founder; the rest written by
 *                       tests/access/01-provision.spec.ts when it creates the E2E test accounts
 */
function load(): Record<RoleKey, Cred> {
  const f = IS_PROD ? "creds.prod.json" : "creds.local.json";
  if (!fs.existsSync(f)) {
    if (!IS_PROD) throw new Error(`e2e: ${f} is missing - copy creds.example.json to it and fill in the local passwords`);
    return {} as Record<RoleKey, Cred>;
  }
  return JSON.parse(fs.readFileSync(f, "utf8"));
}
export const ROLES = load();
export const authFile = (r: RoleKey) => `.auth/${IS_PROD ? "prod" : "local"}-${r}.json`;

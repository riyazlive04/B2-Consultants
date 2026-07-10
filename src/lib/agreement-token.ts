import "server-only";
import { createHash, randomBytes, randomInt, timingSafeEqual } from "crypto";
import { AGREEMENT_TTL_DAYS, OTP_TTL_MINUTES } from "./agreement";

/**
 * Signing links and one-time codes.
 *
 * Same shape as `invite-token.ts`, and for the same reason: only the SHA-256 lands in the
 * database, so a leaked `agreement` row cannot be redeemed. 32 random bytes is 256 bits of
 * entropy; the lookup is a single equality probe on a unique index, so there is no timing
 * signal to defend against beyond never comparing raw tokens.
 *
 * The OTP is different. Six digits is only ~20 bits, so it is defended by a short window, a
 * hard attempt cap, and a constant-time compare — the entropy is not doing the work.
 */

export function mintAgreementToken(): { token: string; tokenHash: string; expiresAt: Date } {
  const token = randomBytes(32).toString("base64url");
  return {
    token,
    tokenHash: hashAgreementToken(token),
    expiresAt: new Date(Date.now() + AGREEMENT_TTL_DAYS * 86400_000),
  };
}

export function hashAgreementToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** `randomInt` is the CSPRNG, not `Math.random()` — this code guards a contract signature. */
export function mintOtp(): { code: string; codeHash: string; expiresAt: Date } {
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  return {
    code,
    codeHash: hashOtp(code),
    expiresAt: new Date(Date.now() + OTP_TTL_MINUTES * 60_000),
  };
}

export function hashOtp(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

/**
 * Constant-time OTP check. Both sides are fixed-length SHA-256 hex, so `timingSafeEqual` never
 * throws on a length mismatch — but a malformed stored hash would, hence the guard.
 */
export function otpMatches(code: string, storedHash: string | null): boolean {
  if (!storedHash) return false;
  const a = Buffer.from(hashOtp(code), "hex");
  const b = Buffer.from(storedHash, "hex");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** SHA-256 of arbitrary bytes/string, hex. Used for `dataSha256` and the sealed `pdfSha256`. */
export function sha256Hex(input: string | Buffer | Uint8Array): string {
  return createHash("sha256").update(input).digest("hex");
}

/**
 * Copy bytes into a standalone ArrayBuffer.
 *
 * Node's `Buffer` (and anything sliced from one) is a view over a shared, pooled slab, so its
 * `.buffer` is 8KB of unrelated memory. Prisma's `Bytes` input demands a `Uint8Array<ArrayBuffer>`
 * precisely to rule that out — `new Uint8Array(buf)` alone still infers `ArrayBufferLike`, so the
 * ArrayBuffer has to be constructed explicitly.
 *
 * The return type is left to inference on purpose: annotating it `Uint8Array` would default the
 * type parameter back to `ArrayBufferLike` and undo the whole point.
 */
export function toOwnedBytes(src: Uint8Array) {
  const out = new Uint8Array(new ArrayBuffer(src.length));
  out.set(src);
  return out;
}

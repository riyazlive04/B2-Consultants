import "server-only";
import { createHash, randomBytes } from "crypto";

/**
 * One-time invite tokens.
 *
 * The token itself is only ever seen once, in the link the Admin copies. What lands
 * in the database is its SHA-256, so a leaked `user_invite` row cannot be redeemed —
 * the same reason you never store a password.
 *
 * 32 random bytes is 256 bits of entropy; a hash lookup on the (unique, indexed)
 * `tokenHash` column is a single equality probe, so there is no useful timing signal
 * to defend against here beyond never comparing raw tokens.
 */

export const INVITE_TTL_DAYS = 7;

export function mintInviteToken(): { token: string; tokenHash: string; expiresAt: Date } {
  const token = randomBytes(32).toString("base64url");
  return {
    token,
    tokenHash: hashInviteToken(token),
    expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 86400_000),
  };
}

export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** The password a freshly-invited account is parked on until the invitee sets their own.
 *  Never shown to anyone, never reused — it exists only because better-auth needs one. */
export function unguessablePlaceholderPassword(): string {
  return randomBytes(24).toString("base64url");
}

import crypto from "node:crypto";

/**
 * Svix webhook signature verification - the scheme Resend uses.
 *
 * Hand-rolled over `node:crypto` rather than pulling in the `svix` package, for the same reason
 * `lib/observability.ts` skips the Sentry SDK: this is forty lines of HMAC, and the dependency
 * would be a build-time cost for no behaviour we don't already have.
 *
 * It lives here, not in the route, because it is the only auth on a PUBLIC endpoint and
 * hand-rolled crypto that nothing can test is a bad trade. `src/app/api/resend/webhook/route.ts`
 * is its only caller.
 */

const TOLERANCE_SECONDS = 300;

export function verifySvixSignature(
  rawBody: string,
  svixId: string,
  svixTimestamp: string,
  svixSignature: string,
  secret: string,
  /** Injectable only so the replay window is testable; production always uses the real clock. */
  nowMs: number = Date.now(),
): boolean {
  const ts = Number(svixTimestamp);
  if (!Number.isFinite(ts) || Math.abs(nowMs / 1000 - ts) > TOLERANCE_SECONDS) return false;

  const secretBytes = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  if (secretBytes.length === 0) return false;
  const expected = crypto.createHmac("sha256", secretBytes).update(signedContent(svixId, svixTimestamp, rawBody)).digest();

  // svix-signature carries space-separated "v1,<base64sig>" entries (one per active signing key,
  // e.g. during secret rotation) - any match is valid.
  return svixSignature.split(" ").some((entry) => {
    const [version, sig] = entry.split(",");
    if (version !== "v1" || !sig) return false;
    try {
      const given = Buffer.from(sig, "base64");
      return given.length === expected.length && crypto.timingSafeEqual(given, expected);
    } catch {
      return false;
    }
  });
}

function signedContent(svixId: string, svixTimestamp: string, rawBody: string): string {
  return `${svixId}.${svixTimestamp}.${rawBody}`;
}

/** Sign a payload the way Svix would. Test/tooling helper - never used by the request path. */
export function signSvix(rawBody: string, svixId: string, svixTimestamp: string, secret: string): string {
  const secretBytes = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const mac = crypto
    .createHmac("sha256", secretBytes)
    .update(signedContent(svixId, svixTimestamp, rawBody))
    .digest("base64");
  return `v1,${mac}`;
}

import "server-only";
import { headers } from "next/headers";
import { normalizeDomain } from "@/lib/whatsapp";

/**
 * The hostname the visitor actually typed, for the request being handled.
 *
 * ── Why `x-forwarded-host` comes first ────────────────────────────────────────────
 * In production the app never sees the public hostname on `host`. Traefik terminates TLS and
 * forwards to Caddy, which forwards to the Next container, so `host` is whatever the last hop
 * addressed - a container name or `localhost:3000`. Reading it would record every prospect as
 * arriving from the internal network, and the WhatsApp domain gate would then be comparing
 * Ameen's real domains against a string no visitor has ever seen.
 *
 * ── This is trusted input, and that is acceptable HERE ────────────────────────────
 * A client can send any `x-forwarded-host` it likes. That matters for auth or for anything that
 * grants access; it does not matter for this, because the only thing the value can do is make
 * the domain gate MORE permissive for the sender's own record - and the gate already lets
 * unknown origins through. There is nothing to gain by forging it. Do not reuse this helper for
 * a decision where the host confers privilege.
 *
 * Returns null rather than a guess when the header is absent or unparseable: `Lead.originDomain`
 * distinguishes "not observed" from "observed", and only a real observation may be written.
 */
export async function observedOriginDomain(): Promise<string | null> {
  const h = await Promise.resolve(headers());
  const raw = h.get("x-forwarded-host") ?? h.get("host");
  if (!raw) return null;
  // A forwarded-host chain is comma-separated; the first entry is the original client-facing host.
  return normalizeDomain(raw.split(",")[0]);
}

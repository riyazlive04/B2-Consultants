import { NextResponse, type NextRequest } from "next/server";
import { upsertIntakeLead } from "@/server/lead-intake";
import { clientIpFrom, rateLimitOk } from "@/lib/rate-limit";
import { extractContact, extractUtm, secretMatches, unwrap } from "@/server/webhook-payload";

/**
 * FlexiFunnels / generic landing-page lead webhook (Wave-1 capture).
 *
 * FlexiFunnels (and most funnel builders) POST a flat JSON object of the opt-in fields.
 * We accept a permissive shape and pull the common contact fields case-insensitively, so
 * the same endpoint works for FlexiFunnels, a custom landing page, or a Zapier relay.
 * A lead arriving here is attributed LANDING_PAGE unconditionally; a relay carrying leads from
 * MIXED origins wants /api/leads/pabbly instead, which reads the origin off the payload.
 *
 * Auth: a shared secret via `x-webhook-secret` header or `?key=` query, checked against
 * FLEXIFUNNELS_WEBHOOK_SECRET. De-dupe: source+externalRef (payload id) then phone.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  // Fail CLOSED: without a configured secret this endpoint would accept
  // unauthenticated lead injection from anyone who finds the URL.
  const secret = process.env.FLEXIFUNNELS_WEBHOOK_SECRET;
  if (!secret) return new Response("Webhook not configured", { status: 503 });
  const provided = req.headers.get("x-webhook-secret") ?? req.nextUrl.searchParams.get("key");
  if (!provided || !secretMatches(provided, secret)) {
    return new Response("Unauthorized", { status: 401 });
  }

  // Even authenticated senders get a generous flood brake (bad Zapier loop etc.).
  if (!rateLimitOk(`ff:${clientIpFrom(req.headers)}`, 120, 60_000)) {
    return new Response("Too many requests", { status: 429 });
  }

  let body: Record<string, unknown>;
  try {
    const parsed = await req.json();
    body = (parsed && typeof parsed === "object" ? parsed : {}) as Record<string, unknown>;
  } catch {
    return new Response("Bad request", { status: 400 });
  }

  // TEMPORARY (LEAD_WEBHOOK_DEBUG): echo the raw body to the server log so a new sender's
  // exact field names can be read off a real delivery instead of guessed at. This prints
  // lead PII — turn the flag off once the mapping is confirmed. Logged after the secret
  // check, so an unauthenticated caller can never write to the log.
  if (process.env.LEAD_WEBHOOK_DEBUG === "true") {
    console.log(
      "[lead-webhook] raw inbound payload:",
      JSON.stringify({ keys: Object.keys(body), body }, null, 2).slice(0, 4000),
    );
  }
  const f = unwrap(body);
  const { name, phone, email, city, externalRef } = extractContact(f);

  if (!name || !phone) {
    return NextResponse.json({ ok: false, error: "name and phone are required" }, { status: 422 });
  }

  const utm = extractUtm(f);

  const { created, deduped } = await upsertIntakeLead({
    name,
    phone,
    email,
    city,
    leadSource: "LANDING_PAGE",
    source: "FLEXIFUNNELS",
    externalRef,
    utm: Object.keys(utm).length ? utm : null,
    notes: "Captured from FlexiFunnels / landing page",
  });

  return NextResponse.json({ ok: true, created, deduped });
}

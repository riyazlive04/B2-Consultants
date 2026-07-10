import crypto from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { upsertIntakeLead } from "@/server/lead-intake";
import { clientIpFrom, rateLimitOk } from "@/lib/rate-limit";

/**
 * FlexiFunnels / generic landing-page lead webhook (Wave-1 capture).
 *
 * FlexiFunnels (and most funnel builders) POST a flat JSON object of the opt-in fields.
 * We accept a permissive shape and pull the common contact fields case-insensitively, so
 * the same endpoint works for FlexiFunnels, a custom landing page, or a Zapier relay.
 *
 * Auth: a shared secret via `x-webhook-secret` header or `?key=` query, checked against
 * FLEXIFUNNELS_WEBHOOK_SECRET. De-dupe: source+externalRef (payload id) then phone.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function pick(obj: Record<string, unknown>, ...keys: string[]): string | undefined {
  const lower = new Map(Object.entries(obj).map(([k, v]) => [k.toLowerCase(), v]));
  for (const k of keys) {
    const v = lower.get(k);
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number") return String(v);
  }
  return undefined;
}

/** Constant-time string comparison - a plain !== leaks length/prefix timing. */
function secretMatches(provided: string, secret: string): boolean {
  const a = crypto.createHash("sha256").update(provided).digest();
  const b = crypto.createHash("sha256").update(secret).digest();
  return crypto.timingSafeEqual(a, b);
}

const cap = (v: string | undefined, max: number) => (v ? v.slice(0, max) : v);

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
  // Some builders nest the fields under `data`/`contact`/`fields`.
  const src = (["data", "contact", "fields", "payload"] as const)
    .map((k) => body[k])
    .find((v) => v && typeof v === "object") as Record<string, unknown> | undefined;
  const f = src ?? body;

  // Length caps: webhook fields go straight into DB text columns.
  const name = cap(pick(f, "name", "full_name", "fullname", "first_name", "fname"), 160);
  const phone = cap(pick(f, "phone", "phone_number", "mobile", "whatsapp", "contact_number"), 32);
  const email = cap(pick(f, "email", "email_address"), 254);
  const city = cap(pick(f, "city", "location"), 120);
  const externalRef = cap(
    pick(f, "id", "lead_id", "submission_id", "contact_id") ?? (email ? `email:${email}` : undefined),
    300,
  );

  if (!name || !phone) {
    return NextResponse.json({ ok: false, error: "name and phone are required" }, { status: 422 });
  }

  // Attribution: forward any utm_* fields present in the payload (bounded).
  const utm: Record<string, string> = {};
  for (const [k, v] of Object.entries(f)) {
    if (Object.keys(utm).length >= 10) break;
    if (k.toLowerCase().startsWith("utm_") && typeof v === "string" && v) {
      utm[k.toLowerCase().slice(0, 64)] = v.slice(0, 200);
    }
  }

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

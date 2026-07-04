import { NextResponse, type NextRequest } from "next/server";
import { upsertIntakeLead } from "@/server/lead-intake";

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

export async function POST(req: NextRequest) {
  const secret = process.env.FLEXIFUNNELS_WEBHOOK_SECRET;
  if (secret) {
    const provided = req.headers.get("x-webhook-secret") ?? req.nextUrl.searchParams.get("key");
    if (provided !== secret) return new Response("Unauthorized", { status: 401 });
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

  const name = pick(f, "name", "full_name", "fullname", "first_name", "fname");
  const phone = pick(f, "phone", "phone_number", "mobile", "whatsapp", "contact_number");
  const email = pick(f, "email", "email_address");
  const city = pick(f, "city", "location");
  const externalRef =
    pick(f, "id", "lead_id", "submission_id", "contact_id") ?? (email ? `email:${email}` : undefined);

  if (!name || !phone) {
    return NextResponse.json({ ok: false, error: "name and phone are required" }, { status: 422 });
  }

  // Attribution: forward any utm_* fields present in the payload.
  const utm: Record<string, string> = {};
  for (const [k, v] of Object.entries(f)) {
    if (k.toLowerCase().startsWith("utm_") && typeof v === "string" && v) utm[k.toLowerCase()] = v;
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

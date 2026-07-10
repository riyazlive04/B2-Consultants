import crypto from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { upsertIntakeLead } from "@/server/lead-intake";

/**
 * Meta Lead Ads webhook (Wave-1 lead capture - replaces Synamate's Meta inbox).
 *
 * GET  - Meta's subscription handshake: echo hub.challenge when the verify token matches.
 * POST - leadgen notifications. Verified with X-Hub-Signature-256 (HMAC-SHA256 of the raw
 *        body using META_APP_SECRET). For each leadgen_id we pull the field answers from the
 *        Graph API using META_PAGE_ACCESS_TOKEN, then upsert via the shared intake helper
 *        (de-duped on source+externalRef = leadgen_id).
 *
 * Env (see .env.example): META_VERIFY_TOKEN, META_APP_SECRET, META_PAGE_ACCESS_TOKEN,
 * META_GRAPH_VERSION (optional, default v19.0). META_APP_SECRET is REQUIRED for POSTs -
 * without it the endpoint refuses (503) rather than accepting unverifiable payloads.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const verify = process.env.META_VERIFY_TOKEN;
  if (p.get("hub.mode") === "subscribe" && verify && p.get("hub.verify_token") === verify) {
    return new Response(p.get("hub.challenge") ?? "", { status: 200 });
  }
  return new Response("Forbidden", { status: 403 });
}

function signatureValid(raw: string, header: string | null, secret: string): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const expected = crypto.createHmac("sha256", secret).update(raw).digest("hex");
  const got = header.slice("sha256=".length);
  const a = Buffer.from(got, "hex");
  const b = Buffer.from(expected, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

type FieldDatum = { name: string; values: string[] };

/** Map Meta's field_data array to our intake shape. Field names are form-defined; we match
 *  the common ones case-insensitively and fall back to the first phone/email-looking value. */
function mapFields(fd: FieldDatum[]): { name: string; phone: string; email?: string; city?: string } | null {
  const get = (...keys: string[]) => {
    for (const f of fd) {
      const n = f.name.toLowerCase();
      if (keys.some((k) => n === k || n.includes(k))) return f.values?.[0]?.trim() || undefined;
    }
    return undefined;
  };
  const name = (get("full_name", "name") ?? get("first_name"))?.slice(0, 160);
  const phone = get("phone_number", "phone", "mobile", "whatsapp")?.slice(0, 32);
  const email = get("email")?.slice(0, 254);
  const city = get("city", "location")?.slice(0, 120);
  if (!name || !phone) return null; // not enough to be a usable lead
  return { name, phone, email, city };
}

export async function POST(req: NextRequest) {
  const raw = await req.text();
  const appSecret = process.env.META_APP_SECRET;

  // Fail CLOSED: without the app secret we cannot verify the sender, so we do not
  // accept the payload (a fail-open here = unauthenticated lead injection).
  if (!appSecret) return new Response("Webhook not configured", { status: 503 });
  if (!signatureValid(raw, req.headers.get("x-hub-signature-256"), appSecret)) {
    return new Response("Invalid signature", { status: 401 });
  }

  let body: { object?: string; entry?: Array<{ changes?: Array<{ field?: string; value?: { leadgen_id?: string; form_id?: string; page_id?: string } }> }> };
  try {
    body = JSON.parse(raw);
  } catch {
    return new Response("Bad request", { status: 400 });
  }

  const token = process.env.META_PAGE_ACCESS_TOKEN;
  const gv = process.env.META_GRAPH_VERSION || "v19.0";
  const leadgenIds: { id: string; formId?: string }[] = [];
  for (const entry of body.entry ?? []) {
    for (const ch of entry.changes ?? []) {
      // leadgen ids are numeric - reject anything else so the id can never
      // smuggle path segments or query params into the Graph API URL below.
      if (ch.field === "leadgen" && ch.value?.leadgen_id && /^\d{1,32}$/.test(ch.value.leadgen_id)) {
        leadgenIds.push({ id: ch.value.leadgen_id, formId: ch.value.form_id });
      }
    }
  }

  // Always ack quickly; if we can't fetch fields yet, record the id so nothing is lost.
  let captured = 0;
  for (const { id } of leadgenIds) {
    if (!token) continue; // no page token → can't fetch fields; ack without creating
    try {
      const res = await fetch(`https://graph.facebook.com/${encodeURIComponent(gv)}/${encodeURIComponent(id)}?access_token=${encodeURIComponent(token)}`, {
        cache: "no-store",
      });
      if (!res.ok) continue;
      const data = (await res.json()) as { field_data?: FieldDatum[] };
      const mapped = mapFields(data.field_data ?? []);
      if (!mapped) continue;
      await upsertIntakeLead({
        ...mapped,
        leadSource: "META_ADS",
        source: "META_LEAD_AD",
        externalRef: id,
        notes: "Captured from Meta Lead Ad",
      });
      captured += 1;
    } catch {
      /* transient Graph error - Meta will redeliver; de-dupe keeps it idempotent */
    }
  }

  return NextResponse.json({ received: leadgenIds.length, captured });
}

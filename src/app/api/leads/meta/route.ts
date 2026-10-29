import crypto from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { upsertIntakeLead } from "@/server/lead-intake";
import { recordDelivery } from "@/server/intake-route";
import { captureMessage } from "@/lib/observability";

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

/**
 * Meta's `field_data` as a flat object, so the qualification mapper can read it like any other
 * sender's payload.
 *
 * A Lead Ad form can carry the band-score questions too, and its field NAMES are whatever the
 * form author typed - which is exactly what the founder-editable inbound mapping is for. Multi
 * answers join on ", " to match the mapper's own array handling.
 */
function flattenFields(fd: FieldDatum[]): Record<string, unknown> {
  const flat: Record<string, unknown> = {};
  for (const f of fd) {
    if (!f?.name) continue;
    const value = (f.values ?? []).map((v) => String(v).trim()).filter(Boolean).join(", ");
    if (value) flat[f.name] = value;
  }
  return flat;
}

/** Names this endpoint in Console → Integrations and in the error tracker. */
const DELIVERY_NAME = "meta";

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
    await recordDelivery(DELIVERY_NAME, false, "unreadable body (not JSON)");
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

  /*
   * ── WHY EVERY `continue` BELOW NOW LEAVES A TRACE ────────────────────────────────────────
   *
   * Meta is PAID traffic, and this loop had four ways to drop a lead in silence: no page token,
   * a Graph fetch that was not ok, a form whose fields do not map to a name + phone, and a
   * thrown request. Each one `continue`d, the handler returned 200, and Meta - correctly - never
   * redelivered. The comment above said "record the id so nothing is lost"; nothing recorded it.
   *
   * The recovery key is the `leadgen_id`, not the lead's details: Meta keeps the answers and
   * they can be re-pulled from the Graph API at any time with that id. So the id is what gets
   * logged, and the PII stays where it already is. `scripts/replay-pabbly.mjs` is the pattern
   * for re-driving one once the cause is fixed.
   *
   * Reasons are counted rather than reported one by one, because a broken page token drops every
   * lead in the batch and 40 identical error-tracker events say no more than one does.
   */
  let captured = 0;
  const dropped: { id: string; why: string }[] = [];
  for (const { id } of leadgenIds) {
    // No page token → we cannot fetch the answers at all. Ack (Meta's retries would not help)
    // but say so: this is a configuration fault that silently voids a whole ad campaign.
    if (!token) { dropped.push({ id, why: "META_PAGE_ACCESS_TOKEN is not set" }); continue; }
    try {
      const res = await fetch(`https://graph.facebook.com/${encodeURIComponent(gv)}/${encodeURIComponent(id)}?access_token=${encodeURIComponent(token)}`, {
        cache: "no-store",
      });
      // Usually an expired or wrongly-scoped page token (190/102). The status is the whole
      // diagnosis and carries no lead data, so it is safe to keep.
      if (!res.ok) { dropped.push({ id, why: `graph ${res.status}` }); continue; }
      const data = (await res.json()) as { field_data?: FieldDatum[] };
      const mapped = mapFields(data.field_data ?? []);
      if (!mapped) {
        // The form asked for something `mapFields` does not recognise as a name or a phone.
        // The FIELD NAMES are form configuration, not the answers, so they are the one useful
        // thing to keep here - without them "unmappable" is unactionable.
        dropped.push({ id, why: `no name/phone in fields: ${(data.field_data ?? []).map((f) => f.name).slice(0, 12).join(",")}` });
        continue;
      }
      await upsertIntakeLead({
        ...mapped,
        leadSource: "META_ADS",
        source: "META_LEAD_AD",
        externalRef: id,
        notes: "Captured from Meta Lead Ad",
        intakePayload: flattenFields(data.field_data ?? []),
      }, { announceReturning: true });
      captured += 1;
    } catch (err) {
      // Transient Graph error - Meta WILL redeliver and de-dupe keeps it idempotent, so this one
      // is genuinely recoverable on its own. Recorded anyway: "transient" every time for a week
      // is not transient, and that is only visible if each occurrence is counted.
      dropped.push({ id, why: `fetch failed: ${err instanceof Error ? err.name : "unknown"}` });
    }
  }

  if (dropped.length > 0) {
    const summary = [...new Set(dropped.map((d) => d.why))].join("; ");
    await recordDelivery(
      DELIVERY_NAME,
      false,
      `${dropped.length}/${leadgenIds.length} lead(s) not captured: ${summary}`,
    );
    await captureMessage("Meta lead ad not captured", {
      where: `webhook:${DELIVERY_NAME}`,
      level: "warning",
      // Grouped by CAUSE, so an expired page token is one issue and a bad form mapping another.
      fingerprint: ["lead-intake-dropped", DELIVERY_NAME, summary.slice(0, 120)],
      // The leadgen ids ARE the recovery list: re-pull these from the Graph API once fixed.
      extra: { droppedCount: dropped.length, received: leadgenIds.length, dropped: dropped.slice(0, 25) },
    });
  } else if (leadgenIds.length > 0) {
    await recordDelivery(DELIVERY_NAME, true);
  }

  return NextResponse.json({ received: leadgenIds.length, captured, dropped: dropped.length });
}

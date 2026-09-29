import { NextResponse, type NextRequest } from "next/server";
import { upsertIntakeLead } from "@/server/lead-intake";
import { recordDelivery } from "@/server/intake-route";
import { takeToken, tooManyRequests, RATE_RULES } from "@/lib/rate-limit";
import { extractContact, extractUtm, secretMatches, unwrap } from "@/server/webhook-payload";
import { getLeadWebhookConfig, LEAD_WEBHOOK_NAME } from "@/server/lead-webhook";

/**
 * B2 Consultants lead webhook - opt-ins from pages hosted OUTSIDE this app (e.g. a FlexiFunnels
 * page on the founder's own domain).
 *
 * Switched on and off by the founder in Console → Sales ops → Lead Webhook; see
 * server/lead-webhook.ts for what the switch means and why its key lives in the database.
 *
 * Auth: the Console-generated key via `x-webhook-secret` header or `?key=` query (FlexiFunnels'
 * form webhook only takes a URL, so the query form is the one it uses).
 * De-dupe: source+externalRef (payload id) then phone, then email - see upsertIntakeLead.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Funnel builders do not agree on an encoding: some POST JSON, some a plain HTML form post.
 * Accept both, so a sender's choice of encoding can never be the reason a lead is lost.
 */
async function readBody(req: NextRequest): Promise<Record<string, unknown> | null> {
  const type = req.headers.get("content-type")?.toLowerCase() ?? "";
  try {
    if (type.includes("application/x-www-form-urlencoded") || type.includes("multipart/form-data")) {
      const form = await req.formData();
      const out: Record<string, unknown> = {};
      for (const [k, v] of form.entries()) if (typeof v === "string") out[k] = v;
      return out;
    }
    const text = await req.text();
    if (!text.trim()) return {};
    try {
      const parsed = JSON.parse(text);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
    } catch {
      // No (or a wrong) content-type on a form-encoded body.
      const params = new URLSearchParams(text);
      const out = Object.fromEntries(params.entries());
      return Object.keys(out).length ? out : null;
    }
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  // Fail CLOSED: switched off, or on with no key, accepts nothing.
  const config = await getLeadWebhookConfig();
  if (!config.enabled || !config.key) return new Response("Webhook is switched off", { status: 503 });

  const provided = req.headers.get("x-webhook-secret") ?? req.nextUrl.searchParams.get("key");
  if (!provided || !secretMatches(provided, config.key)) {
    // Not recorded as a delivery: an unauthenticated caller must not write to the status row.
    return new Response("Unauthorized", { status: 401 });
  }

  const gate = takeToken(`webhook:${LEAD_WEBHOOK_NAME}`, RATE_RULES.leadWebhook);
  if (!gate.ok) return tooManyRequests(gate.retryAfterSec);

  const body = await readBody(req);
  if (!body) {
    await recordDelivery(LEAD_WEBHOOK_NAME, false, "unreadable body");
    return new Response("Bad request", { status: 400 });
  }

  // TEMPORARY (LEAD_WEBHOOK_DEBUG): echo the raw body so a new sender's exact field names can be
  // read off a real delivery instead of guessed at. Prints lead PII - turn the flag off once the
  // mapping is confirmed. After the key check, so an unauthenticated caller can never write to
  // the log.
  if (process.env.LEAD_WEBHOOK_DEBUG === "true") {
    console.log(
      `[${LEAD_WEBHOOK_NAME}] raw inbound payload:`,
      JSON.stringify({ keys: Object.keys(body), body }, null, 2).slice(0, 4000),
    );
  }

  try {
    const f = unwrap(body);
    const { name, phone, email, city, externalRef } = extractContact(f);

    if (!name || !phone) {
      await recordDelivery(LEAD_WEBHOOK_NAME, false, "name and phone are required");
      return NextResponse.json({ ok: false, error: "name and phone are required" }, { status: 422 });
    }

    const utm = extractUtm(f);

    const { created, deduped, reopened } = await upsertIntakeLead({
      name,
      phone,
      email,
      city,
      leadSource: "LANDING_PAGE",
      // The Source value is unchanged from the old /api/leads/flexifunnels route, so reporting
      // and the instant intro message treat these leads exactly as before.
      source: "FLEXIFUNNELS",
      externalRef,
      utm: Object.keys(utm).length ? utm : null,
      notes: "Captured from the B2 Consultants lead webhook",
      // A page that asks the band-score questions gets scored at opt-in. The mapping is
      // founder-editable, so this route hands over the whole payload.
      intakePayload: f,
    }, { announceReturning: true });

    await recordDelivery(LEAD_WEBHOOK_NAME, true);
    return NextResponse.json({ ok: true, created, deduped, reopened });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    console.error(`[${LEAD_WEBHOOK_NAME}] capture failed:`, err);
    await recordDelivery(LEAD_WEBHOOK_NAME, false, message);
    // 500, not 200: the sender should retry - there is no second chance at a lead.
    return NextResponse.json({ ok: false, error: "Capture failed" }, { status: 500 });
  }
}

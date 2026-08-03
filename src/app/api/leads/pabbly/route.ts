import { NextResponse, type NextRequest } from "next/server";
import { upsertIntakeLead } from "@/server/lead-intake";
import { takeToken, tooManyRequests, RATE_RULES } from "@/lib/rate-limit";
import {
  cap,
  extractContact,
  extractUtm,
  pick,
  pickLeadSourceHint,
  secretMatches,
  toLeadSource,
  unwrap,
} from "@/server/webhook-payload";

/**
 * Pabbly Connect lead relay.
 *
 * Pabbly already routes every inbound opt-in to Synamate; this endpoint is added as a SECOND
 * action on the same Pabbly workflow so the lead lands here too. The two destinations are
 * independent — Pabbly failing to reach us does not disturb the Synamate step, and vice versa.
 *
 * Because one Pabbly workflow can carry leads from several origins (Meta ad, IG DM, landing
 * page), the origin travels in the payload as a `lead_source` field and is mapped onto the
 * LeadSource enum; `source` is always PABBLY (the pipe, not the origin).
 *
 * Auth: shared secret via `x-webhook-secret` header or `?key=` query, checked against
 * PABBLY_WEBHOOK_SECRET. De-dupe: source+externalRef (Pabbly's record id) then phone.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  // Fail CLOSED: without a configured secret this would accept unauthenticated lead
  // injection from anyone who finds the URL.
  const secret = process.env.PABBLY_WEBHOOK_SECRET;
  if (!secret) return new Response("Webhook not configured", { status: 503 });
  const provided = req.headers.get("x-webhook-secret") ?? req.nextUrl.searchParams.get("key");
  if (!provided || !secretMatches(provided, secret)) {
    return new Response("Unauthorized", { status: 401 });
  }

  // Even an authenticated sender gets a flood brake — a misconfigured Pabbly workflow can
  // retry-loop, and lead capture is not a place to discover that via the DB.
  //
  // Keyed on the ENDPOINT, not the caller's IP. Every delivery arrives from Pabbly's egress
  // address, so a per-IP bucket here was already a global bucket wearing a disguise — and one
  // that silently resets to a fresh allowance the day Pabbly changes IP. Naming it what it is
  // makes the ceiling honest.
  //
  // The 429 now carries `Retry-After`. That is the substantive fix: Pabbly honours it and
  // REDELIVERS. The previous bare 429 told it nothing, so a throttled lead was simply lost —
  // a rate limiter that drops real leads is worse than no rate limiter.
  const gate = takeToken("webhook:pabbly", RATE_RULES.leadWebhook);
  if (!gate.ok) return tooManyRequests(gate.retryAfterSec);

  let body: Record<string, unknown>;
  try {
    const parsed = await req.json();
    body = (parsed && typeof parsed === "object" ? parsed : {}) as Record<string, unknown>;
  } catch {
    return new Response("Bad request", { status: 400 });
  }

  // TEMPORARY (LEAD_WEBHOOK_DEBUG): echo the raw body so Pabbly's exact field names can be read
  // off a real delivery instead of guessed at. Prints lead PII — turn off once mapping is
  // confirmed. After the secret check, so an unauthenticated caller can never write to the log.
  if (process.env.LEAD_WEBHOOK_DEBUG === "true") {
    console.log(
      "[pabbly-webhook] raw inbound payload:",
      JSON.stringify({ keys: Object.keys(body), body }, null, 2).slice(0, 4000),
    );
  }

  const f = unwrap(body);
  const { name, phone, email, city, externalRef } = extractContact(f);

  if (!name || !phone) {
    return NextResponse.json({ ok: false, error: "name and phone are required" }, { status: 422 });
  }

  // Origin attribution. An unmapped hint lands as OTHER rather than a plausible guess — but say
  // so in the log, because "all our Pabbly leads are OTHER" is otherwise a silent reporting hole.
  const hint = pickLeadSourceHint(f);
  const leadSource = toLeadSource(hint);
  if (hint && !leadSource) {
    console.warn(`[pabbly-webhook] unmapped lead_source ${JSON.stringify(hint.slice(0, 64))} → OTHER`);
  }

  const utm = extractUtm(f);
  const campaign = cap(pick(f, "campaign", "campaign_name", "utm_campaign", "form_name"), 120);

  const { created, deduped, reopened } = await upsertIntakeLead({
    name,
    phone,
    email,
    city,
    leadSource: leadSource ?? "OTHER",
    source: "PABBLY",
    externalRef,
    utm: Object.keys(utm).length ? utm : null,
    notes: campaign ? `Captured via Pabbly — ${campaign}` : "Captured via Pabbly",
    // The landing page asks the band-score questions and Pabbly relays them in this same body.
    // Handing over the WHOLE payload rather than a hand-picked subset is the point: which fields
    // are answers is a founder-editable mapping (Console → Qualification), so this route must not
    // decide it. Everything unrecognised is recorded as evidence and reported, never silently
    // dropped — which is what happened to every landing-page score before this line existed.
    intakePayload: f,
  });

  // `reopened` distinguishes the two 200s that used to look identical: a genuine retry, versus a
  // dormant lead this opt-in just put back in front of a caller. Without it, "we got a 200" said
  // nothing about whether anyone would ever see the lead.
  return NextResponse.json({ ok: true, created, deduped, reopened, leadSource: leadSource ?? "OTHER" });
}

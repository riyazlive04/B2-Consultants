import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { takeToken, tooManyRequests, RATE_RULES } from "@/lib/rate-limit";
import { secretMatches, unwrap } from "./webhook-payload";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

/**
 * The shared shape of every inbound-capture endpoint.
 *
 * ── Why a factory ───────────────────────────────────────────────────────────────
 * `/api/leads/pabbly`, `/api/leads/meta` and `/api/leads/flexifunnels` each hand-roll the same
 * hundred lines: read the secret, compare it, take a rate token, parse the body, echo it under a
 * debug flag, unwrap the envelope. Three copies is where they start to differ — and they had
 * already begun to (only Pabbly echoes the raw payload, only Pabbly returns `reopened`).
 *
 * Adding a fourth source should be ~20 lines of MAPPING, not a hundred lines of plumbing, because
 * the plumbing is where the security lives.
 *
 * ── The contract every intake route keeps ───────────────────────────────────────
 *   FAIL CLOSED  — no configured secret means 503, never "accept anything". An open lead
 *                  endpoint is an open write into the CRM for whoever finds the URL.
 *   RATE LIMITED — keyed on the ENDPOINT, not the caller's IP: every delivery arrives from one
 *                  vendor address, so a per-IP bucket was a global bucket in disguise that also
 *                  reset the day the vendor changed egress.
 *   RETRY-ABLE   — a 429 carries `Retry-After`, which Pabbly and WATI both honour and redeliver
 *                  on. A bare 429 silently DROPS a real lead, which is worse than no limiter.
 *   OBSERVABLE   — every delivery stamps `lastDeliveryAt` so Console can show whether a webhook
 *                  is wired up at all. "Is this endpoint even receiving anything" had no answer.
 */

export type IntakeContext = {
  /** The payload, already unwrapped from any `data` / `fields` envelope. */
  fields: Record<string, unknown>;
  /** The raw body, for handlers that need something `unwrap` folded away. */
  body: Record<string, unknown>;
  req: NextRequest;
};

export type IntakeHandler = (ctx: IntakeContext) => Promise<Response>;

export type IntakeRouteOptions = {
  /** Stable id — names the rate-limit bucket and the delivery-status row. */
  name: string;
  /** The env var holding this endpoint's shared secret. */
  secretEnv: string;
  handler: IntakeHandler;
};

/** AppSetting key holding `{ [name]: { at, ok } }` — the Console "Integrations" card reads it. */
const STATUS_KEY = "integrationDeliveries";

/**
 * Record that a delivery arrived. Never throws and never blocks the response — this is
 * observability, and losing a status stamp must not cost a lead.
 */
export async function recordDelivery(name: string, ok: boolean, note?: string): Promise<void> {
  try {
    const row = await prisma.appSetting.findUnique({ where: { key: STATUS_KEY } });
    const current = (row?.value && typeof row.value === "object" ? row.value : {}) as Record<string, unknown>;
    const next: Prisma.InputJsonObject = {
      ...(current as Prisma.InputJsonObject),
      [name]: { at: new Date().toISOString(), ok, note: note?.slice(0, 200) ?? null },
    };
    await prisma.appSetting.upsert({
      where: { key: STATUS_KEY },
      create: { key: STATUS_KEY, value: next },
      update: { value: next },
    });
  } catch {
    /* observability must never break capture */
  }
}

export type DeliveryStatus = { name: string; at: string | null; ok: boolean; note: string | null };

/** What Console → Operations shows: has each endpoint ever delivered, and did it work? */
export async function readDeliveryStatuses(): Promise<Record<string, DeliveryStatus>> {
  const row = await prisma.appSetting.findUnique({ where: { key: STATUS_KEY } });
  const raw = (row?.value && typeof row.value === "object" ? row.value : {}) as Record<string, unknown>;
  const out: Record<string, DeliveryStatus> = {};
  for (const [name, v] of Object.entries(raw)) {
    const o = (v && typeof v === "object" ? v : {}) as { at?: unknown; ok?: unknown; note?: unknown };
    out[name] = {
      name,
      at: typeof o.at === "string" ? o.at : null,
      ok: o.ok !== false,
      note: typeof o.note === "string" ? o.note : null,
    };
  }
  return out;
}

/** Build a POST handler with the shared guards already applied. */
export function intakeRoute(opts: IntakeRouteOptions) {
  return async function POST(req: NextRequest): Promise<Response> {
    // FAIL CLOSED. Without a configured secret this would accept unauthenticated writes into
    // the CRM from anyone who found the URL.
    const secret = process.env[opts.secretEnv];
    if (!secret) return new Response("Webhook not configured", { status: 503 });

    const provided = req.headers.get("x-webhook-secret") ?? req.nextUrl.searchParams.get("key");
    if (!provided || !secretMatches(provided, secret)) {
      // Deliberately NOT recorded as a delivery: an unauthenticated caller must not be able to
      // write to our status row, or the Console card becomes a graffiti wall.
      return new Response("Unauthorized", { status: 401 });
    }

    const gate = takeToken(`webhook:${opts.name}`, RATE_RULES.leadWebhook);
    if (!gate.ok) return tooManyRequests(gate.retryAfterSec);

    let body: Record<string, unknown>;
    try {
      const parsed = await req.json();
      body = (parsed && typeof parsed === "object" ? parsed : {}) as Record<string, unknown>;
    } catch {
      await recordDelivery(opts.name, false, "unparseable JSON body");
      return new Response("Bad request", { status: 400 });
    }

    /**
     * TEMPORARY (LEAD_WEBHOOK_DEBUG): echo the raw body so a sender's exact field names can be
     * READ off a real delivery instead of guessed at. Prints lead PII — turn it off once the
     * mapping is confirmed. After the secret check, so an unauthenticated caller can never write
     * to the log.
     */
    if (process.env.LEAD_WEBHOOK_DEBUG === "true") {
      console.log(
        `[${opts.name}] raw inbound payload:`,
        JSON.stringify({ keys: Object.keys(body), body }, null, 2).slice(0, 4000),
      );
    }

    try {
      const res = await opts.handler({ fields: unwrap(body), body, req });
      await recordDelivery(opts.name, res.ok);
      return res;
    } catch (err) {
      const message = err instanceof Error ? err.message : "unknown error";
      console.error(`[${opts.name}] handler threw:`, err);
      await recordDelivery(opts.name, false, message);
      // 500, not 200: the sender should RETRY. Swallowing this into a 200 would tell Pabbly the
      // lead was captured when it was not, and there is no second chance at a lead.
      return NextResponse.json({ ok: false, error: "Capture failed" }, { status: 500 });
    }
  };
}

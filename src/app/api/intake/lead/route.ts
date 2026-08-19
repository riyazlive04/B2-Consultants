import { NextResponse } from "next/server";
import { upsertIntakeLead } from "@/server/lead-intake";
import { intakeRoute } from "@/server/intake-route";
import {
  cap,
  extractContact,
  extractUtm,
  pick,
  pickLeadSourceHint,
  toLeadSource,
} from "@/server/webhook-payload";

/**
 * The DIRECT lead endpoint - a landing page posts here itself, with no relay in between.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────────
 * Every inbound lead currently travels landing page → Pabbly → us. A relay is a place fields go
 * missing: it forwards what it was configured to forward, and it was configured before the
 * qualification questions existed. On 4 Aug 2026 production held 111 Pabbly leads, 13 configured
 * qualification questions, and ZERO scored leads - the answers were not arriving at all.
 *
 * Posting straight here removes the hop. Whatever the form collects reaches
 * `scoreLeadAtOptIn` verbatim, and anything unrecognised is recorded as evidence rather than
 * dropped, so a mapping problem becomes visible in Console → Qualification instead of silent.
 *
 * ── Relationship to the existing routes ─────────────────────────────────────────
 * ADDITIVE. `/api/leads/pabbly` keeps working exactly as it does; dedupe (`source` +
 * `externalRef`, then phone, then email) means a lead arriving down BOTH paths during a
 * cut-over is linked, not duplicated. Cut the relay over one form at a time and watch the
 * delivery counter in Console before retiring the old leg.
 *
 * Auth: `INTAKE_WEBHOOK_SECRET`, via the `x-webhook-secret` header or `?key=`. Same fail-closed,
 * rate-limited, retry-able contract as every other intake route - see `intakeRoute`.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = intakeRoute({
  name: "intake-lead",
  secretEnv: "INTAKE_WEBHOOK_SECRET",
  async handler({ fields }) {
    const { name, phone, email, city, externalRef } = extractContact(fields);

    // A lead with no way to reach them is not a lead. 422 rather than 400 so a sender can tell
    // "you sent me nonsense" apart from "you sent me a person with no phone number".
    if (!name || (!phone && !email)) {
      return NextResponse.json(
        { ok: false, error: "name and at least one of phone or email are required" },
        { status: 422 },
      );
    }

    const hint = pickLeadSourceHint(fields);
    const leadSource = toLeadSource(hint);
    if (hint && !leadSource) {
      // Loud on purpose: "all our leads are OTHER" is otherwise a silent reporting hole.
      console.warn(`[intake-lead] unmapped lead_source ${JSON.stringify(hint.slice(0, 64))} → OTHER`);
    }

    const utm = extractUtm(fields);
    const campaign = cap(pick(fields, "campaign", "campaign_name", "utm_campaign", "form_name"), 120);

    const { created, deduped, reopened } = await upsertIntakeLead({
      name,
      phone: phone || null,
      email,
      city,
      leadSource: leadSource ?? "OTHER",
      // NATIVE_FORM, not a new Source value: from the CRM's point of view this IS one of our own
      // forms - the only difference from a hosted form is who rendered it.
      source: "NATIVE_FORM",
      externalRef,
      utm: Object.keys(utm).length ? utm : null,
      notes: campaign ? `Direct opt-in - ${campaign}` : "Direct opt-in",
      /**
       * THE WHOLE PAYLOAD, deliberately. Which fields are qualification answers is a
       * founder-editable mapping (Console → Qualification), so this route must not decide it.
       * Everything unrecognised is stored as evidence and reported - which is the difference
       * between a mapping that can be fixed and one that fails silently forever.
       */
      intakePayload: fields,
    });

    return NextResponse.json({ ok: true, created, deduped, reopened, leadSource: leadSource ?? "OTHER" });
  },
});

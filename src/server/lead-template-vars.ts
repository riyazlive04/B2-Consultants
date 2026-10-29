import "server-only";
import { prisma } from "@/lib/prisma";
import { formatDateTimeInZone } from "@/lib/format";
import { coerceOutreachConfig } from "@/lib/outreach-sop";
import { getPublicLinksConfig } from "./founder-config";

/**
 * The lead-facing WhatsApp template variables, resolved from the lead's own record.
 *
 * `sendWhatsApp` calls this whenever a message to a LEAD uses a template variable its caller did
 * not pass, so every lead-facing touchpoint can fill the same pool (LEAD_TEMPLATE_VARS in
 * lib/whatsapp.ts) and an approved template can be bound to any of them. Before this, each caller
 * passed its own subset - the SOP never passed {{booking_url}}, the stage messages never passed
 * {{date}} - and binding a perfectly good template failed with "cannot supply".
 *
 * A value that does not exist is left OUT, never blank or stale: the send is then skipped with the
 * reason logged, instead of delivering "your call on  at " or last month's no-show date.
 */

export function bookingUrl(): string {
  return `${(process.env.BETTER_AUTH_URL ?? "").replace(/\/+$/, "")}/book`;
}

/**
 * ⚠ `SSS_URL` USED TO BE A CONSTANT HERE, AND THAT IS WHAT WENT WRONG.
 *
 * There were three answers to "where do we send someone to rebook their SSS?" - this constant,
 * a literal inside `sendSssRescheduled`, and `${base}/sss` in the test-variable pool - which is
 * what the 26/10/2026 template review caught ("we have to check with the Link as we have 3 links
 * currently"). All three now resolve through `getPublicLinksConfig()`, so there is one.
 *
 * Note `booking_url` is NOT one of these and is deliberately left alone: it is this app's own
 * `/book` page, used by the booking engine for rebooking a specific call. `apply_url` is the
 * public opt-in page a brand-new prospect is sent to. They are two different destinations, and
 * collapsing them would send a half-booked prospect to the wrong one.
 */

export async function leadTemplateVars(
  leadId: string,
  opts: { sss?: boolean; sentById?: string | null } = {},
): Promise<Record<string, string>> {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: {
      name: true,
      assignedTo: { select: { name: true } },
      outreachJourney: {
        select: {
          sssAt: true,
          zoomLink: true,
          respTouchpoint: { select: { name: true } },
          booking: { select: { status: true, slot: { select: { startsAt: true } } } },
        },
      },
    },
  });
  if (!lead) return {};
  const journey = lead.outreachJourney;

  const links = await getPublicLinksConfig();
  // Every one of these is guaranteed non-empty by `coercePublicLinksConfig`, which is what makes
  // them safe to DECLARE in a template body: an unresolved variable skips the send entirely.
  const vars: Record<string, string> = {
    booking_url: bookingUrl(),
    apply_url: links.applyUrl,
    sss_url: links.sssUrl,
    workshop_url: links.workshopUrl,
  };
  const first = (lead.name ?? "").trim().split(/\s+/)[0];
  if (first) vars.name = first;
  vars.sender = await senderName(opts.sentById ?? null, journey?.respTouchpoint?.name ?? lead.assignedTo?.name ?? null);

  // Only a LIVE booking: a no-show or cancelled call would put an old date in a new message.
  let disco = journey?.booking?.status === "BOOKED" ? (journey.booking.slot?.startsAt ?? null) : null;
  if (!disco) {
    const latest = await prisma.bookingRequest.findFirst({
      where: { leadId, status: "BOOKED", slot: { isNot: null } },
      orderBy: { createdAt: "desc" },
      select: { slot: { select: { startsAt: true } } },
    });
    disco = latest?.slot?.startsAt ?? null;
  }
  const when = opts.sss ? (journey?.sssAt ?? null) : disco;
  if (when) {
    const formatted = formatDateTimeInZone(when, "Asia/Kolkata");
    const i = formatted.lastIndexOf(", ");
    vars.slot_time = formatted;
    vars.date = i === -1 ? formatted : formatted.slice(0, i);
    if (i !== -1) vars.time = formatted.slice(i + 2);
  }
  if (journey?.zoomLink) vars.zoom_link = journey.zoomLink;
  return vars;
}

/** Whoever acted, else the lead's specialist/owner, else the SOP's default specialist name. */
async function senderName(sentById: string | null, fallback: string | null): Promise<string> {
  if (sentById) {
    const u = await prisma.user.findUnique({ where: { id: sentById }, select: { name: true } });
    if (u?.name?.trim()) return u.name.trim().split(/\s+/)[0];
  }
  if (fallback?.trim()) return fallback.trim().split(/\s+/)[0];
  const row = await prisma.appSetting.findUnique({ where: { key: "outreachConfig" } });
  return coerceOutreachConfig(row?.value ?? null).defaultSpecialistName;
}

import "server-only";
import { prisma } from "@/lib/prisma";
import { formatDateTimeInZone } from "@/lib/format";
import { coerceOutreachConfig } from "@/lib/outreach-sop";

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

export const SSS_URL = "https://optin.b2consultants.de/sss";

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

  const vars: Record<string, string> = { booking_url: bookingUrl(), sss_url: SSS_URL };
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

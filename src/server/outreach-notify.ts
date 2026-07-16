import "server-only";
import { prisma } from "@/lib/prisma";
import { getEmailRuntime, sendResendEmail } from "@/lib/email";
import { formatDateTimeInZone } from "@/lib/format";

/**
 * Step 1 — "the outreach specialist will be getting the required information also via E-Mail".
 *
 * The SOP's opt-in step has two outputs: a row in the sheet AND an email to the specialist. The
 * row existed; the email did not — `lib/email.ts` was never imported by any intake path, so a new
 * opt-in produced no email, no push and no in-app alert (gap A of the report).
 *
 * Fail-safe by construction: never throws, and lead capture never awaits the result. An opt-in
 * must land in the database even if Resend is down — losing the lead would be far worse than
 * losing the notification.
 */

/** Who should be told about a new opt-in: the assigned caller, falling back to every admin. */
async function recipientsFor(assignedToId: string | null): Promise<{ id: string; name: string; email: string }[]> {
  if (assignedToId) {
    const owner = await prisma.user.findUnique({
      where: { id: assignedToId },
      select: { id: true, name: true, email: true, status: true },
    });
    if (owner && owner.status === "ACTIVE" && owner.email) return [owner];
  }
  // Unassigned (or the owner is suspended) — an opt-in must never go unnoticed.
  return prisma.user.findMany({
    where: { status: "ACTIVE", role: "ADMIN" },
    select: { id: true, name: true, email: true },
  });
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * The email body carries exactly the fields the SOP's sheet row carries, so the checklist's
 * "Email contains the same lead data as the sheet row (no field mismatch)" holds by construction —
 * both read from the same Lead record.
 */
/**
 * The app's public origin. `BETTER_AUTH_URL` is the codebase's convention for this — the same
 * variable `signingUrl()` and the bookings page use — so there is one place to set it, not two.
 *
 * Returns null when unset. An email link MUST be absolute: a relative href renders as a dead link
 * in a mail client, so the caller drops the button rather than shipping one that goes nowhere.
 */
function publicOrigin(): string | null {
  const raw = (process.env.BETTER_AUTH_URL ?? "").trim().replace(/\/+$/, "");
  return raw.length ? raw : null;
}

function renderNewLeadEmail(lead: {
  name: string;
  phone: string | null;
  email: string | null;
  city: string | null;
  leadSource: string;
  createdAt: Date;
}, appUrl: string | null): { subject: string; html: string } {
  const optIn = formatDateTimeInZone(lead.createdAt, "Asia/Kolkata");
  const rows: [string, string][] = [
    ["Name", lead.name],
    ["Contact number", lead.phone ?? "—"],
    ["Email", lead.email ?? "—"],
    ["City", lead.city ?? "—"],
    ["Source", lead.leadSource],
    ["Opted in (IST)", optIn],
  ];
  const html = `
    <div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:520px">
      <h2 style="margin:0 0 4px">New opt-in — ${esc(lead.name)}</h2>
      <p style="margin:0 0 16px;color:#666">
        Reach out within 5 minutes (SOP Step 2), then log the time contacted.
      </p>
      <table cellpadding="6" cellspacing="0" style="border-collapse:collapse;width:100%">
        ${rows
          .map(
            ([k, v]) =>
              `<tr><td style="color:#666;border-bottom:1px solid #eee">${esc(k)}</td>` +
              `<td style="font-weight:600;border-bottom:1px solid #eee">${esc(v)}</td></tr>`,
          )
          .join("")}
      </table>
      ${
        // No absolute origin → no button. A relative href is a dead link in a mail client, and a
        // dead "Open the queue" button is worse than no button: it teaches people to ignore it.
        appUrl
          ? `<p style="margin:20px 0 0">
        <a href="${esc(appUrl)}/outreach" style="background:#111;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none">
          Open the outreach queue
        </a>
      </p>`
          : ""
      }
    </div>`;
  return { subject: `New opt-in: ${lead.name} — reach out within 5 min`, html };
}

/**
 * Notify the outreach specialist of a new opt-in. Resolves silently when email is not armed
 * (EMAIL_ENABLED / RESEND_API_KEY / fromEmail unset) — same fail-closed stance as the WATI layer.
 */
export async function notifyNewOptIn(leadId: string): Promise<void> {
  try {
    const runtime = await getEmailRuntime();
    if (!runtime.enabled || !runtime.apiKey) return;

    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      select: {
        name: true,
        phone: true,
        email: true,
        city: true,
        leadSource: true,
        createdAt: true,
        assignedToId: true,
      },
    });
    if (!lead) return;

    const { subject, html } = renderNewLeadEmail(lead, publicOrigin());
    const from = `${runtime.fromName} <${runtime.fromEmail}>`;

    for (const person of await recipientsFor(lead.assignedToId)) {
      await sendResendEmail({ apiKey: runtime.apiKey, from, to: person.email, subject, html });
    }
  } catch {
    // Never let a notification failure surface into lead capture.
  }
}

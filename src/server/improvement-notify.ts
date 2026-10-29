import "server-only";
import { brandEmailHeader, getEmailRuntime, sendResendEmail } from "@/lib/email";
import { captureException } from "@/lib/observability";
import {
  IMPROVEMENT_KIND_SHORT,
  IMPROVEMENT_SEVERITY_SHORT,
  answerDisplay,
  notifiesImmediately,
  questionLabel,
  type ImprovementKind,
  type ImprovementSeverity,
} from "@/lib/improvement";
import type { ImprovementContext } from "./improvement-context";
import { getImprovementsConfig } from "./founder-config";

/**
 * TELLING THE DEVELOPER.
 *
 * Three channels, and they are deliberately not equal:
 *
 *   in-app   `server/notifications.ts` carries a count for whoever holds `improvements.triage`. Always
 *            on, costs nothing, and is the system of record's own front door.
 *   email    one message per BLOCKING report. Config-backed address; off when it is blank.
 *   digest   everything else, folded into the EXISTING daily cron tick - no new cron route, so
 *            no crontab entry and no `STALE_AFTER_MINUTES` row to forget (that omission is what
 *            made the `agreements` job read STALE for 21 hours out of every 24).
 *
 * ── What a send does and does not prove ────────────────────────────────────────────────────
 * `Improvement.notifiedAt` records the ATTEMPT. A success from Resend means Resend accepted the
 * message, not that anyone received it - the repo has been bitten by reading `SENT` as "delivered"
 * before. The queue at /improvements is the system of record; this is a nudge towards it.
 *
 * ── Never throws into the submit path ──────────────────────────────────────────────────────
 * A failed notification must not fail the report. Somebody reporting that the app is broken is
 * the worst possible moment to refuse a write because an email bounced, so every path here
 * returns a result and the caller treats a failure as "stored, not announced".
 */

export type ImprovementNotifyInput = {
  id: string;
  ref: string;
  kind: ImprovementKind;
  severity: ImprovementSeverity;
  title: string;
  route: string;
  sectionLabel: string | null;
  reporterName: string;
  reporterRole: string;
  answers: Record<string, string>;
  note: string | null;
  /**
   * The recording the reporter made, or null. DECLARED by the form, because the media uploads on
   * a separate request that this email races - see `submitImprovementSchema`. It buys one line
   * telling the reader there is something to watch; the report page is the truth.
   */
  recordingSeconds: number | null;
  recordingKind: "AUDIO" | "SCREEN" | null;
  context: ImprovementContext;
};

export type NotifyOutcome =
  | { sent: true; id?: string }
  | { sent: false; reason: string };

/**
 * Email the developer about one report, when the configuration says to.
 *
 * Returns `{ sent: false, reason }` for every "we deliberately did not send" case - no address
 * configured, not blocking, email disarmed - because those are not failures and the caller
 * records them differently from a bounce.
 */
export async function notifyDeveloper(input: ImprovementNotifyInput): Promise<NotifyOutcome> {
  try {
    const cfg = await getImprovementsConfig();
    if (!cfg.developerEmail) return { sent: false, reason: "No developer address is configured" };
    if (!notifiesImmediately(input.severity)) {
      return { sent: false, reason: cfg.dailyDigest ? "Riding the daily digest" : "Digest is off" };
    }
    if (!cfg.emailOnBlocking) return { sent: false, reason: "Immediate email is switched off" };

    const rt = await getEmailRuntime();
    if (!rt.enabled || !rt.apiKey || !rt.fromEmail) {
      return { sent: false, reason: rt.configured ? "Email is paused" : "Email is not configured" };
    }

    const from = rt.fromName ? `${rt.fromName} <${rt.fromEmail}>` : rt.fromEmail;
    const res = await sendResendEmail({
      apiKey: rt.apiKey,
      from,
      to: cfg.developerEmail,
      subject: `[${input.ref}] ${IMPROVEMENT_KIND_SHORT[input.kind]} · blocking · ${input.title}`.slice(0, 200),
      html: reportEmailHtml(input),
    });
    return res.ok ? { sent: true, id: res.id } : { sent: false, reason: res.error ?? "Send failed" };
  } catch (err) {
    // The report itself is already saved by the time this runs. Report the failure and move on.
    await captureException(err, { where: "action:notifyDeveloper", extra: { ref: input.ref } });
    return { sent: false, reason: "The notification could not be sent" };
  }
}

/**
 * The email body.
 *
 * ── What goes in it, and what deliberately does not ────────────────────────────────────────
 * The arming verdict goes at the TOP, above the reporter's own words. For most reports it is the
 * answer: "the confirm-or-cancel engine behind this screen is off" ends the investigation before
 * it starts, and burying that under three paragraphs of description wastes the one thing this
 * module automates.
 *
 * What is NOT here: the element tag's captured text, the breadcrumbs, and the recent-error
 * messages. All three are on the report, and all three are the fields most likely to carry a
 * student's name or balance - so they stay behind the login, on a screen with a capability check,
 * rather than travelling to an inbox. The email's job is to get somebody to open IMP-0001, not to
 * be a copy of it.
 */
function reportEmailHtml(input: ImprovementNotifyInput): string {
  const base = process.env.BETTER_AUTH_URL?.replace(/\/+$/, "") ?? "";
  const link = `${base}/improvements?ref=${encodeURIComponent(input.ref)}`;

  const arming = input.context.enginesOff?.length
    ? `<div style="margin:0 0 18px;padding:12px 14px;border-radius:10px;background:#FFF4E5;border:1px solid #F0C48A">
         <p style="margin:0 0 6px;font-weight:700;font-size:13px;color:#8A5200">Before you start: an engine behind this screen is OFF</p>
         ${input.context.enginesOff
           .map(
             (e) =>
               `<p style="margin:0;font-size:13px;color:#6B4200"><strong>${esc(e.name)}</strong> - ${esc(e.consequence)} (${esc(e.where)})</p>`,
           )
           .join("")}
       </div>`
    : "";

  const answers = Object.entries(input.answers)
    .map(
      ([id, value]) =>
        `<tr>
           <td style="padding:6px 12px 6px 0;vertical-align:top;font-size:12px;color:#5A6472;white-space:nowrap">${esc(questionLabel(input.kind, id))}</td>
           <td style="padding:6px 0;vertical-align:top;font-size:13px;color:#1A2230">${esc(answerDisplay(input.kind, id, value))}</td>
         </tr>`,
    )
    .join("");

  return `<!doctype html><html><body style="margin:0;padding:24px;background:#F4F6F9;font-family:Inter,Arial,sans-serif">
  <div style="max-width:620px;margin:0 auto;padding:26px;background:#FFFFFF;border-radius:14px;border:1px solid #E3E8EF">
    ${brandEmailHeader()}
    <p style="margin:0 0 4px;font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#ED1C24">${esc(
      IMPROVEMENT_SEVERITY_SHORT[input.severity],
    )} · ${esc(IMPROVEMENT_KIND_SHORT[input.kind])}</p>
    <h1 style="margin:0 0 14px;font-size:19px;line-height:1.35;color:#003C8C">${esc(input.ref)} · ${esc(input.title)}</h1>
    ${arming}
    <p style="margin:0 0 16px;font-size:13px;color:#5A6472">
      Reported by <strong style="color:#1A2230">${esc(input.reporterName)}</strong> (${esc(input.reporterRole)})
      on <strong style="color:#1A2230">${esc(input.sectionLabel ?? input.route)}</strong>
      · <code style="font-size:12px">${esc(input.route)}</code>
      · ${esc(input.context.ist)} IST
    </p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;margin:0 0 18px">${answers}</table>
    ${
      input.note
        ? `<p style="margin:0 0 18px;padding:12px 14px;border-radius:10px;background:#F4F6F9;font-size:13px;color:#1A2230">${esc(input.note)}</p>`
        : ""
    }
    ${
      input.recordingSeconds !== null
        ? `<p style="margin:0 0 18px;padding:12px 14px;border-radius:10px;background:#FFF6E5;font-size:13px;color:#1A2230"><strong>${
            input.recordingKind === "SCREEN"
              ? "There is a SCREEN RECORDING on this one"
              : "There is a voice note on this one"
          }</strong> - about ${Math.max(1, input.recordingSeconds)} seconds. ${
            input.recordingKind === "SCREEN"
              ? "It shows what they were doing when it went wrong."
              : ""
          } Media cannot travel in an email, so open the report to watch it.</p>`
        : ""
    }
    <p style="margin:0 0 20px;font-size:12px;color:#5A6472">
      Running build: ${esc(input.context.release ?? "unknown")} · ${esc(input.context.environment)}
    </p>
    <a href="${esc(link)}" style="display:inline-block;padding:11px 18px;border-radius:8px;background:#003C8C;color:#FFFFFF;font-size:14px;font-weight:600;text-decoration:none">Open ${esc(input.ref)}</a>
    <p style="margin:20px 0 0;font-size:11px;color:#8A94A6">
      The screenshot, the tagged element and the breadcrumbs stay in the app - open the report to see them.
    </p>
  </div>
</body></html>`;
}

/** Minimal HTML escaping. Every interpolated value above is user-supplied text. */
function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ─────────────────────────────── the daily digest ───────────────────────────────

export type DigestRow = {
  ref: string;
  kind: ImprovementKind;
  severity: ImprovementSeverity;
  title: string;
  sectionLabel: string | null;
  route: string;
  reporterName: string;
};

/**
 * One email for everything that landed since the last tick.
 *
 * Called from the existing daily cron. Sends nothing when there is nothing to say - a digest that
 * arrives every day whether or not anything happened is a digest people learn to ignore, and this
 * one needs to still be read in six months.
 */
export async function sendImprovementDigest(rows: DigestRow[]): Promise<NotifyOutcome> {
  try {
    if (!rows.length) return { sent: false, reason: "Nothing new to report" };
    const cfg = await getImprovementsConfig();
    if (!cfg.developerEmail) return { sent: false, reason: "No developer address is configured" };
    if (!cfg.dailyDigest) return { sent: false, reason: "Digest is switched off" };

    const rt = await getEmailRuntime();
    if (!rt.enabled || !rt.apiKey || !rt.fromEmail) {
      return { sent: false, reason: rt.configured ? "Email is paused" : "Email is not configured" };
    }

    const base = process.env.BETTER_AUTH_URL?.replace(/\/+$/, "") ?? "";
    const list = rows
      .map(
        (r) =>
          `<tr>
             <td style="padding:7px 12px 7px 0;font-size:12px;color:#5A6472;white-space:nowrap">${esc(r.ref)}</td>
             <td style="padding:7px 12px 7px 0;font-size:12px;color:#5A6472;white-space:nowrap">${esc(IMPROVEMENT_KIND_SHORT[r.kind])}</td>
             <td style="padding:7px 0;font-size:13px;color:#1A2230">${esc(r.title)}<br>
               <span style="font-size:11px;color:#8A94A6">${esc(r.sectionLabel ?? r.route)} · ${esc(r.reporterName)}</span>
             </td>
           </tr>`,
      )
      .join("");

    const from = rt.fromName ? `${rt.fromName} <${rt.fromEmail}>` : rt.fromEmail;
    const res = await sendResendEmail({
      apiKey: rt.apiKey,
      from,
      to: cfg.developerEmail,
      subject: `${rows.length} new improvement${rows.length === 1 ? "" : "s"}`,
      html: `<!doctype html><html><body style="margin:0;padding:24px;background:#F4F6F9;font-family:Inter,Arial,sans-serif">
        <div style="max-width:620px;margin:0 auto;padding:26px;background:#FFFFFF;border-radius:14px;border:1px solid #E3E8EF">
          ${brandEmailHeader()}
          <h1 style="margin:0 0 14px;font-size:19px;color:#003C8C">${rows.length} new improvement${rows.length === 1 ? "" : "s"}</h1>
          <table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;margin:0 0 18px">${list}</table>
          <a href="${esc(`${base}/improvements`)}" style="display:inline-block;padding:11px 18px;border-radius:8px;background:#003C8C;color:#FFFFFF;font-size:14px;font-weight:600;text-decoration:none">Open the queue</a>
        </div>
      </body></html>`,
    });
    return res.ok ? { sent: true, id: res.id } : { sent: false, reason: res.error ?? "Send failed" };
  } catch (err) {
    await captureException(err, { where: "cron:improvementDigest" });
    return { sent: false, reason: "The digest could not be sent" };
  }
}

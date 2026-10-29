import "server-only";
import {
  channelForJob,
  CHANNEL_LABELS,
  degradedVerdict,
  describeDelivery,
  formatDuration,
  silentVerdict,
  type DeliveryState,
  type FailureClass,
} from "@/lib/delivery-health";
import { readHeartbeats } from "./uptime";

/**
 * "Armed but not working" - the report that `not-armed.ts` deliberately does not grow into.
 *
 * `not-armed.ts` answers "has a human flipped this switch?". A revoked WATI token is an armed
 * switch whose provider is refusing, and folding the two together would break the one property
 * that makes that panel useful: `Not armed (3)` is a to-do list precisely because it can reach
 * zero. Start counting armed-but-broken things in it and the number never bottoms out.
 *
 * It is also the wrong SHAPE. `armed` is a timeless boolean; everything that matters about a
 * delivery failure is in the time dimension - when it started, when something last got through,
 * how much has failed in the window. The difference between "a blip two hours ago" and "dead for
 * three days" is the entire incident, and a boolean cannot carry it.
 *
 * So: a sibling report, a parallel shape, rendered in the same panel above the arm-state list.
 * Every read here comes off the ONE `cronHeartbeat` AppSetting row the heartbeat already writes.
 */

export type DeliveryHealthRow = {
  job: string;
  channel: "whatsapp" | "email" | "mixed";
  state: DeliveryState;
  attempted24h: number;
  sent24h: number;
  failed24h: number;
  recipientFailed24h: number;
  /**
   * Sends declined over a fixable configuration fault, and whether that is now material. The
   * channel can be `idle` and `silent` at the same time - `idle` says nothing reached the
   * provider, `silent` says that was not because there was nothing to send.
   */
  skippedConfig24h: number;
  silent: boolean;
  deadSinceMs: number | null;
  lastSentMs: number | null;
  lastError: string | null;
  lastClass: FailureClass | null;
};

/** Jobs that send something. A job absent from here never reports delivery health. */
const SENDING_JOBS = ["whatsapp", "outreach", "alerts", "daily"];

export async function deliveryHealth(): Promise<DeliveryHealthRow[]> {
  const map = await readHeartbeats();
  const now = Date.now();
  const rows: DeliveryHealthRow[] = [];

  for (const job of SENDING_JOBS) {
    const d = map[job]?.delivery;
    if (!d) continue;
    const w = d.window;

    const state: DeliveryState = d.deadSince
      ? "dead"
      : w.attempted === 0
        ? "idle"
        : degradedVerdict(w, d.lastFailureAt, now)
          ? "degraded"
          : "healthy";

    rows.push({
      job,
      channel: channelForJob(job),
      state,
      attempted24h: w.attempted,
      sent24h: w.sent,
      failed24h: w.failed,
      recipientFailed24h: w.recipientFailed,
      skippedConfig24h: w.skippedConfig,
      silent: silentVerdict(w, now),
      deadSinceMs: d.deadSince ? now - Date.parse(d.deadSince) : null,
      lastSentMs: d.lastSentAt ? now - Date.parse(d.lastSentAt) : null,
      lastError: d.lastError,
      lastClass: d.lastClass,
    });
  }

  return rows;
}

/** Mirrors `NotArmedItem` so the Console panel can render both lists with the same markup. */
export type DeliveryFailureItem = {
  key: string;
  name: string;
  state: "dead" | "degraded";
  /** Human duration, or null for a degraded channel that is still partly working. */
  since: string | null;
  /** What is NOT reaching anyone. The reason to care. */
  consequence: string;
  /** Exactly where to look. Empty for degraded, where there is nothing to fix. */
  where: string;
  /** The numbers behind the verdict, so nobody has to take it on trust. */
  evidence: string;
};

export async function getDeliveryFailureReport(): Promise<DeliveryFailureItem[]> {
  const rows = await deliveryHealth();
  const items: DeliveryFailureItem[] = [];

  for (const r of rows) {
    /*
     * `r.silent` is the third way in, and it is the one that was missing. An armed channel whose
     * every send is skipped before reaching the provider has `attempted === 0`, so it lands on
     * `idle` - and this loop used to drop `idle` on the floor. That is how a WhatsApp channel sat
     * armed and sending nothing for a week with no surface anywhere saying so.
     */
    if (r.state !== "dead" && r.state !== "degraded" && !r.silent) continue;
    // A degraded channel whose only failures were Meta's per-recipient cap is worth showing, but
    // it is not a fault - so it never gets a "fix this" line.
    const copy = describeDelivery({ ...r, attempted: r.attempted24h, sent: r.sent24h, failed: r.failed24h, recipientFailed: r.recipientFailed24h, skippedConfig: r.skippedConfig24h });
    if (!copy) continue;

    items.push({
      key: `delivery:${r.job}`,
      name: `${CHANNEL_LABELS[r.channel]} · ${r.job}`,
      // A silent channel is NOT dead - the provider has never been asked. It ranks with
      // degraded, which is also "working, but not for everyone".
      state: r.state === "dead" ? "dead" : "degraded",
      since: r.deadSinceMs === null ? null : formatDuration(r.deadSinceMs),
      consequence: copy.body,
      where:
        r.state === "dead"
          ? "Console → System → Maintenance for the credentials, then WhatsApp → History to see who was missed."
          : r.silent
            ? "WhatsApp → Settings to bind an approved template to the touchpoint, then WhatsApp → History for who was skipped."
            : "",
      evidence:
        `${r.attempted24h} attempted, ${r.sent24h} sent, ${r.failed24h} failed in 24 h` +
        (r.skippedConfig24h > 0 ? `, ${r.skippedConfig24h} skipped before reaching the provider` : "") +
        (r.recipientFailed24h > 0 ? ` (${r.recipientFailed24h} were Meta's per-recipient cap)` : "") +
        (r.lastError ? ` · last error: "${r.lastError}"` : ""),
    });
  }

  // Dead before degraded: an armed channel that is delivering nothing outranks one that is
  // dropping some.
  return items.sort((a, b) => (a.state === b.state ? 0 : a.state === "dead" ? -1 : 1));
}

export type DeliveryNotification = {
  key: string;
  severity: "risk" | "watch";
  title: string;
  body: string;
  href: string;
};

/**
 * The home-page card. Admin/Head only - a telecaller cannot fix a revoked token, and putting an
 * un-actionable alarm on their dashboard is how alarms get ignored.
 */
export async function deliveryNotifications(): Promise<DeliveryNotification[]> {
  const rows = await deliveryHealth();
  const out: DeliveryNotification[] = [];

  for (const r of rows) {
    const copy = describeDelivery({ ...r, attempted: r.attempted24h, sent: r.sent24h, failed: r.failed24h, recipientFailed: r.recipientFailed24h, skippedConfig: r.skippedConfig24h });
    if (!copy) continue;
    out.push({
      key: `delivery:${r.job}`,
      // `watch`, not `risk`: the provider is fine and the fix is a dropdown, so this must not
      // outrank a genuine outage on the same card.
      severity: r.state === "dead" ? "risk" : "watch",
      title: copy.title,
      body: copy.body,
      href: r.channel === "email" ? "/conversations" : "/whatsapp",
    });
  }

  return out;
}

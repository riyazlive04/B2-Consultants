import type { WhatsAppKind, WhatsAppStatus } from "@prisma/client";
import { WHATSAPP_STATUS_LABELS, WHATSAPP_KIND_LABELS, whatsappStatusTone } from "@/lib/whatsapp";

/**
 * Small pill showing the last WhatsApp status for a row (pipeline lead, booking, payment,
 * student). Reuses the app's semantic tones so colour means the same as everywhere else:
 * Read/Replied = green, Sent/Delivered = amber, Failed = red, Skipped/Queued = muted.
 * Server+client safe (no "use client") — imported by both server pages and client tables.
 */

const TONE: Record<"good" | "warn" | "bad", { color: string; soft: string }> = {
  good: { color: "var(--good)", soft: "var(--good-bg)" },
  warn: { color: "var(--warn)", soft: "var(--warn-bg)" },
  bad: { color: "var(--bad)", soft: "var(--bad-bg)" },
};

export function WhatsAppStatusBadge({
  status,
  kind,
  at,
  size = "sm",
}: {
  status: WhatsAppStatus;
  kind?: WhatsAppKind;
  at?: Date | string;
  size?: "sm" | "md";
}) {
  const tone = whatsappStatusTone(status);
  const label = WHATSAPP_STATUS_LABELS[status];
  const title = [kind ? WHATSAPP_KIND_LABELS[kind] : null, at ? new Date(at).toLocaleString("en-GB") : null]
    .filter(Boolean)
    .join(" · ");

  const cls = `inline-flex items-center gap-1.5 rounded-full font-medium ${
    size === "sm" ? "px-2 py-0.5 text-xs" : "px-2.5 py-1 text-sm"
  }`;

  if (tone === "muted") {
    return (
      <span className={`${cls} bg-surface-2 text-muted`} title={title || undefined}>
        <span aria-hidden className="inline-block h-2 w-2 rounded-full bg-current opacity-50" />
        {label}
      </span>
    );
  }

  const meta = TONE[tone];
  return (
    <span className={cls} style={{ background: meta.soft, color: meta.color }} title={title || undefined}>
      <span aria-hidden className="inline-block h-2 w-2 rounded-full" style={{ background: meta.color }} />
      {label}
    </span>
  );
}

import "server-only";
import { prisma } from "@/lib/prisma";
import { getWatiRuntime, readTemplateCatalog } from "@/lib/wati";
import type { WhatsAppDirection, WhatsAppKind, WhatsAppStatus } from "@prisma/client";
import { WHATSAPP_KIND_LABELS, type WatiSettings, type WatiTemplateSummary } from "@/lib/whatsapp";

/** Serializable data for the /whatsapp Admin page (status + settings + history + opt-outs). */

export type WhatsAppMessageRow = {
  id: string;
  direction: WhatsAppDirection;
  kind: WhatsAppKind;
  status: WhatsAppStatus;
  toNumber: string;
  templateName: string | null;
  body: string | null;
  error: string | null;
  createdAt: string; // ISO
  contact: string | null;
  sentBy: string | null;
};

export type WhatsAppAdminData = {
  status: {
    envEnabled: boolean;
    configured: boolean;
    paused: boolean;
    enabled: boolean;
    endpointSet: boolean;
    tokenSet: boolean;
    webhookSecretSet: boolean;
    cronSecretSet: boolean;
  };
  settings: WatiSettings;
  /** Templates pulled from WATI (Settings → "Refresh templates"). Empty until first fetch. */
  catalog: WatiTemplateSummary[];
  messages: WhatsAppMessageRow[];
  optOuts: { phone: string; reason: string | null; createdAt: string }[];
  counts: Record<WhatsAppStatus, number> & { total: number };
  /** Top touchpoint kinds behind the Sent / Replied / Failed tiles, for their expand popups. */
  kindBreakdown: {
    sent: { label: string; value: number }[];
    replied: { label: string; value: number }[];
    failed: { label: string; value: number }[];
  };
};

export async function getWhatsAppAdminData(): Promise<WhatsAppAdminData> {
  const runtime = await getWatiRuntime();
  const [catalog, messages, optOuts, grouped] = await Promise.all([
    readTemplateCatalog(),
    prisma.whatsAppMessage.findMany({
      orderBy: { createdAt: "desc" },
      take: 300,
      include: {
        lead: { select: { name: true } },
        student: { select: { fullName: true } },
        bookingRequest: { select: { name: true } },
        sentBy: { select: { name: true } },
      },
    }),
    prisma.whatsAppOptOut.findMany({ orderBy: { createdAt: "desc" }, take: 200 }),
    prisma.whatsAppMessage.groupBy({ by: ["status", "kind"], _count: { _all: true } }),
  ]);

  const counts = {
    total: 0,
    SKIPPED: 0, QUEUED: 0, SENT: 0, DELIVERED: 0, READ: 0, REPLIED: 0, FAILED: 0,
  } as WhatsAppAdminData["counts"];
  for (const g of grouped) {
    counts[g.status] = (counts[g.status] ?? 0) + g._count._all;
    counts.total += g._count._all;
  }

  // Which touchpoints make up a status bucket, for that tile's expand popup - top 4 + "Other".
  const kindBreakdown = (statuses: WhatsAppStatus[], limit = 4) => {
    const byKind = new Map<WhatsAppKind, number>();
    for (const g of grouped) {
      if (!statuses.includes(g.status)) continue;
      byKind.set(g.kind, (byKind.get(g.kind) ?? 0) + g._count._all);
    }
    const sorted = [...byKind.entries()].sort((a, b) => b[1] - a[1]);
    const rows = sorted.slice(0, limit).map(([kind, n]) => ({ label: WHATSAPP_KIND_LABELS[kind], value: n }));
    const rest = sorted.slice(limit).reduce((sum, [, n]) => sum + n, 0);
    if (rest > 0) rows.push({ label: "Other touchpoints", value: rest });
    return rows;
  };

  return {
    status: {
      envEnabled: runtime.envEnabled,
      configured: runtime.configured,
      paused: runtime.paused,
      enabled: runtime.enabled,
      endpointSet: !!runtime.endpoint,
      tokenSet: !!runtime.token,
      webhookSecretSet: !!process.env.WATI_WEBHOOK_SECRET,
      cronSecretSet: !!process.env.CRON_SECRET,
    },
    settings: runtime.settings,
    catalog,
    messages: messages.map((m) => ({
      id: m.id,
      direction: m.direction,
      kind: m.kind,
      status: m.status,
      toNumber: m.toNumber,
      templateName: m.templateName,
      body: m.body,
      error: m.error,
      createdAt: m.createdAt.toISOString(),
      contact: m.lead?.name ?? m.student?.fullName ?? m.bookingRequest?.name ?? null,
      sentBy: m.sentBy?.name ?? null,
    })),
    optOuts: optOuts.map((o) => ({ phone: o.phone, reason: o.reason, createdAt: o.createdAt.toISOString() })),
    counts,
    kindBreakdown: {
      sent: kindBreakdown(["SENT"]),
      replied: kindBreakdown(["REPLIED"]),
      failed: kindBreakdown(["FAILED"]),
    },
  };
}

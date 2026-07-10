import { MessageCircle, CheckCircle2, XCircle, Send, Reply } from "lucide-react";
import { MetricCard } from "@/components/ui/MetricCard";
import { Tabs } from "@/components/ui/Tabs";
import { requireSection } from "@/lib/rbac";
import { getWhatsAppAdminData } from "@/server/whatsapp-metrics";
import { WhatsAppHistory } from "./_components/WhatsAppHistory";
import { WhatsAppSettingsForm } from "./_components/WhatsAppSettingsForm";
import { WhatsAppTools } from "./_components/WhatsAppTools";
import { RunRemindersButton } from "./_components/RunRemindersButton";

export const dynamic = "force-dynamic";

function Chip({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium"
      style={{
        background: ok ? "var(--good-bg)" : "var(--surface-2)",
        color: ok ? "var(--good)" : "var(--muted)",
      }}
    >
      <span className="inline-block h-2 w-2 rounded-full" style={{ background: ok ? "var(--good)" : "var(--muted)" }} />
      {label}
    </span>
  );
}

export default async function WhatsAppPage() {
  await requireSection("whatsapp");
  const data = await getWhatsAppAdminData();
  const { status, counts } = data;

  const live = status.enabled;
  const stateLabel = live
    ? "Live — WhatsApp reminders are active"
    : status.paused
      ? "Paused — sending is turned off in settings"
      : !status.envEnabled
        ? "Off — set WATI_ENABLED=true (and credentials) to go live"
        : "Not configured — add WATI endpoint + token to go live";

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      {/* Header strip */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-line bg-surface px-5 py-4 shadow-card">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 flex-none place-items-center rounded-field bg-accent-soft text-accent">
            <MessageCircle size={20} />
          </span>
          <div>
            <h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">WhatsApp</h1>
            <p className="text-xs text-muted">
              Outbound reminders via WATI — funnel, bookings, payments &amp; student nudges.
            </p>
          </div>
        </div>
        <RunRemindersButton />
      </div>

      {/* Connection status */}
      <div className="rounded-card border border-line bg-surface p-5 shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="flex items-center gap-2 font-medium">
            <span
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ background: live ? "var(--good)" : "var(--warn)" }}
            />
            {stateLabel}
          </p>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Chip ok={status.envEnabled} label="WATI_ENABLED" />
          <Chip ok={status.endpointSet} label="API endpoint" />
          <Chip ok={status.tokenSet} label="Access token" />
          <Chip ok={status.webhookSecretSet} label="Webhook secret" />
          <Chip ok={status.cronSecretSet} label="Cron secret" />
          <Chip ok={!status.paused} label={status.paused ? "Paused" : "Not paused"} />
        </div>
        {!status.configured && (
          <p className="mt-3 text-xs text-muted">
            Set <code className="rounded bg-surface-2 px-1">WATI_API_ENDPOINT</code>,{" "}
            <code className="rounded bg-surface-2 px-1">WATI_ACCESS_TOKEN</code> and{" "}
            <code className="rounded bg-surface-2 px-1">WATI_ENABLED=true</code> in the environment, then map each
            touchpoint to an approved template in Settings. Until then every &quot;Send&quot; is logged as{" "}
            <em>Skipped</em> and nothing leaves the app.
          </p>
        )}
      </div>

      {/* Volume */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <MetricCard label="Sent" value={counts.SENT} secondary="Accepted by WATI" icon={<Send size={18} />} />
        <MetricCard label="Delivered / read" value={counts.DELIVERED + counts.READ} icon={<CheckCircle2 size={18} />} />
        <MetricCard label="Replied" value={counts.REPLIED} secondary="WhatsApp confirmed" signal={counts.REPLIED > 0 ? "ok" : undefined} icon={<Reply size={18} />} />
        <MetricCard label="Failed" value={counts.FAILED} signal={counts.FAILED > 0 ? "risk" : undefined} icon={<XCircle size={18} />} />
      </div>

      <Tabs
        tabs={[
          { label: `History${counts.total ? ` (${counts.total})` : ""}`, content: <WhatsAppHistory rows={data.messages} /> },
          { label: "Settings", content: <WhatsAppSettingsForm settings={data.settings} catalog={data.catalog} /> },
          { label: `Opt-outs & test`, content: <WhatsAppTools optOuts={data.optOuts} templates={data.settings.templates} /> },
        ]}
      />
    </div>
  );
}

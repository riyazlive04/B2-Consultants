import Link from "next/link";
import { MessageCircle, CheckCircle2, XCircle, Send, Reply } from "lucide-react";
import { MetricCard } from "@/components/ui/MetricCard";
import { Tabs } from "@/components/ui/Tabs";
import { EngineOffNotice, PageHeader } from "@/components/ui/kit";
import { enginesOff } from "@/server/engine-status";
import { requireSection } from "@/lib/rbac";
import { getWhatsAppAdminData } from "@/server/whatsapp-metrics";
import { getBookingRulesConfig } from "@/server/founder-config";
import { WhatsAppHistory } from "./_components/WhatsAppHistory";
import { WhatsAppSettingsForm } from "./_components/WhatsAppSettingsForm";
import { WhatsAppTools } from "./_components/WhatsAppTools";
import { RunRemindersButton } from "./_components/RunRemindersButton";
import { WhatsAppMasterSwitch } from "./_components/WhatsAppMasterSwitch";
import { WhatsAppDomainGate } from "./_components/WhatsAppDomainGate";
import { prisma } from "@/lib/prisma";
import { normalizeDomain } from "@/lib/whatsapp";

/** Its own name in the browser tab, rather than sharing one title with every other page
 *  (issue 28). The root layout adds the "· B2 Consultants" suffix. */
export const metadata = { title: "WhatsApp" };

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
  const session = await requireSection("whatsapp");
  /* The three cadences this screen configures, plus the channel itself. An enabled-but-rehearsing
     class reminder counts as off: it is working perfectly and still nobody is being reminded. */
  const enginesDown = await enginesOff(["whatsapp", "studentWelcome", "classReminders", "confirmLoop"]);
  const data = await getWhatsAppAdminData();
  // The confirm-or-cancel loop is edited on the Settings tab but stored with the booking rules.
  const bookingRules = await getBookingRulesConfig();
  const { status, counts } = data;

  /**
   * Hosts to offer as one-click additions.
   *
   * The domains ALREADY OBSERVED on real leads come first, because they are the only source that
   * is evidence rather than assumption - if traffic is arriving from a host, that host is what a
   * gate has to name to let it through. Typing it from memory is how you list `b2consultants.de`
   * and silently block everyone who actually arrived on `optin.b2consultants.de`.
   *
   * The app's own public origin joins them so the dashboard's host is one click away even before
   * a single lead has been recorded through it.
   */
  const observed = await prisma.lead.findMany({
    where: { originDomain: { not: null } },
    distinct: ["originDomain"],
    select: { originDomain: true },
    take: 20,
  });
  const selfHost = normalizeDomain(process.env.BETTER_AUTH_URL ?? "");
  const knownHosts = [
    ...new Set([...observed.map((o) => o.originDomain!), ...(selfHost ? [selfHost] : [])]),
  ].sort();

  const live = status.enabled;
  const stateLabel = live
    ? "Live - WhatsApp reminders are active"
    : status.paused
      ? "Paused - sending is turned off in settings"
      : !status.envEnabled
        ? "Off - set WATI_ENABLED=true (and credentials) to go live"
        : "Not configured - add WATI endpoint + token to go live";

  return (
    <div className="w-full space-y-6">
      <PageHeader
        icon={<MessageCircle size={20} />}
        title="WhatsApp"
        subtitle="Outbound reminders via WATI - funnel, bookings, payments & student nudges."
        actions={
          <>
            {/*
              Stage messages moved here when Automation was removed (23/10/2026). They are a live
              feature - the outreach cron sends them on every run - so the page needs a real door
              rather than existing as a route only somebody with the URL could find, which is the
              dead end this whole piece of work has been removing.
            */}
            <Link
              href="/whatsapp/stage-messages"
              className="whitespace-nowrap rounded-field border border-line px-3 py-1.5 text-sm font-medium text-ink-2 hover:bg-surface-2"
            >
              Stage messages
            </Link>
            <RunRemindersButton />
          </>
        }
      />

      {/* Built, and switched off - said on the screen it affects rather than only on the
          Console, because an engine nobody armed is indistinguishable from a broken one. */}
      <EngineOffNotice engines={enginesDown} canOpenConsole={session.role === "ADMIN"} />

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
          {/* The one control that stops (or starts) outbound messaging, at the top of the page
              rather than buried in the settings form - Admin only, since arming this reaches
              real phones. */}
          {session.role === "ADMIN" && (
            <WhatsAppMasterSwitch
              paused={status.paused}
              envLive={status.envEnabled}
              configured={status.configured}
              testRecipient={data.settings.testRecipient ?? null}
            />
          )}
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

      {/*
        Admin only, and directly under the master switch: both answer "who is reachable right
        now?", and separating them would leave someone reading a green "Not paused" chip while a
        domain gate quietly blocks the contact they are asking about.
      */}
      {session.role === "ADMIN" && (
        <WhatsAppDomainGate
          enabled={data.settings.domainGate.enabled}
          domains={data.settings.domainGate.domains}
          suggestions={knownHosts}
        />
      )}

      {/* Volume - a window, not a lifetime count, so "Failed: 0" means nothing is failing now */}
      <p className="text-xs text-muted">Last {data.windowDays} days</p>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <MetricCard
          label="Sent"
          value={counts.SENT}
          secondary="Accepted by WATI"
          icon={<Send size={18} />}
          detail={{ rows: data.kindBreakdown.sent }}
        />
        <MetricCard
          label="Delivered / read"
          value={counts.DELIVERED + counts.READ}
          icon={<CheckCircle2 size={18} />}
          detail={{
            rows: [
              { label: "Delivered", value: counts.DELIVERED },
              { label: "Read", value: counts.READ },
            ],
          }}
        />
        <MetricCard
          label="Replied"
          value={counts.REPLIED}
          secondary="WhatsApp confirmed"
          signal={counts.REPLIED > 0 ? "ok" : undefined}
          icon={<Reply size={18} />}
          detail={{ rows: data.kindBreakdown.replied }}
        />
        <MetricCard
          label="Failed"
          value={counts.FAILED}
          signal={counts.FAILED > 0 ? "risk" : undefined}
          icon={<XCircle size={18} />}
          detail={{ rows: data.kindBreakdown.failed }}
        />
      </div>
        {/* Keeps the open tab in the address, so a refresh (or a shared link) does not drop
            back to the first tab (issue 28). */}
      <Tabs
        urlKey="tab"
        tabs={[
          { label: `History${counts.total ? ` (${counts.total})` : ""}`, content: <WhatsAppHistory rows={data.messages} /> },
          { label: "Settings", content: <WhatsAppSettingsForm settings={data.settings} rules={bookingRules} catalog={data.catalog} /> },
          { label: `Opt-outs & test`, content: <WhatsAppTools optOuts={data.optOuts} templates={data.settings.templates} /> },
        ]}
      />
    </div>
  );
}

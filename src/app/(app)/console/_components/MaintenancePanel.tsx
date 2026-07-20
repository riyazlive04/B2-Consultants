"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  DEFAULT_MAINTENANCE_CONFIG,
  DEFAULT_SCHEDULED_REPORT_CONFIG,
  DEFAULT_FINANCE_POSTING_CONFIG,
  istMinutesToTimeInput,
  timeInputToIstMinutes,
  type MaintenanceConfig,
  type ScheduledReportConfig,
  type FinancePostingConfig,
} from "@/lib/config-schema";
import { Field } from "@/components/ui/form";
import { toast } from "@/components/ui/feedback";
import {
  saveMaintenanceConfig,
  saveScheduledReportConfig,
  saveFinancePostingConfig,
} from "@/server/maintenance-actions";
import { runCommissionPayout } from "@/server/commission-actions";
import { Btn, Card, Hint, NumInput, Picker, SaveBar, TextIn, TimeIn, Toggle } from "./kit";

/**
 * Founder Console → Maintenance. One screen for the automations the app never had a clock to run
 * (audit §C): the daily housekeeping, the ledger auto-posting switches, the scheduled digest, and a
 * one-click commission payout run. Everything here is ticked by /api/cron/daily — so if CRON_SECRET
 * isn't set, the panel says so rather than claiming a rule that can never fire.
 */
export function MaintenancePanel({
  maintenance,
  report,
  posting,
  cronArmed,
}: {
  maintenance: MaintenanceConfig;
  report: ScheduledReportConfig;
  posting: FinancePostingConfig;
  cronArmed: boolean;
}) {
  return (
    <div className="space-y-6">
      {!cronArmed && (
        <p className="rounded-field bg-warn-soft px-3 py-2 text-xs font-medium text-warn">
          <code>CRON_SECRET</code> isn&apos;t set, so <code>/api/cron/daily</code> returns 503 and none of
          the scheduled jobs below will ever fire. Set it and register the daily task (or run the Docker
          cron stack) to arm them.
        </p>
      )}
      <MaintenanceCard config={maintenance} />
      <PostingCard config={posting} />
      <ReportCard config={report} />
      <CommissionPayoutCard />
    </div>
  );
}

function MaintenanceCard({ config }: { config: MaintenanceConfig }) {
  const router = useRouter();
  const [draft, setDraft] = useState<MaintenanceConfig>(config);
  const [saved, setSaved] = useState<MaintenanceConfig>(config);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);

  async function save() {
    setBusy(true);
    setError(null);
    const res = await saveMaintenanceConfig(draft);
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setSaved(draft);
    toast("Maintenance settings saved");
    router.refresh();
  }

  return (
    <Card>
      <h4 className="text-h3 text-ink">Daily housekeeping</h4>
      <Hint>
        Runs once a day (idempotent). FX prewarm and the overdue sweep are non-destructive and ship on;
        retention <strong>deletes</strong> aged rows, so it ships off and skips any line set to 0 days.
      </Hint>
      <div className="mt-4 space-y-4">
        <Toggle
          checked={draft.fxPrewarm.enabled}
          onChange={(b) => setDraft((d) => ({ ...d, fxPrewarm: { enabled: b } }))}
          label="Pre-warm the daily FX rate"
          title="Fetch today's INR/EUR rate on the cron tick so no user request pays the fetch latency."
        />
        <Toggle
          checked={draft.overdueSweep.enabled}
          onChange={(b) => setDraft((d) => ({ ...d, overdueSweep: { enabled: b } }))}
          label="Mark past-due invoices & instalments OVERDUE"
        />
        <div>
          <Toggle
            checked={draft.retention.enabled}
            onChange={(b) => setDraft((d) => ({ ...d, retention: { ...d.retention, enabled: b } }))}
            label="Prune aged data (deletes)"
            title="Hard-delete old WhatsApp messages and expired invites. Append-only audit tables are never touched."
          />
          <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Keep WhatsApp messages (days)" hint="0 = keep forever.">
              <NumInput
                ariaLabel="WhatsApp message retention days"
                value={draft.retention.whatsAppMessageDays}
                onChange={(n) => setDraft((d) => ({ ...d, retention: { ...d.retention, whatsAppMessageDays: n } }))}
                min={0}
                max={3650}
              />
            </Field>
            <Field label="Keep expired invites (days)" hint="0 = keep forever.">
              <NumInput
                ariaLabel="Expired invite retention days"
                value={draft.retention.expiredInviteDays}
                onChange={(n) => setDraft((d) => ({ ...d, retention: { ...d.retention, expiredInviteDays: n } }))}
                min={0}
                max={3650}
              />
            </Field>
          </div>
        </div>
      </div>
      <SaveBar dirty={dirty} onSave={save} onReset={() => setDraft(DEFAULT_MAINTENANCE_CONFIG)} busy={busy} error={error} />
    </Card>
  );
}

function PostingCard({ config }: { config: FinancePostingConfig }) {
  const router = useRouter();
  const [draft, setDraft] = useState<FinancePostingConfig>(config);
  const [saved, setSaved] = useState<FinancePostingConfig>(config);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);

  async function save() {
    setBusy(true);
    setError(null);
    const res = await saveFinancePostingConfig(draft);
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setSaved(draft);
    toast("Ledger posting settings saved");
    router.refresh();
  }

  return (
    <Card>
      <h4 className="text-h3 text-ink">Ledger auto-posting</h4>
      <Hint>
        Both write to the real double-entry ledger, so both ship <strong>off</strong>. Issuance posting
        makes Accounts receivable two-sided (Dr AR / Cr Income when an invoice is issued). Commission
        accrual books Dr Team-salaries / Cr Accounts-payable when you record a payout run — an accrual,
        not a cash payment.
      </Hint>
      <div className="mt-4 space-y-4">
        <Toggle
          checked={draft.invoiceIssuancePosting.enabled}
          onChange={(b) => setDraft((d) => ({ ...d, invoiceIssuancePosting: { enabled: b } }))}
          label="Post invoice issuance to the ledger"
        />
        <Toggle
          checked={draft.commissionAccrual.enabled}
          onChange={(b) => setDraft((d) => ({ ...d, commissionAccrual: { enabled: b } }))}
          label="Accrue commission payout runs to the ledger"
        />
      </div>
      <SaveBar dirty={dirty} onSave={save} onReset={() => setDraft(DEFAULT_FINANCE_POSTING_CONFIG)} busy={busy} error={error} />
    </Card>
  );
}

function ReportCard({ config }: { config: ScheduledReportConfig }) {
  const router = useRouter();
  const [draft, setDraft] = useState<ScheduledReportConfig>(config);
  const [saved, setSaved] = useState<ScheduledReportConfig>(config);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const patch = (p: Partial<ScheduledReportConfig>) => setDraft((d) => ({ ...d, ...p }));

  async function save() {
    setBusy(true);
    setError(null);
    const res = await saveScheduledReportConfig(draft);
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setSaved(draft);
    toast("Scheduled report saved");
    router.refresh();
  }

  return (
    <Card>
      <h4 className="text-h3 text-ink">Scheduled founder digest</h4>
      <Hint>
        Emails you the numbers on a cadence over the existing Resend channel. Ships off, and never sends
        with no recipients. Needs email configured &amp; armed (WhatsApp/Email settings) to actually
        deliver.
      </Hint>
      <div className="mt-4 space-y-4">
        <Toggle checked={draft.enabled} onChange={(b) => patch({ enabled: b })} label="Send a scheduled digest" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Cadence">
            <Picker
              ariaLabel="Cadence"
              value={draft.cadence}
              onChange={(v) => patch({ cadence: v as "WEEKLY" | "MONTHLY" })}
              options={[
                { value: "WEEKLY", label: "Weekly" },
                { value: "MONTHLY", label: "Monthly" },
              ]}
            />
          </Field>
          {draft.cadence === "WEEKLY" ? (
            <Field label="Weekday (1=Mon … 7=Sun)">
              <NumInput ariaLabel="Weekday" value={draft.weekday} onChange={(n) => patch({ weekday: n })} min={1} max={7} />
            </Field>
          ) : (
            <Field label="Day of month (1–28)">
              <NumInput ariaLabel="Day of month" value={draft.monthday} onChange={(n) => patch({ monthday: n })} min={1} max={28} />
            </Field>
          )}
          <Field label="Send at (IST)">
            <TimeIn
              ariaLabel="Send time"
              value={istMinutesToTimeInput(draft.sendAtMinutes)}
              onChange={(s) => {
                const m = timeInputToIstMinutes(s);
                if (m !== null) patch({ sendAtMinutes: m });
              }}
            />
          </Field>
        </div>
        <Field label="Recipients" hint="Comma-separated email addresses.">
          <TextIn
            ariaLabel="Recipients"
            value={draft.recipients.join(", ")}
            placeholder="you@b2consultants.in, partner@b2consultants.in"
            onChange={(s) =>
              patch({ recipients: s.split(",").map((x) => x.trim()).filter(Boolean) })
            }
          />
        </Field>
      </div>
      <SaveBar dirty={dirty} onSave={save} onReset={() => setDraft(DEFAULT_SCHEDULED_REPORT_CONFIG)} busy={busy} error={error} />
    </Card>
  );
}

function CommissionPayoutCard() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    const res = await runCommissionPayout();
    setBusy(false);
    if (!res.ok) return toast(res.error);
    toast("This month's commission payout recorded");
    router.refresh();
  }

  return (
    <Card>
      <h4 className="text-h3 text-ink">Commission payout run</h4>
      <Hint>
        Snapshots this month&apos;s deal-team commission totals into a durable payout record. If ledger
        accrual is on above, it also posts Dr Team-salaries / Cr Accounts-payable for the total — an
        accrual, never a cash payment, so it can&apos;t overstate the bank. Idempotent per month.
      </Hint>
      <div className="mt-4">
        <Btn onClick={run} disabled={busy}>
          {busy ? "Recording…" : "Record this month's payout"}
        </Btn>
      </div>
    </Card>
  );
}

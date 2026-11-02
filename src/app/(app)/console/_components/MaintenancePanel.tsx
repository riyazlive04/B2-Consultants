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
import { SystemHealthPanel, type CronRowView, type ErrorRowView } from "./SystemHealthPanel";
import { safeAction } from "@/lib/action-guard";

/**
 * Founder Console → Maintenance. One screen for the automations the app never had a clock to run
 * (audit §C): the daily housekeeping, the ledger auto-posting switches, the scheduled digest, and a
 * one-click commission payout run. Everything here is ticked by /api/cron/daily - so if CRON_SECRET
 * isn't set, the panel says so rather than claiming a rule that can never fire.
 */
export function MaintenancePanel({
  maintenance,
  report,
  posting,
  cronArmed,
  health,
}: {
  maintenance: MaintenanceConfig;
  report: ScheduledReportConfig;
  posting: FinancePostingConfig;
  cronArmed: boolean;
  health: {
    crons: CronRowView[];
    errors: ErrorRowView[];
    errorsLastHour: number;
    trackingArmed: boolean;
    heartbeatArmed: boolean;
    environment: string;
  };
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
      {/* Health goes FIRST, above the switches. Reading "the digest is on" is misleading if the
          job that would send it hasn't been called in a week - the state has to be visible before
          the settings it governs. */}
      <SystemHealthPanel {...health} />
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
    const res = await safeAction(() => saveMaintenanceConfig(draft));
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
        {/* The purge used to run whatever this said - see `runRetentionPurge`. Now that one switch
            really does govern every delete, it has to say which deletes. */}
        {" "}Pruning covers both the aged logs below <em>and</em> the permanent purge of records
        left in the Archive past the retention window. Issued invoices are never purged - they are
        tax records and stay archived for good.
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
            title="Hard-delete old WhatsApp messages, expired invites, and records left in the Archive past the retention window. Issued invoices and append-only audit tables are never touched."
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
            {/* The archive window. Until 1 Nov 2026 this number lived in a database row no screen
                wrote - the most destructive setting in the app, and the only one with no field.
                Note the floor is 1, not 0: see `archiveDays` for why 0 cannot mean "forever" here. */}
            <Field
              label="Keep archived records (days)"
              hint="The permanent purge. A record deleted anywhere in the app sits in the Archive this long, then is destroyed for good - cascades included. Minimum 1 day; there is no 'keep forever' on this line."
            >
              <NumInput
                ariaLabel="Archive retention days"
                value={draft.retention.archiveDays}
                onChange={(n) => setDraft((d) => ({ ...d, retention: { ...d.retention, archiveDays: n } }))}
                min={1}
                max={3650}
              />
            </Field>
          </div>
          {draft.retention.enabled && draft.retention.archiveDays < 30 && (
            /**
             * Under a month is legitimate and is also how somebody loses a record they meant to
             * restore. The Archive is the only undo the app has for a delete, so shortening it
             * shortens the window in which a mistake is recoverable - worth saying once, here,
             * rather than discovering afterwards.
             */
            <p className="mt-3 rounded-field border border-warn bg-warn-soft px-4 py-3 text-sm text-warn-ink">
              With pruning on and a {draft.retention.archiveDays}-day window, anything deleted is
              unrecoverable after {draft.retention.archiveDays} day
              {draft.retention.archiveDays === 1 ? "" : "s"}. The Archive is the only undo there is.
            </p>
          )}
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
    const res = await safeAction(() => saveFinancePostingConfig(draft));
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
        All three write to the real double-entry ledger, so all three ship <strong>off</strong>.
        Issuance posting makes Accounts receivable two-sided (Dr AR / Cr Income when an invoice is
        issued). Recording commission as owed books Dr Team-salaries / Cr Accounts-payable when you
        record a payout run - it logs the cost as money owed, not as cash leaving the bank. Tutor-fee
        accrual does the same for German Note delivery when a fee is approved: Dr COGS-Tutor-fees /
        Cr Accounts-payable.
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
          label="Record commission payout runs as money owed"
        />
        {/*
          ── THE SWITCH THE APP HAD BEEN REPORTING FOR MONTHS WITHOUT HAVING ──────────────
          `financePosting.tutorFeeAccrual` was stored, read by `setTutorFeeStatus` and listed by
          `not-armed.ts` and `engine-status.ts` as an engine that was off - with "Console → System
          → Maintenance" as the place to arm it. This card had two toggles. So three screens named
          a control that did not exist, the Tutor Fees panel pointed at a path that did not exist
          either, and the only way to post a tutor fee was to edit the AppSetting row by hand.

          Nothing else changed: the posting is already written, idempotent per fee id
          (`postEntryOnce`), and still ships off like its two neighbours.
        */}
        <Toggle
          checked={draft.tutorFeeAccrual.enabled}
          onChange={(b) => setDraft((d) => ({ ...d, tutorFeeAccrual: { enabled: b } }))}
          label="Record approved tutor fees as money owed"
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
    const res = await safeAction(() => saveScheduledReportConfig(draft));
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
        Emails you the numbers on a schedule over the existing Resend channel. Ships off, and never sends
        with no recipients. Needs email configured &amp; armed (WhatsApp/Email settings) to actually
        deliver.
      </Hint>
      <div className="mt-4 space-y-4">
        <Toggle checked={draft.enabled} onChange={(b) => patch({ enabled: b })} label="Send a scheduled digest" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="How often">
            <Picker
              ariaLabel="How often"
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
            <Field label="Day of month (1-28)">
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
        <Field
          label="Also send to WhatsApp"
          hint="Comma-separated numbers with country code. Sent IN ADDITION to email, never instead of it - see below."
        >
          <TextIn
            ariaLabel="WhatsApp recipients"
            value={draft.whatsappRecipients.join(", ")}
            placeholder="919876543210"
            onChange={(s) =>
              patch({ whatsappRecipients: s.split(",").map((x) => x.trim()).filter(Boolean) })
            }
          />
        </Field>
        {draft.whatsappRecipients.length > 0 && (
          <p className="rounded-field bg-warn-soft px-3 py-2 text-xs font-medium text-warn">
            The WhatsApp copy goes out as a <strong>session message</strong>, which Meta only
            allows inside the 24 hours after that number last messaged the business. If nobody has
            messaged recently it will be logged as skipped and the emailed copy is what you&apos;ll
            get. Making this reliable needs a WhatsApp template approved by Meta for the digest -
            one doesn&apos;t exist yet.
          </p>
        )}
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
    const res = await safeAction(() => runCommissionPayout());
    setBusy(false);
    if (!res.ok) return toast(res.error);
    toast("This month's commission payout recorded");
    router.refresh();
  }

  return (
    <Card>
      <h4 className="text-h3 text-ink">Commission payout run</h4>
      <Hint>
        Snapshots this month&apos;s deal-team commission totals into a durable payout record. If
        recording as money owed is on above, it also posts Dr Team-salaries / Cr Accounts-payable for
        the total - money owed, never a cash payment, so it can&apos;t overstate the bank. Idempotent
        per month.
      </Hint>
      <div className="mt-4">
        <Btn onClick={run} disabled={busy}>
          {busy ? "Recording…" : "Record this month's payout"}
        </Btn>
      </div>
    </Card>
  );
}

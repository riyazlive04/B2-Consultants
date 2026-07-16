"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { PhoneCall, Target, Trophy } from "lucide-react";
import { logCall } from "@/server/call-log-actions";
import type { DeskLead, TelecallerDesk } from "@/server/telecaller-desk-metrics";
import { Card, EmptyState, Grid, Pill, ProgressBar, Stat } from "@/components/ui/kit";
import { Btn } from "@/components/ui/controls";
import { Field, FormError, Select, SubmitButton, TextInput } from "@/components/ui/form";
import { Modal } from "@/components/ui/Modal";
import { toast } from "@/components/ui/feedback";
import { NewLeadWatcher } from "./NewLeadWatcher";
import { LEAD_STAGE_LABELS, LEAD_SOURCE_LABELS } from "@/lib/labels";

/** Outcomes in the order a telecaller actually meets them — connected first. */
const OUTCOME_OPTIONS = [
  { value: "SPOKE", label: "Spoke to them" },
  { value: "NO_ANSWER", label: "No answer" },
  { value: "BUSY", label: "Busy" },
  { value: "CALLBACK", label: "Asked to call back" },
  { value: "WRONG_NUMBER", label: "Wrong number" },
  { value: "NOT_INTERESTED", label: "Not interested" },
];

function sinceLabel(iso: string | null): string {
  if (!iso) return "never called";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "called today";
  if (days === 1) return "called yesterday";
  return `called ${days}d ago`;
}

/**
 * Click-to-dial. `tel:` is the whole mechanism — on a phone it opens the dialer with the
 * number filled in, which is exactly the ask ("if they are logged in through mobile, an
 * option to directly dial"). No telephony integration, nothing to configure, works offline.
 *
 * Shown on every device rather than sniffing for mobile: user-agent detection is unreliable
 * and would hide the button on a tablet or a desktop with a softphone. On a machine with no
 * handler the link simply does nothing, which is a smaller failure than a missing button.
 */
function DialLink({ phone, name }: { phone: string; name: string }) {
  return (
    <a
      href={`tel:${phone.replace(/[^\d+]/g, "")}`}
      aria-label={`Call ${name} on ${phone}`}
      className="inline-flex items-center gap-1.5 rounded-btn bg-primary px-3 py-1.5 text-sm font-semibold text-on-accent hover:bg-primary-strong"
    >
      <PhoneCall size={14} /> Call
    </a>
  );
}

function LogCallModal({ lead, onClose }: { lead: DeskLead; onClose: () => void }) {
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal open onClose={onClose} title={`Log call — ${lead.name}`} subtitle={lead.phone}>
      <form
        action={async (form) => {
          setError(null);
          const res = await logCall(lead.id, form);
          if (!res.ok) return setError(res.error);
          toast("Call logged");
          onClose();
        }}
        className="space-y-4"
      >
        <Field label="What happened?">
          <Select name="outcome" options={OUTCOME_OPTIONS} defaultValue="SPOKE" />
        </Field>
        <Field label="Notes (optional)">
          <TextInput name="notes" maxLength={500} placeholder="What did they say?" />
        </Field>
        <div className="flex items-center justify-between gap-3">
          <FormError message={error} />
          <span className="ml-auto"><SubmitButton>Log call</SubmitButton></span>
        </div>
      </form>
    </Modal>
  );
}

export function DeskClient({ desk }: { desk: TelecallerDesk }) {
  const router = useRouter();
  const [logging, setLogging] = useState<DeskLead | null>(null);

  const { today, month } = desk;
  const targetPct = today.target > 0 ? (today.calls / today.target) * 100 : 0;
  const targetTone = targetPct >= 100 ? "good" : targetPct >= 50 ? "primary" : "warn";

  return (
    <div className="space-y-6">
      {/* Polls every 30s and pops any lead newly assigned to me. */}
      <NewLeadWatcher onSeen={() => router.refresh()} />

      <Grid cols={4}>
        <Card>
          <Stat label="Calls today" value={today.calls} />
          {today.target > 0 ? (
            <div className="mt-2 space-y-1">
              <ProgressBar pct={targetPct} tone={targetTone} />
              <p className="text-xs text-muted">
                {today.calls} of {today.target} · {Math.max(0, today.target - today.calls)} to go
              </p>
            </div>
          ) : (
            <p className="mt-2 text-xs text-muted">No daily target set</p>
          )}
        </Card>
        <Card>
          <Stat label="Still to call today" value={today.toCall} tone={today.toCall > 0 ? "warn" : "good"} />
          <p className="mt-2 text-xs text-muted">
            {today.toCall > 0 ? "Open leads with no call logged today" : "Everyone on your list has been called"}
          </p>
        </Card>
        <Card>
          <Stat label="Spoken to · this month" value={month.spokenTo} />
          <p className="mt-2 text-xs text-muted">{month.calls} dials · {month.spokenTo} people reached</p>
        </Card>
        <Card>
          <Stat label="Converted · this month" value={month.converted} tone="good" />
          <p className="mt-2 text-xs text-muted">
            {month.conversionPct === null
              ? "No one spoken to yet this month"
              : `${month.conversionPct.toFixed(0)}% of the people you spoke to`}
          </p>
        </Card>
      </Grid>

      {desk.goals.length > 0 && (
        <Card title="My goals" subtitle="Set by Ameen. Hit the target to earn the incentive.">
          <div className="space-y-4">
            {desk.goals.map((g) => (
              <div key={g.goal.id}>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="flex items-center gap-1.5 text-sm font-semibold">
                    <Target size={14} className="text-primary" /> {g.goal.name}
                  </p>
                  <p className="tnum text-sm text-ink-2">
                    {g.actual.toLocaleString("en-IN")} / {g.goal.targetValue.toLocaleString("en-IN")}
                    {g.met && <Pill tone="good">Met</Pill>}
                  </p>
                </div>
                <div className="mt-1.5">
                  <ProgressBar pct={g.pct} tone={g.met ? "good" : "primary"} />
                </div>
                <p className="mt-1 text-xs text-muted">
                  {g.met
                    ? `Target reached${g.metOn ? ` on ${g.metOn}` : ""} — incentive unlocked.`
                    : `${Math.max(0, g.goal.targetValue - g.actual).toLocaleString("en-IN")} to go.`}
                </p>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card
        title={`Today's call list (${desk.worklist.length})`}
        subtitle="Your open leads with no call logged today — never-called first."
        flush
      >
        {desk.worklist.length === 0 ? (
          <div className="p-6">
            <EmptyState
              icon={<Trophy size={22} />}
              title="Nothing left to call today"
              body="Every open lead assigned to you has a call logged today. New leads will pop up here automatically."
            />
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {desk.worklist.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
                <div className="min-w-[180px] flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/pipeline?lead=${l.id}`} className="text-sm font-semibold text-accent hover:underline">
                      {l.name}
                    </Link>
                    <Pill tone={l.callCount === 0 ? "warn" : "neutral"}>
                      {LEAD_STAGE_LABELS[l.stage] ?? l.stage}
                    </Pill>
                  </div>
                  <p className="mt-0.5 text-xs text-muted">
                    {l.phone}
                    {l.city ? ` · ${l.city}` : ""} · {LEAD_SOURCE_LABELS[l.leadSource] ?? l.leadSource} ·{" "}
                    {sinceLabel(l.lastCalledAt)}
                    {l.callCount > 0 ? ` · ${l.callCount} call${l.callCount === 1 ? "" : "s"}` : ""}
                  </p>
                </div>
                <DialLink phone={l.phone} name={l.name} />
                <Btn variant="soft" size="sm" onClick={() => setLogging(l)}>
                  Log call
                </Btn>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {logging && <LogCallModal lead={logging} onClose={() => { setLogging(null); router.refresh(); }} />}
    </div>
  );
}

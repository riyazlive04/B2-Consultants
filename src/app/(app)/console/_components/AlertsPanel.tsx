"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  DEFAULT_SPEED_TO_LEAD_ALERT,
  DEFAULT_DUNNING_CONFIG,
  DEFAULT_ATTENDANCE_CONFIG,
  type SpeedToLeadAlertConfig,
  type DunningConfig,
  type DunningChannel,
  type AttendanceConfig,
} from "@/lib/config-schema";
import { Field } from "@/components/ui/form";
import { toast } from "@/components/ui/feedback";
import { TablePager, usePaged } from "@/components/ui/pager";
import {
  saveSpeedToLeadAlertConfig,
  saveDunningConfig,
  saveAttendanceConfig,
  previewDunningLadder,
} from "@/server/maintenance-actions";
import { Btn, Card, Hint, NumInput, Picker, SaveBar, TextIn, Toggle } from "./kit";
import { safeAction } from "@/lib/action-guard";

/**
 * Founder Console → Alerts & chasing.
 *
 * The three rules that DECIDE WHEN THE APP TALKS TO SOMEBODY: who gets told about a lead going
 * cold, how a late payment gets chased, and when a student's attendance becomes a concern.
 *
 * Grouped together deliberately. They live in different parts of the product but they are the
 * same kind of decision - a threshold that, once crossed, produces a message to a real person -
 * and the two that send ship OFF for that reason.
 */

/** Shared save-state plumbing. Every card here is the same shape; only the fields differ. */
function useDraft<T>(initial: T, save: (draft: T) => Promise<{ ok: boolean; error?: string }>) {
  const router = useRouter();
  const [draft, setDraft] = useState<T>(initial);
  const [saved, setSaved] = useState<T>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);

  async function commit(successMessage: string) {
    setBusy(true);
    setError(null);
    const res = await save(draft);
    setBusy(false);
    if (!res.ok) return setError(res.error ?? "Couldn't save");
    setSaved(draft);
    toast(successMessage);
    router.refresh();
  }

  return { draft, setDraft, busy, error, dirty, commit };
}

export function AlertsPanel({
  speedToLead,
  dunning,
  attendance,
  cronArmed,
  emailArmed,
}: {
  speedToLead: SpeedToLeadAlertConfig;
  dunning: DunningConfig;
  attendance: AttendanceConfig;
  cronArmed: boolean;
  emailArmed: boolean;
}) {
  return (
    <div className="space-y-6">
      {!cronArmed && (
        <p className="rounded-field bg-warn-soft px-3 py-2 text-xs font-medium text-warn">
          <code>CRON_SECRET</code> isn&apos;t set, so none of the rules below can ever fire - the
          app has no clock of its own.
        </p>
      )}
      {cronArmed && !emailArmed && (
        <p className="rounded-field bg-warn-soft px-3 py-2 text-xs font-medium text-warn">
          Email isn&apos;t armed, so these rules will still <em>run</em> and log who they{" "}
          <em>would</em> have contacted - but nothing will actually be sent.
        </p>
      )}
      <SpeedToLeadCard config={speedToLead} />
      <DunningCard config={dunning} />
      <AttendanceCard config={attendance} />
    </div>
  );
}

function SpeedToLeadCard({ config }: { config: SpeedToLeadAlertConfig }) {
  const { draft, setDraft, busy, error, dirty, commit } = useDraft(config, saveSpeedToLeadAlertConfig);
  const patch = (p: Partial<SpeedToLeadAlertConfig>) => setDraft((d) => ({ ...d, ...p }));

  return (
    <Card>
      <h4 className="text-h3 text-ink">Speed-to-lead alert</h4>
      <Hint>
        Emails you when new leads are sitting unanswered. Checked every few minutes by{" "}
        <code>/api/cron/alerts</code>.
        <br />
        <strong>Only newly-arrived leads count.</strong> The standing backlog of never-contacted
        leads is reported in the weekly digest, not alerted on - an alert that fires on 23,000
        leads every few minutes gets muted on day two, and a muted alert is worse than none.
      </Hint>
      <div className="mt-4 space-y-4">
        <Toggle
          checked={draft.enabled}
          onChange={(b) => patch({ enabled: b })}
          label="Alert me about unanswered leads"
        />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Late after (minutes)" hint="The JD target is 5; alerting at 5 would page you about calls in progress.">
            <NumInput
              ariaLabel="Threshold minutes"
              value={draft.thresholdMinutes}
              onChange={(n) => patch({ thresholdMinutes: n })}
              min={1}
              max={1440}
            />
          </Field>
          <Field label="Only leads from the last (minutes)" hint="Older than this is backlog.">
            <NumInput
              ariaLabel="Lookback minutes"
              value={draft.lookbackMinutes}
              onChange={(n) => patch({ lookbackMinutes: n })}
              min={5}
              max={10080}
            />
          </Field>
          <Field label="Alert at this many" hint="One late lead is a Tuesday. Several at once is a situation.">
            <NumInput
              ariaLabel="Minimum breaches"
              value={draft.minBreaches}
              onChange={(n) => patch({ minBreaches: n })}
              min={1}
              max={500}
            />
          </Field>
          <Field label="Quiet for (minutes)" hint="After an alert, how long before another can go out.">
            <NumInput
              ariaLabel="Cooldown minutes"
              value={draft.cooldownMinutes}
              onChange={(n) => patch({ cooldownMinutes: n })}
              min={5}
              max={1440}
            />
          </Field>
        </div>
        <Field label="Recipients" hint="Comma-separated email addresses.">
          <TextIn
            ariaLabel="Alert recipients"
            value={draft.recipients.join(", ")}
            placeholder="you@b2consultants.in"
            onChange={(s) => patch({ recipients: s.split(",").map((x) => x.trim()).filter(Boolean) })}
          />
        </Field>
      </div>
      <SaveBar
        dirty={dirty}
        onSave={() => commit("Speed-to-lead alerting saved")}
        onReset={() => setDraft(DEFAULT_SPEED_TO_LEAD_ALERT)}
        busy={busy}
        error={error}
      />
    </Card>
  );
}

const CHANNEL_OPTIONS = [
  { value: "EMAIL", label: "Email" },
  { value: "WHATSAPP", label: "WhatsApp" },
  { value: "BOTH", label: "Email + WhatsApp" },
];

type PreviewRow = {
  instalmentId: string;
  studentName: string;
  stage: string;
  amountLabel: string;
  dueDateLabel: string;
  daysPastDue: number;
  channel: string;
  hasEmail: boolean;
  hasPhone: boolean;
};

/** Stable empty list, so "no preview yet" does not hand the pager a fresh array each render. */
const EMPTY_PREVIEW: PreviewRow[] = [];

function DunningCard({ config }: { config: DunningConfig }) {
  const { draft, setDraft, busy, error, dirty, commit } = useDraft(config, saveDunningConfig);
  const [preview, setPreview] = useState<PreviewRow[] | null>(null);
  const [previewing, setPreviewing] = useState(false);
  // The dunning preview used to be cut off at 25 rows with "…and 112 more" - which is exactly the
  // list someone arming this needs to read in full before they arm it.
  const { paged: pagedPreview, pager: previewPager } = usePaged(preview ?? EMPTY_PREVIEW);

  const stage = (
    key: "upcoming" | "missed" | "final",
    title: string,
    description: string,
  ) => {
    const s = draft.stages[key];
    const patchStage = (p: Partial<typeof s>) =>
      setDraft((d) => ({ ...d, stages: { ...d.stages, [key]: { ...d.stages[key], ...p } } }));

    return (
      <div key={key} className="rounded-field border border-line bg-surface-2 p-3.5">
        <Toggle checked={s.enabled} onChange={(b) => patchStage({ enabled: b })} label={title} />
        <p className="mt-1 text-caption text-muted">{description}</p>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Days from due date" hint="Negative is before it.">
            <NumInput
              ariaLabel={`${title} day offset`}
              value={s.dayOffset}
              onChange={(n) => patchStage({ dayOffset: n })}
              min={-60}
              max={180}
            />
          </Field>
          <Field label="Send by">
            <Picker
              ariaLabel={`${title} channel`}
              value={s.channel}
              onChange={(v) => patchStage({ channel: v as DunningChannel })}
              options={CHANNEL_OPTIONS}
            />
          </Field>
        </div>
      </div>
    );
  };

  return (
    <Card>
      <h4 className="text-h3 text-ink">Payment chase ladder</h4>
      <Hint>
        Three escalating messages keyed off each instalment&apos;s own due date. Ships{" "}
        <strong>off</strong> - this talks to paying students, which is the highest-consequence
        thing the app does.
        <br />
        Stages never fire out of order or bunch up: an instalment already ten days overdue when
        this is switched on gets the <em>final notice only</em>, not all three at once. A paid
        instalment is re-checked immediately before every send.
      </Hint>
      <div className="mt-4 space-y-4">
        <Toggle
          checked={draft.enabled}
          onChange={(b) => setDraft((d) => ({ ...d, enabled: b }))}
          label="Chase late payments automatically"
        />
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          {stage("upcoming", "Upcoming reminder", "A friendly heads-up before the due date.")}
          {stage("missed", "Missed payment", "Direct: states the amount and the date it was due.")}
          {stage("final", "Final notice", "Firm, names the consequence, and copies you in.")}
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field
            label="Copy me on final notices"
            hint="Optional. Only the last rung - copying you on every nudge would bury the escalations."
          >
            <TextIn
              ariaLabel="Founder CC"
              value={draft.founderCc}
              placeholder="you@b2consultants.in"
              onChange={(s) => setDraft((d) => ({ ...d, founderCc: s.trim() }))}
            />
          </Field>
          <Field
            label="Most messages per run"
            hint="The first run faces the whole backlog at once. This turns that into a queue that drains over days."
          >
            <NumInput
              ariaLabel="Per-run cap"
              value={draft.perRunCap}
              onChange={(n) => setDraft((d) => ({ ...d, perRunCap: n }))}
              min={1}
              max={1000}
            />
          </Field>
        </div>
      </div>
      {/* The dry run. Nobody sensible arms an engine that emails paying students on the strength
          of a description of what it does - this runs the identical read path with every side
          effect removed, so "show me exactly who gets what" has an answer first. */}
      <div className="mt-5 border-t border-line pt-4">
        <Btn
          onClick={async () => {
            setPreviewing(true);
            const res = await safeAction(() => previewDunningLadder());
            setPreviewing(false);
            if (!res.ok) return toast(res.error, "error");
            setPreview(res.rows);
            if (res.rows.length === 0) toast("Nothing would be sent on the next run");
          }}
          disabled={previewing}
        >
          {previewing ? "Checking…" : "Preview the next run"}
        </Btn>

        {preview && preview.length > 0 && (
          <div className="mt-3 overflow-x-auto">
            <p className="mb-2 text-caption text-muted">
              {preview.length} message{preview.length === 1 ? "" : "s"} would go out on the next
              run{preview.length > draft.perRunCap ? `, capped at ${draft.perRunCap}` : ""}.
            </p>
            <table className="w-full min-w-[34rem] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-caption text-muted">
                  <th className="py-1.5 pr-4 font-semibold">Student</th>
                  <th className="py-1.5 pr-4 font-semibold">Stage</th>
                  <th className="py-1.5 pr-4 font-semibold">Amount</th>
                  <th className="py-1.5 pr-4 font-semibold">Due</th>
                  <th className="py-1.5 font-semibold">Via</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {pagedPreview.map((r) => (
                  <tr key={r.instalmentId}>
                    <td className="py-1.5 pr-4 text-ink">{r.studentName}</td>
                    <td className="py-1.5 pr-4 text-ink-2">{r.stage}</td>
                    <td className="py-1.5 pr-4 tabular-nums text-ink-2">{r.amountLabel}</td>
                    <td className="py-1.5 pr-4 text-ink-3">
                      {r.dueDateLabel}
                      {r.daysPastDue > 0 && ` (${r.daysPastDue}d ago)`}
                    </td>
                    <td className="py-1.5 text-ink-3">
                      {/* A row with no usable contact detail is the most useful thing on this
                          table - it is silently skipped by the real run. */}
                      {r.channel === "WHATSAPP"
                        ? r.hasPhone ? "WhatsApp" : "- no number -"
                        : r.hasEmail ? "Email" : "- no email -"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <TablePager {...previewPager} bordered={false} />
          </div>
        )}
      </div>

      <SaveBar
        dirty={dirty}
        onSave={() => commit("Payment chase ladder saved")}
        onReset={() => setDraft(DEFAULT_DUNNING_CONFIG)}
        busy={busy}
        error={error}
      />
    </Card>
  );
}

function AttendanceCard({ config }: { config: AttendanceConfig }) {
  const { draft, setDraft, busy, error, dirty, commit } = useDraft(config, saveAttendanceConfig);
  const patch = (p: Partial<AttendanceConfig>) => setDraft((d) => ({ ...d, ...p }));

  return (
    <Card>
      <h4 className="text-h3 text-ink">Attendance risk</h4>
      <Hint>
        When a student&apos;s attendance turns amber or red on the batch roster. Nothing here
        sends anything - it only colours a list, so unlike the two rules above there is no switch
        to arm.
        <br />
        Excused absences are excluded from the rate entirely, and a late arrival counts as
        attending.
      </Hint>
      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Amber below (%)">
          <NumInput
            ariaLabel="Amber threshold"
            value={draft.amberRatePct}
            onChange={(n) => patch({ amberRatePct: n })}
            min={0}
            max={100}
          />
        </Field>
        <Field label="Red below (%)" hint="Must be at or below amber.">
          <NumInput
            ariaLabel="Red threshold"
            value={draft.redRatePct}
            onChange={(n) => patch({ redRatePct: n })}
            min={0}
            max={100}
          />
        </Field>
        <Field
          label="Red after N missed in a row"
          hint="Fires on its own - a student at 80% who's missed the last three is the one about to drop, and an average can't see that."
        >
          <NumInput
            ariaLabel="Consecutive misses for red"
            value={draft.consecutiveMissedForRed}
            onChange={(n) => patch({ consecutiveMissedForRed: n })}
            min={1}
            max={20}
          />
        </Field>
        <Field label="Need at least N sessions" hint="Below this the signal reads 'unknown' rather than guessing.">
          <NumInput
            ariaLabel="Minimum sessions for a signal"
            value={draft.minSessionsForSignal}
            onChange={(n) => patch({ minSessionsForSignal: n })}
            min={1}
            max={20}
          />
        </Field>
      </div>
      <div className="mt-6 border-t border-line pt-5">
        <h4 className="text-h3 text-ink">Self check-in</h4>
        <Hint>
          A tutor or head coach opens the register from Attendance and the students in that
          cohort - and only that cohort - get a live &quot;I&apos;m here&quot; button for as long as
          the window runs. It fills the register from the room instead of from memory.
          <br />
          Lateness is counted from whichever is later, the class start or the moment the window
          opened, so opening early never makes anyone late and opening late never penalises the
          room.
        </Hint>
        <div className="mt-4 space-y-3">
          <Toggle
            checked={draft.selfCheckInEnabled}
            onChange={(v) => patch({ selfCheckInEnabled: v })}
            label="Let students check themselves in"
            title="Off hides the button everywhere; tutors keep the register sheet"
          />
          <Toggle
            checked={draft.publishRequired}
            onChange={(v) => patch({ publishRequired: v })}
            label="Hide a register until the coach shows it"
            title="Off means a mark is visible to the student as soon as it is written"
          />
        </div>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Window length (minutes)" hint="The tutor can change this when opening.">
            <NumInput
              ariaLabel="Default check-in window in minutes"
              value={draft.checkInWindowMins}
              onChange={(n) => patch({ checkInWindowMins: n })}
              min={1}
              max={240}
            />
          </Field>
          <Field
            label="On time for the first N minutes"
            hint="A check-in after this records as Late, which still counts as attending. Cannot exceed the window."
          >
            <NumInput
              ariaLabel="Minutes a check-in still counts as on time"
              value={draft.checkInLateAfterMins}
              onChange={(n) => patch({ checkInLateAfterMins: n })}
              min={0}
              max={240}
            />
          </Field>
        </div>
      </div>

      <div className="mt-6 border-t border-line pt-5">
        <h4 className="text-h3 text-ink">Missing a class, and catching up</h4>
        <Hint>
          When a register is SHOWN to the batch, the students marked absent are told so - in the
          app here, and over WhatsApp only if you arm that separately in WhatsApp → Settings.
          Nothing is ever sent about a register you have not published.
          <br />
          The catch-up grace is measured from when the RECORDING went up, not from the class: a
          coach who posts the video three days late has not made the whole room three days
          overdue.
        </Hint>
        <div className="mt-4 space-y-3">
          <Toggle
            checked={draft.absenceAlertEnabled}
            onChange={(v) => patch({ absenceAlertEnabled: v })}
            label="Tell a student in the app when they are marked absent"
            title="Only once the register is shown to the batch"
          />
          <Toggle
            checked={draft.catchUpAlertEnabled}
            onChange={(v) => patch({ catchUpAlertEnabled: v })}
            label="Nudge them again if the recording goes unwatched"
            title="Fires once the grace below has run out"
          />
        </div>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field
            label="Catch-up grace (hours)"
            hint="After the recording goes up. The founders asked for 24. 0 means overdue immediately."
          >
            <NumInput
              ariaLabel="Hours before an unwatched recording counts as overdue"
              value={draft.catchUpHours}
              onChange={(n) => patch({ catchUpHours: n })}
              min={0}
              max={720}
            />
          </Field>
          <Field
            label="Register chase escalates after (hours)"
            hint="A class already shows up as needing a register the moment it is taught. This is when that reminder changes its wording and goes to the top - the founders asked for 24."
          >
            <NumInput
              ariaLabel="Hours before an unmarked register escalates"
              value={draft.registerEscalationHours}
              onChange={(n) => patch({ registerEscalationHours: n })}
              min={1}
              max={336}
            />
          </Field>
          <Field
            label="Default viewing window (days)"
            hint="What a tutor's picker pre-selects when they post a recording. 0 = no time limit, which is how every existing recording behaves."
          >
            <NumInput
              ariaLabel="Default days a recording stays visible to students"
              value={draft.recordingAccessDays}
              onChange={(n) => patch({ recordingAccessDays: n })}
              min={0}
              max={3650}
            />
          </Field>
        </div>
        <p className="mt-3 text-caption text-muted">
          Changing the default never re-dates a recording that is already posted - each one keeps
          the window it was given. A tutor or head coach sets it per recording, and can extend or
          reopen one from the Attendance desk.
        </p>
      </div>

      <SaveBar
        dirty={dirty}
        onSave={() => commit("Attendance settings saved")}
        onReset={() => setDraft(DEFAULT_ATTENDANCE_CONFIG)}
        busy={busy}
        error={error}
      />
    </Card>
  );
}

"use client";

import { useState } from "react";
import { Card, Pill } from "@/components/ui/kit";
import { Field, TextInput, SubmitButton, FormError } from "@/components/ui/form";
import { SelectMenu } from "@/components/ui/SelectMenu";
import { toast } from "@/components/ui/feedback";
import type { WeeklyReportConfig } from "@/lib/config-schema";
import { saveWeeklyReportConfig } from "@/server/weekly-report-actions";

/**
 * WEEKLY REPORTS - the cadence, the two switches, and the red-flag thresholds.
 *
 * ── Why the dry run is its own switch ─────────────────────────────────────────────────
 * Armed-and-rehearsing is the state this panel exists to make legible. With the engine on
 * and the dry run on, every cohort's week opens, the dashboard fills up, and a full skipped
 * row is written per student - so the screen looks alive while not one student has been sent
 * anything. Two switches say that; one boolean cannot.
 *
 * ── Why the thresholds are here and not in the code ──────────────────────────────────
 * They are the founders' numbers, off their own Red Flag System tab, and they are the kind
 * of number that moves: 10 applications a week is a decision about this quarter, not a fact
 * about the product. Changing one re-colours the history too, because every flag is derived
 * on read rather than stored - which is the whole reason the spreadsheet's flag column kept
 * going stale.
 */

const DAYS = [
  { value: "1", label: "Monday" },
  { value: "2", label: "Tuesday" },
  { value: "3", label: "Wednesday" },
  { value: "4", label: "Thursday" },
  { value: "5", label: "Friday" },
  { value: "6", label: "Saturday" },
  { value: "7", label: "Sunday" },
];

const YES_NO = [
  { value: "no", label: "No" },
  { value: "yes", label: "Yes" },
];

/** Minutes past midnight as "HH:MM", for a time field. */
function hhmm(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function minutesOf(value: string, fallback: number): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return fallback;
  return Math.min(1439, Number(m[1]) * 60 + Number(m[2]));
}

export function WeeklyReportPanel({ config }: { config: WeeklyReportConfig }) {
  const [error, setError] = useState<string | null>(null);
  const t = config.thresholds;

  async function save(form: FormData) {
    setError(null);
    const num = (name: string, fallback: number) => {
      const raw = String(form.get(name) ?? "").trim();
      const n = Number(raw);
      return Number.isFinite(n) && raw !== "" ? Math.trunc(n) : fallback;
    };
    const yes = (name: string) => String(form.get(name) ?? "no") === "yes";

    const res = await saveWeeklyReportConfig({
      enabled: yes("enabled"),
      dryRun: yes("dryRun"),
      openWeekday: num("openWeekday", config.openWeekday),
      openAtMinutes: minutesOf(String(form.get("openAt") ?? ""), config.openAtMinutes),
      closeWeekday: num("closeWeekday", config.closeWeekday),
      closeAtMinutes: minutesOf(String(form.get("closeAt") ?? ""), config.closeAtMinutes),
      reminderEnabled: yes("reminderEnabled"),
      reminderWeekday: num("reminderWeekday", config.reminderWeekday),
      reminderAtMinutes: minutesOf(String(form.get("reminderAt") ?? ""), config.reminderAtMinutes),
      missedNoticeEnabled: yes("missedNoticeEnabled"),
      maxPerRun: num("maxPerRun", config.maxPerRun),
      germanNoteEnabled: yes("germanNoteEnabled"),
      thresholds: {
        appsTarget: num("appsTarget", t.appsTarget),
        networkingTarget: num("networkingTarget", t.networkingTarget),
        linkedinTarget: num("linkedinTarget", t.linkedinTarget),
        lowThreshold: num("lowThreshold", t.lowThreshold),
        ghostWeeks: num("ghostWeeks", t.ghostWeeks),
        yellowToRedWeeks: num("yellowToRedWeeks", t.yellowToRedWeeks),
        recoveryGreenWeeks: num("recoveryGreenWeeks", t.recoveryGreenWeeks),
        notifyAdminOnYellow: yes("notifyAdminOnYellow"),
      },
      // Not editable here yet: the per-level overrides are passed back as they came so saving
      // the cadence cannot silently reset Elite's tighter ghost window.
      perLevel: config.perLevel,
    });
    if (!res.ok) {
      setError(res.error);
      return;
    }
    toast("Weekly report settings saved.");
  }

  const armed = config.enabled && !config.dryRun;

  return (
    <form action={save} className="space-y-6">
      <Card
        title="The engine"
        subtitle="Off, nothing opens and nothing is sent - the dashboard still reads, and weeks can still be opened by hand."
        actions={
          <Pill tone={armed ? "good" : config.enabled ? "warn" : "neutral"}>
            {armed ? "Armed" : config.enabled ? "Rehearsing" : "Off"}
          </Pill>
        }
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field
            label="Run the weekly report automatically"
            hint="Opens each active cohort's week, tells the students it is waiting, chases non-responders and closes the week."
          >
            <SelectMenu name="enabled" defaultValue={config.enabled ? "yes" : "no"} options={YES_NO} />
          </Field>
          <Field
            label="Rehearse only (dry run)"
            hint="Yes does everything except hand a message to WhatsApp, and logs exactly what it would have sent. Leave this on until you have read a rehearsal."
          >
            <SelectMenu name="dryRun" defaultValue={config.dryRun ? "yes" : "no"} options={YES_NO} />
          </Field>
          <Field label="Ask German Note cohorts too" hint="They get the shorter check-in, not the sprint questions.">
            <SelectMenu
              name="germanNoteEnabled"
              defaultValue={config.germanNoteEnabled ? "yes" : "no"}
              options={YES_NO}
            />
          </Field>
          <Field
            label="Messages per run"
            hint="A ceiling across every cohort and every rung, so a stuck scheduler catching up cannot send hundreds at once."
          >
            <TextInput name="maxPerRun" kind="int" inputMode="numeric" defaultValue={String(config.maxPerRun)} />
          </Field>
        </div>
      </Card>

      <Card
        title="The week"
        subtitle="Every Last Form Date in the founders' own tracker is a Friday, and the review happens on Monday - which is where these defaults come from."
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Opens on">
            <SelectMenu name="openWeekday" defaultValue={String(config.openWeekday)} options={DAYS} />
          </Field>
          <Field label="Opens at (IST)">
            <TextInput name="openAt" type="time" defaultValue={hhmm(config.openAtMinutes)} />
          </Field>
          <Field label="Closes on">
            <SelectMenu name="closeWeekday" defaultValue={String(config.closeWeekday)} options={DAYS} />
          </Field>
          <Field
            label="Closes at (IST)"
            hint="After this a submission still counts, and is marked late."
          >
            <TextInput name="closeAt" type="time" defaultValue={hhmm(config.closeAtMinutes)} />
          </Field>
        </div>
      </Card>

      <Card title="Chasing" subtitle="Who hears about a report that has not arrived, and when.">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Remind whoever has not answered">
            <SelectMenu
              name="reminderEnabled"
              defaultValue={config.reminderEnabled ? "yes" : "no"}
              options={YES_NO}
            />
          </Field>
          <Field label="Remind on">
            <SelectMenu name="reminderWeekday" defaultValue={String(config.reminderWeekday)} options={DAYS} />
          </Field>
          <Field label="Remind at (IST)">
            <TextInput name="reminderAt" type="time" defaultValue={hhmm(config.reminderAtMinutes)} />
          </Field>
          <Field
            label="Message a student whose week closed empty"
            hint="The Red Flag System's 'missed 1 form' rung. Sent once, after the window, never during it."
          >
            <SelectMenu
              name="missedNoticeEnabled"
              defaultValue={config.missedNoticeEnabled ? "yes" : "no"}
              options={YES_NO}
            />
          </Field>
        </div>
      </Card>

      <Card
        title="Red flag thresholds"
        subtitle="The numbers the rules compare against. Changing one re-colours the history as well, because every flag is worked out on read rather than stored."
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Applications a week" hint="Below this is a yellow.">
            <TextInput name="appsTarget" kind="int" inputMode="numeric" defaultValue={String(t.appsTarget)} />
          </Field>
          <Field label="Networking contacts a week">
            <TextInput
              name="networkingTarget"
              kind="int"
              inputMode="numeric"
              defaultValue={String(t.networkingTarget)}
            />
          </Field>
          <Field label="Posts a week">
            <TextInput
              name="linkedinTarget"
              kind="int"
              inputMode="numeric"
              defaultValue={String(t.linkedinTarget)}
            />
          </Field>
          <Field label="Well below" hint="Networking or posts under this is a yellow on its own.">
            <TextInput name="lowThreshold" kind="int" inputMode="numeric" defaultValue={String(t.lowThreshold)} />
          </Field>
          <Field label="Silent weeks before red" hint="Elite is held to two by default.">
            <TextInput name="ghostWeeks" kind="int" inputMode="numeric" defaultValue={String(t.ghostWeeks)} />
          </Field>
          <Field label="Yellow weeks before it escalates">
            <TextInput
              name="yellowToRedWeeks"
              kind="int"
              inputMode="numeric"
              defaultValue={String(t.yellowToRedWeeks)}
            />
          </Field>
          <Field label="Clean weeks to come back from red" hint="One good week shows as yellow - the interim.">
            <TextInput
              name="recoveryGreenWeeks"
              kind="int"
              inputMode="numeric"
              defaultValue={String(t.recoveryGreenWeeks)}
            />
          </Field>
          <Field label="Tell the founder about a yellow" hint="Per-level overrides still apply on top of this.">
            <SelectMenu
              name="notifyAdminOnYellow"
              defaultValue={t.notifyAdminOnYellow ? "yes" : "no"}
              options={YES_NO}
            />
          </Field>
        </div>
      </Card>

      <FormError message={error} />
      <SubmitButton>Save weekly report settings</SubmitButton>
    </form>
  );
}

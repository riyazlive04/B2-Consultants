"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { saveWeeklySnapshot } from "@/server/funnel-actions";
import type { FunnelOverview } from "@/server/funnel-metrics";
import { toast } from "@/components/ui/feedback";
import { Field, FormError, SubmitButton, TextArea, TextInput } from "@/components/ui/form";

/** Weekly snapshot entry (PRD3 §3.2): auto-pulled fields pre-filled, Admin can override. */
export function SnapshotForm({ entry }: { entry: FunnelOverview["entry"] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const e = entry.existing;
  const a = entry.autoPulls;

  const submit = async (form: FormData) => {
    setError(null);
    const res = await saveWeeklySnapshot(form);
    if (!res.ok) return setError(res.error);
    toast("Weekly snapshot saved");
    router.refresh();
  };

  const def = (existing: number | undefined, auto: number) =>
    e ? String(existing ?? 0) : auto > 0 ? String(auto) : "";

  return (
    <form action={submit} key={entry.weekStart} className="rounded-card border border-line bg-surface p-5 shadow-card">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-display text-lg font-semibold">
          Weekly snapshot {e ? "(editing saved week)" : ""}
        </h3>
        <label className="flex items-center gap-2 text-sm">
          Week (Monday)
          <input
            type="date"
            value={entry.weekStart}
            onChange={(ev) => router.push(`/funnel?week=${ev.target.value}`)}
            className="rounded-field border border-line bg-surface-2 px-2 py-1.5 text-sm"
          />
        </label>
      </div>
      <p className="mb-4 text-xs text-muted">
        Awareness reach and Ghosted Blueprint downloads are manual (Meta/IG/YT dashboards).
        Leads, calls, proposals and enrollments are pre-filled from Pipeline & Students -
        override them if needed.
      </p>
      <input type="hidden" name="weekStart" value={entry.weekStart} />
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <Field label="Awareness reach" hint="manual">
          <TextInput name="awarenessReach" inputMode="numeric" defaultValue={e ? String(e.awarenessReach) : ""} placeholder="0" />
        </Field>
        <Field label="Leads captured" hint={`auto: ${a.leadsCaptured}`}>
          <TextInput name="leadsCaptured" inputMode="numeric" defaultValue={def(e?.leadsCaptured, a.leadsCaptured)} placeholder="0" />
        </Field>
        <Field label="Calls completed" hint={`auto: ${a.callsCompleted}`}>
          <TextInput name="callsCompleted" inputMode="numeric" defaultValue={def(e?.callsCompleted, a.callsCompleted)} placeholder="0" />
        </Field>
        <Field label="Proposals sent" hint={`auto: ${a.proposalsSent}`}>
          <TextInput name="proposalsSent" inputMode="numeric" defaultValue={def(e?.proposalsSent, a.proposalsSent)} placeholder="0" />
        </Field>
        <Field label="Ghosted Blueprint downloads" hint="manual">
          <TextInput name="ghostedDownloads" inputMode="numeric" defaultValue={e ? String(e.ghostedDownloads) : ""} placeholder="0" />
        </Field>
        <Field label="Enrollments - Solo" hint={`auto: ${a.enrollmentsSolo}`}>
          <TextInput name="enrollmentsSolo" inputMode="numeric" defaultValue={def(e?.enrollmentsSolo, a.enrollmentsSolo)} placeholder="0" />
        </Field>
        <Field label="Enrollments - Guided" hint={`auto: ${a.enrollmentsGuided}`}>
          <TextInput name="enrollmentsGuided" inputMode="numeric" defaultValue={def(e?.enrollmentsGuided, a.enrollmentsGuided)} placeholder="0" />
        </Field>
        <Field label="Enrollments - Elite" hint={`auto: ${a.enrollmentsElite}`}>
          <TextInput name="enrollmentsElite" inputMode="numeric" defaultValue={def(e?.enrollmentsElite, a.enrollmentsElite)} placeholder="0" />
        </Field>
        <Field label="Workshop / webinar attendees">
          <TextInput name="workshopAttendees" inputMode="numeric" defaultValue={e ? String(e.workshopAttendees) : ""} placeholder="0" />
        </Field>
        <div className="col-span-2 sm:col-span-3 lg:col-span-5">
          <Field label="Notes" hint="What ran this week - ads, content, event? Any unusual spike or drop?">
            <TextArea name="notes" defaultValue={e?.notes ?? ""} />
          </Field>
        </div>
      </div>
      <div className="mt-4 flex items-center gap-3">
        <SubmitButton>{e ? "Update snapshot" : "Save snapshot"}</SubmitButton>
        <FormError message={error} />
      </div>
    </form>
  );
}

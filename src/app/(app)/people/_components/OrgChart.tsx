"use client";

import { useState } from "react";
import { moveProfile, saveTeamProfile } from "@/server/people-actions";
import type { MemberRow } from "@/server/people-metrics";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { toast } from "@/components/ui/feedback";
import { Card, Pill } from "@/components/ui/kit";
import { Btn, IconButton } from "@/components/ui/controls";
import { CheckboxField, Field, FormError, Select, SubmitButton, TextArea, TextInput } from "@/components/ui/form";
import { formatDate } from "@/lib/format";
import { LOG_VARIANT_LABELS, optionsFrom, TEAM_STATUS_LABELS } from "@/lib/labels";

const ROLE_OPTIONS = [
  { value: "ADMIN", label: "Admin" },
  { value: "HEAD", label: "Head" },
  { value: "USER", label: "User" },
];

/** Display-only org chart (PRD2 §3.1): Admin on top, team below; Admin reorders cards. */
export function OrgChart({ members }: { members: MemberRow[] }) {
  const [editing, setEditing] = useState<MemberRow | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const top = members.filter((m) => m.dashboardRole === "ADMIN");
  const team = members.filter((m) => m.dashboardRole !== "ADMIN");
  const showForm = adding || editing;

  const submit = async (form: FormData) => {
    setError(null);
    const res = await saveTeamProfile(editing?.id ?? null, form);
    if (!res.ok) return setError(res.error);
    toast(editing ? "Profile saved" : "Team member created");
    setEditing(null);
    setAdding(false);
  };

  const card = (m: MemberRow, canMove: boolean) => (
    <div key={m.id} className="w-64 rounded-card border border-line bg-surface p-4 shadow-card">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-display text-h2 font-semibold">{m.fullName}</p>
          <p className="text-sm text-muted">{m.roleTitle}</p>
        </div>
        {m.status !== "ACTIVE" && <Pill tone="warn">{TEAM_STATUS_LABELS[m.status]}</Pill>}
      </div>
      <p className="mt-2 truncate text-xs text-muted">{m.email}</p>
      {m.dateJoined && <p className="text-xs text-muted">Joined {formatDate(m.dateJoined)}</p>}
      {m.keyResponsibilities && (
        <p className="mt-2 line-clamp-3 text-xs text-muted">{m.keyResponsibilities}</p>
      )}
      <div className="mt-3 flex items-center gap-2 text-sm">
        <Btn variant="ghost" size="sm" onClick={() => { setEditing(m); setAdding(false); }}>
          Edit
        </Btn>
        {canMove && (
          <>
            <IconButton label="Move left" size="sm" onClick={() => moveProfile(m.id, "up")}>
              <ArrowLeft size={16} />
            </IconButton>
            <IconButton label="Move right" size="sm" onClick={() => moveProfile(m.id, "down")}>
              <ArrowRight size={16} />
            </IconButton>
          </>
        )}
      </div>
    </div>
  );

  return (
    <section className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="font-display text-h2 font-semibold">Org chart</h3>
        <Btn variant="soft" onClick={() => { setAdding(true); setEditing(null); }}>
          Add team member
        </Btn>
      </div>

      <div className="flex flex-col items-center gap-6">
        <div className="flex flex-wrap justify-center gap-4">{top.map((m) => card(m, false))}</div>
        {team.length > 0 && <div className="h-6 w-px bg-line" aria-hidden />}
        <div className="flex flex-wrap justify-center gap-4">{team.map((m) => card(m, true))}</div>
      </div>

      {showForm && (
        <Card
          title={editing ? `Edit profile - ${editing.fullName}` : "New team member"}
          actions={
            <Btn variant="ghost" size="sm" onClick={() => { setEditing(null); setAdding(false); }}>
              Close
            </Btn>
          }
        >
        <form action={submit} key={editing?.id ?? "new"}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Full name">
              <TextInput name="fullName" required defaultValue={editing?.fullName ?? ""} />
            </Field>
            <Field label="Role title" hint="e.g. Discovery Call Specialist">
              <TextInput name="roleTitle" required defaultValue={editing?.roleTitle ?? ""} />
            </Field>
            <Field label="Dashboard role" hint="Controls access">
              <Select name="dashboardRole" options={ROLE_OPTIONS} defaultValue={editing?.dashboardRole ?? "USER"} />
            </Field>
            <Field label="Email (login)">
              <TextInput type="email" name="email" required defaultValue={editing?.email ?? ""} />
            </Field>
            <Field label="Phone / WhatsApp">
              <TextInput name="phone" defaultValue={editing?.phone ?? ""} />
            </Field>
            <Field label="Date joined team">
              <TextInput type="date" name="dateJoined" defaultValue={editing?.dateJoined?.slice(0, 10) ?? ""} />
            </Field>
            <Field label="Status">
              <Select name="status" options={optionsFrom(TEAM_STATUS_LABELS)} defaultValue={editing?.status ?? "ACTIVE"} />
            </Field>
            <Field label="Daily log form" hint="Which daily numbers this person logs">
              <Select name="logVariant" options={optionsFrom(LOG_VARIANT_LABELS)} defaultValue={editing?.logVariant ?? "APPOINTMENT_SETTER"} />
            </Field>
            <Field label="First-call share %" hint="Target share of new leads (0 = not in rotation)">
              <TextInput name="firstCallSharePct" inputMode="numeric" defaultValue={String(editing?.firstCallSharePct ?? 0)} />
            </Field>
            <Field label="Daily call target" hint="Calls expected per day (0 = no target). Shows on their My Desk.">
              <TextInput name="dailyCallTarget" inputMode="numeric" defaultValue={String(editing?.dailyCallTarget ?? 0)} />
            </Field>
            <div className="flex items-end pb-1">
              <CheckboxField name="worksSaturdays" label="Works Saturdays" defaultChecked={editing?.worksSaturdays ?? true} />
            </div>
            <div className="sm:col-span-2 lg:col-span-3">
              <Field label="Key responsibilities" hint="Plain English - what this person owns every day">
                <TextArea name="keyResponsibilities" defaultValue={editing?.keyResponsibilities ?? ""} />
              </Field>
            </div>
          </div>
          <div className="mt-4 flex items-center gap-3">
            <SubmitButton>{editing ? "Save profile" : "Create profile"}</SubmitButton>
            <FormError message={error} />
          </div>
        </form>
        </Card>
      )}
    </section>
  );
}

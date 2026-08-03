"use client";

import { useState } from "react";
import { moveProfile, saveTeamProfile } from "@/server/people-actions";
import { loadTerminationReport, reinstateTeamMember } from "@/server/users-actions";
import type { TerminationReport } from "@/server/termination-report";
import type { MemberRow } from "@/server/people-metrics";
import { TerminateDialog } from "./TerminateDialog";
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
  const [offboarding, setOffboarding] = useState<TerminationReport | null>(null);
  const [loadingReport, setLoadingReport] = useState<string | null>(null);

  // Former members leave the chart entirely and get their own list below. Keeping them in the
  // org chart would misrepresent the team to everyone who opens this page.
  const current = members.filter((m) => !m.terminatedAt);
  const former = members.filter((m) => m.terminatedAt);
  const top = current.filter((m) => m.dashboardRole === "ADMIN");
  const team = current.filter((m) => m.dashboardRole !== "ADMIN");
  const showForm = adding || editing;

  // Anyone still here can take over — offering a departed or suspended colleague would just move
  // the orphaned-work problem along.
  const successors = current.map((m) => ({ value: m.id, label: `${m.fullName} · ${m.roleTitle}` }));

  async function openOffboarding(m: MemberRow) {
    setLoadingReport(m.id);
    const res = await loadTerminationReport(m.id);
    setLoadingReport(null);
    if (!res.ok) return toast(res.error, "error");
    setOffboarding(res.report);
  }

  async function bringBack(m: MemberRow) {
    const res = await reinstateTeamMember(m.id);
    if (!res.ok) return toast(res.error, "error");
    toast(`${m.fullName} is back on the team`);
  }

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
        {/* Last in the row and quiet: offboarding is rare and irreversible-feeling, so it should
            never sit where "Edit" is expected. */}
        <Btn
          variant="ghost"
          size="sm"
          onClick={() => openOffboarding(m)}
          disabled={loadingReport === m.id}
        >
          {loadingReport === m.id ? "Opening…" : "Offboard"}
        </Btn>
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

      {/* ── Former team members ──────────────────────────────────────────────────────
          Not the app's `deletedAt` archive: that one is purged after 90 days, and an employment
          record must outlive that — their name has to keep resolving on every call, commission
          and audit row they ever produced. Permanent, and restorable. */}
      {former.length > 0 && (
        <details className="rounded-card border border-line bg-surface p-4">
          <summary className="cursor-pointer text-sm font-semibold text-ink">
            Former team members ({former.length})
          </summary>
          <ul className="mt-3 divide-y divide-line">
            {former.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-ink">
                    {m.fullName} <span className="font-normal text-muted">· {m.roleTitle}</span>
                  </p>
                  <p className="text-xs text-muted">
                    Left {m.terminatedAt ? formatDate(m.terminatedAt) : "—"}
                    {m.terminationReason ? ` · ${m.terminationReason}` : ""}
                  </p>
                </div>
                <a
                  href={`/api/people/${m.id}/termination-report`}
                  className="text-xs font-medium text-primary hover:underline"
                >
                  Record (PDF)
                </a>
                <Btn variant="ghost" size="sm" onClick={() => bringBack(m)}>
                  Bring back
                </Btn>
              </li>
            ))}
          </ul>
        </details>
      )}

      {offboarding && (
        <TerminateDialog
          report={offboarding}
          successors={successors.filter((s) => s.value !== offboarding.profile.id)}
          onClose={() => setOffboarding(null)}
        />
      )}

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
              <TextInput kind="name" name="fullName" required defaultValue={editing?.fullName ?? ""} />
            </Field>
            <Field label="Role title" hint="e.g. Discovery Call Specialist">
              <TextInput name="roleTitle" required defaultValue={editing?.roleTitle ?? ""} />
            </Field>
            <Field label="Dashboard role" hint="Controls access">
              <Select name="dashboardRole" options={ROLE_OPTIONS} defaultValue={editing?.dashboardRole ?? "USER"} />
            </Field>
            <Field label="Email (login)">
              <TextInput kind="email" name="email" required defaultValue={editing?.email ?? ""} />
            </Field>
            <Field label="Phone / WhatsApp">
              <TextInput kind="phone" name="phone" defaultValue={editing?.phone ?? ""} />
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
              <TextInput kind="int" name="firstCallSharePct" min={0} max={100} defaultValue={String(editing?.firstCallSharePct ?? 0)} />
            </Field>
            <Field label="Daily call target" hint="Calls expected per day (0 = no target). Shows on their My Desk.">
              <TextInput kind="int" name="dailyCallTarget" min={0} max={999} defaultValue={String(editing?.dailyCallTarget ?? 0)} />
            </Field>
            <div className="flex items-end pb-1">
              <CheckboxField name="worksSaturdays" label="Works Saturdays" defaultChecked={editing?.worksSaturdays ?? true} />
            </div>
            <div className="sm:col-span-2 lg:col-span-3">
              <Field label="Key responsibilities" hint="Plain English - what this person owns every day">
                <TextArea kind="text" name="keyResponsibilities" defaultValue={editing?.keyResponsibilities ?? ""} />
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

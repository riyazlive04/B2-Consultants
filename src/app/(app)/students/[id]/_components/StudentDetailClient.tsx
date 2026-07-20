"use client";

import { useState } from "react";
import {
  addEnrollment, addSatisfactionScore, createStudentLogin, linkIncomeToStudent,
  revokeStudentLogin, setEnrollmentCloser, setEnrollmentStatus, updateStudent, updateTracker,
} from "@/server/students-actions";
import { createJobApplication, deleteJobApplication, updateJobApplicationStatus } from "@/server/job-applications-actions";
import type { StudentDetail } from "@/server/students-metrics";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { BadgeChip, JourneyRing, MomentumChip } from "@/components/ui/gamification";
import { askConfirm, celebrate, toast } from "@/components/ui/feedback";
import { Card, Pill } from "@/components/ui/kit";
import { Btn } from "@/components/ui/controls";
import { CheckboxField, Field, FormError, Select, SubmitButton, TextArea, TextInput } from "@/components/ui/form";
import { SignalBadge } from "@/components/ui/SignalBadge";
import { SprintTracker } from "./SprintTracker";
import { signalForStudent } from "@/lib/signals";
import { formatDate, formatInrMinor, formatPct } from "@/lib/format";
import {
  LEAD_SOURCE_LABELS, MILESTONE_LABELS, optionsFrom, OUTCOME_ACHIEVED_LABELS,
  PROGRAM_LEVEL_LABELS, SIGNAL_LABELS, STUDENT_STATUS_LABELS, TASK_COMPLETION_LABELS,
} from "@/lib/labels";

type Enrollment = StudentDetail["enrollments"][number];
type MilestoneLogRow = Enrollment["milestoneLogs"][number];

const B2_LEVEL_OPTIONS = [
  { value: "SOLO", label: "Solo" },
  { value: "GUIDED", label: "Guided (90d)" },
  { value: "ELITE", label: "Elite (120d)" },
];

// PRD2 §4.1: assigned coach is a dropdown (currently Karthick).
const COACH_OPTIONS = [
  { value: "Karthick", label: "Karthick" },
  { value: "Ameen", label: "Ameen" },
];

const MILESTONE_ORDER = [
  "ONBOARDING", "RESUME_BUILD", "LINKEDIN_OPTIMISATION", "APPLICATIONS",
  "INTERVIEWS", "OFFER_RECEIVED", "COMPLETED",
] as const;

/** Gamified journey: the 7 milestones as a stepper - done, current, ahead. */
function MilestoneJourney({ current }: { current: string }) {
  const idx = MILESTONE_ORDER.indexOf(current as (typeof MILESTONE_ORDER)[number]);
  return (
    <ol className="mt-4 flex flex-wrap items-center gap-y-3">
      {MILESTONE_ORDER.map((m, i) => {
        const done = i < idx;
        const active = i === idx;
        const trophy = m === "OFFER_RECEIVED" || m === "COMPLETED";
        return (
          <li key={m} className="flex items-center">
            <span
              title={MILESTONE_LABELS[m]}
              className={`flex h-7 w-7 items-center justify-center rounded-full border text-caption font-bold ${
                active
                  ? "border-transparent text-on-accent"
                  : done
                    ? "border-transparent text-on-accent"
                    : "border-line bg-surface text-muted"
              }`}
              style={{
                background: active ? "var(--primary)" : done ? "var(--ok)" : undefined,
                boxShadow: active ? "var(--e-2)" : undefined,
              }}
            >
              {done ? "✓" : trophy ? "★" : i + 1}
            </span>
            <span className={`mx-1.5 hidden text-xs sm:inline ${active ? "font-semibold" : "text-muted"}`}>
              {MILESTONE_LABELS[m]}
            </span>
            {i < MILESTONE_ORDER.length - 1 && (
              <span
                aria-hidden
                className="mx-1 h-px w-4 sm:w-6"
                style={{ background: i < idx ? "var(--ok)" : "var(--line)" }}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}

const JOB_APP_STATUS_OPTIONS = [
  { value: "APPLIED", label: "Applied" },
  { value: "INTERVIEW", label: "Interview" },
  { value: "SELECTED", label: "Selected" },
  { value: "REJECTED", label: "Rejected" },
];
const JOB_APP_STATUS_LABEL: Record<string, string> = Object.fromEntries(
  JOB_APP_STATUS_OPTIONS.map((o) => [o.value, o.label]),
);
function jobAppTone(status: string): "good" | "bad" | "warn" | "neutral" {
  return status === "SELECTED" ? "good" : status === "REJECTED" ? "bad" : status === "INTERVIEW" ? "warn" : "neutral";
}

/** Per-application placement tracking (spec Module I): applied → interview → selected/rejected. */
function JobApplications({
  enrollmentId,
  applications,
  canEdit,
  todayKey,
  onError,
}: {
  enrollmentId: string;
  applications: Enrollment["jobApplications"];
  canEdit: boolean;
  todayKey: string;
  onError: (msg: string | null) => void;
}) {
  const [adding, setAdding] = useState(false);
  return (
    <div className="mt-5 border-t border-line pt-4">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold">Job applications</h4>
        {canEdit && (
          <button type="button" className="text-sm text-accent hover:underline" onClick={() => setAdding((v) => !v)}>
            {adding ? "Close" : "+ Add application"}
          </button>
        )}
      </div>

      {applications.length === 0 ? (
        <p className="mt-2 text-sm text-muted">No applications logged yet.</p>
      ) : (
        <div className="mt-3 space-y-2">
          {applications.map((a) => (
            <div
              key={a.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-card border border-line bg-surface-2 px-3 py-2 text-sm"
            >
              <span className="font-medium">
                {a.jobUrl ? (
                  <a href={a.jobUrl} target="_blank" rel="noreferrer" className="text-accent hover:underline">
                    {a.role}
                  </a>
                ) : (
                  a.role
                )}
                <span className="text-muted"> · {a.company}</span>
                {a.location && <span className="text-muted"> · {a.location}</span>}
              </span>
              <span className="text-xs text-muted">applied {formatDate(a.appliedAt)}</span>
              <div className="ml-auto flex items-center gap-2">
                {canEdit ? (
                  <Select
                    value={a.status}
                    aria-label="Application status"
                    options={JOB_APP_STATUS_OPTIONS}
                    onChange={async (ev) => {
                      onError(null);
                      const res = await updateJobApplicationStatus(a.id, ev.target.value);
                      if (!res.ok) onError(res.error);
                      else toast("Application updated");
                    }}
                  />
                ) : (
                  <Pill tone={jobAppTone(a.status)}>{JOB_APP_STATUS_LABEL[a.status]}</Pill>
                )}
                {canEdit && (
                  <button
                    type="button"
                    aria-label="Delete application"
                    className="px-1 text-muted hover:text-risk"
                    onClick={async () => {
                      const ok = await askConfirm({
                        title: "Delete this application?",
                        body: `${a.role} · ${a.company}`,
                        confirmLabel: "Delete",
                        danger: true,
                      });
                      if (!ok) return;
                      onError(null);
                      const res = await deleteJobApplication(a.id);
                      if (!res.ok) onError(res.error);
                    }}
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {canEdit && adding && (
        <form
          action={async (form) => {
            onError(null);
            const res = await createJobApplication(enrollmentId, form);
            if (!res.ok) return onError(res.error);
            setAdding(false);
            toast("Application added");
          }}
          className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
        >
          <Field label="Company"><TextInput name="company" required /></Field>
          <Field label="Role"><TextInput name="role" required /></Field>
          <Field label="Location"><TextInput name="location" /></Field>
          <Field label="Applied date"><TextInput type="date" name="appliedAt" required defaultValue={todayKey} /></Field>
          <div className="lg:col-span-2">
            <Field label="Job URL (optional)"><TextInput type="url" name="jobUrl" placeholder="https://…" /></Field>
          </div>
          <Field label="Status"><Select name="status" options={JOB_APP_STATUS_OPTIONS} defaultValue="APPLIED" /></Field>
          <div className="flex items-end"><SubmitButton>Add application</SubmitButton></div>
        </form>
      )}
    </div>
  );
}

export function StudentDetailClient({
  student,
  isAdmin,
  canEditTracker,
  todayKey,
}: {
  student: StudentDetail;
  isAdmin: boolean;
  canEditTracker: boolean; // Admin or Head
  todayKey: string; // IST today, YYYY-MM-DD - highlights the current sprint week
}) {
  const [error, setError] = useState<string | null>(null);
  const [editingProfile, setEditingProfile] = useState(false);
  const [addingEnrollment, setAddingEnrollment] = useState(false);

  const milestoneColumns: Column<MilestoneLogRow>[] = [
    { key: "date", header: "Date", cell: (r) => formatDate(r.date), value: (r) => r.date },
    { key: "by", header: "Updated by", cell: (r) => r.updatedBy, value: (r) => r.updatedBy },
    {
      key: "from", header: "Previous",
      cell: (r) => (r.previousMilestone ? MILESTONE_LABELS[r.previousMilestone] : "-"),
      value: (r) => r.previousMilestone ?? "",
    },
    { key: "to", header: "New milestone", cell: (r) => MILESTONE_LABELS[r.newMilestone], value: (r) => r.newMilestone },
    { key: "note", header: "Note", cell: (r) => r.note ?? "", value: (r) => r.note ?? "" },
  ];

  return (
    <div className="space-y-8">
      <FormError message={error} />

      {/* Profile */}
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-2xl font-semibold">{student.fullName}</h2>
            <p className="mt-1 text-sm text-muted">
              {[student.email, student.phone, student.industry].filter(Boolean).join(" · ") || "No contact details"}
            </p>
            {student.targetRole && <p className="text-sm text-muted">Target: {student.targetRole}</p>}
            {student.leadSource && (
              <p className="mt-1 text-xs text-muted">Lead source: {LEAD_SOURCE_LABELS[student.leadSource]}</p>
            )}
          </div>
          <div className="text-right">
            <p className="text-sm font-medium text-muted">Lifetime value</p>
            <p className="font-display text-3xl font-semibold">{formatInrMinor(student.ltvInr, { compact: true })}</p>
            <p className="text-xs text-muted">{student.incomes.length} linked payment(s)</p>
          </div>
        </div>
        {student.internalNotes && <p className="mt-3 border-t border-line pt-3 text-sm">{student.internalNotes}</p>}
        {isAdmin && (
          <button type="button" className="mt-3 text-sm text-accent hover:underline" onClick={() => setEditingProfile((v) => !v)}>
            {editingProfile ? "Close" : "Edit profile"}
          </button>
        )}
        {editingProfile && (
          <form
            action={async (form) => {
              setError(null);
              const res = await updateStudent(student.id, form);
              if (!res.ok) return setError(res.error);
              setEditingProfile(false);
            }}
            className="mt-4 grid grid-cols-1 gap-4 border-t border-line pt-4 sm:grid-cols-2 lg:grid-cols-3"
          >
            <Field label="Full name"><TextInput kind="name" name="fullName" required defaultValue={student.fullName} /></Field>
            <Field label="Email"><TextInput kind="email" name="email" defaultValue={student.email ?? ""} /></Field>
            <Field label="Phone"><TextInput kind="phone" name="phone" defaultValue={student.phone ?? ""} /></Field>
            <Field label="Industry"><TextInput name="industry" defaultValue={student.industry ?? ""} /></Field>
            <Field label="Target role"><TextInput name="targetRole" defaultValue={student.targetRole ?? ""} /></Field>
            <Field label="Lead source">
              <Select name="leadSource" options={[{ value: "", label: "-" }, ...optionsFrom(LEAD_SOURCE_LABELS)]} defaultValue={student.leadSource ?? ""} />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Internal notes"><TextArea kind="text" name="internalNotes" defaultValue={student.internalNotes ?? ""} /></Field>
            </div>
            <div className="flex items-end"><SubmitButton>Save profile</SubmitButton></div>
          </form>
        )}
      </Card>

      {/* Enrollments + tracker */}
      {student.enrollments.map((e) => (
        <Card
          key={e.id}
          title={
            <span className="font-display text-h3 text-ink">
              {PROGRAM_LEVEL_LABELS[e.programLevel]} - enrolled {formatDate(e.enrollmentDate)}
              {e.totalDays && e.status === "ACTIVE" && (
                <span className="ml-2 text-sm font-normal text-muted">
                  Day {e.dayNumber} of {e.totalDays} · {formatPct(((e.dayNumber ?? 0) / e.totalDays) * 100)}
                </span>
              )}
              {/* PRD2 §4.1: program end date (Solo has none — lifetime). */}
              <span className="ml-2 text-sm font-normal text-muted">
                · {e.programEndDate ? `ends ${formatDate(e.programEndDate)}` : "lifetime"}
              </span>
            </span>
          }
          actions={
            <>
              {e.signalColour && <SignalBadge level={signalForStudent(e.signalColour)} size="sm" />}
              {isAdmin ? (
                <Select
                  name="status"
                  value={e.status}
                  onChange={async (ev) => {
                    const next = ev.target.value;
                    const ok = await askConfirm({
                      title: "Change enrollment status?",
                      body: `Set this enrollment to “${STUDENT_STATUS_LABELS[next] ?? next}”.`,
                      confirmLabel: "Change status",
                    });
                    if (!ok) return; // controlled value snaps back automatically
                    setError(null);
                    const fd = new FormData();
                    fd.set("status", next);
                    const res = await setEnrollmentStatus(e.id, fd);
                    if (!res.ok) {
                      setError(res.error);
                    } else {
                      toast("Enrollment status updated");
                    }
                  }}
                  aria-label="Enrollment status"
                  options={optionsFrom(STUDENT_STATUS_LABELS)}
                />
              ) : (
                <span className="text-sm text-muted">{STUDENT_STATUS_LABELS[e.status]}</span>
              )}
            </>
          }
        >
          {/* Deal team + coach — the closer (L3) drives the commission split */}
          <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
            <span className="text-muted">
              Coach: <span className="text-ink">{e.assignedCoach ?? "—"}</span>
            </span>
            <span className="flex items-center gap-2">
              <span className="text-muted">Closer (L3):</span>
              {isAdmin ? (
                <Select
                  value={e.closerId ?? ""}
                  aria-label="Deal closer"
                  onChange={async (ev) => {
                    setError(null);
                    const res = await setEnrollmentCloser(e.id, ev.target.value);
                    if (!res.ok) setError(res.error);
                    else toast("Closer updated — commission split recalculated");
                  }}
                  options={[{ value: "", label: "— none —" }, ...student.teamMembers.map((m) => ({ value: m.id, label: m.name }))]}
                />
              ) : (
                <span className="text-ink">{e.closerName ?? "—"}</span>
              )}
            </span>
          </div>

          {/* Gamified journey card — stage title, XP, momentum, achievement badges.
              Show it in sessions: the ring and badges are the student's scoreboard. */}
          <div className="flex flex-wrap items-center gap-4 rounded-card border border-line bg-surface-2 p-4">
            <JourneyRing pct={e.journey.journeyPct} stageIndex={e.journey.stageIndex} size={64} />
            <div className="min-w-44">
              <p className="font-display text-h2 font-semibold">{e.journey.stageTitle}</p>
              <p className="tnum text-xs text-muted">
                {e.journey.xp.toLocaleString("en-IN")} journey XP · stage {e.journey.stageIndex + 1} of 7 ·{" "}
                {e.journey.unlockedCount}/{e.journey.badges.length} badges
              </p>
              {e.journey.momentum && (
                <div className="mt-1.5">
                  <MomentumChip momentum={e.journey.momentum} size="sm" />
                </div>
              )}
            </div>
            <div className="ml-auto flex flex-wrap justify-end gap-x-1.5 gap-y-2">
              {[...e.journey.badges]
                .sort((a, b) => Number(!!b.unlockedAt) - Number(!!a.unlockedAt))
                .map((b) => (
                  <BadgeChip key={b.key} badge={b} size="sm" />
                ))}
            </div>
          </div>

          {e.totalDays !== null && <MilestoneJourney current={e.currentMilestone} />}

          {e.totalDays === null ? (
            <p className="mt-3 text-sm text-muted">Solo is self-paced - no 90/120-day tracker.</p>
          ) : (
            <form
              action={async (form) => {
                setError(null);
                const res = await updateTracker(e.id, form);
                if (!res.ok) return setError(res.error);
                const nextMilestone = String(form.get("currentMilestone") ?? "");
                if (
                  nextMilestone !== e.currentMilestone &&
                  (nextMilestone === "OFFER_RECEIVED" || nextMilestone === "COMPLETED")
                ) {
                  celebrate(); // offer or graduation — that's the whole point of the program
                  toast(nextMilestone === "OFFER_RECEIVED" ? "Offer received! 🏆 Badge unlocked" : "Journey complete! 🎓");
                } else {
                  toast("Tracker saved - milestone & signal changes logged");
                }
              }}
              className="mt-4 border-t border-line pt-4"
            >
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Field label="Last session date">
                  <TextInput type="date" name="lastSessionDate" defaultValue={e.lastSessionDate?.slice(0, 10) ?? ""} disabled={!canEditTracker} />
                </Field>
                <Field label="Sessions completed / planned">
                  <div className="flex gap-2">
                    <TextInput kind="int" name="totalSessionsCompleted" defaultValue={String(e.totalSessionsCompleted)} disabled={!canEditTracker} />
                    <TextInput kind="int" name="totalSessionsPlanned" defaultValue={e.totalSessionsPlanned?.toString() ?? ""} disabled={!canEditTracker} />
                  </div>
                </Field>
                <Field label="Last task assigned">
                  <TextInput name="lastTaskAssigned" defaultValue={e.lastTaskAssigned ?? ""} disabled={!canEditTracker} />
                </Field>
                <Field label="Last task completed?">
                  <Select name="lastTaskCompleted" options={[{ value: "", label: "-" }, ...optionsFrom(TASK_COMPLETION_LABELS)]} defaultValue={e.lastTaskCompleted ?? ""} disabled={!canEditTracker} />
                </Field>
                <Field label="Applications submitted">
                  <TextInput kind="int" name="applicationsSubmitted" defaultValue={String(e.applicationsSubmitted)} disabled={!canEditTracker} />
                </Field>
                <Field label="Interviews received">
                  <TextInput kind="int" name="interviewsReceived" defaultValue={String(e.interviewsReceived)} disabled={!canEditTracker} />
                </Field>
                <Field label="Current milestone" hint="Changing it logs the change permanently">
                  <Select name="currentMilestone" options={optionsFrom(MILESTONE_LABELS)} defaultValue={e.currentMilestone} disabled={!canEditTracker} />
                </Field>
                <Field label="Milestone change note (optional)">
                  <TextInput kind="text" name="milestoneNote" placeholder="What happened in the session" disabled={!canEditTracker} />
                </Field>
                <Field label="Signal colour" hint="Manual - every change is logged">
                  <Select name="signalColour" options={[{ value: "", label: "Not set" }, ...optionsFrom(SIGNAL_LABELS)]} defaultValue={e.signalColour ?? ""} disabled={!canEditTracker} />
                </Field>
                <Field label="Next check-in date">
                  <TextInput type="date" name="nextCheckInDate" defaultValue={e.nextCheckInDate?.slice(0, 10) ?? ""} disabled={!canEditTracker} />
                </Field>
                <div className="sm:col-span-2">
                  <Field label="Signal notes" hint="Why Green/Amber/Red? What action is being taken?">
                    <TextArea kind="text" name="signalNotes" defaultValue={e.signalNotes ?? ""} disabled={!canEditTracker} />
                  </Field>
                </div>
              </div>
              {canEditTracker && (
                <div className="mt-4">
                  <SubmitButton>Save tracker</SubmitButton>
                </div>
              )}
            </form>
          )}

          {/* Sprint tracker (client notes): week-wise targets, Guided/Elite only */}
          {e.totalDays !== null && (
            <SprintTracker enrollment={e} todayKey={todayKey} canEdit={canEditTracker} />
          )}

          {/* Per-application job tracking (spec Module I) */}
          <JobApplications
            enrollmentId={e.id}
            applications={e.jobApplications}
            canEdit={canEditTracker}
            todayKey={todayKey}
            onError={setError}
          />

          {/* Milestone progress log - append-only, CSV exportable (PRD2 §4.4) */}
          {e.milestoneLogs.length > 0 && (
            <div className="mt-5">
              <h4 className="mb-2 text-sm font-semibold">Milestone progress log</h4>
              <DataTable rows={e.milestoneLogs} columns={milestoneColumns} csvName={isAdmin ? `milestone-log-${student.fullName.replace(/\s+/g, "-").toLowerCase()}` : undefined} />
            </div>
          )}

          {/* Signal change audit (PRD2 §6) */}
          {e.signalChanges.length > 0 && (
            <div className="mt-4 text-xs text-muted">
              <h4 className="mb-1 text-sm font-semibold text-ink">Signal history</h4>
              {e.signalChanges.map((c) => (
                <p key={c.id}>
                  {formatDate(c.date)} - {c.previousSignal ? SIGNAL_LABELS[c.previousSignal] : "unset"} → {c.newSignal ? SIGNAL_LABELS[c.newSignal] : "cleared"} by {c.changedBy}
                  {c.note ? ` · ${c.note}` : ""}
                </p>
              ))}
            </div>
          )}
        </Card>
      ))}

      {/* Student portal access (Admin): a Role.STUDENT login that sees only /my-journey */}
      {isAdmin && (
        <Card title="Student portal access">
          <p className="text-xs text-muted">
            A portal login shows this student their own journey, XP, badges and next steps —
            plus the CV Diagnostic. It never sees money, signals or internal notes.
          </p>
          {student.portalEmail ? (
            <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
              <Pill tone="good">Portal active</Pill>
              <span className="text-muted">Login: {student.portalEmail}</span>
              <span className="text-xs text-muted">(reset the password from People → Users &amp; access)</span>
              <Btn
                variant="danger"
                size="sm"
                className="ml-auto"
                onClick={async () => {
                  const ok = await askConfirm({
                    title: `Revoke portal access for ${student.portalEmail}?`,
                    body: "The login is deleted and all their sessions end. The student record is untouched.",
                    confirmLabel: "Revoke",
                    danger: true,
                  });
                  if (!ok) return;
                  setError(null);
                  const res = await revokeStudentLogin(student.id);
                  if (!res.ok) return setError(res.error);
                  toast("Portal access revoked");
                }}
              >
                Revoke access
              </Btn>
            </div>
          ) : (
            <form
              action={async (form) => {
                setError(null);
                const res = await createStudentLogin(student.id, form);
                if (!res.ok) return setError(res.error);
                toast("Portal login created - share the password securely");
              }}
              className="mt-3 flex flex-wrap items-end gap-3"
            >
              <div className="min-w-64 flex-1">
                <Field label="Login email" hint="Defaults to the student's email">
                  <TextInput kind="email" name="email" required defaultValue={student.email ?? ""} />
                </Field>
              </div>
              <div className="w-56">
                <Field label="Temporary password" hint="Min 8 characters">
                  <TextInput name="password" required minLength={8} defaultValue="" placeholder="e.g. journey-2026" />
                </Field>
              </div>
              <SubmitButton>Create portal login</SubmitButton>
            </form>
          )}
        </Card>
      )}

      {/* Upgrade: add enrollment (Admin) */}
      {isAdmin && (
        <Card>
          <button type="button" className="text-sm text-accent hover:underline" onClick={() => setAddingEnrollment((v) => !v)}>
            {addingEnrollment ? "Close" : "+ Add enrollment (upgrade)"}
          </button>
          {addingEnrollment && (
            <form
              action={async (form) => {
                setError(null);
                const res = await addEnrollment(student.id, form);
                if (!res.ok) return setError(res.error);
                setAddingEnrollment(false);
              }}
              className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
            >
              <Field label="Program level"><Select name="programLevel" options={B2_LEVEL_OPTIONS} defaultValue="GUIDED" /></Field>
              <Field label="Enrollment date"><TextInput type="date" name="enrollmentDate" required defaultValue={todayKey} /></Field>
              <Field label="Sessions planned"><TextInput kind="int" name="totalSessionsPlanned" /></Field>
              <Field label="Assigned coach"><Select name="assignedCoach" options={COACH_OPTIONS} defaultValue="Karthick" /></Field>
              <Field label="Closer (L3)" hint="For the commission split">
                <Select
                  name="closerId"
                  options={[{ value: "", label: "— none —" }, ...student.teamMembers.map((m) => ({ value: m.id, label: m.name }))]}
                  defaultValue=""
                />
              </Field>
              <div className="flex items-end"><SubmitButton>Add enrollment</SubmitButton></div>
            </form>
          )}
        </Card>
      )}

      {/* Satisfaction / NPS (Admin, PRD2 §4.5) */}
      <Card title="Satisfaction & NPS">
        {student.satisfaction.length > 0 && (
          <div className="mt-3 space-y-1 text-sm">
            {student.satisfaction.map((s) => (
              <p key={s.id}>
                {formatDate(s.date)} - satisfaction <strong>{s.satisfactionScore}/10</strong>, NPS{" "}
                <strong>{s.npsScore}/10</strong> · {OUTCOME_ACHIEVED_LABELS[s.outcomeAchieved]}
                {s.testimonialReceived ? " · testimonial ✓" : ""}
                {s.notes ? ` · ${s.notes}` : ""}
              </p>
            ))}
          </div>
        )}
        {isAdmin && (
          <form
            action={async (form) => {
              setError(null);
              const res = await addSatisfactionScore(student.id, form);
              if (!res.ok) setError(res.error);
            }}
            className="mt-4 grid grid-cols-1 gap-4 border-t border-line pt-4 sm:grid-cols-2 lg:grid-cols-4"
          >
            <Field label="Date of score"><TextInput type="date" name="date" required defaultValue={todayKey} /></Field>
            <Field label="Satisfaction (1-10)"><TextInput kind="int" name="satisfactionScore" min={1} max={10} required /></Field>
            <Field label="NPS (0-10)"><TextInput kind="int" name="npsScore" min={0} max={10} required /></Field>
            <Field label="Outcome achieved">
              <Select name="outcomeAchieved" options={optionsFrom(OUTCOME_ACHIEVED_LABELS)} defaultValue="NO_OUTCOME_YET" />
            </Field>
            <div className="flex items-end pb-1">
              <CheckboxField name="testimonialReceived" label="Testimonial received" />
            </div>
            <div className="sm:col-span-2">
              <Field label="Notes" hint="What did the student say?"><TextArea kind="text" name="notes" /></Field>
            </div>
            <div className="flex items-end"><SubmitButton>Record score</SubmitButton></div>
          </form>
        )}
      </Card>

      {/* Linked payments (fee ↔ Finance, CONTEXT §7) */}
      <Card title="Payments (from Finance)">
        {student.incomes.length ? (
          <div className="mt-3 space-y-1 text-sm">
            {student.incomes.map((i) => (
              <p key={i.id} className="tnum">
                {formatDate(i.date)} - {formatInrMinor(i.aggInr, { compact: true })} · {PROGRAM_LEVEL_LABELS[i.programLevel]}
              </p>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-sm text-muted">No income entries linked yet.</p>
        )}
        {isAdmin && student.unlinkedIncomes.length > 0 && (
          <form
            action={async (form) => {
              setError(null);
              const incomeId = String(form.get("incomeId") ?? "");
              if (!incomeId) return;
              const fd = new FormData();
              fd.set("studentId", student.id);
              const res = await linkIncomeToStudent(incomeId, fd);
              if (!res.ok) setError(res.error);
            }}
            className="mt-4 flex flex-wrap items-end gap-3 border-t border-line pt-4"
          >
            <div className="min-w-72 flex-1">
              <Field label="Link an unlinked income entry" hint="LTV updates immediately">
                <Select name="incomeId" options={[{ value: "", label: "Pick an income entry…" }, ...student.unlinkedIncomes]} defaultValue="" />
              </Field>
            </div>
            <SubmitButton>Link payment</SubmitButton>
          </form>
        )}
      </Card>
    </div>
  );
}

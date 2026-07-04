"use client";

import { useState } from "react";
import {
  addEnrollment, addSatisfactionScore, createStudentLogin, linkIncomeToStudent,
  revokeStudentLogin, setEnrollmentStatus, updateStudent, updateTracker,
} from "@/server/students-actions";
import type { StudentDetail } from "@/server/students-metrics";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { BadgeChip, JourneyRing, MomentumChip } from "@/components/ui/gamification";
import { askConfirm, celebrate, toast } from "@/components/ui/feedback";
import { CheckboxField, Field, FormError, Select, SubmitButton, TextArea, TextInput } from "@/components/ui/form";
import { SignalBadge } from "@/components/ui/SignalBadge";
import { SprintTracker } from "./SprintTracker";
import { signalForStudent } from "@/lib/signals";
import { formatDate, formatInrMinor } from "@/lib/format";
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
              className={`flex h-7 w-7 items-center justify-center rounded-full border text-[11px] font-bold ${
                active
                  ? "border-transparent text-white"
                  : done
                    ? "border-transparent text-white"
                    : "border-line bg-surface text-muted"
              }`}
              style={{
                background: active
                  ? trophy ? "var(--brass)" : "var(--accent)"
                  : done ? "var(--ok)" : undefined,
                boxShadow: active ? "0 3px 8px rgba(26,25,19,0.25)" : undefined,
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
      <section className="rounded-card border border-line bg-surface p-5 shadow-card">
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
            <Field label="Full name"><TextInput name="fullName" required defaultValue={student.fullName} /></Field>
            <Field label="Email"><TextInput type="email" name="email" defaultValue={student.email ?? ""} /></Field>
            <Field label="Phone"><TextInput name="phone" defaultValue={student.phone ?? ""} /></Field>
            <Field label="Industry"><TextInput name="industry" defaultValue={student.industry ?? ""} /></Field>
            <Field label="Target role"><TextInput name="targetRole" defaultValue={student.targetRole ?? ""} /></Field>
            <Field label="Lead source">
              <Select name="leadSource" options={[{ value: "", label: "-" }, ...optionsFrom(LEAD_SOURCE_LABELS)]} defaultValue={student.leadSource ?? ""} />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Internal notes"><TextArea name="internalNotes" defaultValue={student.internalNotes ?? ""} /></Field>
            </div>
            <div className="flex items-end"><SubmitButton>Save profile</SubmitButton></div>
          </form>
        )}
      </section>

      {/* Enrollments + tracker */}
      {student.enrollments.map((e) => (
        <section key={e.id} className="rounded-card border border-line bg-surface p-5 shadow-card">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-display text-lg font-semibold">
              {PROGRAM_LEVEL_LABELS[e.programLevel]} - enrolled {formatDate(e.enrollmentDate)}
              {e.totalDays && e.status === "ACTIVE" && (
                <span className="ml-2 text-sm font-normal text-muted">
                  Day {e.dayNumber} of {e.totalDays} · {Math.round(((e.dayNumber ?? 0) / e.totalDays) * 100)}%
                </span>
              )}
            </h3>
            <div className="flex items-center gap-2">
              {e.signalColour && <SignalBadge level={signalForStudent(e.signalColour)} size="sm" />}
              {isAdmin ? (
                <select
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
                  className="rounded-field border border-line bg-surface-2 px-2 py-1.5 text-sm"
                  aria-label="Enrollment status"
                >
                  {optionsFrom(STUDENT_STATUS_LABELS).map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              ) : (
                <span className="text-sm text-muted">{STUDENT_STATUS_LABELS[e.status]}</span>
              )}
            </div>
          </div>

          {/* Gamified journey card — stage title, XP, momentum, achievement badges.
              Show it in sessions: the ring and badges are the student's scoreboard. */}
          <div className="mt-4 flex flex-wrap items-center gap-4 rounded-card border border-line bg-surface-2 p-4">
            <JourneyRing pct={e.journey.journeyPct} stageIndex={e.journey.stageIndex} size={64} />
            <div className="min-w-44">
              <p className="font-display text-lg font-semibold">{e.journey.stageTitle}</p>
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
                    <TextInput name="totalSessionsCompleted" inputMode="numeric" defaultValue={String(e.totalSessionsCompleted)} disabled={!canEditTracker} />
                    <TextInput name="totalSessionsPlanned" inputMode="numeric" defaultValue={e.totalSessionsPlanned?.toString() ?? ""} disabled={!canEditTracker} />
                  </div>
                </Field>
                <Field label="Last task assigned">
                  <TextInput name="lastTaskAssigned" defaultValue={e.lastTaskAssigned ?? ""} disabled={!canEditTracker} />
                </Field>
                <Field label="Last task completed?">
                  <Select name="lastTaskCompleted" options={[{ value: "", label: "-" }, ...optionsFrom(TASK_COMPLETION_LABELS)]} defaultValue={e.lastTaskCompleted ?? ""} disabled={!canEditTracker} />
                </Field>
                <Field label="Applications submitted">
                  <TextInput name="applicationsSubmitted" inputMode="numeric" defaultValue={String(e.applicationsSubmitted)} disabled={!canEditTracker} />
                </Field>
                <Field label="Interviews received">
                  <TextInput name="interviewsReceived" inputMode="numeric" defaultValue={String(e.interviewsReceived)} disabled={!canEditTracker} />
                </Field>
                <Field label="Current milestone" hint="Changing it logs the change permanently">
                  <Select name="currentMilestone" options={optionsFrom(MILESTONE_LABELS)} defaultValue={e.currentMilestone} disabled={!canEditTracker} />
                </Field>
                <Field label="Milestone change note (optional)">
                  <TextInput name="milestoneNote" placeholder="What happened in the session" disabled={!canEditTracker} />
                </Field>
                <Field label="Signal colour" hint="Manual - every change is logged">
                  <Select name="signalColour" options={[{ value: "", label: "Not set" }, ...optionsFrom(SIGNAL_LABELS)]} defaultValue={e.signalColour ?? ""} disabled={!canEditTracker} />
                </Field>
                <Field label="Next check-in date">
                  <TextInput type="date" name="nextCheckInDate" defaultValue={e.nextCheckInDate?.slice(0, 10) ?? ""} disabled={!canEditTracker} />
                </Field>
                <div className="sm:col-span-2">
                  <Field label="Signal notes" hint="Why Green/Amber/Red? What action is being taken?">
                    <TextArea name="signalNotes" defaultValue={e.signalNotes ?? ""} disabled={!canEditTracker} />
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
                  {formatDate(c.date)} - {c.previousSignal ? SIGNAL_LABELS[c.previousSignal] : "unset"} → {SIGNAL_LABELS[c.newSignal]} by {c.changedBy}
                  {c.note ? ` · ${c.note}` : ""}
                </p>
              ))}
            </div>
          )}
        </section>
      ))}

      {/* Student portal access (Admin): a Role.STUDENT login that sees only /my-journey */}
      {isAdmin && (
        <section className="rounded-card border border-line bg-surface p-5 shadow-card">
          <h3 className="font-display text-lg font-semibold">Student portal access</h3>
          <p className="mt-1 text-xs text-muted">
            A portal login shows this student their own journey, XP, badges and next steps —
            plus the CV Diagnostic. It never sees money, signals or internal notes.
          </p>
          {student.portalEmail ? (
            <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
              <span className="rounded-full bg-ok-soft px-2.5 py-1 font-semibold text-ok">Portal active</span>
              <span className="text-muted">Login: {student.portalEmail}</span>
              <span className="text-xs text-muted">(reset the password from People → Users &amp; access)</span>
              <button
                type="button"
                className="ml-auto text-sm text-risk hover:underline"
                onClick={async () => {
                  const ok = await askConfirm({
                    title: "Revoke portal access?",
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
              </button>
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
                  <TextInput type="email" name="email" required defaultValue={student.email ?? ""} />
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
        </section>
      )}

      {/* Upgrade: add enrollment (Admin) */}
      {isAdmin && (
        <section className="rounded-card border border-line bg-surface p-5 shadow-card">
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
              <Field label="Enrollment date"><TextInput type="date" name="enrollmentDate" required /></Field>
              <Field label="Sessions planned"><TextInput name="totalSessionsPlanned" inputMode="numeric" /></Field>
              <Field label="Assigned coach"><TextInput name="assignedCoach" defaultValue="Karthick" /></Field>
              <div className="flex items-end"><SubmitButton>Add enrollment</SubmitButton></div>
            </form>
          )}
        </section>
      )}

      {/* Satisfaction / NPS (Admin, PRD2 §4.5) */}
      <section className="rounded-card border border-line bg-surface p-5 shadow-card">
        <h3 className="font-display text-lg font-semibold">Satisfaction & NPS</h3>
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
            <Field label="Date of score"><TextInput type="date" name="date" required /></Field>
            <Field label="Satisfaction (1-10)"><TextInput name="satisfactionScore" inputMode="numeric" required /></Field>
            <Field label="NPS (0-10)"><TextInput name="npsScore" inputMode="numeric" required /></Field>
            <Field label="Outcome achieved">
              <Select name="outcomeAchieved" options={optionsFrom(OUTCOME_ACHIEVED_LABELS)} defaultValue="NO_OUTCOME_YET" />
            </Field>
            <div className="flex items-end pb-1">
              <CheckboxField name="testimonialReceived" label="Testimonial received" />
            </div>
            <div className="sm:col-span-2">
              <Field label="Notes" hint="What did the student say?"><TextArea name="notes" /></Field>
            </div>
            <div className="flex items-end"><SubmitButton>Record score</SubmitButton></div>
          </form>
        )}
      </section>

      {/* Linked payments (fee ↔ Finance, CONTEXT §7) */}
      <section className="rounded-card border border-line bg-surface p-5 shadow-card">
        <h3 className="font-display text-lg font-semibold">Payments (from Finance)</h3>
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
      </section>
    </div>
  );
}

"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, UserMinus, UserPlus } from "lucide-react";
import { addExistingMember, addNewMember, removeBatchMember } from "@/server/german-note-actions";
import { createStudentLogin, revokeStudentLogin } from "@/server/students-actions";
import type { GnManageBatch, GnStudentOption } from "@/server/german-note-metrics";
import { askConfirm, toast } from "@/components/ui/feedback";
import { Btn } from "@/components/ui/controls";
import { Field, FormError, Select, SubmitButton, TextInput } from "@/components/ui/form";
import { Modal } from "@/components/ui/Modal";
import { LevelChip, StatusChip } from "./LevelChip";

/**
 * Batch membership + portal logins. Students can be added BEFORE they have a
 * login (membership references the Student record); "Portal login" then reuses
 * the same provisioning flow as B2 students (Role.STUDENT).
 */
export function MembersPanel({
  batches,
  students,
}: {
  batches: GnManageBatch[];
  students: GnStudentOption[];
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [batchId, setBatchId] = useState(batches[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [loginFor, setLoginFor] = useState<{ studentId: string; fullName: string; email: string | null } | null>(null);

  const batch = batches.find((b) => b.id === batchId) ?? null;
  const memberStudentIds = useMemo(() => new Set(batch?.members.map((m) => m.studentId)), [batch]);
  const addable = students.filter((s) => !memberStudentIds.has(s.id));

  const refresh = () => startTransition(() => router.refresh());

  if (batches.length === 0) {
    return (
      <p className="rounded-card border border-dashed border-line bg-surface-2 px-4 py-8 text-center text-sm text-muted">
        Create a batch first — then assign students to it here.
      </p>
    );
  }

  return (
    <section className="space-y-5">
      <div>
        <h3 className="font-display text-h2 font-semibold">Batch members</h3>
        <p className="text-xs text-muted">
          Pick a batch, then add students — existing ones from anywhere in the system, or quick-create a new
          German Note learner (no B2 enrollment needed).
        </p>
      </div>

      <div className="max-w-md">
        <Field label="Batch">
          <Select
            options={batches.map((b) => ({ value: b.id, label: `${b.name}${b.status === "ARCHIVED" ? " (archived)" : ""}` }))}
            value={batchId}
            onChange={(e) => setBatchId(e.target.value)}
          />
        </Field>
      </div>

      {batch && (
        <>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-semibold">{batch.name}</span>
            <LevelChip level={batch.level} />
            <StatusChip status={batch.status} />
            <span className="text-xs text-muted">
              {batch.members.length} member{batch.members.length === 1 ? "" : "s"}
              {batch.tutorName ? ` · Tutor: ${batch.tutorName}` : ""}
            </span>
          </div>

          {/* current members */}
          <div className="overflow-hidden rounded-card border border-line bg-surface shadow-card">
            {batch.members.length === 0 && (
              <p className="px-4 py-6 text-center text-sm text-muted">No members in this batch yet.</p>
            )}
            {batch.members.map((m) => (
              <div key={m.id} className="flex flex-wrap items-center gap-3 border-t border-line px-4 py-3 first:border-t-0">
                <div className="min-w-[180px] flex-1">
                  <p className="text-sm font-semibold text-ink">{m.fullName}</p>
                  <p className="text-xs text-muted">{m.email ?? "no email on file"}</p>
                </div>
                {m.hasLogin ? (
                  <Btn
                    variant="soft"
                    size="sm"
                    icon={<KeyRound size={14} />}
                    onClick={async () => {
                      const ok = await askConfirm({
                        title: `Remove ${m.fullName}'s portal login?`,
                        body: "They stay in the batch — they just can't sign in anymore.",
                        confirmLabel: "Revoke login",
                        danger: true,
                      });
                      if (!ok) return;
                      const res = await revokeStudentLogin(m.studentId);
                      if (!res.ok) return toast(res.error, "error");
                      toast("Login revoked");
                      refresh();
                    }}
                  >
                    Revoke login
                  </Btn>
                ) : (
                  <Btn
                    variant="soft"
                    size="sm"
                    icon={<KeyRound size={14} />}
                    onClick={() => setLoginFor({ studentId: m.studentId, fullName: m.fullName, email: m.email })}
                  >
                    Portal login
                  </Btn>
                )}
                <Btn
                  variant="danger"
                  size="sm"
                  icon={<UserMinus size={14} />}
                  onClick={async () => {
                    const ok = await askConfirm({
                      title: `Remove ${m.fullName} from ${batch.name}?`,
                      body: "The student record and any login stay, but they LOSE lifetime access to this batch's recordings. Membership is what grants it — don't remove finished students; archive the batch instead.",
                      confirmLabel: "Remove",
                      danger: true,
                    });
                    if (!ok) return;
                    const res = await removeBatchMember(m.id);
                    if (!res.ok) return toast(res.error, "error");
                    toast("Member removed");
                    refresh();
                  }}
                >
                  Remove
                </Btn>
              </div>
            ))}
          </div>

          {/* add controls */}
          <div className="grid gap-4 lg:grid-cols-2">
            <form
              className="rounded-card border border-line bg-surface p-4 shadow-card"
              action={async (form) => {
                setError(null);
                const res = await addExistingMember(batch.id, form);
                if (!res.ok) return setError(res.error);
                toast("Member added");
                refresh();
              }}
            >
              <h4 className="mb-3 flex items-center gap-2 font-display text-[15px] font-semibold">
                <UserPlus size={15} /> Add existing student
              </h4>
              <Field label="Student" hint="Includes B2 students — one person can be in both worlds.">
                <Select
                  name="studentId"
                  options={[
                    { value: "", label: addable.length ? "Pick a student…" : "Everyone is already in this batch" },
                    ...addable.map((s) => ({
                      value: s.id,
                      label: `${s.fullName}${s.email ? ` · ${s.email}` : ""}${s.batchNames.length ? ` · in ${s.batchNames.join(", ")}` : ""}`,
                    })),
                  ]}
                />
              </Field>
              <div className="mt-3 flex items-center justify-between gap-3">
                <FormError message={error} />
                <span className="ml-auto"><SubmitButton>Add to batch</SubmitButton></span>
              </div>
            </form>

            <form
              className="rounded-card border border-line bg-surface p-4 shadow-card"
              action={async (form) => {
                setError(null);
                const res = await addNewMember(batch.id, form);
                if (!res.ok) return setError(res.error);
                toast("Learner created and added");
                refresh();
              }}
            >
              <h4 className="mb-3 flex items-center gap-2 font-display text-[15px] font-semibold">
                <UserPlus size={15} /> Quick-create a learner
              </h4>
              <div className="space-y-3">
                <Field label="Full name">
                  <TextInput name="fullName" required maxLength={120} />
                </Field>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Email (optional)">
                    <TextInput name="email" type="email" />
                  </Field>
                  <Field label="Phone (optional)">
                    <TextInput name="phone" maxLength={30} />
                  </Field>
                </div>
              </div>
              <div className="mt-3 flex items-center justify-end">
                <SubmitButton>Create & add</SubmitButton>
              </div>
            </form>
          </div>
        </>
      )}

      {/* portal login provisioning — same flow as B2 student logins */}
      <Modal
        open={loginFor !== null}
        onClose={() => setLoginFor(null)}
        title={loginFor ? `Portal login for ${loginFor.fullName}` : ""}
        subtitle="They sign in with this email and see the German Note section."
        size="sm"
      >
        {loginFor && (
          <form
            action={async (form) => {
              setError(null);
              const res = await createStudentLogin(loginFor.studentId, form);
              if (!res.ok) return setError(res.error);
              setLoginFor(null);
              toast("Portal login created");
              refresh();
            }}
            className="space-y-3"
          >
            <Field label="Login email">
              <TextInput name="email" type="email" required defaultValue={loginFor.email ?? ""} />
            </Field>
            <Field label="Password" hint="At least 8 characters — share it with the student privately.">
              <TextInput name="password" type="password" required minLength={8} />
            </Field>
            <div className="flex items-center justify-between gap-3">
              <FormError message={error} />
              <span className="ml-auto"><SubmitButton>Create login</SubmitButton></span>
            </div>
          </form>
        )}
      </Modal>
    </section>
  );
}

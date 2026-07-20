"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, UserX } from "lucide-react";
import { createTutorLogin, revokeTutorLogin } from "@/server/german-note-actions";
import type { GnTutorRow } from "@/server/german-note-metrics";
import { askConfirm, toast } from "@/components/ui/feedback";
import { Btn } from "@/components/ui/controls";
import { Field, FormError, SubmitButton, TextInput } from "@/components/ui/form";

/** Tutor accounts (Role.TUTOR): they see ONLY the German Note section. */
export function TutorsPanel({ tutors }: { tutors: GnTutorRow[] }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => startTransition(() => router.refresh());

  return (
    <section className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="font-display text-h2 font-semibold">Tutor accounts</h3>
          <p className="text-xs text-muted">
            Tutors sign in and see only German Note: their batches, posting recordings, and the community.
            Assign them to batches in the Batches tab.
          </p>
        </div>
        <Btn variant="soft" icon={<Plus size={15} />} onClick={() => { setCreating((v) => !v); setError(null); }}>
          {creating ? "Close" : "Create tutor"}
        </Btn>
      </div>

      {creating && (
        <form
          className="rounded-card border border-line bg-surface p-4 shadow-card"
          action={async (form) => {
            setError(null);
            const res = await createTutorLogin(form);
            if (!res.ok) return setError(res.error);
            setCreating(false);
            toast("Tutor account created");
            refresh();
          }}
        >
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Name">
              <TextInput kind="name" name="name" required maxLength={120} />
            </Field>
            <Field label="Email">
              <TextInput kind="email" name="email" required />
            </Field>
            <Field label="Password" hint="At least 8 characters.">
              <TextInput name="password" type="password" required minLength={8} />
            </Field>
          </div>
          <div className="mt-4 flex items-center justify-between gap-3">
            <FormError message={error} />
            <span className="ml-auto"><SubmitButton>Create tutor</SubmitButton></span>
          </div>
        </form>
      )}

      <div className="overflow-hidden rounded-card border border-line bg-surface shadow-card">
        {tutors.length === 0 && (
          <p className="px-4 py-6 text-center text-sm text-muted">No tutor accounts yet.</p>
        )}
        {tutors.map((t) => (
          <div key={t.id} className="flex flex-wrap items-center gap-3 border-t border-line px-4 py-3 first:border-t-0">
            <div className="min-w-[200px] flex-1">
              <div className="flex items-center gap-2.5">
                <span className="text-sm font-semibold text-ink">{t.name}</span>
                <span className="rounded-full bg-lvl-gn/10 px-2.5 py-0.5 text-caption font-semibold text-ink">
                  Tutor
                </span>
              </div>
              <p className="mt-0.5 text-xs text-muted">
                {t.email} · {t.batchCount} batch{t.batchCount === 1 ? "" : "es"}
              </p>
            </div>
            <Btn
              variant="danger"
              size="sm"
              icon={<UserX size={14} />}
              onClick={async () => {
                const ok = await askConfirm({
                  title: `Remove ${t.name}'s account?`,
                  body: "Their batches stay (unassigned) and their posts remain as “Former member”. This cannot be undone.",
                  confirmLabel: "Remove account",
                  danger: true,
                });
                if (!ok) return;
                const res = await revokeTutorLogin(t.id);
                if (!res.ok) return toast(res.error, "error");
                toast("Tutor account removed");
                refresh();
              }}
            >
              Remove
            </Btn>
          </div>
        ))}
      </div>
    </section>
  );
}

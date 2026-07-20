"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Lock, Pencil, Plus, Trash2 } from "lucide-react";
import type { AdminLevel, LevelSummary } from "@/lib/levels";
import { LEVEL_KIND_LABELS } from "@/lib/levels";
import { CHART_OF_ACCOUNTS } from "@/lib/chart-of-accounts";
import { createLevel, deleteLevel, setLevelActive, updateLevel } from "@/server/level-actions";
import { askConfirm, toast } from "@/components/ui/feedback";
import { Btn, IconButton } from "@/components/ui/controls";
import { Field, FormError, Select, SubmitButton, TextInput } from "@/components/ui/form";
import { Modal } from "@/components/ui/Modal";

/**
 * Level catalogue admin (Admin-only). Add German levels (C1, C2, …) and bundles here; they flow
 * straight into the batch, pending-pool, book-order, finance and pipeline dropdowns. Coaching tiers
 * (Solo/Guided/Elite) and Other are seeded + locked — label and GL account editable, nothing else.
 */

const INCOME_ACCOUNT_OPTIONS = CHART_OF_ACCOUNTS.filter((a) => a.type === "INCOME").map((a) => ({
  value: a.code,
  label: `${a.code} — ${a.name}`,
}));

const KIND_OPTIONS = [
  { value: "GERMAN_LEVEL", label: "German level" },
  { value: "GERMAN_BUNDLE", label: "German bundle" },
];

const paiseToRupees = (n: number | null) => (n === null ? "" : String(Math.round(n / 100)));

function LevelFields({ level }: { level?: LevelSummary }) {
  const isCreate = !level;
  const locked = level?.locked ?? false;
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Code" hint={isCreate ? "Stable key, e.g. GN_C1 — cannot change later." : "Fixed once created."}>
          <TextInput
            name="code"
            required={isCreate}
            disabled={!isCreate}
            maxLength={40}
            placeholder="GN_C1"
            defaultValue={level?.code}
          />
        </Field>
        <Field label="Label" hint="What people see, e.g. GN C1.">
          <TextInput name="label" required maxLength={80} placeholder="GN C1" defaultValue={level?.label} />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Kind" hint={locked ? "Locked — this is a system level." : "A bundle is composed of single levels."}>
          <Select name="kind" options={KIND_OPTIONS} defaultValue={level?.kind ?? "GERMAN_LEVEL"} disabled={locked} />
        </Field>
        <Field label="Income account" hint="Which GL account this level's revenue posts to.">
          <Select name="incomeAccountCode" options={INCOME_ACCOUNT_OPTIONS} defaultValue={level?.incomeAccountCode ?? "4030"} />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Books cost (₹)" hint="Single levels only.">
          <TextInput kind="int" name="booksCost" placeholder="1300" defaultValue={paiseToRupees(level?.booksCostInrMinor ?? null)} />
        </Field>
        <Field label="Tutor cost (₹)" hint="Single levels only.">
          <TextInput kind="int" name="tutorCost" placeholder="7000" defaultValue={paiseToRupees(level?.tutorCostInrMinor ?? null)} />
        </Field>
        <Field label="Order" hint="Sort within its group.">
          <TextInput kind="int" name="order" defaultValue={String(level?.order ?? 0)} />
        </Field>
      </div>
      <Field label="Bundle members" hint="Bundles only — the single-level codes it contains, e.g. GN_A1, GN_A2.">
        <TextInput name="bundleMembers" placeholder="GN_A1, GN_A2" defaultValue={level?.bundleMembers.join(", ")} />
      </Field>
      {level && !locked && (
        <Field label="Status">
          <Select
            name="active"
            options={[
              { value: "true", label: "Active" },
              { value: "false", label: "Inactive (hidden from pickers)" },
            ]}
            defaultValue={level.active ? "true" : "false"}
          />
        </Field>
      )}
    </div>
  );
}

export function LevelsPanel({ levels }: { levels: AdminLevel[] }) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<AdminLevel | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => router.refresh();
  const accountLabel = (code: string) => INCOME_ACCOUNT_OPTIONS.find((a) => a.value === code)?.label ?? code;

  return (
    <section className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="font-display text-h2 font-semibold">Levels &amp; bundles</h3>
          <p className="text-xs text-muted">
            Add German levels and bundles. They appear everywhere a level is chosen — batches, pending pool, book
            orders, income and pipeline. Coaching tiers are locked.
          </p>
        </div>
        <Btn variant="soft" icon={<Plus size={15} />} onClick={() => { setCreating((v) => !v); setError(null); }}>
          {creating ? "Close" : "Add level"}
        </Btn>
      </div>

      {creating && (
        <form
          className="rounded-card border border-line bg-surface p-4 shadow-card"
          action={async (form) => {
            setError(null);
            const res = await createLevel(form);
            if (!res.ok) return setError(res.error);
            setCreating(false);
            toast("Level added");
            refresh();
          }}
        >
          <LevelFields />
          <div className="mt-4 flex items-center justify-between gap-3">
            <FormError message={error} />
            <span className="ml-auto"><SubmitButton>Add level</SubmitButton></span>
          </div>
        </form>
      )}

      <div className="space-y-2.5">
        {levels.map((l) => (
          <div key={l.code} className="flex flex-wrap items-center gap-3 rounded-card border border-line bg-surface px-4 py-3 shadow-card">
            <div className="min-w-[220px] flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-ink">{l.label}</span>
                <span className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-muted">{l.code}</span>
                {l.locked && <Lock size={12} className="text-muted" aria-label="Locked system level" />}
                {!l.active && <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[11px] text-ink-3">Inactive</span>}
              </div>
              <p className="mt-0.5 text-xs text-muted">
                {LEVEL_KIND_LABELS[l.kind]} · {accountLabel(l.incomeAccountCode)}
                {l.kind === "GERMAN_BUNDLE" && l.bundleMembers.length ? ` · ${l.bundleMembers.join(" + ")}` : ""}
                {l.booksCostInrMinor !== null || l.tutorCostInrMinor !== null
                  ? ` · books ₹${paiseToRupees(l.booksCostInrMinor)} / tutor ₹${paiseToRupees(l.tutorCostInrMinor)}`
                  : ""}
              </p>
            </div>
            {!l.locked && (
              <Btn
                variant="ghost"
                onClick={async () => {
                  const res = await setLevelActive(l.id, !l.active);
                  if (!res.ok) return toast(res.error, "error");
                  toast(l.active ? "Level deactivated" : "Level reactivated");
                  refresh();
                }}
              >
                {l.active ? "Deactivate" : "Reactivate"}
              </Btn>
            )}
            <IconButton label={`Edit ${l.label}`} size="sm" onClick={() => { setEditing(l); setError(null); }}>
              <Pencil size={15} />
            </IconButton>
            {!l.locked && (
              <IconButton
                label={`Delete ${l.label}`}
                size="sm"
                tone="danger"
                onClick={async () => {
                  const ok = await askConfirm({
                    title: `Delete “${l.label}”?`,
                    body: "Only possible if no record uses it. Otherwise deactivate it to hide it from pickers.",
                    confirmLabel: "Delete",
                    danger: true,
                  });
                  if (!ok) return;
                  const res = await deleteLevel(l.id);
                  if (!res.ok) return toast(res.error, "error");
                  toast("Level deleted");
                  refresh();
                }}
              >
                <Trash2 size={15} />
              </IconButton>
            )}
          </div>
        ))}
      </div>

      <Modal open={editing !== null} onClose={() => setEditing(null)} title="Edit level" size="md">
        {editing && (
          <form
            action={async (form) => {
              setError(null);
              const res = await updateLevel(editing.id, form);
              if (!res.ok) return setError(res.error);
              setEditing(null);
              toast("Level updated");
              refresh();
            }}
          >
            <LevelFields level={editing} />
            <div className="mt-4 flex items-center justify-between gap-3">
              <FormError message={error} />
              <span className="ml-auto"><SubmitButton>Save changes</SubmitButton></span>
            </div>
          </form>
        )}
      </Modal>
    </section>
  );
}

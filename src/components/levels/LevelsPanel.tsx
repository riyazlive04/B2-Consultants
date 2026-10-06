"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Lock, Pencil, Plus, Trash2 } from "lucide-react";
import type { LevelKind } from "@prisma/client";
import type { AdminLevel, LevelSummary } from "@/lib/levels";
import { LEVEL_KIND_LABELS, LEVEL_KINDS_BY_LINE } from "@/lib/levels";
import type { BusinessLine } from "@/lib/business-line";
import { CHART_OF_ACCOUNTS } from "@/lib/chart-of-accounts";
import { createLevel, deleteLevel, setLevelActive, updateLevel } from "@/server/level-actions";
import { askConfirm, toast } from "@/components/ui/feedback";
import { Btn, IconButton } from "@/components/ui/controls";
import { Field, FormError, Select, SubmitButton, TextInput } from "@/components/ui/form";
import { Modal } from "@/components/ui/Modal";

/**
 * Level catalogue admin (Admin-only), for ONE business line at a time.
 *
 * It used to render the whole `Level` table on a single tab inside German Note, so the B2
 * coaching tiers - a different product, sold by different people, posting to different GL
 * accounts - were administered from a screen about German courses. The two halves now have
 * their own surfaces, and this component renders whichever one it is given:
 *
 *   GERMAN_NOTE - German Note > Manage > Levels: A1/A2/B1, bundles, books + tutor cost
 *   B2          - Programs: the coaching tiers (Solo/Guided/Elite) and Other
 *
 * `line` is the only difference between the two. Levels arrive unfiltered and are split here,
 * so a caller can never accidentally hand one surface the other's rows.
 *
 * Seeded rows (the coaching tiers and Other) are `locked`: label and GL account are editable,
 * but they cannot be re-coded, re-kinded, deactivated or deleted.
 */

const INCOME_ACCOUNT_OPTIONS = CHART_OF_ACCOUNTS.filter((a) => a.type === "INCOME").map((a) => ({
  value: a.code,
  label: `${a.code} - ${a.name}`,
}));

type LineConfig = {
  heading: string;
  blurb: string;
  addLabel: string;
  /** Kinds this surface may CREATE. A locked row's own kind is never offered - it cannot move. */
  kindOptions: { value: string; label: string }[];
  defaultKind: LevelKind;
  /** GL account a newly added level posts to until someone picks another. */
  defaultIncomeAccount: string;
  codePlaceholder: string;
  labelPlaceholder: string;
  /**
   * Books + tutor cost per head, and bundle composition. German-only: the schema documents both
   * cost columns as null for coaching tiers, and only a German level can sit inside a bundle.
   */
  germanEconomics: boolean;
  empty: string;
};

const LINE_CONFIG: Record<BusinessLine, LineConfig> = {
  GERMAN_NOTE: {
    heading: "German levels & bundles",
    blurb:
      "The German Note course catalogue. Add levels (C1, C2, ...) and bundles of them; they appear everywhere a German level is chosen - batches, book orders, income and pipeline. B2 coaching tiers are managed under Programs.",
    addLabel: "Add level",
    kindOptions: [
      { value: "GERMAN_LEVEL", label: "German level" },
      { value: "GERMAN_BUNDLE", label: "German bundle" },
    ],
    defaultKind: "GERMAN_LEVEL",
    defaultIncomeAccount: "4030",
    codePlaceholder: "GN_C1",
    labelPlaceholder: "GN C1",
    germanEconomics: true,
    empty: "No German levels yet. Add A1 to get started.",
  },
  B2: {
    heading: "Coaching tiers",
    blurb:
      "What B2 Consultants sells: the coaching tier a client buys, plus the catch-all Other. These appear wherever a B2 programme is chosen - students, income and pipeline. German Note's own levels are managed under German Note > Manage.",
    addLabel: "Add programme",
    kindOptions: [
      { value: "COACHING_TIER", label: "Coaching tier" },
      { value: "OTHER", label: "Other" },
    ],
    defaultKind: "COACHING_TIER",
    // Not 4030 (German Note). A B2 programme's revenue must not default onto the other line's
    // income account - "Income - Other" is the neutral landing spot until a founder picks one.
    defaultIncomeAccount: "4090",
    codePlaceholder: "MASTERCLASS",
    labelPlaceholder: "Masterclass",
    germanEconomics: false,
    empty: "No programmes yet.",
  },
};

const paiseToRupees = (n: number | null) => (n === null ? "" : String(Math.round(n / 100)));

function LevelFields({ cfg, level }: { cfg: LineConfig; level?: LevelSummary }) {
  const isCreate = !level;
  const locked = level?.locked ?? false;
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Code"
          hint={isCreate ? `Stable key, e.g. ${cfg.codePlaceholder} - cannot change later.` : "Fixed once created."}
        >
          <TextInput
            name="code"
            required={isCreate}
            disabled={!isCreate}
            maxLength={40}
            placeholder={cfg.codePlaceholder}
            defaultValue={level?.code}
          />
        </Field>
        <Field label="Label" hint={`What people see, e.g. ${cfg.labelPlaceholder}.`}>
          <TextInput name="label" required maxLength={80} placeholder={cfg.labelPlaceholder} defaultValue={level?.label} />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Kind"
          hint={
            locked
              ? "Locked - this is a system level."
              : cfg.germanEconomics
                ? "A bundle is composed of single levels."
                : "How this programme is classified."
          }
        >
          <Select name="kind" options={cfg.kindOptions} defaultValue={level?.kind ?? cfg.defaultKind} disabled={locked} />
        </Field>
        <Field label="Income account" hint="Which GL account this level's revenue posts to.">
          <Select
            name="incomeAccountCode"
            options={INCOME_ACCOUNT_OPTIONS}
            defaultValue={level?.incomeAccountCode ?? cfg.defaultIncomeAccount}
          />
        </Field>
      </div>
      {cfg.germanEconomics ? (
        <>
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
          <Field label="Bundle members" hint="Bundles only - the single-level codes it contains, e.g. GN_A1, GN_A2.">
            <TextInput name="bundleMembers" placeholder="GN_A1, GN_A2" defaultValue={level?.bundleMembers.join(", ")} />
          </Field>
        </>
      ) : (
        /* No books/tutor cost and no bundle membership on this line. The fields are ABSENT rather
           than blank, and the action preserves what it is not sent - see level-actions.ts. */
        <Field label="Order" hint="Sort within its group.">
          <TextInput kind="int" name="order" defaultValue={String(level?.order ?? 0)} />
        </Field>
      )}
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

export function LevelsPanel({ levels, line }: { levels: AdminLevel[]; line: BusinessLine }) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<AdminLevel | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cfg = LINE_CONFIG[line];
  const kinds = LEVEL_KINDS_BY_LINE[line];
  const rows = levels.filter((l) => kinds.includes(l.kind));

  const refresh = () => router.refresh();
  const accountLabel = (code: string) => INCOME_ACCOUNT_OPTIONS.find((a) => a.value === code)?.label ?? code;

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-display text-h2 font-semibold">{cfg.heading}</h3>
          <p className="mt-0.5 max-w-2xl text-xs text-muted">{cfg.blurb}</p>
        </div>
        <Btn
          variant="soft"
          icon={<Plus size={15} />}
          onClick={() => {
            setCreating((v) => !v);
            setError(null);
          }}
        >
          {creating ? "Close" : cfg.addLabel}
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
          <LevelFields cfg={cfg} />
          <div className="mt-4 flex items-center justify-between gap-3">
            <FormError message={error} />
            <span className="ml-auto"><SubmitButton>{cfg.addLabel}</SubmitButton></span>
          </div>
        </form>
      )}

      {rows.length === 0 ? (
        <div className="rounded-field border border-line bg-surface-2 px-4 py-8 text-center text-sm text-muted">
          {cfg.empty}
        </div>
      ) : (
        <div className="space-y-2.5">
          {rows.map((l) => (
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
      )}

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
            <LevelFields cfg={cfg} level={editing} />
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

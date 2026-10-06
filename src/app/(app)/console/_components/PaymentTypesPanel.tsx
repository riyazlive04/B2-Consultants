"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Lock, Plus } from "lucide-react";
import {
  DEFAULT_PAYMENT_TYPES_CONFIG,
  PAYMENT_TYPE_KIND_LABELS,
  PAYMENT_TYPE_KINDS,
  type PaymentTypeKind,
  type PaymentTypesConfig,
} from "@/lib/config-schema";
import { isLockedPaymentType } from "@/lib/payment-types";
import { toast } from "@/components/ui/feedback";
import { savePaymentTypesConfig } from "@/server/console-actions";
import {
  Btn, Card, ColHead, ColRow, ColScroll, Hint, NameCell, Picker, RemoveCell, SaveBar, TextIn, Toggle,
} from "./kit";

/**
 * The "Payment type" list every money form offers (Founder Console → Payment Types).
 *
 * This was a two-value Prisma enum, so the only arrangements the app could record were "paid in
 * full" and "instalment plan" - and a student on a monthly subscription had to be filed as one of
 * those two. Filing it as an instalment plan is the worse of the two, because the chasing ladder
 * then treats a recurring charge as a finite debt and starts dunning somebody who owes nothing.
 *
 * ── WHAT THE FOUNDER CHOOSES, AND WHAT THEY CANNOT ────────────────────────────────
 * The name and the list are theirs. The BEHAVIOUR is not invented here - each type picks one of
 * three kinds (lib/config-schema), and the kind is what the rest of the app branches on:
 * whether a schedule is asked for, whether a receivable is raised, whether anything recurs.
 * A kind that did nothing would be a payment type that silently did nothing.
 *
 * Full payment and Instalment are LOCKED. Every Income row ever recorded holds one of their two
 * codes, and the settlement engine reads those codes by name, so they can be relabelled and
 * switched off but never removed or re-kinded - deleting one would change what thousands of
 * historic rows mean.
 */

const COLS = "1fr 9rem 14rem 5rem 2rem";

const KIND_OPTIONS = PAYMENT_TYPE_KINDS.map((k) => ({ value: k, label: PAYMENT_TYPE_KIND_LABELS[k] }));

/** A code from a typed label: "Part payment" → "PART_PAYMENT". Editable afterwards. */
function codeFromLabel(label: string): string {
  const base = label
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 32);
  return /^[A-Z]/.test(base) ? base : `TYPE_${base}`.slice(0, 32);
}

export function PaymentTypesPanel({ config }: { config: PaymentTypesConfig }) {
  const router = useRouter();
  const [draft, setDraft] = useState<PaymentTypesConfig>(config);
  const [saved, setSaved] = useState<PaymentTypesConfig>(config);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);

  const patch = (code: string, patchObj: Partial<PaymentTypesConfig["types"][number]>) =>
    setDraft((d) => ({ ...d, types: d.types.map((t) => (t.code === code ? { ...t, ...patchObj } : t)) }));

  const addType = () =>
    setDraft((d) => {
      // A unique placeholder code so two "Add"s in a row don't collide before either is named.
      let n = d.types.length + 1;
      while (d.types.some((t) => t.code === `PAYMENT_TYPE_${n}`)) n += 1;
      return {
        ...d,
        types: [...d.types, { code: `PAYMENT_TYPE_${n}`, label: "", kind: "FULL" as PaymentTypeKind, active: true }],
      };
    });

  const removeType = (code: string) =>
    setDraft((d) => ({ ...d, types: d.types.filter((t) => t.code !== code) }));

  async function save() {
    setBusy(true);
    setError(null);
    const res = await savePaymentTypesConfig(draft);
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setSaved(draft);
    toast("Payment types saved");
    router.refresh();
  }

  return (
    <div className="space-y-5">
      <Hint>
        What <strong>&ldquo;Payment type&rdquo;</strong> offers on every money form. The{" "}
        <strong>kind</strong> decides the behaviour: an <strong>instalment</strong> type asks for a
        count and a schedule and raises a receivable the ladder chases, a{" "}
        <strong>recurring</strong> type asks how often it bills and raises none, and a{" "}
        <strong>paid in full</strong> type asks for nothing further. Switch a type off and it stops
        being offered while every record that already uses it still reads correctly.
      </Hint>

      <Card>
        <ColScroll>
          <div className="space-y-1.5">
            <ColHead cols={COLS} labels={["Name", "Code", "Kind", "Offered", ""]} />
            {draft.types.map((t, i) => {
              const locked = isLockedPaymentType(t.code);
              return (
                <ColRow key={t.code} cols={COLS} index={i}>
                  <TextIn
                    ariaLabel={`Name for ${t.code}`}
                    value={t.label}
                    placeholder="e.g. Subscription"
                    onChange={(label) =>
                      // Only a NEW, still-unnamed row has its code tracked to the name. Re-coding
                      // a type already in use would orphan every row that stores the old code.
                      patch(t.code, {
                        label,
                        ...(t.label === "" && !locked ? { code: codeFromLabel(label) || t.code } : {}),
                      })
                    }
                  />
                  {locked ? (
                    <NameCell className="flex items-center gap-1.5 font-medium text-ink-3">
                      <Lock size={12} aria-hidden /> {t.code}
                    </NameCell>
                  ) : (
                    <NameCell className="tnum text-ink-3">{t.code}</NameCell>
                  )}
                  <Picker
                    ariaLabel={`Kind for ${t.code}`}
                    value={t.kind}
                    onChange={(kind) => patch(t.code, { kind })}
                    options={
                      // A locked type's kind is what the settlement engine relies on, so it is
                      // shown rather than offered: the only option is the one it must keep.
                      locked ? KIND_OPTIONS.filter((o) => o.value === t.kind) : KIND_OPTIONS
                    }
                  />
                  <Toggle
                    checked={t.active}
                    onChange={(active) => patch(t.code, { active })}
                    label={`Offer ${t.label || t.code}`}
                    hideLabel
                  />
                  {locked ? (
                    <span
                      className="grid h-8 w-8 place-items-center text-ink-disabled"
                      title="Existing records use this type - it can be renamed or switched off, but not removed"
                    >
                      <Lock size={13} aria-hidden />
                      <span className="sr-only">{t.code} cannot be removed</span>
                    </span>
                  ) : (
                    <RemoveCell onClick={() => removeType(t.code)} label={`Remove ${t.label || t.code}`} />
                  )}
                </ColRow>
              );
            })}
            <Btn variant="ghost" size="sm" onClick={addType}>
              <Plus size={14} /> Add a payment type
            </Btn>
          </div>
        </ColScroll>

        <SaveBar
          dirty={dirty}
          onSave={save}
          onReset={() => setDraft(DEFAULT_PAYMENT_TYPES_CONFIG)}
          busy={busy}
          error={error}
        />
      </Card>
    </div>
  );
}

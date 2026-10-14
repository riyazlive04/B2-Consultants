"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Lock, Plus } from "lucide-react";
import {
  DEFAULT_EXPENSE_CATEGORIES_CONFIG,
  NEW_EXPENSE_ACCOUNT,
  type ExpenseCategoriesConfig,
} from "@/lib/config-schema";
import { isLockedExpenseCategory } from "@/lib/expense-categories";
import { toast } from "@/components/ui/feedback";
import { saveExpenseCategoriesConfig } from "@/server/console-actions";
import { safeAction } from "@/lib/action-guard";
import {
  Btn, Card, ColHead, ColRow, ColScroll, Hint, NameCell, Picker, RemoveCell, SaveBar, TextIn, Toggle,
} from "./kit";

/**
 * The "Expense category" list every cost form offers (Founder Console → Expense categories).
 *
 * This was an eight-value Prisma enum, chosen in a spec. The categories a real business reaches
 * for next - Rent, Legal and accounting, Travel, Bank charges - were not among them, so every
 * such cost had to be filed as "Other": the largest line in the P&L became the one that says
 * nothing, and the only way to fix it was a schema change and a deploy.
 *
 * ── A CATEGORY IS A LINE IN THE LEDGER, NOT A LABEL ───────────────────────────────
 * Each category names the P&L account its costs are debited to, which is the whole difference
 * between adding a category and adding a word. A new one can share a line that already exists
 * (Rent under Operations, say) or open a line of its own - and "its own" really does mean a new
 * account in the chart, created when this panel is saved, which then appears in the Ledger and in
 * every report that reads it.
 *
 * Team salaries, COGS and Other are LOCKED against removal. The app branches on those three
 * codes by NAME - team pay turns the vendor box into a people picker, approved tutor fees accrue
 * to COGS, and Other is what an unrecognised code falls back to - so they can be relabelled,
 * re-pointed and switched off, but deleting one would change what historic rows mean and leave a
 * live code pointing at nothing.
 */

const COLS = "1fr 9rem 13rem 4.5rem 4.5rem 2rem";

/** A code from a typed label: "Legal and accounting" → "LEGAL_AND_ACCOUNTING". Editable after. */
function codeFromLabel(label: string): string {
  const base = label
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 32);
  return /^[A-Z]/.test(base) ? base : `CATEGORY_${base}`.slice(0, 32);
}

export function ExpenseCategoriesPanel({
  config,
  accounts,
}: {
  config: ExpenseCategoriesConfig;
  /** The EXPENSE accounts in the chart today, newest customs included, in chart order. */
  accounts: { code: string; name: string }[];
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<ExpenseCategoriesConfig>(config);
  const [saved, setSaved] = useState<ExpenseCategoriesConfig>(config);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);

  const accountOptions = [
    ...accounts.map((a) => ({ value: a.code, label: `${a.code} · ${a.name}` })),
    // Last, and named as the consequence rather than the mechanism: "a new line" is what the
    // founder is choosing; creating a ledger account is what the app does about it.
    { value: NEW_EXPENSE_ACCOUNT, label: "+ Its own new line" },
  ];

  const patch = (code: string, patchObj: Partial<ExpenseCategoriesConfig["categories"][number]>) =>
    setDraft((d) => ({
      ...d,
      categories: d.categories.map((c) => (c.code === code ? { ...c, ...patchObj } : c)),
    }));

  const addCategory = () =>
    setDraft((d) => {
      // A unique placeholder code so two "Add"s in a row don't collide before either is named.
      let n = d.categories.length + 1;
      while (d.categories.some((c) => c.code === `CATEGORY_${n}`)) n += 1;
      return {
        ...d,
        categories: [
          ...d.categories,
          // Its own line by default: somebody adding a category has a cost the existing lines
          // do not describe, which is precisely the case for a line of its own.
          { code: `CATEGORY_${n}`, label: "", accountCode: NEW_EXPENSE_ACCOUNT, isCogs: false, active: true },
        ],
      };
    });

  const removeCategory = (code: string) =>
    setDraft((d) => ({ ...d, categories: d.categories.filter((c) => c.code !== code) }));

  async function save() {
    setBusy(true);
    setError(null);
    const res = await safeAction(() => saveExpenseCategoriesConfig(draft));
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setSaved(draft);
    toast("Expense categories saved");
    // Not optional: a category saved as "its own new line" comes back holding the code of the
    // account that was just created, and the draft here still holds the sentinel.
    router.refresh();
  }

  return (
    <div className="space-y-5">
      <Hint>
        What <strong>&ldquo;Expense category&rdquo;</strong> offers on the expense form, the Record
        button and the payables list. <strong>P&amp;L line</strong> is where the money is debited in
        the ledger - share a line that exists, or give the category one of its own and it becomes a
        new line in the accounts. <strong>COGS</strong> is only the category&rsquo;s default answer
        to &ldquo;is this a direct cost of delivery&rdquo;; every expense still carries its own tick.
        Switch a category off and it stops being offered while every cost already filed under it
        still reads correctly.
      </Hint>

      <Card>
        <ColScroll>
          <div className="space-y-1.5">
            <ColHead cols={COLS} labels={["Name", "Code", "P&L line", "COGS", "Offered", ""]} />
            {draft.categories.map((c, i) => {
              const locked = isLockedExpenseCategory(c.code);
              return (
                <ColRow key={c.code} cols={COLS} index={i}>
                  <TextIn
                    ariaLabel={`Name for ${c.code}`}
                    value={c.label}
                    placeholder="e.g. Rent"
                    onChange={(label) =>
                      // Only a NEW, still-unnamed row has its code tracked to the name. Re-coding
                      // a category already in use would orphan every cost that stores the old one.
                      patch(c.code, {
                        label,
                        ...(c.label === "" && !locked ? { code: codeFromLabel(label) || c.code } : {}),
                      })
                    }
                  />
                  {locked ? (
                    <NameCell className="flex items-center gap-1.5 font-medium text-ink-3">
                      <Lock size={12} aria-hidden /> {c.code}
                    </NameCell>
                  ) : (
                    <NameCell className="tnum text-ink-3">{c.code}</NameCell>
                  )}
                  <Picker
                    ariaLabel={`P&L line for ${c.code}`}
                    value={c.accountCode}
                    onChange={(accountCode) => patch(c.code, { accountCode })}
                    options={accountOptions}
                  />
                  <Toggle
                    checked={c.isCogs}
                    onChange={(isCogs) => patch(c.code, { isCogs })}
                    label={`${c.label || c.code} is a direct delivery cost`}
                    hideLabel
                  />
                  <Toggle
                    checked={c.active}
                    onChange={(active) => patch(c.code, { active })}
                    label={`Offer ${c.label || c.code}`}
                    hideLabel
                  />
                  {locked ? (
                    <span
                      className="grid h-8 w-8 place-items-center text-ink-disabled"
                      title="The app branches on this category by name - it can be renamed, re-pointed or switched off, but not removed"
                    >
                      <Lock size={13} aria-hidden />
                      <span className="sr-only">{c.code} cannot be removed</span>
                    </span>
                  ) : (
                    <RemoveCell onClick={() => removeCategory(c.code)} label={`Remove ${c.label || c.code}`} />
                  )}
                </ColRow>
              );
            })}
            <Btn variant="ghost" size="sm" onClick={addCategory}>
              <Plus size={14} /> Add an expense category
            </Btn>
          </div>
        </ColScroll>

        <SaveBar
          dirty={dirty}
          onSave={save}
          onReset={() => setDraft(DEFAULT_EXPENSE_CATEGORIES_CONFIG)}
          resetLabel="Back to the shipped eight"
          busy={busy}
          error={error}
        />
      </Card>
    </div>
  );
}

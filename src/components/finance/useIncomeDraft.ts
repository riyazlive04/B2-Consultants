"use client";

import { useCallback, useMemo, useState } from "react";
import {
  deriveIncomeForm, emptyDraft,
  type DerivedIncomeForm, type IncomeFormCatalogues, type IncomeFormDraft, type IncomeFormEditing,
} from "@/lib/income-form";

/**
 * The income form's answers, as ONE piece of state.
 *
 * ── What this replaces ────────────────────────────────────────────────────────────
 * Eighteen `useState` hooks and five hand-rolled `xChoice ?? editing?.x ?? default` triples -
 * payment type, method, level, business line, plan - each needing a manual `setXChoice(null)` at
 * TWO reset sites (`switchEditing`, and the clear after a successful submit). Forget one and the
 * form carries the previous entry's answer into the next: a payment filed against the last
 * student's plan, or at the last level.
 *
 * That is not a theoretical risk. The file's own history has two repairs of this exact shape
 * (commit 49a22a6, and the standing note at the old reset site: "reset fires no change event ...
 * Left alone they carried the last payment's plan into the next one"), and adding the plan picker
 * needed a sixth setter at both sites.
 *
 * One object has one reset. `reset()` is the whole of it, and `patch()` is the only way to change
 * an answer - so a new question added tomorrow is automatically cleared with the rest and cannot
 * reintroduce the bug.
 *
 * The rules themselves are in `lib/income-form` - pure, and tested without a browser.
 */
export function useIncomeDraft(editing: IncomeFormEditing, cat: IncomeFormCatalogues): {
  draft: IncomeFormDraft;
  /** Change one or more answers. Everything not named is left exactly as it was. */
  patch: (next: Partial<IncomeFormDraft>) => void;
  /**
   * Back to "nothing answered", optionally seeding the answers that cannot be derived from the
   * row being edited.
   *
   * `student` is the only such answer: the name box is a ComboBox holding text AND a resolved id,
   * and there is no way to "follow the edited row" for a control that the operator types into
   * freely. Everything else falls back through `deriveIncomeForm`, so it needs no seed.
   */
  reset: (seed?: Partial<IncomeFormDraft>) => void;
  /** Everything the form displays, derived from the answers above. */
  derived: DerivedIncomeForm;
} {
  const [draft, setDraft] = useState<IncomeFormDraft>(() => emptyDraft(cat.today));

  const patch = useCallback((next: Partial<IncomeFormDraft>) => {
    setDraft((cur) => ({ ...cur, ...next }));
  }, []);

  const reset = useCallback(
    (seed?: Partial<IncomeFormDraft>) => setDraft({ ...emptyDraft(cat.today), ...seed }),
    [cat.today],
  );

  /**
   * Memoised on the three inputs it is a pure function of. Not for speed - it is a few dozen
   * comparisons - but so the derived object is referentially stable between renders, which keeps
   * it usable as a dependency and keeps the remount keys it produces from changing on every
   * keystroke elsewhere in the form.
   */
  const derived = useMemo(() => deriveIncomeForm(draft, editing, cat), [draft, editing, cat]);

  return { draft, patch, reset, derived };
}

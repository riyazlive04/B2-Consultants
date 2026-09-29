import { expect, Locator, Page } from "@playwright/test";
import { recordCreated, HAS_DB } from "./target";
import { q } from "./db";
import {
  Ymd, dateTrigger, selectTrigger, pickDate, pickOption, incomeForm, expenseForm, pendingForm,
  openTab, gotoFinance, FRUN,
} from "./finance-ui";

/**
 * A toast is NOT proof of a save: the previous entry's toast is still on screen for a few seconds,
 * so a submit that silently did nothing would pass. Proof is the new row in the (run-filtered)
 * table, or the form's own error.
 */
export async function ensureRunFilter(page: Page) {
  const box = page.locator('input[aria-label^="Filter"]').first();
  if ((await box.count()) && (await box.inputValue()) !== FRUN) await box.fill(FRUN);
}
export async function waitSaved(page: Page, form: Locator, notes: string) {
  const row = page.locator("table tbody tr").filter({ hasText: notes }).filter({ hasNotText: "Nothing matches" });
  const alert = form.getByRole("alert");
  await expect(row.or(alert).first()).toBeVisible({ timeout: 30_000 });
  if (await alert.isVisible()) throw new Error(`Save failed with form error: ${await alert.innerText()}`);
}

export type IncomeInput = {
  date?: Ymd;
  student: string; // must carry the RUN tag
  inr?: string;
  eur?: string;
  level?: string; // label, e.g. "Guided"
  type?: "Full payment" | "Instalment";
  instalmentCount?: string;
  schedule?: { date: Ymd; inr?: string; eur?: string }[];
  method?: string; // label, e.g. "UPI"
  notes: string; // must carry the RUN tag
};

/** Fill the income form in `scope` (Finance page or the Record modal) - does not submit. */
export async function fillIncome(page: Page, form: Locator, v: IncomeInput) {
  if (v.date) await pickDate(page, dateTrigger(form, "date"), v.date);
  const name = form.locator('input[name="studentName"]');
  await name.fill(v.student);
  await page.keyboard.press("Escape"); // close the student suggestions popover
  if (v.inr) await form.locator('input[name="amountInr"]').fill(v.inr);
  if (v.eur) {
    // A typed INR mirrors into (and disables) the EUR box; only type EUR when INR is blank.
    await form.locator('input[name="amountEur"]').fill(v.eur);
  }
  if (v.level) await pickOption(page, selectTrigger(form, "programLevel"), v.level);
  if (v.type) await pickOption(page, selectTrigger(form, "paymentType"), v.type);
  if (v.type === "Instalment") {
    if (v.instalmentCount) await form.locator('input[name="instalmentCount"]').fill(v.instalmentCount);
    if (v.schedule?.length) {
      for (let i = 0; i < v.schedule.length; i++) {
        if (i > 0) await form.getByRole("button", { name: "Add due date" }).click();
        const s = v.schedule[i];
        const trig = form.getByRole("button", { name: `Due date for instalment ${i + 2}` });
        await pickDate(page, trig, s.date);
        const inrBox = form.getByLabel(`Amount due in rupees for instalment ${i + 2}`);
        const eurBox = form.getByLabel(`Amount due in euros for instalment ${i + 2}`);
        await inrBox.fill(s.inr ?? "");
        await eurBox.fill(s.eur ?? "");
      }
    }
  }
  if (v.method) await pickOption(page, selectTrigger(form, "paymentMethod"), v.method);
  await form.locator('input[name="notes"]').fill(v.notes);
}

/** Create an income on /finance through the UI and wait for the toast. Returns the form error (if any). */
export async function addIncome(page: Page, v: IncomeInput, opts: { expectOk?: boolean } = {}) {
  const form = incomeForm(page);
  await fillIncome(page, form, v);
  await ensureRunFilter(page);
  await form.getByRole("button", { name: "Add income" }).click();
  const expectOk = opts.expectOk ?? true;
  if (expectOk) {
    await waitSaved(page, form, v.notes);
    recordCreated("finance", {
      kind: "Income", label: v.notes,
      cleanup: "Finance > Income: filter by the tag, Delete (archives + voids ledger), then Archived > Delete permanently",
    });
    return null;
  }
  const err = form.getByRole("alert");
  await expect(err).toBeVisible();
  return (await err.innerText()).trim();
}

export type ExpenseInput = {
  date?: Ymd;
  inr?: string;
  eur?: string;
  category?: string; // label
  businessLine?: string; // label
  vendor: string;
  notes: string;
  cogs?: boolean;
};

export async function fillExpense(page: Page, form: Locator, v: ExpenseInput) {
  if (v.date) await pickDate(page, dateTrigger(form, "date"), v.date);
  if (v.inr) await form.locator('input[name="amountInr"]').fill(v.inr);
  if (v.eur) await form.locator('input[name="amountEur"]').fill(v.eur);
  if (v.category) await pickOption(page, selectTrigger(form, "category"), v.category);
  if (v.businessLine) await pickOption(page, selectTrigger(form, "businessLine"), v.businessLine);
  await form.locator('input[name="vendor"]').fill(v.vendor);
  await form.locator('input[name="notes"]').fill(v.notes);
  if (v.cogs !== undefined) {
    const box = form.locator('input[name="isCogs"]');
    if ((await box.isChecked()) !== v.cogs) await form.getByText("Is this COGS?").click();
    await expect(box).toBeChecked({ checked: v.cogs });
  }
}

export async function addExpense(page: Page, v: ExpenseInput, opts: { expectOk?: boolean } = {}) {
  const form = expenseForm(page);
  await fillExpense(page, form, v);
  await ensureRunFilter(page);
  await form.getByRole("button", { name: "Add expense" }).click();
  if (opts.expectOk ?? true) {
    await waitSaved(page, form, v.notes);
    recordCreated("finance", {
      kind: "Expense", label: v.notes,
      cleanup: "Finance > Expenses: filter by the tag, Delete (archives + voids ledger), then Archived > Delete permanently",
    });
    return null;
  }
  const err = form.getByRole("alert");
  await expect(err).toBeVisible();
  return (await err.innerText()).trim();
}

export type PendingInput = {
  student: string;
  level?: string;
  feeInr?: string;
  feeEur?: string;
  due?: Ymd;
  status?: "Active" | "Paid in full" | "Overdue" | "Dropped";
  notes: string;
};

export async function addPending(page: Page, v: PendingInput) {
  const form = pendingForm(page);
  await form.locator('input[name="studentName"]').fill(v.student);
  if (v.level) await pickOption(page, selectTrigger(form, "programLevel"), v.level);
  if (v.feeInr) await form.locator('input[name="totalFeeInr"]').fill(v.feeInr);
  if (v.feeEur) await form.locator('input[name="totalFeeEur"]').fill(v.feeEur);
  if (v.due) await pickDate(page, dateTrigger(form, "nextDueDate"), v.due);
  if (v.status) await pickOption(page, selectTrigger(form, "status"), v.status);
  await form.locator('input[name="notes"]').fill(v.notes);
  await ensureRunFilter(page);
  await form.getByRole("button", { name: "Add pending payment" }).click();
  await waitSaved(page, form, v.notes);
  recordCreated("finance", {
    kind: "PendingPayment", label: `${v.student} | ${v.notes}`,
    cleanup: "Finance > Pending payments: filter by the tag, Delete (archive), then Archived > Delete permanently (cascades instalments)",
  });
}

/** Reload /finance and open a tab - every assertion "after save + reload" goes through here. */
export async function reloadFinanceTab(page: Page, tab: RegExp | string, query = "", filter: string | null = FRUN) {
  await gotoFinance(page, query);
  await openTab(page, tab);
  // Tables page at 25 rows (newest date first) - narrow to this run so older-dated rows are visible.
  if (filter) await page.locator('input[aria-label^="Filter"]').first().fill(filter);
}

// ───────────────────────────── local DB reads (never in prod) ─────────────────────────────

/** Dates come back as ::text so the pg driver cannot shift them into the machine's timezone. */
export async function dbIncome(notesLike: string) {
  if (!HAS_DB) return [];
  return q(
    `select id, date::text as date, "studentName", "studentId", "amountInrMinor"::text as inr, "amountEurMinor"::text as eur,
            "fxRateUsed"::text as fx, "programLevel", "paymentType"::text, "paymentMethod"::text, "instalmentCount",
            notes, "deletedAt"
       from income where notes like $1 order by "createdAt"`,
    [notesLike],
  );
}
export async function dbExpense(notesLike: string) {
  if (!HAS_DB) return [];
  return q(
    `select id, date::text as date, "amountInrMinor"::text as inr, "amountEurMinor"::text as eur, "fxRateUsed"::text as fx,
            category::text, "isCogs", "businessLine"::text, vendor, notes, "deletedAt"
       from expense where notes like $1 order by "createdAt"`,
    [notesLike],
  );
}
export async function dbPending(nameLike: string) {
  if (!HAS_DB) return [];
  return q(
    `select p.id, p."studentName", p.status::text, p."nextDueDate"::text as "nextDueDate", p."totalFeeInrMinor"::text as fee,
            p."numEmis", p."deletedAt",
            coalesce(json_agg(json_build_object('seq', i.seq, 'due', i."dueDate"::text, 'status', i.status::text,
                     'inr', i."amountInrMinor"::text, 'paid', i."paidDate"::text) order by i.seq)
                     filter (where i.id is not null), '[]') as instalments
       from pending_payment p left join instalment i on i."pendingPaymentId" = p.id
      where p."studentName" like $1 group by p.id order by p."createdAt"`,
    [nameLike],
  );
}

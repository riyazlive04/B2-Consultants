"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronRight } from "lucide-react";
import {
  createPendingPayment, deletePendingPayment, updatePendingPayment,
} from "@/server/finance-actions";
import {
  clearInstalmentPlan, generateInstalmentPlan, setInstalmentStatus,
} from "@/server/emi-actions";
import type { PendingRow } from "@/server/finance-metrics";
import type { WhatsAppStatusCell } from "@/server/whatsapp";
import { sendPaymentReminderMsg } from "@/server/whatsapp-actions";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Card } from "@/components/ui/kit";
import { Btn } from "@/components/ui/controls";
import { Modal } from "@/components/ui/Modal";
import { SendWhatsAppButton } from "@/components/ui/SendWhatsAppButton";
import { WhatsAppStatusBadge } from "@/components/ui/WhatsAppStatusBadge";
import { askConfirm, toast } from "@/components/ui/feedback";
import { guardAction } from "@/lib/action-guard";
import { Field, FormError, NotesField, Select, SubmitButton, TextInput } from "@/components/ui/form";
import { AmountPair } from "@/components/ui/AmountPair";
import { SignalBadge } from "@/components/ui/SignalBadge";
import { formatDate } from "@/lib/format";
import { money, moneyInline, moneyValue, type Ccy } from "@/lib/money-display";
import { instalmentExtraFor, splitInstalments } from "@/lib/instalment-plan";
import type { InstalmentPlanConfig } from "@/lib/config-schema";
import { optionsFrom, PENDING_STATUS_LABELS, PROGRAM_LEVEL_LABELS } from "@/lib/labels";
import { StudentName } from "@/components/ui/StudentName";
import { ComboBox } from "@/components/ui/ComboBox";
import { useUnsavedGuard } from "@/components/ui/use-unsaved-guard";
import { lineForKind } from "@/lib/business-line";
import { ReceivableDetailModal } from "@/components/finance/ReceivableDetailModal";
import { useFinanceCcy } from "./FinanceCurrency";
import { safeAction } from "@/lib/action-guard";

const minorToInput = (raw: string) => {
  const v = BigInt(raw);
  return v === BigInt(0) ? "" : (Number(v) / 100).toFixed(2);
};

/** Chosen currency first, the other beneath - the toggle's rule, in a table cell. */
const money2 = (m: { inr: number; eur: number }, ccy: Ccy) => moneyInline(m, ccy, { compact: true });

const INSTALMENT_STATUS_OPTIONS = [
  { value: "DUE", label: "Due" },
  { value: "PAID", label: "Paid" },
  { value: "OVERDUE", label: "Overdue" },
];

/** Structured EMI schedule (spec Module G): generate an N-instalment plan, mark each paid, or clear it. */
function EmiScheduleModal({
  row,
  config,
  onClose,
  onError,
}: {
  row: PendingRow;
  /** The Console's instalment prices, handed down - see the note on `plan` below. */
  config: InstalmentPlanConfig;
  onClose: () => void;
  onError: (m: string | null) => void;
}) {
  const { ccy } = useFinanceCcy();
  const has = row.instalments.length > 0;
  const paidCount = row.instalments.filter((i) => i.status === "PAID").length;

  const [count, setCount] = useState(row.instalments.length || 2);
  const [intervalDays, setIntervalDays] = useState<number | null>(config.defaultIntervalDays);

  /**
   * ── What this plan length costs, priced AS YOU TYPE ───────────────────────────────
   *
   * Straight from the Console table, so the founder's pricing is the single source: type 3 and
   * the ₹600 appears, and the amount the schedule is built from is the amount shown.
   *
   * It used to arrive by server action, one round trip per keystroke on the count - so against
   * the Supabase pooler (~200ms) every figure in this panel lagged the digit that changed it,
   * and typing "12" flashed the 1-instalment answer on the way past. The table now travels with
   * the page and `instalmentExtraFor` runs here: the same function the server prices with, on
   * the same config, with nothing between the keystroke and the number.
   *
   * An EXISTING schedule is never re-priced - it is history, and its surcharge was snapshotted
   * when it was generated.
   */
  const plan = has
    ? null
    : (() => {
        const extra = instalmentExtraFor(count, config);
        return {
          extraInr: Number(extra.inr),
          extraEur: Number(extra.eur),
          intervalDays: config.defaultIntervalDays,
        };
      })();

  // The schedule the current answers would produce - same split function the server uses.
  const previewTotal = {
    inr: row.totalFee.inr + (plan?.extraInr ?? 0),
    eur: row.totalFee.eur + (plan?.extraEur ?? 0),
  };
  const previewRows = splitInstalments(
    { inr: BigInt(Math.round(previewTotal.inr)), eur: BigInt(Math.round(previewTotal.eur)) },
    count,
  );

  return (
    <Modal
      open
      onClose={onClose}
      title={`EMI schedule - ${row.studentName}`}
      subtitle={has ? `${paidCount}/${row.instalments.length} paid` : "No schedule yet"}
    >
      {has ? (
        <div className="space-y-2">
          {/* What the plan came to, so an existing schedule explains its own total. */}
          <div className="flex flex-wrap gap-x-5 gap-y-1 rounded-field border border-line bg-surface-2 px-3 py-2 text-sm">
            <span className="text-muted">
              Fee <strong className="tnum text-ink-2">{money(row.totalFee, ccy)}</strong>
            </span>
            {row.planExtra.inr > 0 && (
              <span className="text-muted">
                + plan extra <strong className="tnum text-ink-2">{money(row.planExtra, ccy)}</strong>
              </span>
            )}
            <span className="text-muted">
              To collect <strong className="tnum text-ink">{money(row.toCollect, ccy)}</strong>
            </span>
            {row.intervalDays && <span className="text-muted">every {row.intervalDays} days</span>}
          </div>
          {row.instalments.map((it) => (
            <div
              key={it.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-field border border-line bg-surface-2 px-3 py-2 text-sm"
            >
              <span className="font-medium">#{it.seq}</span>
              {/*
                Full precision, NOT compact (issue 24). The compact formatter rounds to whole
                rupees, so six instalments of ₹1,666.83 each displayed as ₹1,667 and the window
                appeared to bill ₹10,002 against a fee of ₹10,001. The stored schedule was always
                exact - `splitInstalments` works in paise and puts the remainder on the last row -
                so this was the display contradicting correct data.
              */}
              <span className="tnum">{money({ inr: it.inr, eur: it.eur }, ccy)}</span>
              <span className="text-xs text-muted">
                due {formatDate(it.dueDate)}
                {it.paidDate ? ` · paid ${formatDate(it.paidDate)}` : ""}
              </span>
              <div className="ml-auto">
                <Select
                  value={it.status}
                  aria-label={`Instalment ${it.seq} status`}
                  onChange={async (ev) => {
                    onError(null);
                    const res = await safeAction(() => setInstalmentStatus(it.id, ev.target.value));
                    if (!res.ok) onError(res.error);
                    else toast("Instalment updated");
                  }}
                  options={INSTALMENT_STATUS_OPTIONS}
                />
              </div>
            </div>
          ))}
          <div className="pt-2">
            <Btn
              variant="danger"
              size="sm"
              onClick={async () => {
                const ok = await askConfirm({
                  title: "Clear this EMI schedule?",
                  body: "All instalment rows are deleted. The receivable itself stays.",
                  confirmLabel: "Clear schedule",
                  danger: true,
                });
                if (!ok) return;
                onError(null);
                const res = await safeAction(() => clearInstalmentPlan(row.id));
                if (!res.ok) return onError(res.error);
                toast("Schedule cleared");
                onClose();
              }}
            >
              Clear schedule
            </Btn>
          </div>
        </div>
      ) : (
        <form
          action={async (form) => {
            onError(null);
            const res = await safeAction(() => generateInstalmentPlan(row.id, form));
            if (!res.ok) return onError(res.error);
            toast("EMI schedule generated");
            onClose();
          }}
          className="space-y-4"
        >
          <p className="text-sm text-muted">
            Split the fee into equal instalments - the last one absorbs any rounding. The extra for
            each plan length is set in <strong>Console → Instalment Plans</strong>.
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label="Number of instalments" hint="Prices the plan from the Console table">
              <TextInput
                kind="int"
                name="count"
                required
                value={String(count)}
                onChange={(e) => setCount(Math.max(1, Number(e.currentTarget.value) || 0))}
              />
            </Field>
            <Field label="First due date">
              <TextInput type="date" name="firstDueDate" required defaultValue={row.nextDueDate?.slice(0, 10) ?? ""} />
            </Field>
            <Field label="Days between" hint={plan ? `Console default: ${plan.intervalDays}` : undefined}>
              <TextInput
                kind="int"
                name="intervalDays"
                value={intervalDays === null ? "" : String(intervalDays)}
                onChange={(e) => setIntervalDays(Number(e.currentTarget.value) || 0)}
              />
            </Field>
          </div>

          {/*
            The surcharge and the schedule it produces, BEFORE generating. Without this the
            founder types a count and finds out what it cost only afterwards - and the plan is
            append-only in practice (clear + regenerate), so "afterwards" is the wrong time.
          */}
          <div className="rounded-field border border-line bg-surface-2 px-3 py-2.5">
            <dl className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
              <div className="flex gap-2">
                <dt className="text-muted">Fee</dt>
                <dd className="tnum text-ink-2">{money(row.totalFee, ccy)}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="text-muted">+ plan extra</dt>
                <dd className="tnum text-ink-2">
                  {plan ? money({ inr: plan.extraInr, eur: plan.extraEur }, ccy) : "-"}
                </dd>
              </div>
              <div className="flex gap-2">
                <dt className="text-muted">Total to collect</dt>
                <dd className="tnum font-semibold text-ink">{money(previewTotal, ccy)}</dd>
              </div>
            </dl>
            {previewRows.length > 0 && previewRows.length <= 24 && (
              <p className="mt-1.5 text-caption text-muted">
                {count} × {money({ inr: Number(previewRows[0].inr), eur: Number(previewRows[0].eur) }, ccy)}
                {previewRows[count - 1].inr !== previewRows[0].inr &&
                  ` (last ${money(
                    { inr: Number(previewRows[count - 1].inr), eur: Number(previewRows[count - 1].eur) },
                    ccy,
                  )})`}
                {intervalDays ? ` · every ${intervalDays} days` : ""}
              </p>
            )}
          </div>

          <SubmitButton>Generate schedule</SubmitButton>
        </form>
      )}
    </Modal>
  );
}

export function PendingSection({
  rows,
  studentOptions = [],
  levelKinds = {},
  studentCodeById = {},
  waStatus = {},
  levelOptions,
  fxRate,
  fxStale,
  fxDate,
  instalmentPlans,
}: {
  rows: PendingRow[];
  /** The roster, so raising a receivable LINKS a student instead of only naming one. */
  studentOptions?: {
    value: string; label: string; hint?: string; meta?: string;
    /** Which business(es) this student is in. Empty = unknown, and unknown is never filtered out. */
    lines?: ("B2" | "GERMAN_NOTE")[];
  }[];
  /** Level code → the kind it is, so the form can tell which book a level belongs to. */
  levelKinds?: Record<string, string>;
  studentCodeById?: Record<string, string>;
  waStatus?: Record<string, WhatsAppStatusCell>;
  levelOptions: { value: string; label: string }[];
  fxRate: number;
  fxStale?: boolean;
  fxDate?: string;
  /** The Console's instalment prices, so the EMI panel costs a plan without a server round trip. */
  instalmentPlans: InstalmentPlanConfig;
}) {
  const { ccy } = useFinanceCcy();
  const [editing, setEditing] = useState<PendingRow | null>(null);
  const [emiRowId, setEmiRowId] = useState<string | null>(null);
  /**
   * ── Collecting is a different act from editing the agreement ────────────────────
   * This tab reads as the place money is received - it is called Pending payments, and its rows
   * are the people who owe - but everything on it wrote the DEBT. The form raises a receivable,
   * Edit changes the agreed fee, and the only way to receive an instalment was the unlabelled
   * "EMI" control at the end of a row. So the natural move, "I have the money, log it here", had
   * no button; it lived on the Income tab, where the plan has to be named by hand.
   *
   * The panel below (shared with Cash Health) is that button: the student, their course, what has
   * actually come in, the income form already pointed at this plan, and the instalment ticks.
   */
  const [detailId, setDetailId] = useState<string | null>(null);
  /**
   * The level on the form right now - which is what decides the business, and therefore which
   * students can possibly be paying for it. Held in state (the control was uncontrolled) purely
   * so the name box below can narrow with it.
   */
  const [levelChoice, setLevelChoice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  // Optimistic delete: hide the row at once, restore it if the archive fails.
  const [removedIds, setRemovedIds] = useState<Set<string>>(new Set());
  const visibleRows = rows.filter((r) => !removedIds.has(r.id));
  // Derive by id (not a captured row) so the modal reflects fresh instalments after a revalidate.
  const emiRow = emiRowId ? rows.find((r) => r.id === emiRowId) ?? null : null;

  /**
   * ── The roster, narrowed to the business the chosen level belongs to ────────────
   * Raising a B2 receivable used to offer every German Note student as well, which is scrolling
   * at best and the wrong person at worst - two students can share a name, and the only thing
   * separating them was a code nobody had a reason to read.
   *
   * A student with NO known business is always offered. Sixteen people on this roster have
   * neither a code nor any history; hiding them for want of evidence would break the search for
   * exactly the people it exists to find.
   */
  const formLevel = levelChoice ?? editing?.programLevel ?? levelOptions[0]?.value ?? "";
  const formLine = lineForKind(levelKinds[formLevel]);
  const studentsForLine = studentOptions.filter(
    (o) => !o.lines || o.lines.length === 0 || o.lines.includes(formLine),
  );

  // Warn before a refresh or a tab close throws away a half-typed receivable.
  useUnsavedGuard(formRef);

  /** Load a row into the form and take the eye there too (issue 21). */
  const startEdit = (row: PendingRow) => {
    setEditing(row);
    setLevelChoice(row.programLevel);
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const submit = async (form: FormData) => {
    setError(null);
    // Guarded so an offline submit keeps what was typed (issue 10) - see lib/action-guard.
    const guarded = await guardAction(() =>
      editing ? updatePendingPayment(editing.id, form) : createPendingPayment(form),
    );
    if (!guarded.ok) return setError(guarded.error);
    const res = guarded.value;
    if (!res.ok) return setError(res.error);
    toast(editing ? "Pending payment updated" : "Pending payment added");
    setEditing(null);
    setLevelChoice(null);
    formRef.current?.reset();
  };

  const remove = async (row: PendingRow) => {
    const ok = await askConfirm({
      title: `Archive pending payment for ${row.studentName}?`,
      body: "It moves to the Archived tab - you can restore it there.",
      confirmLabel: "Archive",
      danger: true,
    });
    if (!ok) return;
    setRemovedIds((s) => new Set(s).add(row.id)); // optimistic
    const res = await safeAction(() => deletePendingPayment(row.id));
    if (!res.ok) {
      setRemovedIds((s) => {
        const n = new Set(s);
        n.delete(row.id);
        return n;
      });
      return toast(res.error, "error");
    }
    toast("Pending payment archived");
  };

  const columns: Column<PendingRow>[] = [
    {
      key: "student", header: "Student",
      cell: (r) => (
        <button
          type="button"
          onClick={() => setDetailId(r.id)}
          aria-haspopup="dialog"
          className="inline-flex min-w-0 items-center gap-1 rounded-field text-left hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
        >
          <StudentName name={r.studentName} code={r.studentId ? studentCodeById[r.studentId] : null} />
          <ChevronRight size={13} className="flex-none text-muted" />
        </button>
      ),
      value: (r) =>
        r.studentId && studentCodeById[r.studentId]
          ? `${r.studentName} ${studentCodeById[r.studentId]}`
          : r.studentName,
    },
    { key: "level", header: "Level", cell: (r) => PROGRAM_LEVEL_LABELS[r.programLevel] ?? r.programLevel, value: (r) => PROGRAM_LEVEL_LABELS[r.programLevel] ?? r.programLevel },
    {
      key: "fee", header: "To collect", align: "right",
      // Fee + the instalment surcharge. The surcharge is spelled out beneath rather than folded
      // in silently, so a total that is ₹600 more than the agreed fee explains itself.
      cell: (r) => (
        <span className="whitespace-nowrap">
          {money2(r.toCollect, ccy)}
          {r.planExtra.inr > 0 && (
            <span className="block text-caption text-muted">
              incl. {money(r.planExtra, ccy)} plan extra
            </span>
          )}
        </span>
      ),
      value: (r) => moneyValue(r.toCollect, ccy),
    },
    {
      key: "paid", header: "Collected", align: "right",
      /*
        Capped at this plan's own total, which is what makes the summary strip add up. Where a
        payment named this plan and exceeded it, the surplus is called out rather than silently
        dropped - "Collected" reading less than the money that arrived, with nothing said, would
        be the same class of quiet wrongness this whole change is undoing (issue 3).
      */
      cell: (r) => (
        <span>
          {money2(r.paidSoFar, ccy)}
          {r.overpaid.inr > 0 && (
            <span className="block text-caption text-warn">
              {money2(r.overpaid, ccy)} over
            </span>
          )}
        </span>
      ),
      value: (r) => moneyValue(r.paidSoFar, ccy),
    },
    {
      key: "balance", header: "Still to collect", align: "right",
      cell: (r) => <strong className="tnum">{money2(r.balance, ccy)}</strong>,
      value: (r) => moneyValue(r.balance, ccy),
    },
    {
      key: "due", header: "Next due", cell: (r) => (r.nextDueDate ? formatDate(r.nextDueDate) : "-"),
      value: (r) => r.nextDueDate?.slice(0, 10) ?? "",
    },
    {
      key: "status", header: "Status",
      cell: (r) =>
        r.overdue ? (
          <SignalBadge level="risk" size="sm" label="Overdue" />
        ) : (
          PENDING_STATUS_LABELS[r.status]
        ),
      value: (r) => (r.overdue ? "Overdue" : PENDING_STATUS_LABELS[r.status]),
    },
    {
      key: "whatsapp", header: "WhatsApp", sortable: false,
      cell: (r) => {
        const w = waStatus[r.id];
        return (
          <span className="flex items-center gap-2 whitespace-nowrap">
            {w && <WhatsAppStatusBadge status={w.status} kind={w.kind} at={w.at} />}
            {r.balance.inr > 0 && (
              /*
                ── No phone, no button (issue 5) ──────────────────────────────────────
                The control used to be offered regardless, so clicking it on a student with no
                number could only ever produce a skip - and the skip then read as "Sent just
                now" beside a "Skipped" badge. Saying so up front is both honest and shorter.
              */
              r.studentPhone ? (
                <SendWhatsAppButton
                  action={() => sendPaymentReminderMsg(r.id)}
                  label="Remind"
                  /*
                    ── The confirmation names who it is going to (issue 5) ─────────────
                    One click used to start a real WhatsApp send with nothing in between and no
                    indication of the recipient. A payment chase to the wrong person is not
                    recoverable by an undo.
                  */
                  confirmTitle={`Send ${r.studentName} a payment reminder?`}
                  confirmBody={`A WhatsApp message goes to ${r.studentPhone} asking for the ${money2(r.balance, ccy)} still outstanding.`}
                  // L6: the control knows this person was already chased, so a second reminder
                  // has to be deliberate rather than a stray second click. `sentAt`, not `at`:
                  // a skipped attempt never reached them, so it must not read as "Sent".
                  lastSentAt={w?.sentAt ?? null}
                />
              ) : (
                <span className="text-caption text-muted" title="Add a phone number on the student record to send reminders">
                  No phone number
                </span>
              )
            )}
          </span>
        );
      },
      value: (r) => waStatus[r.id]?.status ?? "",
    },
    {
      key: "actions", header: "", sortable: false,
      cell: (r) => (
        <span className="flex gap-2 whitespace-nowrap">
          {/* First, and named for the thing people come to this tab to do. */}
          <Btn variant="soft" size="sm" onClick={() => setDetailId(r.id)}>
            {r.balance.inr > 0 ? "Collect" : "Open"}
          </Btn>
          <Btn variant="ghost" size="sm" onClick={() => setEmiRowId(r.id)}>
            EMI{r.instalments.length ? ` ${r.instalments.filter((i) => i.status === "PAID").length}/${r.instalments.length}` : ""}
          </Btn>
          {/* Scrolls to the form and tints the row (issue 21) - opening the editor from a row
              far down the table otherwise looked like a click that did nothing. */}
          <Btn variant="ghost" size="sm" onClick={() => startEdit(r)}>Edit</Btn>
          {/* "Archive", because that is what it does - the row moves to the Archived tab and
              can be restored for 90 days. The dialog has always said so; the button did not. */}
          <Btn variant="danger" size="sm" onClick={() => remove(r)}>Archive</Btn>
        </span>
      ),
      value: () => null,
    },
  ];

  /**
   * The section's own bottom line: of everything owed, how much is in and how much is still out.
   * Only rows that can still owe money count - a DROPPED or PAID_IN_FULL plan would otherwise
   * inflate both sides and make the collected share meaningless.
   */
  const owingRows = visibleRows.filter((r) => r.status === "ACTIVE" || r.status === "OVERDUE");
  const totals = owingRows.reduce(
    (a, r) => ({
      toCollect: { inr: a.toCollect.inr + r.toCollect.inr, eur: a.toCollect.eur + r.toCollect.eur },
      collected: { inr: a.collected.inr + r.paidSoFar.inr, eur: a.collected.eur + r.paidSoFar.eur },
      balance: { inr: a.balance.inr + r.balance.inr, eur: a.balance.eur + r.balance.eur },
    }),
    {
      toCollect: { inr: 0, eur: 0 },
      collected: { inr: 0, eur: 0 },
      balance: { inr: 0, eur: 0 },
    },
  );
  /**
   * Each student's surplus counted ONCE, not once per plan.
   *
   * `unapplied` is a student-level figure carried on every one of that student's rows (see
   * getPendingRows), so summing the column would multiply it by their plan count.
   */
  const unappliedTotal = [
    ...new Map(owingRows.map((r) => [r.studentId ?? r.studentName.trim().toLowerCase(), r.unapplied])).values(),
  ].reduce((a, m) => ({ inr: a.inr + m.inr, eur: a.eur + m.eur }), { inr: 0, eur: 0 });

  const collectedPct =
    totals.toCollect.inr > 0 ? Math.round((totals.collected.inr / totals.toCollect.inr) * 100) : 0;
  const overdueCount = owingRows.filter((r) => r.overdue).length;

  return (
    <section className="space-y-4">
      {owingRows.length > 0 && (
        <Card title="Collected vs still to collect" subtitle={`Across ${owingRows.length} open plan${owingRows.length === 1 ? "" : "s"} - fee plus any instalment extra.`}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {[
              { label: "Total to collect", m: totals.toCollect, tone: "text-ink" },
              { label: "Collected", m: totals.collected, tone: "text-good" },
              { label: "Still to collect", m: totals.balance, tone: overdueCount ? "text-bad" : "text-ink" },
            ].map((c) => (
              <div key={c.label}>
                <p className="text-caption text-muted">{c.label}</p>
                <p className={`tnum text-h2 font-semibold ${c.tone}`}>{money(c.m, ccy)}</p>
                <p className="tnum text-caption text-muted">{money(c.m, ccy === "INR" ? "EUR" : "INR")}</p>
              </div>
            ))}
          </div>
          {/*
            ── Money that fits on none of this student's plans (issue 3) ─────────────
            Real payments, in the bank, that every open plan is already full of. It used to be
            invisible: the per-student sum was handed to every plan, so a surplus simply read as
            "nothing left to collect" on all of them. Surfacing it is how somebody knows to raise
            the receivable it belongs to.
          */}
          {unappliedTotal.inr > 0 && (
            <p className="mt-3 rounded-field border border-line bg-surface-2 px-3 py-2 text-caption text-ink-2">
              <strong className="tnum text-ink">{money(unappliedTotal, ccy)}</strong> has been
              received from these students beyond what their open plans ask for. Either it is for a
              receivable nobody has raised yet, or a plan&apos;s fee is understated.
            </p>
          )}
          {/* One bar, so "how far through the money are we" is answered without arithmetic. */}
          <div className="mt-4">
            <div
              className="h-2 w-full overflow-hidden rounded-full bg-surface-2"
              role="img"
              aria-label={`${collectedPct}% of the total collected`}
            >
              <div className="h-full rounded-full bg-good transition-[width] duration-500" style={{ width: `${collectedPct}%` }} />
            </div>
            <p className="mt-1.5 text-caption text-muted">
              {collectedPct}% collected
              {overdueCount > 0 && ` · ${overdueCount} plan${overdueCount === 1 ? "" : "s"} overdue`}
            </p>
          </div>
        </Card>
      )}

      <Card
        title={editing ? `Edit pending payment - ${editing.studentName}` : "Raise a receivable"}
        subtitle="What a student has AGREED to pay - not money received. Enter the agreed total fee only; payments come in through Collect on the row, or on the Income tab. “Collected” is whatever has been credited to this plan: name the plan on the income entry, or leave it and the student's payments fill their oldest plan first."
        actions={
          editing ? (
            <Btn variant="ghost" size="sm" onClick={() => { setEditing(null); setLevelChoice(null); }}>
              Cancel edit
            </Btn>
          ) : undefined
        }
      >
        <form ref={formRef} action={submit} key={editing?.id ?? "new"}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {/*
            ── Searchable, and it submits the id (not just the text) ────────────────
            This was a bare text box. A receivable raised through it linked to no student record,
            which is why its row could never offer a WhatsApp reminder - the number lives on the
            student, reached through this id - and why the detail panel reported "Not on the
            record" for people who are plainly on the roster.

            The same control the income form uses, so the two ways of naming a payer behave
            alike: type freely for somebody not yet on the roster, or pick to link.
          */}
          <Field
            label="Student name"
            hint={`Search by name, student ID or programme - ${
              formLine === "B2" ? "B2" : "German Note"
            } students only`}
          >
            <ComboBox
              options={studentsForLine}
              nameText="studentName"
              nameValue="studentId"
              required
              placeholder="Search or type a name"
              defaultText={editing?.studentName ?? ""}
              defaultValue={editing?.studentId ?? ""}
              key={`student-${editing?.id ?? "new"}`}
            />
          </Field>
          <Field label="Programme level">
            <Select
              name="programLevel"
              options={levelOptions}
              value={formLevel}
              onChange={(e) => setLevelChoice(e.target.value)}
            />
          </Field>
          <AmountPair
            fxRate={fxRate}
            fxStale={fxStale}
            fxDate={fxDate}
            inrName="totalFeeInr"
            eurName="totalFeeEur"
            inrLabel="Total fee agreed (₹)"
            eurLabel="Total fee agreed (€)"
            baseHint="INR, EUR, or both"
            defaultInr={editing ? minorToInput(editing.totalFeeInrRaw) : ""}
            defaultEur={editing ? minorToInput(editing.totalFeeEurRaw) : ""}
          />
          <Field label="Next payment due date">
            <TextInput type="date" name="nextDueDate" defaultValue={editing?.nextDueDate?.slice(0, 10) ?? ""} />
          </Field>
          <Field label="Status">
            <Select name="status" options={optionsFrom(PENDING_STATUS_LABELS)} defaultValue={editing?.status ?? "ACTIVE"} />
          </Field>
          {/* Counts down the last characters instead of silently swallowing them (issue 18). */}
          <NotesField defaultValue={editing?.notes ?? ""} key={`notes-${editing?.id ?? "new"}`} />
        </div>
        <div className="mt-4 flex items-center gap-3">
          <SubmitButton>{editing ? "Save changes" : "Add pending payment"}</SubmitButton>
          <FormError message={error} />
        </div>
        </form>
      </Card>

      <DataTable
        rows={visibleRows}
        columns={columns}
        csvName="pending-payments"
        filterPlaceholder="Filter pending payments…"
        rowClassName={(r) =>
          // Being edited wins over overdue: it is the more immediate fact about the row, and
          // the red tint is still carried by the Overdue badge in the status column.
          r.id === editing?.id ? "bg-accent-soft" : r.overdue ? "bg-risk-soft" : undefined
        }
      />

      <ReceivableDetailModal planId={detailId} onClose={() => setDetailId(null)} />

      {emiRow && (
        <EmiScheduleModal
          row={emiRow}
          config={instalmentPlans}
          onClose={() => setEmiRowId(null)}
          onError={setError}
        />
      )}
    </section>
  );
}

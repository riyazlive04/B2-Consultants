"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  BookOpen, CalendarClock, ExternalLink, Mail, Phone, Receipt, Wallet,
} from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Btn } from "@/components/ui/controls";
import { SkeletonBlock } from "@/components/ui/Skeleton";
import { Field, FormError, NotesField, Select, SubmitButton, TextInput } from "@/components/ui/form";
import { SignalBadge } from "@/components/ui/SignalBadge";
import { SendWhatsAppButton } from "@/components/ui/SendWhatsAppButton";
import { StudentName } from "@/components/ui/StudentName";
import { toast } from "@/components/ui/feedback";
import { safeAction } from "@/lib/action-guard";
import { formatDate, formatEurMinor, formatInrMinor } from "@/lib/format";
import { optionsFrom, PENDING_STATUS_LABELS } from "@/lib/labels";
import { getReceivableDetail, type ReceivableDetail } from "@/server/receivable-detail";
import { createIncome, resolveReceivable } from "@/server/finance-actions";
import { setInstalmentStatus } from "@/server/emi-actions";
import { sendPaymentReminderMsg } from "@/server/whatsapp-actions";
import { getRecordFormData, type RecordFormData } from "@/server/record-form-data";
import { IncomeFields } from "@/components/finance/IncomeFields";
import { useIncomeDraft } from "@/components/finance/useIncomeDraft";
import type { IncomeFormCatalogues } from "@/lib/income-form";

/**
 * ONE OVERDUE BALANCE, OPENED FROM THE SCREEN THAT NAMED IT.
 *
 * ── What it replaces ──────────────────────────────────────────────────────────────
 * Cash Health's age analysis drew a bar per student and linked it to `/finance?pending=<id>`.
 * Nothing has ever read that query parameter, so the click did three unhelpful things at once:
 * left the page, landed on the Finance Income tab, and highlighted nothing. The two receivables
 * tables beside it did not react to a click at all. In every case the next move - find out who
 * this is, see what they bought, then do something about it - meant starting again somewhere
 * else from a name you had to remember.
 *
 * ── What "resolve it from here" means ─────────────────────────────────────────────
 * There are only four honest endings for an overdue balance, and all four are on this panel:
 *
 *   · the money arrived and was never recorded   → Record the payment (the real Finance form,
 *                                                   already pointed at this plan)
 *   · an instalment of it arrived                 → tick that instalment paid
 *   · it is still coming, later than agreed       → move the due date, and say why
 *   · it is never coming / it is already settled  → change the status
 *
 * Chasing is here too, because the fifth thing anyone does with this screen is send a reminder,
 * and the number to send it to is a fact about this record.
 *
 * ── Why the payment form is the real one ──────────────────────────────────────────
 * It renders `IncomeFields` over `useIncomeDraft` and posts to `createIncome`, exactly as the
 * Finance page and the shell's Quick Record do. A third income form would be the third
 * implementation of a contract whose last two copies quietly diverged on the plan link, the
 * offline guard and the duplicate-payment check - see the header of `lib/income-form`. The only
 * thing this one does differently is open with the student and the plan already answered, which
 * is the entire reason for recording it from here rather than anywhere else.
 */

type Money2 = { inr: number; eur: number };

/** ₹ over €, and the € line only when there is one - this panel is on ₹-only screens. */
function Amount({ m, className = "" }: { m: Money2; className?: string }) {
  return (
    <span className={`tnum ${className}`}>
      {formatInrMinor(m.inr)}
      {m.eur > 0 && <span className="block text-caption font-normal text-muted">{formatEurMinor(m.eur)}</span>}
    </span>
  );
}

function Chip({ children, tone = "muted" }: { children: React.ReactNode; tone?: "muted" | "accent" }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-caption font-semibold ${
        tone === "accent" ? "bg-accent-soft text-accent" : "bg-surface-2 text-ink-2"
      }`}
    >
      {children}
    </span>
  );
}

function SectionTitle({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <h3 className="flex items-center gap-1.5 text-label font-semibold uppercase text-muted">
      {icon}
      {children}
    </h3>
  );
}

const LINK_LABEL: Record<ReceivableDetail["payments"][number]["link"], string> = {
  THIS_PLAN: "this plan",
  UNLINKED: "no plan named",
  OTHER_PLAN: "another plan",
};

export function ReceivableDetailModal({
  planId,
  onClose,
}: {
  /** The receivable to show, or null for "closed". */
  planId: string | null;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<ReceivableDetail | null>(null);
  const [loadState, setLoadState] = useState<"idle" | "loading" | "error" | "denied">("idle");
  const [error, setError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);

  const load = useCallback(async (id: string) => {
    setLoadState("loading");
    try {
      const d = await getReceivableDetail(id);
      if (!d) {
        setLoadState("denied");
        return;
      }
      setDetail(d);
      setLoadState("idle");
    } catch {
      setLoadState("error");
    }
  }, []);

  useEffect(() => {
    if (!planId) {
      // Cleared on close so reopening a DIFFERENT student never flashes the last one's figures
      // while the fetch is in flight - on this panel that misread is a payment chased to the
      // wrong person, which is the mistake the student code elsewhere exists to prevent.
      setDetail(null);
      setError(null);
      setRecording(false);
      setLoadState("idle");
      return;
    }
    void load(planId);
  }, [planId, load]);

  /** After any write: the page revalidates itself, and this panel re-reads so it agrees with it. */
  const reload = useCallback(() => {
    if (planId) void load(planId);
  }, [planId, load]);

  const d = detail;

  return (
    <Modal
      open={!!planId}
      onClose={onClose}
      title={d ? d.student.name : "Receivable"}
      subtitle={
        d
          ? `${d.course.levelLabel} · ${d.course.lineLabel} · ${
              d.overdue ? `${d.schedule.daysOverdue} days late` : d.statusLabel
            }`
          : undefined
      }
      size="lg"
    >
      {loadState === "denied" ? (
        <p className="py-6 text-center text-sm text-muted">
          You don&apos;t have access to this receivable.
        </p>
      ) : loadState === "error" ? (
        <div className="space-y-3 py-4 text-center">
          <p className="text-sm text-muted">Couldn&apos;t load this receivable.</p>
          <Btn variant="secondary" size="sm" onClick={reload}>Try again</Btn>
        </div>
      ) : !d ? (
        <div className="space-y-3 py-2">
          <SkeletonBlock className="h-16 w-full" />
          <SkeletonBlock className="h-24 w-full" />
          <SkeletonBlock className="h-32 w-full" />
        </div>
      ) : (
        <div className="space-y-6">
          <WhoAndWhat d={d} />
          <TheMoney d={d} />
          <Schedule d={d} onError={setError} onChanged={reload} />
          <Payments d={d} />

          <div className="space-y-3">
            <SectionTitle icon={<Wallet size={13} />}>Resolve it</SectionTitle>

            <div className="flex flex-wrap items-center gap-2">
              <Btn
                variant={recording ? "secondary" : "primary"}
                size="sm"
                onClick={() => setRecording((v) => !v)}
              >
                {recording ? "Hide payment form" : "Record a payment"}
              </Btn>
              {/* Same rule as the receivables table: no number, no button - a click whose only
                  possible outcome is a skip is worse than saying so (issue 5). */}
              {d.money.balance.inr <= 0 ? null : d.student.phone ? (
                <SendWhatsAppButton
                  action={() => sendPaymentReminderMsg(d.id)}
                  label="Send a reminder"
                  variant="button"
                  confirmTitle={`Send ${d.student.name} a payment reminder?`}
                  confirmBody={`A WhatsApp message goes to ${d.student.phone} asking for the ${formatInrMinor(d.money.balance.inr)} still outstanding.`}
                />
              ) : (
                <span className="text-caption text-muted">
                  No phone number on the student record - a reminder can&apos;t be sent.
                </span>
              )}
            </div>

            {recording && (
              <RecordPaymentForm
                d={d}
                onDone={() => {
                  setRecording(false);
                  reload();
                }}
              />
            )}

            <ResolveForm d={d} error={error} onError={setError} onSaved={reload} />
          </div>
        </div>
      )}
    </Modal>
  );
}

/** Who this is and what they bought - the two questions a name and an amount cannot answer. */
function WhoAndWhat({ d }: { d: ReceivableDetail }) {
  return (
    <div className="rounded-card border border-line bg-surface-2 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-display text-h3">
            <StudentName name={d.student.name} code={d.student.code} />
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <Chip tone="accent">
              <BookOpen size={11} /> {d.course.levelLabel}
            </Chip>
            <Chip>{d.course.lineLabel}</Chip>
            {d.overdue ? (
              <SignalBadge level="risk" size="sm" label={`${d.schedule.daysOverdue} days late`} />
            ) : (
              <Chip>{d.statusLabel}</Chip>
            )}
          </div>
        </div>
        {d.student.id && (
          <Link
            href={`/students/${d.student.id}`}
            className="inline-flex flex-none items-center gap-1 text-sm font-semibold text-accent hover:underline"
          >
            Open student record <ExternalLink size={13} />
          </Link>
        )}
      </div>

      <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
        <Row label="Phone">
          {d.student.phone ? (
            <span className="inline-flex items-center gap-1.5">
              <Phone size={12} className="text-muted" /> {d.student.phone}
            </span>
          ) : (
            <span className="text-muted">Not on the record</span>
          )}
        </Row>
        <Row label="Email">
          {d.student.email ? (
            <span className="inline-flex min-w-0 items-center gap-1.5">
              <Mail size={12} className="flex-none text-muted" />
              <span className="truncate">{d.student.email}</span>
            </span>
          ) : (
            <span className="text-muted">Not on the record</span>
          )}
        </Row>
        <Row label="Debt raised">{formatDate(d.raisedOn)}</Row>
        {/*
          The enrolment, when the plan is linked to one. This is the difference between "they owe
          for Guided" and "they are IN Guided, with this coach, at this milestone" - which is what
          decides whether a chase is a reminder or a conversation. Absent for a receivable raised
          without an enrolment, which is common and not an error, so it simply does not appear.
        */}
        {d.enrollment && (
          <>
            <Row label="Enrolled">{formatDate(d.enrollment.enrolledOn)}</Row>
            {d.enrollment.batchName && <Row label="Batch">{d.enrollment.batchName}</Row>}
            {d.enrollment.coach && <Row label="Coach">{d.enrollment.coach}</Row>}
            <Row label="Progress">
              {d.enrollment.milestone.replace(/_/g, " ").toLowerCase()} · {d.enrollment.status.toLowerCase()}
            </Row>
          </>
        )}
      </dl>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 items-baseline gap-2">
      <dt className="flex-none text-muted">{label}</dt>
      <dd className="min-w-0 truncate font-medium text-ink-2">{children}</dd>
    </div>
  );
}

function TheMoney({ d }: { d: ReceivableDetail }) {
  const { money } = d;
  return (
    <div className="space-y-2">
      <SectionTitle icon={<Receipt size={13} />}>The money</SectionTitle>
      <div className="grid grid-cols-1 gap-4 rounded-card border border-line p-4 sm:grid-cols-3">
        <div>
          <p className="text-caption text-muted">To collect</p>
          <Amount m={money.toCollect} className="text-h3 font-semibold" />
          {money.planExtra.inr > 0 && (
            <p className="text-caption text-muted">
              fee {formatInrMinor(money.totalFee.inr)} + {formatInrMinor(money.planExtra.inr)} plan extra
            </p>
          )}
        </div>
        <div>
          <p className="text-caption text-muted">Collected</p>
          <Amount m={money.collected} className="text-h3 font-semibold text-good" />
        </div>
        <div>
          <p className="text-caption text-muted">Still to collect</p>
          <Amount m={money.balance} className={`text-h3 font-semibold ${d.overdue ? "text-bad" : "text-ink"}`} />
        </div>
      </div>
      {/*
        Both surpluses, spelled out rather than folded away. "Collected" is capped at this plan's
        own total so the three figures above add up (FIN-12); without these two lines the capping
        would quietly hide money that genuinely arrived.
      */}
      {money.overpaid.inr > 0 && (
        <p className="rounded-field border border-line bg-surface-2 px-3 py-2 text-caption text-ink-2">
          <strong className="tnum text-ink">{formatInrMinor(money.overpaid.inr)}</strong> was credited
          to this plan beyond its total - the extra is not counted in &ldquo;Collected&rdquo; above.
        </p>
      )}
      {money.unapplied.inr > 0 && (
        <p className="rounded-field border border-line bg-surface-2 px-3 py-2 text-caption text-ink-2">
          <strong className="tnum text-ink">{formatInrMinor(money.unapplied.inr)}</strong> has been
          received from {d.student.name} that fits on none of their open plans. Either it pays a
          receivable nobody has raised, or a plan&apos;s fee is understated.
        </p>
      )}
    </div>
  );
}

function Schedule({
  d,
  onError,
  onChanged,
}: {
  d: ReceivableDetail;
  onError: (m: string | null) => void;
  onChanged: () => void;
}) {
  const { schedule } = d;
  return (
    <div className="space-y-2">
      <SectionTitle icon={<CalendarClock size={13} />}>Where it stands</SectionTitle>
      <p className="text-sm text-ink-2">
        {schedule.nextDueDate ? (
          <>
            Next due <strong>{formatDate(schedule.nextDueDate)}</strong>
            {d.overdue && <span className="text-bad"> · {schedule.daysOverdue} days late</span>}
          </>
        ) : (
          <span className="text-muted">
            No due date has been set, so nothing here can be late and no reminder can be scheduled.
            Setting one below is the fix.
          </span>
        )}
        {schedule.intervalDays ? ` · every ${schedule.intervalDays} days` : ""}
      </p>

      {schedule.instalments.length === 0 ? (
        <p className="rounded-field border border-dashed border-line px-3 py-2 text-caption text-muted">
          No instalment schedule - this is a single balance. A schedule can be generated from the
          Finance page&apos;s EMI panel.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {schedule.instalments.map((it) => (
            <li
              key={it.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-field border border-line bg-surface-2 px-3 py-2 text-sm"
            >
              <span className="font-medium">#{it.seq}</span>
              {/* Full precision, not compact: six instalments of ₹1,666.83 displayed as ₹1,667
                  made a ₹10,001 fee read as ₹10,002 (issue 24). */}
              <span className="tnum">{formatInrMinor(it.inr)}</span>
              <span className="text-xs text-muted">
                due {formatDate(it.dueDate)}
                {it.paidDate ? ` · paid ${formatDate(it.paidDate)}` : ""}
              </span>
              <div className="ml-auto">
                <Select
                  value={it.status}
                  size="sm"
                  aria-label={`Instalment ${it.seq} status`}
                  onChange={async (ev) => {
                    onError(null);
                    const res = await safeAction(() => setInstalmentStatus(it.id, ev.target.value));
                    if (!res.ok) return onError(res.error);
                    toast("Instalment updated");
                    onChanged();
                  }}
                  options={[
                    { value: "DUE", label: "Due" },
                    { value: "PAID", label: "Paid" },
                    { value: "OVERDUE", label: "Overdue" },
                  ]}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * What has actually come in from this person.
 *
 * The question behind every overdue balance is "did they really not pay?", and the commonest
 * answer here is that they did and the entry never named the plan. Each row says which plan it
 * names, so a balance that looks wrong can be read rather than guessed at.
 */
function Payments({ d }: { d: ReceivableDetail }) {
  if (d.payments.length === 0) {
    return (
      <div className="space-y-2">
        <SectionTitle icon={<Receipt size={13} />}>What&apos;s come in</SectionTitle>
        <p className="rounded-field border border-dashed border-line px-3 py-3 text-sm text-muted">
          No payment has ever been recorded from {d.student.name}. If money did arrive, record it
          below - that, not the status, is what clears the balance.
        </p>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <SectionTitle icon={<Receipt size={13} />}>
        What&apos;s come in ({d.payments.length})
      </SectionTitle>
      <ul className="max-h-64 space-y-1.5 overflow-y-auto pr-1">
        {d.payments.map((p) => (
          <li
            key={p.id}
            className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-field border border-line px-3 py-2 text-sm"
          >
            <span className="tnum font-semibold">{formatInrMinor(p.amount.inr)}</span>
            <span className="text-xs text-muted">
              {formatDate(p.date)} · {p.typeLabel} · {p.methodLabel} · {p.levelLabel}
            </span>
            <span className="ml-auto">
              <Chip tone={p.link === "THIS_PLAN" ? "accent" : "muted"}>{LINK_LABEL[p.link]}</Chip>
            </span>
          </li>
        ))}
      </ul>
      {d.payments.some((p) => p.link === "UNLINKED") && (
        <p className="text-caption text-muted">
          A payment that names no plan is still credited - to this student&apos;s oldest open plan
          first, capped at what that plan is owed. Naming the plan on the entry is what makes it
          land where you intend.
        </p>
      )}
    </div>
  );
}

/** Status, due date and the reason - the three things this panel is allowed to change. */
function ResolveForm({
  d,
  error,
  onError,
  onSaved,
}: {
  d: ReceivableDetail;
  error: string | null;
  onError: (m: string | null) => void;
  onSaved: () => void;
}) {
  return (
    <form
      // Keyed on the plan so reopening a different student never inherits the last one's answers.
      key={d.id}
      action={async (form) => {
        onError(null);
        const res = await safeAction(() => resolveReceivable(d.id, form));
        if (!res.ok) return onError(res.error);
        toast("Receivable updated");
        onSaved();
      }}
      className="rounded-card border border-line p-4"
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field
          label="Status"
          hint={
            d.money.balance.inr > 0
              ? "“Paid in full” needs a zero balance - record the payment and it follows on its own."
              : undefined
          }
        >
          <Select name="status" options={optionsFrom(PENDING_STATUS_LABELS)} defaultValue={d.storedStatus} />
        </Field>
        <Field label="Next payment due" hint="Push the date when they have agreed a new one.">
          <TextInput type="date" name="nextDueDate" defaultValue={d.schedule.nextDueDate?.slice(0, 10) ?? ""} />
        </Field>
      </div>
      <div className="mt-1">
        <NotesField
          label="Why (optional)"
          defaultValue={d.notes ?? ""}
          placeholder="Promised to pay after salary on the 5th"
          hint="Kept on the receivable, so the next person chasing it knows what was agreed."
        />
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <SubmitButton>Save</SubmitButton>
        <FormError message={error} />
      </div>
    </form>
  );
}

/**
 * The Finance income form, opened on this student and this plan.
 *
 * Its dependencies (FX rate, roster, levels, open plans) load on first expand rather than with
 * the page - the Cash Health screen should not pay for a form most visits never open.
 */
function RecordPaymentForm({ d, onDone }: { d: ReceivableDetail; onDone: () => void }) {
  const [data, setData] = useState<RecordFormData | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "idle" | "error">("loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    getRecordFormData()
      .then((v) => {
        if (!live) return;
        if (v) {
          setData(v);
          setLoadState("idle");
        } else {
          setLoadState("error");
        }
      })
      .catch(() => live && setLoadState("error"));
    return () => {
      live = false;
    };
  }, []);

  const catalogues: IncomeFormCatalogues | null = useMemo(
    () =>
      data
        ? {
            levelOptions: data.levelOptions,
            levelLines: data.levelLines,
            paymentTypes: data.paymentTypes,
            instalmentPlans: data.instalmentPlans,
            studentOptions: data.studentOptions,
            openPlans: data.openPlans,
            nextStudentCodes: data.nextStudentCodes,
            today: data.today,
            // This plan's own book, not whatever the operator last filtered to: the payment is
            // settling THIS receivable, and its level already decides where the money lands.
            defaultLine: d.course.line,
          }
        : null,
    /**
     * `d.course.line` IS a dependency, and leaving it out was a live correctness hole.
     *
     * `data` is fetched once on mount (the effect above has an empty dep list), so it never
     * changes again. That means a memo keyed on `[data]` alone is computed exactly once - and
     * if `d` is then swapped for another receivable while this form stays mounted, the form
     * keeps the FIRST receivable's `defaultLine`.
     *
     * `defaultLine` decides which book the money is filed to. Filing German Note income into
     * the B2 book is not a cosmetic bug, it is the one this codebase has already shipped once
     * (see the note on `defaultLine` in lib/income-defaults) - which is why this is pinned
     * rather than silenced with an eslint-disable.
     */
    [data, d.course.line],
  );

  if (loadState === "error") {
    return (
      <p className="rounded-field border border-line px-3 py-3 text-sm text-muted">
        Couldn&apos;t load the payment form - you may not have permission to record finance entries.
      </p>
    );
  }
  if (!catalogues || !data) {
    return (
      <div className="space-y-2">
        <SkeletonBlock className="h-10 w-full" />
        <SkeletonBlock className="h-24 w-full" />
      </div>
    );
  }
  return (
    <SeededIncomeForm
      d={d}
      data={data}
      catalogues={catalogues}
      error={error}
      onError={setError}
      onDone={onDone}
    />
  );
}

/**
 * Split out so the draft hook is created only once the catalogues exist.
 *
 * `useIncomeDraft` seeds from `cat.today`, and a hook cannot be called conditionally - mounting
 * this child after the fetch is what lets the parent render a skeleton without breaking that rule.
 */
function SeededIncomeForm({
  d,
  data,
  catalogues,
  error,
  onError,
  onDone,
}: {
  d: ReceivableDetail;
  data: RecordFormData;
  catalogues: IncomeFormCatalogues;
  error: string | null;
  onError: (m: string | null) => void;
  onDone: () => void;
}) {
  // Create-only: editing an existing entry belongs beside its row on the Finance page.
  const { draft, patch, reset, derived } = useIncomeDraft(null, catalogues);

  /**
   * The three answers this panel already knows, pre-filled: who is paying, which receivable it
   * settles, and at which level. Everything else - amount, type, method, date - is the
   * operator's, exactly as on the Finance page.
   *
   * `reset` rather than `patch`, and keyed on the plan, so opening the form for a second student
   * in the same session starts from empty rather than from the previous one's answers.
   */
  useEffect(() => {
    reset({
      student: { text: d.student.name, value: d.student.id ?? "" },
      pendingPaymentId: d.id,
      programLevel: d.course.level,
      businessLine: d.course.line,
      // Minting a student while recording makes no sense here: this receivable's payer either
      // already has a record or is deliberately name-only, and either way the answer exists.
      mintStudent: false,
    });
  }, [d.id, d.student.name, d.student.id, d.course.level, d.course.line, reset]);

  const nameOptions = useMemo(
    () => [...data.studentOptions, ...data.payerOptions],
    [data.studentOptions, data.payerOptions],
  );

  return (
    <form
      action={async (form) => {
        onError(null);
        const res = await safeAction(() => createIncome(form));
        if (!res.ok) return onError(res.error);
        toast("Payment recorded");
        onDone();
      }}
      className="rounded-card border border-accent/40 bg-accent-soft/30 p-4"
    >
      <p className="mb-3 text-caption text-muted">
        Already pointed at <strong className="text-ink-2">{d.course.levelLabel}</strong> for{" "}
        <strong className="text-ink-2">{d.student.name}</strong>, so this payment lands on this
        receivable and not on another of theirs.
      </p>
      <IncomeFields
        draft={draft}
        patch={patch}
        derived={derived}
        editing={null}
        catalogues={catalogues}
        nameOptions={nameOptions}
        canCreateStudent={false}
        fxRate={data.fxRate}
        fxStale={data.fxStale}
        fxDate={data.fxDate}
      />
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <SubmitButton>Record the payment</SubmitButton>
        <FormError message={error} />
      </div>
    </form>
  );
}

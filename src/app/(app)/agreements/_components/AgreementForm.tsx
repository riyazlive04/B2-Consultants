"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { ComboBox } from "@/components/ui/ComboBox";
import { Field, FormError, Select, TextArea, TextInput } from "@/components/ui/form";
import { MoneyInput } from "@/components/ui/MoneyInput";
import { toast } from "@/components/ui/feedback";
import { Btn } from "@/components/ui/controls";
import { type AgreementData } from "@/lib/agreement";
import {
  AGREEMENT_MAX_INSTALMENTS,
  AGREEMENT_MIN_INSTALMENTS,
  agreementDueDates,
  agreementPlanTotal,
  agreementShares,
} from "@/lib/agreement-plan";
import { DUE_DATE_SCHEME_LABELS, type DueDateScheme } from "@/lib/instalment-dates";
import { instalmentExtraFor } from "@/lib/instalment-plan";
import type { InstalmentPlanConfig } from "@/lib/config-schema";
import { fillFromAttendee } from "@/lib/attendee-fill";
import { BATCH_TIMING_LABELS } from "@/lib/batch";
import type { MeetingAttendee } from "@/server/agreement-metrics";
import type { AgreementBatchOption } from "@/server/batches";
import { formatInrMinor, majorStringToMinor, minorToMajorString } from "@/lib/format";
import { createAgreement, updateAgreement } from "@/server/agreement-actions";
import { DocumentChooser, type UsableTemplate } from "./DocumentChooser";
import { PhoneField } from "@/components/ui/PhoneField";

/**
 * The founder's field form. Everything the master document leaves variable, and nothing else -
 * clause text lives in the renderer, not in a database column a typo can reach.
 *
 * The instalment total is checked here AND in `agreementDataSchema` on the server. The client
 * check exists so the founder sees the mismatch as they type; the server check exists because the
 * client one is advisory.
 *
 * ── §7 WORKS THE WAY THE INCOME FORM WORKS ───────────────────────────────────────
 * It used to be: click "Add instalment", type an amount, type a milestone, four more times, then
 * check the sum by hand. The income entry form had already retired all of that - say how many
 * instalments, and the amounts, the plan surcharge and the due dates fall out of the fee - and a
 * contract is the LAST place those numbers should be retyped, because here they are binding.
 *
 * So the plan is now DERIVED and then editable, which is the same two-step the income form uses:
 *   - the count builds the rows and splits the fee (`agreementShares`, remainder on the last);
 *   - the Console's price for a plan of that length pre-fills the surcharge (`instalmentExtraFor`);
 *   - a bigger first instalment re-cuts the rest instead of being thrown away;
 *   - the dates follow the programme start on one of the two rules a plan is ever agreed on
 *     (`agreementDueDates`), and every box stays the founder's to overwrite.
 *
 * The arithmetic itself lives in `lib/agreement-plan` (pure, tested) and reuses the same
 * `splitInstalments` / `dueDateFor` the income side divides by, so a plan quoted on one screen
 * and written on the other cannot differ by a paise or a day.
 */

type Mode = { kind: "create"; leadId: string | null; studentId: string | null } | { kind: "edit"; id: string };

/** Rupees in the inputs, minor units in the payload - the same split the ledger uses. */
const toMajor = (minor: string) => minorToMajorString(BigInt(minor)).replace(/\.00$/, "");
const toMinor = (major: string) => majorStringToMinor(major).toString();
const minorOf = (major: string) => majorStringToMinor(major.trim() || "0");

/** One row of the plan as the form holds it. */
type InstRow = { amount: string; due: string; date: string };

/**
 * What §7.2 of the master calls the first two instalments. Anything past that is numbered, because
 * the template has no agreed wording for it and inventing legal phrasing here is not this form's
 * job - the founder types what was actually agreed.
 */
const MILESTONES = [
  "Before commencement of Week 1",
  "Before the commencement of 2nd Sprint Week",
];
const milestoneFor = (i: number) => MILESTONES[i] ?? `Instalment ${i + 1}`;

/** Prefill field keys (server/agreement-metrics.ts) → what the founder calls them. */
const PREFILL_FIELD_LABELS: Record<string, string> = {
  fullName: "Full name",
  email: "Email",
  phone: "WhatsApp number",
  address: "Postal address",
  batchNumber: "Batch",
  batchStartDate: "Start date",
  payment: "Fee & plan",
};

export function AgreementForm({
  initial,
  mode,
  notes,
  missing,
  filled,
  instalmentPlans,
  attendees = [],
  templates,
  defaultTemplateId = null,
  batches = [],
  batchId = null,
  suggested,
}: {
  initial: AgreementData;
  mode: Mode;
  notes?: string[];
  /** Fields the CRM had no answer for - the founder must type these. */
  missing?: string[];
  /** Field keys filled from the CRM, so we can say so instead of making them re-check everything. */
  filled?: string[];
  /**
   * The founder's plan prices (Console → Instalment plans). Optional so the edit screen can
   * render without them; the surcharge box then simply opens empty rather than pre-filled.
   */
  instalmentPlans?: InstalmentPlanConfig;
  /** Everybody who has sat through a discovery call - what the name box suggests. */
  attendees?: MeetingAttendee[];
  /**
   * The uploaded templates this draft could be drawn up on (create mode only).
   *
   * Empty means the founder has not uploaded any, and the chooser is not shown at all - the
   * Guided Mode clause set is the default and always has been, so an app with no templates looks
   * exactly as it did before this feature existed.
   */
  templates?: UsableTemplate[];
  /**
   * Which of them the founder set as the default (`agreementWorkflow.defaultTemplateId`), so the
   * form opens on the same document one tap would have sent. Null is the guided clause set.
   */
  defaultTemplateId?: string | null;
  /**
   * The cohorts §2.1 can name - every ACTIVE batch on both lines, in offer order (what starts
   * next, then what is running). Defaults to empty, and the box is then the plain text field it
   * has always been: an app with no batches on file must not lose the ability to type one.
   */
  batches?: AgreementBatchOption[];
  /** Which of them the prefill resolved to, so the chooser opens on it. */
  batchId?: string | null;
  /**
   * Fields answered by an inference rather than by a record - the batch, when nothing on file
   * says which cohort this person is joining. Said out loud as its own line, because "filled
   * from the record" would be a claim the record does not support.
   */
  suggested?: string[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  /**
   * WHICH DOCUMENT this agreement is drawn up on. `null` is the Guided Mode clause set.
   *
   * Only offered while creating: changing it afterwards means attaching a different document to
   * an existing draft, which is the detail screen's job (and has a confirmation, because it
   * replaces the contract body).
   */
  const [templateId, setTemplateId] = useState<string | null>(defaultTemplateId ?? null);

  const [fullName, setFullName] = useState(initial.student.fullName);
  const [address, setAddress] = useState(initial.student.address);
  const [phone, setPhone] = useState(initial.student.phone);
  const [email, setEmail] = useState(initial.student.email);
  const [batchNo, setBatchNo] = useState(initial.batch.number);
  const [startDate, setStartDate] = useState(initial.batch.startDate);

  const [option, setOption] = useState<"FULL" | "INSTALMENT">(initial.payment.option);
  const [total, setTotal] = useState(toMajor(initial.payment.totalInrMinor));
  const [fullDue, setFullDue] = useState(
    initial.payment.option === "FULL" ? initial.payment.dueMilestone : "Before commencement of Week 1",
  );
  const [inst, setInst] = useState<InstRow[]>(
    initial.payment.option === "INSTALMENT"
      ? initial.payment.instalments.map((i) => ({
          amount: toMajor(i.amountInrMinor),
          due: i.dueMilestone,
          date: i.dueDate ?? "",
        }))
      : MILESTONES.map((due) => ({ amount: "", due, date: "" })),
  );
  /**
   * How many instalments the fee is split into - the question that now BUILDS the rows, exactly
   * as it does on the income form. Seeded from the plan already on the record so re-opening a
   * draft shows the plan it holds, not a blank count beside four filled rows.
   */
  const [count, setCount] = useState<number>(
    initial.payment.option === "INSTALMENT" ? initial.payment.instalments.length : MILESTONES.length,
  );
  /** The plan surcharge, as typed. Pre-filled from the Console's price for this plan length. */
  const [extra, setExtra] = useState(
    initial.payment.option === "INSTALMENT" && initial.payment.planExtraInrMinor
      ? toMajor(initial.payment.planExtraInrMinor)
      : "",
  );
  /**
   * Whether the founder has taken the surcharge over. Until they have, it follows the Console's
   * price for the chosen plan length; afterwards it is theirs, because a plan agreed at a
   * different charge is a normal thing to agree and re-imposing the list price would undo it on
   * the next keystroke anywhere else in the form.
   */
  const [extraTouched, setExtraTouched] = useState(
    initial.payment.option === "INSTALMENT" && !!initial.payment.planExtraInrMinor,
  );
  /**
   * The first instalment AS TYPED, or null for "nobody has said - divide equally".
   *
   * Null is not zero. This is the income form's `firstInstalment` under another name, and it
   * exists for the same reason: the single commonest plan the business sells is a larger payment
   * up front with the balance spread, and deriving every instalment from "total ÷ count" made
   * that plan unwritable without hand-editing every row and re-checking the sum.
   */
  const [firstOverride, setFirstOverride] = useState<string | null>(() => {
    /*
      Seeded from a plan that is ALREADY uneven, so the derivation does not flatten it.

      The prefill opens on §7.2's own default - 43,999 then 26,000 of a 69,999 fee, which is not
      an equal split - and a draft being re-opened may hold any plan the founder negotiated. With
      nothing pinned, the first thing this form would do on mount is re-cut both into 35,000 and
      35,000: a term changed by rendering the screen, which is the one thing a contract form may
      never do. Pinning the first instalment reproduces the stored plan exactly (the rest is
      re-cut from what is left, which IS what is left), and "Split equally" unpins it.

      An already-equal plan is deliberately NOT pinned: there is nothing to preserve, and pinning
      it would stop the first instalment following the fee when the price is changed.
    */
    if (initial.payment.option !== "INSTALMENT") return null;
    const rows = initial.payment.instalments;
    const first = rows[0];
    if (!first) return null;
    const stored = rows.map((r) => BigInt(r.amountInrMinor));
    const even = agreementShares(
      stored.reduce((a, b) => a + b, BigInt(0)),
      BigInt(0),
      rows.length,
    );
    const alreadyEven = even.length === stored.length && even.every((v, i) => v === stored[i]);
    return alreadyEven ? null : toMajor(first.amountInrMinor);
  });
  /** Fill the dates and amounts in, on one of the two rules a plan is actually agreed on. */
  const [autoFill, setAutoFill] = useState(mode.kind === "create");
  const [scheme, setScheme] = useState<DueDateScheme>("MONTH_FIRST");

  /**
   * The attendees as the name box offers them. The option's `value` is its index, not the lead
   * id: a booking that was never linked to a lead carries no id at all, and two of those would
   * collide on "" and make the second unpickable.
   */
  const attendeeOptions = useMemo(
    () =>
      attendees.map((a, i) => ({
        value: String(i),
        label: a.name,
        // Searchable alongside the name, so "9876" or an email address finds the right person.
        hint: a.phone || a.email || undefined,
        meta: [a.met, a.email].filter(Boolean).join(" · "),
      })),
    [attendees],
  );

  /**
   * What a PICK last wrote into the contact boxes, so a later pick can correct it.
   *
   * Not state: nothing on screen reads it, and making it state would re-render the whole form on
   * every pick to no effect.
   */
  const injected = useRef({ phone: "", email: "" });

  /**
   * Picking somebody fills the two fields their booking actually knows.
   *
   * ── WHOSE NUMBER WINS ────────────────────────────────────────────────────────
   * Never over something a person put there. A form opened from the client picker arrives
   * prefilled from the CRM record, and that record is the better source - overwriting a student's
   * current number with one they typed into a booking form months ago silently downgrades the
   * field the signing link and the OTP are both sent to.
   *
   * But a value THIS control wrote is not such a value, and treating it as one was a real bug:
   * picking Priya and then correcting yourself to Arun left the form reading "Arun Mehta" beside
   * Priya's WhatsApp number, which is the single worst way to get this wrong - the agreement goes
   * out, and the one-time code that signs it is delivered to somebody else's phone. So a box
   * still holding the last pick's answer is replaced by this one's, INCLUDING when the new
   * booking has nothing to put there: a blank is honest, and the previous person's number is not.
   */
  const onNamePick = (next: { text: string; value: string }) => {
    setFullName(next.text);
    const picked = next.value === "" ? null : attendees[Number(next.value)];
    if (!picked) return;
    /*
      DECIDED HERE, FROM PLAIN VALUES - never inside a setState updater.

      The first attempt made this decision in `setPhone(cur => ...)`, reading `injected.current`
      from within it. React runs an updater during a LATER render, by which time the assignment
      below had already replaced the ref, so every pick compared the previous number against
      itself-as-just-overwritten, found no match and kept the stale one. The rule only makes
      sense against the values that were true at the moment of the pick, so it is evaluated
      against them (lib/attendee-fill, where it is also tested).
    */
    const filled = fillFromAttendee({
      current: { phone, email },
      injected: injected.current,
      picked: { phone: picked.phone, email: picked.email },
    });
    injected.current = { phone: picked.phone, email: picked.email };
    setPhone(filled.phone);
    setEmail(filled.email);
  };

  /**
   * ── THE BATCH BOX: a chooser over the real cohorts ────────────────────────────────
   * `label` is what goes into the contract (the founders' code, "B26"); everything else is there
   * to be read and searched - the level, whether it is running or starting, and how many seats
   * are gone, which is the question that decides whether this person can join it at all.
   */
  const batchOptions = useMemo(
    () =>
      batches.map((b) => ({
        value: b.id,
        label: b.label,
        // Searchable beside the label, so "Pflege" or "July" finds the cohort by its full name.
        hint: b.name === b.label ? undefined : b.name,
        meta: [
          BATCH_TIMING_LABELS[b.timing],
          b.startDate ? `starts ${b.startDate}` : null,
          b.levelLabel,
          `${b.capacityLabel} seats`,
          b.lineLabel,
        ]
          .filter(Boolean)
          .join(" · "),
      })),
    [batches],
  );

  /**
   * The start date THIS control last wrote, so a second pick can correct its own first answer
   * without ever overwriting one that came from the CRM or from the founder's keyboard.
   *
   * Seeded only when the prefill's date demonstrably came from the resolved cohort. The student
   * branch of the prefill also fills this field from an ENROLMENT date, and that value is not
   * ours to replace: every instalment due date is counted forward from it.
   */
  const injectedStart = useRef(
    (() => {
      const opened = batches.find((b) => b.id === batchId);
      return opened?.startDate && opened.startDate === initial.batch.startDate ? opened.startDate : "";
    })(),
  );

  const onBatchPick = (next: { text: string; value: string }) => {
    setBatchNo(next.text);
    const picked = next.value ? batches.find((b) => b.id === next.value) : undefined;
    // No cohort behind the text, or a cohort with no start date of its own: the box is the
    // founder's typed label and the date stays whatever it was. A blank start date would take
    // the whole instalment schedule with it, so it is never written back.
    if (!picked?.startDate) return;
    // Decided from plain values, NOT inside a setState updater - see `onNamePick` on why an
    // updater that reads this ref compares the previous answer against itself.
    const replaceable = startDate === "" || startDate === injectedStart.current;
    injectedStart.current = picked.startDate;
    if (replaceable) setStartDate(picked.startDate);
  };

  const totalMinor = minorOf(total);
  const extraMinor = minorOf(extra);
  /** The Console's price for a plan of this length - what the surcharge box opens on. */
  const pricedExtra = instalmentPlans ? instalmentExtraFor(count, instalmentPlans).inr : BigInt(0);
  /** Fee + surcharge: what the plan has to collect, and what the rows are reconciled against. */
  const planTotalMinor = agreementPlanTotal(totalMinor, extraMinor);

  const shares = useMemo(
    () =>
      agreementShares(
        totalMinor,
        extraMinor,
        count,
        firstOverride === null ? null : minorOf(firstOverride),
      ),
    // bigints are compared by value, so this re-derives only when a figure actually changes.
    [totalMinor, extraMinor, count, firstOverride],
  );
  const dates = useMemo(() => agreementDueDates(scheme, startDate, count), [scheme, startDate, count]);

  /**
   * Adopt the Console's price when the plan LENGTH changes - the one answer that re-prices the
   * surcharge. Deliberately not keyed on the fee: the charge is flat, and re-filling it on every
   * digit of a price would fight whoever is typing.
   */
  useEffect(() => {
    if (extraTouched) return;
    setExtra(pricedExtra > BigInt(0) ? toMajor(pricedExtra.toString()) : "");
  }, [pricedExtra, extraTouched]);

  /**
   * Re-fill the rows whenever the shape of the plan changes - the count, the fee, the surcharge,
   * the start date or the spacing rule.
   *
   * Three things it deliberately does NOT do:
   *   - run while the tick-box is off, so a hand-built schedule is never overwritten;
   *   - touch the FIRST amount once it has been typed (`firstOverride`), because the derived
   *     value and the half-typed one disagree between keystrokes and the box would fight back;
   *   - replace a milestone that already says something. The wording is the term the student
   *     signs; only an empty one gets the template's default.
   *
   * `shares` and `dates` are fresh arrays each render, so the effect keys off their CONTENT -
   * keying on the arrays would re-run on every keystroke anywhere in the form.
   */
  const sharesKey = shares.join("|");
  const datesKey = dates.join("|");
  useEffect(() => {
    if (!autoFill) return;
    const amounts = sharesKey ? sharesKey.split("|") : [];
    const days = datesKey ? datesKey.split("|") : [];
    setInst((cur) =>
      Array.from({ length: count }, (_, i) => ({
        amount:
          i === 0 && firstOverride !== null
            ? (cur[i]?.amount ?? "")
            : amounts[i]
              ? toMajor(amounts[i])
              : (cur[i]?.amount ?? ""),
        date: days[i] ?? cur[i]?.date ?? "",
        due: cur[i]?.due || milestoneFor(i),
      })),
    );
  }, [autoFill, count, sharesKey, datesKey, firstOverride]);

  /** Patch one row. Whether that edit also stops the auto-fill is the caller's call - see below. */
  const setRow = (i: number, patch: Partial<InstRow>) => {
    setInst((p) => p.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  };

  const partsMinor = inst.reduce((a, i) => a + minorOf(i.amount), BigInt(0));
  /**
   * Does the plan add up? Measured from the ROWS, against the fee PLUS the surcharge.
   *
   * Still a hard gate rather than the income form's warning, and that difference is deliberate:
   * an income entry stores whatever its parts say, while `agreementDataSchema` refuses a plan
   * that does not sum. Letting the save through to be rejected by the server would teach the
   * founder nothing they could not be told here.
   */
  const sumMismatch = useMemo(() => {
    if (option !== "INSTALMENT" || planTotalMinor === BigInt(0)) return null;
    if (partsMinor === planTotalMinor) return null;
    return extraMinor > BigInt(0)
      ? `The instalments add up to ${formatInrMinor(partsMinor)}, but the fee plus the plan charge is ${formatInrMinor(planTotalMinor)}.`
      : `Instalments add up to ${formatInrMinor(partsMinor)}, but the total fee is ${formatInrMinor(planTotalMinor)}.`;
  }, [option, partsMinor, planTotalMinor, extraMinor]);

  /**
   * A plan with a blank due date is a payment nothing will ever chase. Said, not discovered.
   *
   * Gated on NEW plans, and on drafts that already carry dates - never on a draft drawn up before
   * §7 had a date column. Those are valid contracts whose dates the schema still treats as
   * optional, and refusing to save an unrelated typo in one until its schedule is rebuilt would
   * be this change breaking work it has nothing to do with. The prompt still shows, and the
   * tick-box above fills them in one click.
   */
  const dateless =
    initial.payment.option === "INSTALMENT" && initial.payment.instalments.every((i) => !i.dueDate);
  const requireDates = mode.kind === "create" || !dateless;
  const missingDates = option === "INSTALMENT" && inst.some((r) => !r.date.trim());

  function build(): AgreementData {
    const student = { fullName, address, phone, email };
    const batch = { number: batchNo, startDate };
    const payment: AgreementData["payment"] =
      option === "FULL"
        ? { option: "FULL", totalInrMinor: toMinor(total), dueMilestone: fullDue }
        : {
            option: "INSTALMENT",
            totalInrMinor: toMinor(total),
            instalments: inst.map((i) => ({
              amountInrMinor: toMinor(i.amount),
              dueMilestone: i.due,
              // Omitted, never "" - the schema's `dueDate` is optional precisely so an agreement
              // without one hashes as it always did, and an empty string is a value.
              ...(i.date.trim() ? { dueDate: i.date } : {}),
            })),
            // Same rule: a plan with no charge must not carry the key at all.
            ...(extraMinor > BigInt(0) ? { planExtraInrMinor: extraMinor.toString() } : {}),
          };
    return { student, batch, payment } as AgreementData;
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const data = build();
    startTransition(async () => {
      const res =
        mode.kind === "create"
          ? await createAgreement({
              data,
              leadId: mode.leadId,
              studentId: mode.studentId,
              templateId,
            })
          : await updateAgreement(mode.id, data);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      toast(mode.kind === "create" ? "Draft agreement created" : "Draft updated");
      const id = mode.kind === "create" ? (res.data as { id: string }).id : mode.id;
      router.push(`/agreements/${id}`);
      router.refresh();
    });
  }

  const filledLabels = [...new Set(filled ?? [])].map((k) => PREFILL_FIELD_LABELS[k] ?? k);

  return (
    <form onSubmit={submit} className="space-y-6">
      {mode.kind === "create" && templates && templates.length > 0 && (
        <DocumentChooser
          templates={templates}
          value={templateId}
          defaultTemplateId={defaultTemplateId ?? null}
          onChange={setTemplateId}
        />
      )}

      {/* What the CRM answered, and what it couldn't. The founder should re-type only the second
          list - everything else is already on the record and re-asking for it is the bug this
          redesign exists to kill. */}
      {(filledLabels.length > 0 ||
        (missing && missing.length > 0) ||
        (suggested && suggested.length > 0)) && (
        <div className="space-y-1.5 rounded-card border border-line bg-surface-2 px-4 py-3 text-sm">
          {filledLabels.length > 0 && (
            <p style={{ color: "var(--good)" }}>
              <span className="font-semibold">Filled from the record:</span>{" "}
              <span className="text-ink-2">{filledLabels.join(", ")}</span>
            </p>
          )}
          {suggested && suggested.length > 0 && (
            <p style={{ color: "var(--warn)" }}>
              <span className="font-semibold">Suggested - worth a glance:</span>{" "}
              <span className="text-ink-2">{suggested.join(", ")}</span>
            </p>
          )}
          {missing && missing.length > 0 && (
            <p style={{ color: "var(--warn)" }}>
              <span className="font-semibold">Needs you:</span>{" "}
              <span className="text-ink-2">{missing.join(", ")}</span>
            </p>
          )}
        </div>
      )}

      {notes && notes.length > 0 && (
        <div className="rounded-field bg-warn-bg px-3 py-2 text-sm" style={{ color: "var(--warn)" }}>
          {notes.map((n) => (
            <p key={n}>{n}</p>
          ))}
        </div>
      )}

      <section className="rounded-card border border-line bg-surface p-5 shadow-card">
        <h2 className="mb-1 font-display text-h2 font-semibold">The Student</h2>
        <p className="mb-4 text-xs text-muted">
          These values are frozen into the agreement when you issue it. Editing the student record later never
          changes a signed contract.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          {/*
            ── The name, suggested from the people who have actually met us ──────────────
            The picker above this form starts from a CRM record and navigates; this is the other
            half of the same job, for the moment the founder is usually in - typing the name of
            somebody they have just come off a call with. Picking one brings their WhatsApp number
            and email with it, which are the two fields §2 and the signing link both need and the
            two most worth not retyping from memory.

            Free text still wins: a name that matches nobody is kept exactly as typed, because
            plenty of agreements are drawn up for people whose call was never logged.
          */}
          <Field
            label="Full name"
            hint={
              attendees.length > 0
                ? "Search the people who have attended a call - or type any name"
                : undefined
            }
          >
            <ComboBox
              options={attendeeOptions}
              // This form posts through a server action, not FormData, so the two inputs the
              // ComboBox renders are carriers only - `onStateChange` is what the form reads.
              nameText="studentFullName"
              nameValue="studentAttendee"
              required
              defaultText={initial.student.fullName}
              placeholder={attendees.length > 0 ? "Search or type the student's name" : "Type the student's name"}
              onStateChange={onNamePick}
              emptyHint="No call on file under that name - it will be used exactly as typed."
            />
          </Field>
          <Field label="WhatsApp number" hint="The signing link and code both go here.">
            {/* Controlled: the form holds `phone` itself, so no `name` - a hidden input would
                submit a second field of the same name alongside this state. */}
            <PhoneField defaultValue={phone} onChange={setPhone} required />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Postal address" hint="Printed in the agreement header (§2).">
              <TextArea value={address} onChange={(e) => setAddress(e.target.value)} required rows={2} maxLength={300} />
            </Field>
          </div>
          <Field label="Email (optional)">
            {/* 200, not the kind's 254: agreementDataSchema caps it there, and that schema also
                reads back already-signed agreements, so it isn't ours to loosen. */}
            <TextInput kind="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={200} />
          </Field>
        </div>
      </section>

      <section className="rounded-card border border-line bg-surface p-5 shadow-card">
        <h2 className="mb-1 font-display text-h2 font-semibold">Batch (§2.1)</h2>
        <p className="mb-4 text-xs text-muted">
          {batches.length > 0
            ? "The cohorts on file, next intake first. Picking one brings its start date with it."
            : "No cohorts on file yet - type the batch as it should read in the contract."}
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          {/*
            Free text underneath, always. `agreementDataSchema` keeps `batch.number` a string
            because it re-parses agreements signed before cohorts were a table - those say
            "Batch 12", and a <Select> would have made them unrepresentable. So this offers the
            real batches and still keeps whatever is typed.
          */}
          <Field
            label="Batch"
            hint={batches.length > 0 ? "Search by code, name or level - or type any label" : undefined}
          >
            {batches.length > 0 ? (
              <ComboBox
                options={batchOptions}
                // Carriers only: this form posts through a server action, and `onBatchPick` is
                // what the form actually reads.
                nameText="batchNumber"
                nameValue="batchId"
                required
                defaultText={batchNo}
                defaultValue={batchId ?? ""}
                placeholder="Search the cohorts, or type a label"
                onStateChange={onBatchPick}
                emptyHint="No cohort on file under that name - it will be used exactly as typed."
              />
            ) : (
              <TextInput value={batchNo} onChange={(e) => setBatchNo(e.target.value)} required placeholder="Batch 12" />
            )}
          </Field>
          <Field label="Programme start date" hint="Also the 12-month boundary in §6.">
            <TextInput type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required />
          </Field>
        </div>
      </section>

      <section className="rounded-card border border-line bg-surface p-5 shadow-card">
        <h2 className="mb-4 font-display text-h2 font-semibold">Payment (§7)</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Total programme price (₹)">
            <MoneyInput
              currency="INR"
              value={total}
              onValueChange={setTotal}
              required
              placeholder="69,999"
            />
          </Field>
          <Field label="Payment option">
            <Select
              value={option}
              onChange={(e) => setOption(e.target.value as "FULL" | "INSTALMENT")}
              options={[
                { value: "FULL", label: "Option A - Full payment" },
                { value: "INSTALMENT", label: "Option B - Instalment plan (2-6)" },
              ]}
            />
          </Field>
        </div>

        {option === "FULL" ? (
          <div className="mt-4">
            <Field label="Due milestone">
              <TextInput value={fullDue} onChange={(e) => setFullDue(e.target.value)} required maxLength={120} />
            </Field>
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            {/*
              ── The two answers that BUILD the plan ───────────────────────────────────
              Count and surcharge, asked the way the income form asks them. Everything below is
              derived from these plus the fee and the programme start, and then editable.
            */}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Number of instalments"
                hint={`How many instalments the fee is split into - ${AGREEMENT_MIN_INSTALMENTS} to ${AGREEMENT_MAX_INSTALMENTS}`}
              >
                <TextInput
                  kind="int"
                  value={String(count)}
                  placeholder="e.g. 3"
                  onChange={(e) => {
                    const n = Number.parseInt(e.currentTarget.value, 10);
                    if (!Number.isFinite(n)) return;
                    // Clamped rather than validated-on-submit: the count BUILDS the rows, so an
                    // out-of-range figure would silently draw a plan the schema will refuse.
                    setCount(
                      Math.min(AGREEMENT_MAX_INSTALMENTS, Math.max(AGREEMENT_MIN_INSTALMENTS, n)),
                    );
                    // A new length re-opens the whole plan: a first instalment agreed against
                    // three parts means nothing against six, and keeping it would leave the rest
                    // cut from a number nobody has looked at since.
                    setFirstOverride(null);
                    setAutoFill(true);
                  }}
                />
              </Field>
              <Field
                label="Extra price for the plan (₹)"
                hint={
                  !extraTouched && pricedExtra > BigInt(0)
                    ? `The Console price for a ${count}-part plan - change it if this one was agreed differently`
                    : "Added to the fee for paying in instalments, and stated in §7.1"
                }
              >
                <MoneyInput
                  currency="INR"
                  value={extra}
                  onValueChange={(v) => {
                    setExtraTouched(true);
                    setExtra(v);
                  }}
                  placeholder="0"
                />
              </Field>
            </div>

            {/*
              ── Fill them in for me ───────────────────────────────────────────────────
              The rule sits beside the tick-box rather than behind a second screen: which of the
              two it is changes every date below, so it has to be readable while you read them.
              Anchored on the PROGRAMME START, not on today - instalment 1 falls due at
              commencement, which is what "Before commencement of Week 1" has always meant.
            */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <label className="flex items-center gap-2 text-caption">
                <input
                  type="checkbox"
                  checked={autoFill}
                  onChange={(e) => setAutoFill(e.currentTarget.checked)}
                  className="h-4 w-4 rounded border-line"
                />
                <span className="font-medium text-ink">Fill the dates and amounts in for me</span>
              </label>
              <div className="flex items-center gap-1" role="group" aria-label="How the dates are spaced">
                {(Object.keys(DUE_DATE_SCHEME_LABELS) as DueDateScheme[]).map((k) => (
                  <button
                    key={k}
                    type="button"
                    aria-pressed={scheme === k}
                    onClick={() => {
                      setScheme(k);
                      setAutoFill(true);
                    }}
                    className={`rounded-full border px-2.5 py-1 text-caption font-medium transition-colors ${
                      scheme === k && autoFill
                        ? "border-primary bg-primary-soft text-primary-strong"
                        : "border-line text-muted hover:bg-surface-2 hover:text-ink"
                    }`}
                  >
                    {DUE_DATE_SCHEME_LABELS[k]}
                  </button>
                ))}
              </div>
              {autoFill && !startDate && (
                <span className="text-caption text-muted">
                  Set the programme start date above and the due dates appear.
                </span>
              )}
            </div>

            {/* What the plan collects, said once, so the surcharge is never a surprise in a column. */}
            {planTotalMinor > BigInt(0) && extraMinor > BigInt(0) && (
              <p className="rounded-card bg-surface-2 px-3 py-2 text-caption text-ink-2">
                <span className="font-medium text-ink">{formatInrMinor(totalMinor)}</span> fee +{" "}
                <span className="font-medium text-ink">{formatInrMinor(extraMinor)}</span> plan charge ={" "}
                <span className="font-medium text-ink">{formatInrMinor(planTotalMinor)}</span> collected over{" "}
                {count} instalments.
              </p>
            )}

            {inst.map((row, i) => (
              <div
                key={i}
                className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)_minmax(0,1.6fr)]"
              >
                <Field
                  label={`Instalment ${i + 1} price (₹)`}
                  hint={
                    i === 0
                      ? firstOverride !== null
                        ? "The rest of the plan is split over the remaining instalments"
                        : "An equal share by default - change it for a larger first payment"
                      : undefined
                  }
                >
                  <MoneyInput
                    currency="INR"
                    value={row.amount}
                    onValueChange={(v) => {
                      setRow(i, { amount: v });
                      /*
                        The FIRST row is special, and it is the whole reason this form can now
                        express the plan the business sells most: typing it re-cuts the rows below
                        from what is left, rather than switching the derivation off and leaving
                        them at a figure that no longer sums.

                        Any OTHER row is the founder taking the plan over - real plans land
                        unevenly - so the auto-fill stands down rather than overwriting them the
                        next time the fee or the start date moves.
                      */
                      if (i === 0) setFirstOverride(v);
                      else setAutoFill(false);
                    }}
                    required
                  />
                </Field>
                <Field label={`Instalment ${i + 1} due date`}>
                  <TextInput
                    type="date"
                    value={row.date}
                    onChange={(e) => {
                      setRow(i, { date: e.currentTarget.value });
                      setAutoFill(false);
                    }}
                    required
                  />
                </Field>
                <Field label={`Instalment ${i + 1} due milestone`}>
                  {/* The wording stays free text and stays the founder's: it is the TERM, and the
                      date beside it is only that term resolved. Editing it does not stand the
                      auto-fill down, because nothing here ever rewrites a milestone that speaks. */}
                  <TextInput
                    value={row.due}
                    onChange={(e) => setRow(i, { due: e.currentTarget.value })}
                    required
                    maxLength={120}
                  />
                </Field>
              </div>
            ))}

            {/* N3: the plan is 2-6 instalments, because that is what the business sells - 4 EMI
                on a bundle, 6 across three courses, and German Note runs up to 6 equal ones.
                N4: every amount, date and milestone stays editable, because offers are negotiated
                per student rather than picked from a fixed menu. */}
            <div className="flex flex-wrap items-center gap-3">
              <Btn
                type="button"
                variant="ghost"
                size="sm"
                // Puts the derivation back in charge after a hand edit - the one way out of a
                // half-edited plan that does not involve retyping every row.
                onClick={() => {
                  setFirstOverride(null);
                  setAutoFill(true);
                }}
              >
                Split equally
              </Btn>
              <span className="text-caption text-muted">
                {count} of {AGREEMENT_MAX_INSTALMENTS} · minimum {AGREEMENT_MIN_INSTALMENTS}
                {!autoFill && " · filling in by hand"}
              </span>
            </div>

            {missingDates && (
              <p className="rounded-field bg-warn-soft px-3 py-2 text-sm font-medium text-warn">
                {requireDates
                  ? "Every instalment needs a due date - it is the date the student is reminded on."
                  : "This draft predates due dates. Tick the box above to fill them in - it is the date the student is reminded on."}
              </p>
            )}
            {sumMismatch && (
              <p role="alert" className="rounded-field bg-risk-soft px-3 py-2 text-sm font-medium text-risk">
                {sumMismatch}
              </p>
            )}
          </div>
        )}
      </section>

      <FormError message={error} />

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending || !!sumMismatch || (missingDates && requireDates)}
          className="inline-flex h-10 items-center justify-center gap-1.5 rounded-btn bg-primary px-4 text-sm font-semibold text-on-accent transition-colors hover:bg-primary-strong disabled:opacity-60"
        >
          {pending && <Loader2 size={15} className="animate-spin" />}
          {mode.kind === "create" ? "Create draft" : "Save draft"}
        </button>
        <p className="text-xs text-muted">Nothing is sent yet - you countersign and issue on the next screen.</p>
      </div>
    </form>
  );
}

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, Hint } from "@/components/ui/kit";
import { SelectMenu } from "@/components/ui/SelectMenu";
import { toast } from "@/components/ui/feedback";
import { DIMENSION_LABELS, type QuestionOption } from "@/lib/qualification";
import type { IntakeMappingReport } from "@/server/intake-inspection";
import type { BantDimension, QuestionKind } from "@prisma/client";
import {
  createQualificationQuestion,
  updateQualificationQuestion,
  setQualificationQuestionActive,
  setQualificationScorer,
} from "@/server/qualification-actions";

/**
 * Qualification questions (Founder Console → Qualification) - ER v2 Track D.
 *
 * These questions produce the BANT verdict that decides WHO GETS CALLED, so the panel is
 * built to make two things impossible to miss:
 *
 *  1. THE CUTOVER GATE. The catalogue runs in SHADOW until a full historical replay agrees
 *     with the shipped scorer on every past booking. Until then the live form still scores
 *     from its original columns, and the banner says so - an admin editing questions here
 *     needs to know their edits are not yet live.
 *
 *  2. VERSIONING. Editing an ANSWERED question creates version N+1 rather than mutating it,
 *     because the wording is the evidence for a verdict already acted on. The row says so
 *     before you click, not after.
 */

export type AdminQuestion = {
  id: string;
  key: string;
  version: number;
  text: string;
  helpText: string | null;
  kind: QuestionKind;
  options: QuestionOption[];
  /** Field names an external form may use for this question - see the mapping fieldset. */
  inboundKeys: string[];
  dimension: BantDimension;
  weight: number;
  required: boolean;
  orderIndex: number;
  active: boolean;
  answerCount: number;
};

export type ShadowStatus = { total: number; scored: number; disagreements: number; readyToFlip: boolean };

/** Which scorer is live right now - see `qualificationConfigSchema`. */
export type ScorerMode = "shipped" | "catalogue";

/**
 * What the landing page actually sent, and what we failed to read.
 *
 * This panel is the reason the mapping is maintainable at all. Without it the founder is asked
 * to configure field names for a form they cannot see from here, and a mistake shows up only as
 * scores that are quietly too low - the failure mode that never gets reported because nothing
 * looks broken.
 */
/**
 * Which scorer is live, why it may not be switchable, and the switch itself.
 *
 * The three states are kept visually distinct because they mean very different things to the
 * person about to edit a score table: LIVE means their next save changes who gets called;
 * READY means it does not yet but one click would; BLOCKED means the catalogue and the shipped
 * tables disagree and nothing should move until that is resolved.
 */
function ScorerSwitch({ shadow, scorer }: { shadow: ShadowStatus; scorer: ScorerMode }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const live = scorer === "catalogue";

  const flip = (next: ScorerMode) =>
    start(async () => {
      const res = await setQualificationScorer(next);
      if (!res.ok) return toast(res.error, "error");
      toast(next === "catalogue" ? "These questions now decide the verdict" : "Reverted to the shipped scoring tables");
      router.refresh();
    });

  const tone = live
    ? "border-ok bg-ok-soft text-ok-ink"
    : shadow.readyToFlip
      ? "border-ok bg-ok-soft text-ok-ink"
      : "border-warn bg-warn-soft text-warn-ink";

  return (
    <div className={`flex flex-wrap items-center justify-between gap-3 rounded-field border px-4 py-3 text-sm ${tone}`}>
      <span className="min-w-0 flex-1">
        {live ? (
          <>
            <strong>These questions are live.</strong> Every new booking is scored from the table
            below, and a change here changes who gets called - and, while auto-disqualify is on,
            who is turned away.
          </>
        ) : shadow.scored === 0 ? (
          <>
            <strong>Not live - nothing scored yet.</strong> Bookings are scored by the shipped
            tables. The catalogue is recorded alongside for comparison, but a booking has to come
            in before there is any evidence it agrees.
          </>
        ) : shadow.disagreements > 0 ? (
          <>
            <strong>Not live - {shadow.disagreements} disagreement(s) across {shadow.scored} scored
            bookings.</strong>{" "}
            The catalogue has drifted from the shipped scorer. Re-seed it
            (<code>prisma/seed-qualification.ts</code>) before switching anything.
          </>
        ) : (
          <>
            <strong>Not live - but ready.</strong> The catalogue reproduces all {shadow.scored}{" "}
            historical verdicts exactly, so switching changes nothing today and everything you edit
            afterwards.
          </>
        )}
      </span>
      <button
        type="button"
        disabled={busy || (!live && !shadow.readyToFlip)}
        onClick={() => flip(live ? "shipped" : "catalogue")}
        className="flex-none rounded-btn border border-current px-3 py-1.5 text-sm font-medium disabled:opacity-50"
      >
        {busy ? "Saving…" : live ? "Revert to shipped scoring" : "Make these questions live"}
      </button>
    </div>
  );
}

function InboundReport({ report }: { report: IntakeMappingReport }) {
  const nothingWrong = report.unresolved.length === 0 && report.unmapped.length === 0;

  /**
   * The total failure, stated first and in plain words.
   *
   * Leads ARE arriving from a source that can carry answers, and NONE of them scored. That is not
   * "no submissions yet" - it is a mapping that matches nothing, and it is invisible in every
   * other panel because an unscored lead looks exactly like an unqualified one. Production ran
   * this way for months: 111 Pabbly leads, 13 questions configured, zero scores, nothing on any
   * screen saying so.
   */
  const { captured, scored } = report.coverage7d;
  const totalMiss = captured > 0 && scored === 0;

  return (
    <Card>
      <p className="text-caption font-semibold uppercase text-ink-3">
        What the landing page is sending
      </p>

      {totalMiss && (
        <p role="alert" className="mt-2 rounded-field border border-bad bg-bad-soft px-3 py-2.5 text-sm text-bad">
          <strong>No lead has been scored in the last 7 days.</strong> {captured} lead
          {captured === 1 ? "" : "s"} arrived from a form that should carry qualification answers,
          and not one produced a band score - so every discovery call is being prepared blind.
          Either the answers are not reaching us, or the field names below match no question.
          Start with &ldquo;Fields we are not reading&rdquo;.
        </p>
      )}
      {captured > 0 && scored > 0 && scored < captured && (
        <p className="mt-2 rounded-field border border-warn bg-warn-soft px-3 py-2 text-caption text-warn-ink">
          Last 7 days: <strong>{scored}</strong> of <strong>{captured}</strong> captured leads
          scored. The rest arrived without recognisable answers.
        </p>
      )}

      <p className="mt-1 text-caption text-ink-3">
        {report.inspected === 0 ? (
          captured === 0 ? (
            <>
              No opt-in submissions with qualification answers have arrived yet. Once Pabbly
              delivers one, its fields appear here.
            </>
          ) : (
            <>
              No submission has left readable evidence yet - the next delivery will populate this
              list even if nothing in it maps.
            </>
          )
        ) : (
          <>
            Last {report.inspected} submissions with answers · <strong>{report.scored}</strong>{" "}
            produced a score
            {report.lastCaptureAt && (
              <> · most recent {new Date(report.lastCaptureAt).toLocaleDateString("en-GB")}</>
            )}
          </>
        )}
      </p>

      {report.inspected > 0 && nothingWrong && !totalMiss && (
        <p className="mt-3 rounded-field border border-ok bg-ok-soft px-3 py-2 text-sm text-ok-ink">
          <strong>Every field is being read.</strong> Nothing arrived that we could not map.
        </p>
      )}

      {/* Answers that matched a question but no OPTION. Listed first: these leads DO have a
          score and it is too low, because the dimension scored nothing for want of an alias.
          An unmapped field is visible; a wrong score is not. */}
      {report.unresolved.length > 0 && (
        <div className="mt-3 rounded-field border border-warn bg-warn-soft p-3">
          <p className="text-sm font-semibold text-warn-ink">
            Answers we could not recognise - these prospects are scoring too low
          </p>
          <p className="mt-0.5 text-caption text-warn-ink">
            The question matched, the answer did not. Paste each value into that question&apos;s
            &ldquo;Answer wording&rdquo; box against the option it means.
          </p>
          <ul className="mt-2 space-y-1.5">
            {report.unresolved.map((u) => (
              <li key={u.questionKey} className="text-caption">
                <code className="font-semibold text-ink">{u.questionKey}</code>{" "}
                <span className="text-ink-3">({u.count} lead{u.count === 1 ? "" : "s"})</span>
                <span className="mt-0.5 flex flex-wrap gap-1">
                  {u.values.map((v) => (
                    <span key={v} className="rounded-full bg-surface px-2 py-0.5 font-mono text-ink-2">
                      {v}
                    </span>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {report.unmapped.length > 0 && (
        <details className="mt-3" open={report.unresolved.length === 0}>
          <summary className="cursor-pointer text-sm font-medium text-ink">
            Fields we are not reading ({report.unmapped.length})
          </summary>
          <p className="mt-1 text-caption text-ink-3">
            The form posts these and no question claims them. If one is a qualification answer,
            add its name to that question&apos;s &ldquo;Field names&rdquo; box. Most will be
            legitimate extras and can be ignored.
          </p>
          <ul className="mt-2 space-y-1">
            {report.unmapped.map((f) => (
              <li key={f.key} className="flex flex-wrap items-baseline gap-2 text-caption">
                <code className="font-semibold text-ink">{f.key}</code>
                <span className="text-ink-3">×{f.count}</span>
                {f.samples.length > 0 && (
                  <span className="truncate text-ink-3">e.g. &ldquo;{f.samples.join('", "')}&rdquo;</span>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </Card>
  );
}

export function QualificationPanel({
  questions,
  shadow,
  scorer,
  inbound,
}: {
  questions: AdminQuestion[];
  shadow: ShadowStatus;
  scorer: ScorerMode;
  inbound: IntakeMappingReport;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = () => startTransition(() => router.refresh());

  async function submit(fd: FormData, id: string | null) {
    setBusy(true);
    const res = id ? await updateQualificationQuestion(id, fd) : await createQualificationQuestion(fd);
    setBusy(false);
    if (!res.ok) return toast(res.error);
    setEditing(null);
    setAdding(false);
    toast(id ? "Question saved" : "Question added");
    refresh();
  }

  async function toggle(id: string, active: boolean) {
    setBusy(true);
    const res = await setQualificationQuestionActive(id, active);
    setBusy(false);
    if (!res.ok) return toast(res.error);
    toast(active ? "Question restored" : "Question retired");
    refresh();
  }

  const live = questions.filter((q) => q.active);
  const retired = questions.filter((q) => !q.active);

  return (
    <div className="space-y-5">
      <Hint>
        The booking form&apos;s qualification questions and how each answer scores. A dimension
        takes the <strong>best</strong> answer it has, not the sum - high income still counts
        toward Budget when the invest answer is lukewarm.
      </Hint>

      {/* The gate, and the switch it guards. Deliberately loud: an admin editing scores below
          needs to know in one glance whether those edits decide anything. */}
      <ScorerSwitch shadow={shadow} scorer={scorer} />

      <InboundReport report={inbound} />

      <Card>
        <div className="flex items-center justify-between">
          <p className="text-caption font-semibold uppercase text-ink-3">
            Live questions ({live.length})
          </p>
          <button
            type="button"
            onClick={() => { setAdding((a) => !a); setEditing(null); }}
            className="rounded-field border border-line px-3 py-1.5 text-sm font-medium text-ink hover:bg-surface-2"
          >
            {adding ? "Cancel" : "Add question"}
          </button>
        </div>

        {adding && <QuestionForm onSubmit={(fd) => submit(fd, null)} busy={busy} />}

        <div className="mt-4 space-y-2">
          {live.map((q) => (
            <div key={q.id} className="rounded-field border border-line p-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium text-ink">{q.text}</div>
                  <div className="mt-0.5 text-caption text-ink-3">
                    <code>{q.key}</code> · v{q.version} · {DIMENSION_LABELS[q.dimension]}
                    {q.dimension !== "NONE" && q.weight !== 1 ? ` · weight ${q.weight}` : ""}
                    {q.answerCount > 0 && (
                      <> · <strong>{q.answerCount} answered - editing creates v{q.version + 1}</strong></>
                    )}
                  </div>
                  {q.options.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {q.options.map((o) => (
                        <span key={o.value} className="rounded-full bg-surface-3 px-2 py-0.5 text-caption text-ink-2">
                          {o.label}
                          {q.dimension !== "NONE" && <span className="ml-1 text-ink-3">{o.score}</span>}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    onClick={() => { setEditing(editing === q.id ? null : q.id); setAdding(false); }}
                    className="rounded-field border border-line px-2 py-1 text-caption font-medium text-ink hover:bg-surface-2"
                  >
                    {editing === q.id ? "Cancel" : "Edit"}
                  </button>
                  <button
                    type="button"
                    onClick={() => toggle(q.id, false)}
                    disabled={busy}
                    className="rounded-field border border-line px-2 py-1 text-caption font-medium text-ink-2 hover:bg-surface-2 disabled:opacity-50"
                  >
                    Retire
                  </button>
                </div>
              </div>

              {editing === q.id && <QuestionForm question={q} onSubmit={(fd) => submit(fd, q.id)} busy={busy} />}
            </div>
          ))}
        </div>

        {retired.length > 0 && (
          <details className="mt-5">
            <summary className="cursor-pointer text-caption font-semibold uppercase text-ink-3">
              Retired ({retired.length})
            </summary>
            <div className="mt-2 space-y-1">
              {retired.map((q) => (
                <div key={q.id} className="flex items-center justify-between rounded-field border border-line px-3 py-2 text-sm">
                  <span className="text-ink-3">
                    {q.text} <span className="text-caption">(v{q.version}, {q.answerCount} answers)</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => toggle(q.id, true)}
                    disabled={busy}
                    className="rounded-field border border-line px-2 py-1 text-caption text-ink hover:bg-surface-2 disabled:opacity-50"
                  >
                    Restore
                  </button>
                </div>
              ))}
            </div>
          </details>
        )}
      </Card>
    </div>
  );
}

const DIMENSIONS: BantDimension[] = ["BUDGET", "AUTHORITY", "NEED", "TIMELINE", "NONE"];
const KINDS: QuestionKind[] = ["SELECT", "MULTI_SELECT", "BOOLEAN", "TEXT", "LONG_TEXT", "NUMBER"];

/**
 * Aliases are merged onto the options for reading, but stored in their own column - so the
 * Options JSON box must show them stripped, or a save would round-trip them back into the
 * frozen `options` value and the version guard would reject the next edit.
 */
function stripAliases(options: QuestionOption[]): Omit<QuestionOption, "aliases">[] {
  return options.map(({ value, label, score }) => ({ value, label, score }));
}

/** The alias editor's text form: one `value: alias, alias` line per option that has any. */
function aliasesToText(options: QuestionOption[]): string {
  return options
    .filter((o) => o.aliases?.length)
    .map((o) => `${o.value}: ${o.aliases!.join(", ")}`)
    .join("\n");
}

function QuestionForm({
  question,
  onSubmit,
  busy,
}: {
  question?: AdminQuestion;
  onSubmit: (fd: FormData) => void;
  busy: boolean;
}) {
  return (
    <form action={onSubmit} className="mt-3 grid gap-3 rounded-field border border-line bg-surface-2 p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-caption uppercase text-ink-3">
          Key
          <input
            name="key"
            defaultValue={question?.key}
            readOnly={!!question}
            required
            className="mt-1 w-full rounded-field border border-line bg-surface px-2 py-1 text-sm text-ink read-only:text-ink-3"
          />
        </label>
        <label className="text-caption uppercase text-ink-3">
          Dimension
          {/* SelectMenu (§5.5) - these two were the last raw <select>s in the console. */}
          <span className="mt-1 block">
            <SelectMenu
              name="dimension"
              aria-label="Dimension"
              defaultValue={question?.dimension ?? "NONE"}
              options={DIMENSIONS.map((d) => ({ value: d, label: DIMENSION_LABELS[d] }))}
            />
          </span>
        </label>
      </div>

      <label className="text-caption uppercase text-ink-3">
        Question text
        <input
          name="text"
          defaultValue={question?.text}
          required
          className="mt-1 w-full rounded-field border border-line bg-surface px-2 py-1 text-sm text-ink"
        />
      </label>

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-caption uppercase text-ink-3">
          Kind
          <span className="mt-1 block">
            <SelectMenu
              name="kind"
              aria-label="Kind"
              defaultValue={question?.kind ?? "SELECT"}
              options={KINDS.map((k) => ({ value: k, label: k }))}
            />
          </span>
        </label>
        <label className="text-caption uppercase text-ink-3">
          Weight
          <input
            name="weight"
            type="number"
            step="0.1"
            min={0}
            max={5}
            defaultValue={question?.weight ?? 1}
            className="mt-1 w-full rounded-field border border-line bg-surface px-2 py-1 text-sm text-ink"
          />
        </label>
        <label className="flex items-center gap-2 self-end text-sm text-ink-2">
          <input type="checkbox" name="required" defaultChecked={question?.required} value="true" />
          Required
        </label>
      </div>

      <label className="text-caption uppercase text-ink-3">
        Options - JSON: [{"{"}&quot;value&quot;,&quot;label&quot;,&quot;score&quot;{"}"}], score 0–5
        <textarea
          name="options"
          rows={4}
          defaultValue={JSON.stringify(stripAliases(question?.options ?? []), null, 0)}
          className="mt-1 w-full rounded-field border border-line bg-surface px-2 py-1 font-mono text-caption text-ink"
        />
      </label>

      {/* ── Inbound mapping ───────────────────────────────────────────────────────────────
          Editable even on an ANSWERED question without spawning a new version: these two fields
          change how an external form's wording is RECOGNISED, not what was asked or what it
          scored. See `updateQualificationQuestion`. */}
      <fieldset className="grid gap-3 rounded-field border border-line bg-surface p-3">
        <legend className="px-1 text-caption font-semibold uppercase text-ink-3">
          Landing-page mapping
        </legend>
        <p className="text-caption text-ink-3">
          What this question is called, and what its answers are called, on the form that feeds
          Pabbly. Capitalisation, spaces, dashes and underscores are ignored - only add an entry
          when the wording genuinely differs.
        </p>

        <label className="text-caption uppercase text-ink-3">
          Field names on the external form
          <input
            name="inboundKeys"
            defaultValue={(question?.inboundKeys ?? []).join(", ")}
            placeholder="when_start, timeline, When are you looking to start?"
            className="mt-1 w-full rounded-field border border-line bg-surface-2 px-2 py-1 font-mono text-caption text-ink"
          />
        </label>

        <label className="text-caption uppercase text-ink-3">
          Answer wording - one option per line, <code>value: text, text</code>
          <textarea
            name="answerAliases"
            rows={Math.max(3, question?.options.length ?? 3)}
            defaultValue={aliasesToText(question?.options ?? [])}
            placeholder={"immediately: Right away, ASAP\n3_months: Within 3 months"}
            className="mt-1 w-full rounded-field border border-line bg-surface-2 px-2 py-1 font-mono text-caption text-ink"
          />
        </label>
      </fieldset>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={busy}
          className="rounded-field bg-accent px-3 py-1.5 text-sm font-medium text-on-accent disabled:opacity-50"
        >
          {busy ? "Saving…" : question ? "Save" : "Add"}
        </button>
        {question && question.answerCount > 0 && (
          <span className="text-caption text-warn-ink">
            {question.answerCount} answers exist - this creates v{question.version + 1} and retires v{question.version}.
          </span>
        )}
      </div>
    </form>
  );
}

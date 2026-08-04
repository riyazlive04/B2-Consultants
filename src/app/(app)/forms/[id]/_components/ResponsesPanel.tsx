"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Download } from "lucide-react";
import type { FormDetail } from "@/server/forms-metrics";
import { answerToText, isStaticItem, type FormItem } from "@/lib/sites-types";
import type { QuestionSummary } from "@/lib/form-summary";
import { Card, CardTitle, Pill } from "@/components/ui/kit";
import { RankedBars } from "@/components/ui/chart";
import { SegmentedControl, IconButton } from "@/components/ui/controls";
import { DateText } from "@/components/ui/DateText";

/**
 * Responses — Google Forms' three views: Summary, Question-by-question and Individual.
 *
 * The old screen had one: a flat list showing the first six answers of the most recent hundred
 * submissions, truncated with no indication that it was truncating. That is fine for "did anything
 * arrive" and useless for "what did people say".
 *
 * The charts run on the shared chart layer (DS §5.8 forbids hand-rolled SVG), so they inherit the
 * app's colours, the empty state and the accessible caption rather than reinventing three of each.
 */
export function ResponsesPanel({ form }: { form: FormDetail }) {
  const [view, setView] = useState<"summary" | "individual">("summary");
  const [at, setAt] = useState(0);

  const questions = form.fields.filter((f) => !isStaticItem(f.type));

  if (form.submissionCount === 0) {
    return (
      <Card>
        <p className="text-sm text-ink-3">
          No responses yet.{" "}
          {form.published ? (
            <>
              The form is live at <span className="font-mono">/f/{form.slug}</span>.
            </>
          ) : (
            <>It is still a draft — publish it before sharing the link.</>
          )}
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl
          value={view}
          onChange={setView}
          options={[
            { value: "summary", label: "Summary" },
            { value: "individual", label: "Individual" },
          ]}
        />
        <div className="flex items-center gap-2">
          <span className="text-caption text-ink-3">
            {form.submissionCount.toLocaleString("en-IN")} response
            {form.submissionCount === 1 ? "" : "s"}
            {/* Said out loud, because a chart that quietly describes 5,000 of 12,000 responses
                while the heading says "responses" is the most believable wrong number there is. */}
            {form.summarised < form.submissionCount && (
              <> · charts cover the most recent {form.summarised.toLocaleString("en-IN")}</>
            )}
          </span>
          <a
            href={`/api/export/form-responses?formId=${form.id}&period=all`}
            className="inline-flex h-9 flex-none items-center gap-1.5 rounded-field border border-line bg-surface px-3 text-xs font-semibold text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
            title="Download every response, one column per question"
          >
            <Download size={14} /> Export CSV
          </a>
        </div>
      </div>

      {view === "summary" ? (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {form.summary.map((s) => (
            <QuestionSummaryCard key={s.item.id} summary={s} total={form.summarised} />
          ))}
          {form.summary.length === 0 && (
            <Card>
              <p className="text-sm text-ink-3">This form has no questions to summarise.</p>
            </Card>
          )}
        </div>
      ) : (
        <IndividualView form={form} questions={questions} at={at} setAt={setAt} />
      )}
    </div>
  );
}

function QuestionSummaryCard({ summary, total }: { summary: QuestionSummary; total: number }) {
  const { item, counts, samples, average, answered, multi } = summary;

  return (
    <Card
      title={<CardTitle>{item.label || item.key}</CardTitle>}
      actions={
        <Pill tone={answered === 0 ? "neutral" : "info"}>
          {answered} answered{item.required ? "" : " · optional"}
        </Pill>
      }
    >
      {counts && counts.length > 0 ? (
        <>
          <RankedBars
            rows={counts.map((c) => ({
              key: c.label,
              label: c.label,
              value: c.value,
              display: c.value.toLocaleString("en-IN"),
              // A share of RESPONDENTS, which is what people read a percentage as. Suppressed
              // for multi-select below, where the denominator isn't people.
              meta: total > 0 && !multi ? `${Math.round((c.value / total) * 100)}%` : undefined,
            }))}
            showShare={false}
            srCaption={`Answers to "${item.label || item.key}"`}
            emptyTitle="Nobody has answered this yet"
          />
          {multi && (
            <p className="mt-2 text-caption text-ink-3">
              People could tick more than one, so these add up to more than the number of responses.
            </p>
          )}
          {average != null && (
            <p className="mt-2 text-caption text-ink-3">Average {average.toFixed(1)}</p>
          )}
        </>
      ) : samples && samples.length > 0 ? (
        <>
          {average != null && (
            <p className="mb-2 text-sm text-ink-2">
              Average <b className="tnum">{average.toFixed(1)}</b>
            </p>
          )}
          {/* Free text gets verbatims, not bars: a hundred one-count bars looks like analysis
              and tells you nothing. */}
          <ul className="space-y-1.5">
            {samples.map((s, i) => (
              <li key={i} className="rounded-field bg-surface-2 px-3 py-2 text-sm text-ink-2">
                {s}
              </li>
            ))}
          </ul>
          {answered > samples.length && (
            <p className="mt-2 text-caption text-ink-3">
              and {answered - samples.length} more — the CSV has every one
            </p>
          )}
        </>
      ) : (
        <p className="text-sm text-ink-3">Nobody has answered this yet.</p>
      )}
    </Card>
  );
}

function IndividualView({
  form,
  questions,
  at,
  setAt,
}: {
  form: FormDetail;
  questions: FormItem[];
  at: number;
  setAt: (n: number) => void;
}) {
  const rows = form.submissions;
  const row = rows[at];
  if (!row) return <Card><p className="text-sm text-ink-3">Nothing to show.</p></Card>;

  return (
    <Card
      title={
        <CardTitle>
          {row.leadId ? (
            <Link href={`/contacts/${row.leadId}`} className="hover:text-primary">
              {row.leadName || "Contact"}
            </Link>
          ) : (
            answerToText(row.data["name"]) || "Anonymous"
          )}
        </CardTitle>
      }
      actions={
        <div className="flex items-center gap-1.5">
          <span className="text-caption text-ink-3">
            {at + 1} of {rows.length}
            {form.submissionCount > rows.length && ` (latest ${rows.length})`}
          </span>
          <IconButton label="Previous response" onClick={() => setAt(at - 1)} disabled={at === 0}>
            <ChevronLeft size={15} />
          </IconButton>
          <IconButton label="Next response" onClick={() => setAt(at + 1)} disabled={at >= rows.length - 1}>
            <ChevronRight size={15} />
          </IconButton>
        </div>
      }
    >
      <p className="mb-3 text-caption text-ink-3">
        <DateText date={row.createdAt} />
      </p>
      <dl className="divide-y divide-line">
        {questions.map((q) => {
          const v = answerToText(row.data[q.key]);
          return (
            <div key={q.id} className="grid grid-cols-1 gap-0.5 py-2 sm:grid-cols-[220px_1fr] sm:gap-3">
              <dt className="text-caption font-semibold uppercase tracking-wide text-ink-3">
                {q.label || q.key}
              </dt>
              {/* "No answer" rather than a blank cell: an unanswered optional question and a
                  question that was never shown look identical when both render as nothing. */}
              <dd className={v ? "text-sm text-ink" : "text-sm italic text-ink-3"}>{v || "No answer"}</dd>
            </div>
          );
        })}
      </dl>
    </Card>
  );
}

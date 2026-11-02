"use client";

import { useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Card, EmptyState, Pill, TableShell, Td, Th, Tr } from "@/components/ui/kit";
import { Btn } from "@/components/ui/controls";
import { Modal } from "@/components/ui/Modal";
import { Field, TextInput, TextArea, SubmitButton, FormError } from "@/components/ui/form";
import { SelectMenu } from "@/components/ui/SelectMenu";
import { toast } from "@/components/ui/feedback";
import {
  removeWeeklyQuestion,
  saveWeeklyQuestion,
  saveWeeklyTemplate,
} from "@/server/weekly-template-actions";

/**
 * THE QUESTION SETS - what each cohort is asked, and who is asked what.
 *
 * Two seeded sets ship: a B2 sprint report and a shorter German Note check-in. A founder
 * adds more here when a cohort is running something different, then points that cohort at
 * it from the Weekly Reports screen.
 *
 * ── Why "remove" says what it will do before you press it ────────────────────────────
 * A question that has been answered is never deleted - deleting it would delete a student's
 * own words. It stops being asked instead, and the weeks it WAS asked in still read
 * correctly. The row says which of the two will happen, because "Remove" meaning two
 * different things depending on invisible state is how people lose data they thought they
 * were tidying.
 */

export type TemplateQuestionView = {
  id: string;
  key: string;
  version: number;
  kind: string;
  metric: string;
  label: string;
  helpText: string | null;
  required: boolean;
  orderIndex: number;
  options: { value: string; label: string; numeric?: number | null }[] | null;
  allowOther: boolean;
  min: number | null;
  max: number | null;
  targetNumeric: number | null;
  answerCount: number;
};

export type TemplateView = {
  id: string;
  name: string;
  description: string | null;
  line: string;
  levelCode: string | null;
  active: boolean;
  cohortCount: number;
  questions: TemplateQuestionView[];
};

const KIND_LABELS: Record<string, string> = {
  NUMBER: "A number",
  SCALE: "A 1-5 scale",
  SINGLE_SELECT: "Pick one",
  MULTI_SELECT: "Pick any",
  YES_NO: "Yes or no",
  TEXT: "Short text",
  LONG_TEXT: "Long text",
};

const METRIC_LABELS: Record<string, string> = {
  APPLICATIONS: "Applications",
  INTERVIEWS: "Interviews",
  NETWORKING: "Networking contacts",
  LINKEDIN_POSTS: "LinkedIn posts",
  LEARNING_HOURS: "Learning hours",
  BLOCKERS: "Blockers",
  OTHER: "Not scored",
};

const CHOICE_KINDS = new Set(["SINGLE_SELECT", "MULTI_SELECT"]);

export function WeeklyTemplatesPanel({
  templates,
  levels,
}: {
  templates: TemplateView[];
  levels: { code: string; label: string; line: string }[];
}) {
  const [editingTemplate, setEditingTemplate] = useState<TemplateView | "new" | null>(null);
  const [editingQuestion, setEditingQuestion] = useState<
    { templateId: string; question: TemplateQuestionView | null } | null
  >(null);

  return (
    <div className="space-y-6">
      <Card
        title="Question sets"
        subtitle="What each cohort is asked every week. Point a cohort at one from Weekly Reports - a cohort with no choice of its own follows the set for its line and level."
        actions={
          <Btn variant="primary" icon={<Plus size={15} />} onClick={() => setEditingTemplate("new")}>
            New question set
          </Btn>
        }
      >
        {templates.length === 0 ? (
          <EmptyState
            title="No question sets yet"
            body="A cohort cannot be asked anything until one exists."
            action={
              <Btn variant="primary" onClick={() => setEditingTemplate("new")}>
                New question set
              </Btn>
            }
          />
        ) : (
          <div className="space-y-6">
            {templates.map((t) => (
              <div key={t.id} className="rounded-field border border-line">
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-3">
                  <div>
                    <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink">
                      {t.name}
                      <Pill tone={t.line === "B2" ? "primary" : "info"}>
                        {t.line === "B2" ? "B2" : "German Note"}
                      </Pill>
                      {t.levelCode && <Pill tone="neutral">{t.levelCode}</Pill>}
                      {!t.active && <Pill tone="warn">Switched off</Pill>}
                    </p>
                    {t.description && <p className="mt-0.5 text-caption text-muted">{t.description}</p>}
                    <p className="mt-0.5 text-caption text-ink-3">
                      {t.questions.length} question{t.questions.length === 1 ? "" : "s"} ·{" "}
                      {t.cohortCount === 0
                        ? "no cohort points at it directly"
                        : `${t.cohortCount} cohort${t.cohortCount === 1 ? "" : "s"} point at it`}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Btn size="sm" onClick={() => setEditingTemplate(t)}>
                      Edit set
                    </Btn>
                    <Btn
                      size="sm"
                      icon={<Plus size={14} />}
                      onClick={() => setEditingQuestion({ templateId: t.id, question: null })}
                    >
                      Add question
                    </Btn>
                  </div>
                </div>

                {t.questions.length === 0 ? (
                  <p className="px-4 py-4 text-sm text-muted">
                    No questions yet. A cohort pointed at this set would be sent an empty form.
                  </p>
                ) : (
                  <TableShell
                    minWidth={820}
                    head={
                      <>
                        <Th>#</Th>
                        <Th>Question</Th>
                        <Th>Answer</Th>
                        <Th>Counts as</Th>
                        <Th align="right">Target</Th>
                        <Th align="right">Answers</Th>
                        <Th>{""}</Th>
                      </>
                    }
                  >
                    {t.questions.map((q) => (
                      <Tr key={q.id}>
                        <Td className="tnum">{q.orderIndex + 1}</Td>
                        <Td>
                          <span className="font-medium text-ink">{q.label}</span>
                          <span className="block text-caption text-muted">
                            {q.key}
                            {q.version > 1 ? ` · v${q.version}` : ""}
                            {q.required ? "" : " · optional"}
                          </span>
                        </Td>
                        <Td>
                          {KIND_LABELS[q.kind] ?? q.kind}
                          {q.options && (
                            <span className="block text-caption text-muted">
                              {q.options.length} option{q.options.length === 1 ? "" : "s"}
                              {q.allowOther ? " + other" : ""}
                            </span>
                          )}
                        </Td>
                        <Td>{METRIC_LABELS[q.metric] ?? q.metric}</Td>
                        <Td align="right" className="tnum">
                          {q.targetNumeric ?? "-"}
                        </Td>
                        <Td align="right" className="tnum">
                          {q.answerCount}
                        </Td>
                        <Td>
                          <div className="flex justify-end gap-1">
                            <Btn
                              size="sm"
                              icon={<Pencil size={13} />}
                              onClick={() => setEditingQuestion({ templateId: t.id, question: q })}
                            >
                              Edit
                            </Btn>
                            <Btn
                              size="sm"
                              icon={<Trash2 size={13} />}
                              title={
                                q.answerCount > 0
                                  ? `Stops being asked. The ${q.answerCount} answer(s) already given are kept.`
                                  : "Deleted - nobody has answered it."
                              }
                              onClick={async () => {
                                const res = await removeWeeklyQuestion({ id: q.id });
                                toast(
                                  res.ok
                                    ? q.answerCount > 0
                                      ? "No longer asked. The answers already given are kept."
                                      : "Question removed."
                                    : res.error,
                                  res.ok ? "success" : "error",
                                );
                              }}
                            >
                              {q.answerCount > 0 ? "Stop asking" : "Remove"}
                            </Btn>
                          </div>
                        </Td>
                      </Tr>
                    ))}
                  </TableShell>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      {editingTemplate && (
        <TemplateModal
          template={editingTemplate === "new" ? null : editingTemplate}
          levels={levels}
          onClose={() => setEditingTemplate(null)}
        />
      )}
      {editingQuestion && (
        <QuestionModal
          templateId={editingQuestion.templateId}
          question={editingQuestion.question}
          nextIndex={
            templates.find((t) => t.id === editingQuestion.templateId)?.questions.length ?? 0
          }
          onClose={() => setEditingQuestion(null)}
        />
      )}
    </div>
  );
}

function TemplateModal({
  template,
  levels,
  onClose,
}: {
  template: TemplateView | null;
  levels: { code: string; label: string; line: string }[];
  onClose: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [line, setLine] = useState(template?.line ?? "B2");

  async function save(form: FormData) {
    setError(null);
    const res = await saveWeeklyTemplate({
      id: template?.id,
      name: String(form.get("name") ?? ""),
      description: String(form.get("description") ?? ""),
      line: String(form.get("line") ?? "B2"),
      levelCode: String(form.get("levelCode") ?? ""),
      active: String(form.get("active") ?? "yes"),
    });
    if (!res.ok) {
      setError(res.error);
      return;
    }
    toast(template ? "Question set updated." : "Question set created.");
    onClose();
  }

  return (
    <Modal open onClose={onClose} title={template ? "Edit question set" : "New question set"}>
      <form action={save} className="space-y-4">
        <FormError message={error} />
        <Field label="Name" required>
          <TextInput name="name" required defaultValue={template?.name ?? ""} kind="text" />
        </Field>
        <Field label="What it is for" hint="Shown to the student at the top of the form.">
          <TextArea name="description" rows={2} defaultValue={template?.description ?? ""} kind="text" />
        </Field>
        <Field label="Business line" required>
          <SelectMenu
            name="line"
            value={line}
            onChange={(e) => setLine(e.currentTarget.value)}
            options={[
              { value: "B2", label: "B2 coaching" },
              { value: "GERMAN_NOTE", label: "German Note" },
            ]}
          />
        </Field>
        <Field
          label="Only for one level"
          hint="Leave on 'Every level' unless this set is written for one tier - Elite asking about OIC sessions, say."
        >
          <SelectMenu
            name="levelCode"
            defaultValue={template?.levelCode ?? ""}
            options={[
              { value: "", label: "Every level on this line" },
              ...levels.filter((l) => l.line === line).map((l) => ({ value: l.code, label: l.label })),
            ]}
          />
        </Field>
        <Field
          label="In use"
          hint="Switching a set off stops it being offered. Cohorts pointed at it fall back to their line's default rather than being asked nothing."
        >
          <SelectMenu
            name="active"
            defaultValue={template ? (template.active ? "yes" : "no") : "yes"}
            options={[
              { value: "yes", label: "Yes" },
              { value: "no", label: "No" },
            ]}
          />
        </Field>
        <div className="flex justify-end gap-2">
          <Btn onClick={onClose}>Cancel</Btn>
          <SubmitButton>{template ? "Save" : "Create"}</SubmitButton>
        </div>
      </form>
    </Modal>
  );
}

function QuestionModal({
  templateId,
  question,
  nextIndex,
  onClose,
}: {
  templateId: string;
  question: TemplateQuestionView | null;
  nextIndex: number;
  onClose: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState(question?.kind ?? "NUMBER");
  const [optionsText, setOptionsText] = useState(
    (question?.options ?? [])
      .map((o) => `${o.value} | ${o.label}${o.numeric != null ? ` | ${o.numeric}` : ""}`)
      .join("\n"),
  );

  async function save(form: FormData) {
    setError(null);
    const num = (name: string): number | null => {
      const raw = String(form.get(name) ?? "").trim();
      if (raw === "") return null;
      const n = Number(raw);
      return Number.isFinite(n) ? Math.trunc(n) : null;
    };

    /**
     * One option per line, "value | label | number". The number is optional and is what a
     * bucket contributes to a total - "3-5 hours" counts as 3 - so a dashboard can still add
     * up a column of ranges.
     */
    const options = optionsText
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [value, label, numeric] = line.split("|").map((p) => p.trim());
        return {
          value: value ?? "",
          label: label || value || "",
          numeric: numeric !== undefined && numeric !== "" && Number.isFinite(Number(numeric))
            ? Math.trunc(Number(numeric))
            : null,
        };
      });

    const res = await saveWeeklyQuestion({
      templateId,
      id: question?.id,
      key: String(form.get("key") ?? ""),
      kind: String(form.get("kind") ?? "NUMBER"),
      metric: String(form.get("metric") ?? "OTHER"),
      label: String(form.get("label") ?? ""),
      helpText: String(form.get("helpText") ?? ""),
      required: String(form.get("required") ?? "yes"),
      orderIndex: num("orderIndex") ?? nextIndex,
      options: CHOICE_KINDS.has(String(form.get("kind") ?? "")) ? options : [],
      allowOther: String(form.get("allowOther") ?? "no"),
      min: num("min"),
      max: num("max"),
      targetNumeric: num("targetNumeric"),
    });
    if (!res.ok) {
      setError(res.error);
      return;
    }
    toast(
      question && question.answerCount > 0
        ? "Saved as a new version. The answers already given keep the wording they were asked."
        : "Question saved.",
    );
    onClose();
  }

  return (
    <Modal open onClose={onClose} title={question ? "Edit question" : "Add a question"}>
      <form action={save} className="space-y-4">
        <FormError message={error} />

        {question && question.answerCount > 0 && (
          <p className="rounded-field bg-warn-soft/50 px-3 py-2 text-caption text-ink-2">
            {question.answerCount} student answer{question.answerCount === 1 ? " has" : "s have"}{" "}
            been given to this question. Saving keeps those answers against the wording they were
            actually asked, and starts asking the new wording from the next week.
          </p>
        )}

        <Field label="The question" required hint="Written the way a student will read it.">
          <TextInput name="label" required defaultValue={question?.label ?? ""} kind="text" />
        </Field>
        <Field label="Help text" hint="One line under the question. Optional.">
          <TextInput name="helpText" defaultValue={question?.helpText ?? ""} kind="text" />
        </Field>
        <Field
          label="Short name"
          required
          hint="Lower-case, no spaces - applications, learning_hours. It never changes when the wording does, which is what keeps a chart readable across a rewording."
        >
          <TextInput name="key" required defaultValue={question?.key ?? ""} placeholder="applications" />
        </Field>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Answer type" required>
            <SelectMenu
              name="kind"
              value={kind}
              onChange={(e) => setKind(e.currentTarget.value)}
              options={Object.entries(KIND_LABELS).map(([value, label]) => ({ value, label }))}
            />
          </Field>
          <Field
            label="Counts as"
            hint="What the answer MEANS, so the dashboard and the flags can read it however the wording changes."
          >
            <SelectMenu
              name="metric"
              defaultValue={question?.metric ?? "OTHER"}
              options={Object.entries(METRIC_LABELS).map(([value, label]) => ({ value, label }))}
            />
          </Field>
        </div>

        {CHOICE_KINDS.has(kind) && (
          <>
            <Field
              label="The choices"
              required
              hint="One per line: value | what the student sees | the number it counts as (optional)."
            >
              <TextArea
                rows={6}
                value={optionsText}
                onChange={(e) => setOptionsText(e.currentTarget.value)}
                placeholder={"none | No blockers - I'm on track\n1-2 | 1-2 hours | 1"}
              />
            </Field>
            <Field
              label="Let them type their own"
              hint="On, the form offers 'Something else' and a text box. The live data shows students doing this whether or not it is offered."
            >
              <SelectMenu
                name="allowOther"
                defaultValue={question?.allowOther ? "yes" : "no"}
                options={[
                  { value: "no", label: "No" },
                  { value: "yes", label: "Yes" },
                ]}
              />
            </Field>
          </>
        )}

        {(kind === "NUMBER" || kind === "SCALE") && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label="Smallest answer">
              <TextInput name="min" kind="int" inputMode="numeric" defaultValue={question?.min ?? ""} />
            </Field>
            <Field label="Largest answer">
              <TextInput name="max" kind="int" inputMode="numeric" defaultValue={question?.max ?? ""} />
            </Field>
            <Field label="Weekly target" hint="Below it is a yellow flag. Blank means it is not scored.">
              <TextInput
                name="targetNumeric"
                kind="int"
                inputMode="numeric"
                defaultValue={question?.targetNumeric ?? ""}
              />
            </Field>
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Must be answered">
            <SelectMenu
              name="required"
              defaultValue={question ? (question.required ? "yes" : "no") : "yes"}
              options={[
                { value: "yes", label: "Yes" },
                { value: "no", label: "No - optional" },
              ]}
            />
          </Field>
          <Field label="Position" hint="Lower numbers come first.">
            <TextInput
              name="orderIndex"
              kind="int"
              inputMode="numeric"
              defaultValue={String(question?.orderIndex ?? nextIndex)}
            />
          </Field>
        </div>

        <div className="flex justify-end gap-2">
          <Btn onClick={onClose}>Cancel</Btn>
          <SubmitButton>Save question</SubmitButton>
        </div>
      </form>
    </Modal>
  );
}

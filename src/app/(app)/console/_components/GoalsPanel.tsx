"use client";

import { useState } from "react";
import { Target } from "lucide-react";
import { askConfirm, toast } from "@/components/ui/feedback";
import { Field, FormError, Select, SubmitButton, TextInput } from "@/components/ui/form";
import { Modal } from "@/components/ui/Modal";
import { deleteGoal, saveGoal } from "@/server/console-actions";
import { GOAL_METRIC_LABELS, GOAL_METRICS, periodLabel, type GoalProgress } from "@/lib/goals";
import { formatDate, formatInrMinor } from "@/lib/format";
import { EmptyState, Pill, ProgressBar } from "@/components/ui/kit";
import { Btn, Card, Hint } from "./kit";

/**
 * Goals: what the team is steering towards. Progress is derived from the same history
 * the Arena scores, so a goal can never disagree with the leaderboard — and one set
 * today for last quarter immediately shows how that quarter actually went.
 */

export type GoalPerson = { id: string; fullName: string };

const METRIC_OPTIONS = GOAL_METRICS.map((m) => ({ value: m, label: GOAL_METRIC_LABELS[m] }));
const PERIOD_OPTIONS = [
  { value: "MONTH", label: "This month" },
  { value: "QUARTER", label: "This quarter" },
  { value: "YEAR", label: "This year" },
];
const SCOPE_OPTIONS = [
  { value: "COMPANY", label: "Whole team (combined total)" },
  { value: "USER", label: "One person" },
];

const fmt = (n: number) =>
  Number.isInteger(n) ? n.toLocaleString("en-IN") : n.toLocaleString("en-IN", { maximumFractionDigits: 2 });

/** Revenue goals are money (set in whole rupees) → ₹ formatter. Count/XP metrics stay plain. */
const showMetricValue = (metric: GoalProgress["goal"]["metric"], n: number) =>
  metric === "revenueInr" ? formatInrMinor(Math.round(n * 100)) : fmt(n);

/** met / missed / running — the pill that says where a goal stands at a glance. */
function GoalStatus({ g }: { g: GoalProgress }) {
  if (g.met) return <Pill tone="good">✓ Met{g.metOn ? ` ${formatDate(g.metOn)}` : ""}</Pill>;
  if (!g.open) return <Pill tone="bad">Missed</Pill>;
  if (!g.goal.active) return <Pill tone="neutral">Paused</Pill>;
  return <Pill tone="primary">{Math.round(g.pct)}%</Pill>;
}

export function GoalsPanel({ goals, people }: { goals: GoalProgress[]; people: GoalPerson[] }) {
  const [editing, setEditing] = useState<GoalProgress | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scope, setScope] = useState<"COMPANY" | "USER">("COMPANY");

  const open = (g: GoalProgress | null) => {
    setError(null);
    setScope(g?.goal.scope ?? "COMPANY");
    if (g) setEditing(g);
    else setCreating(true);
  };
  const close = () => {
    setEditing(null);
    setCreating(false);
  };

  const current = editing?.goal;

  const submit = async (form: FormData) => {
    setError(null);
    const res = await saveGoal(form);
    if (!res.ok) return setError(res.error);
    toast(current ? "Goal updated" : "Goal created");
    close();
  };

  const remove = async (g: GoalProgress) => {
    const ok = await askConfirm({
      title: `Delete "${g.goal.name}"?`,
      body: "Any reward rule that pays when this goal is met will be deleted too, along with its grants.",
      confirmLabel: "Delete goal",
      danger: true,
    });
    if (!ok) return;
    const res = await deleteGoal(g.goal.id);
    if (!res.ok) return toast(res.error, "error");
    toast("Goal deleted");
  };

  return (
    <Card
      title="Goals"
      subtitle="Targets for the team or one person, over a month, quarter or year."
      actions={<Btn variant="primary" onClick={() => open(null)}>+ New goal</Btn>}
    >
      {goals.length === 0 ? (
        <EmptyState
          icon={<Target size={26} />}
          title="No goals yet"
          body="Set one and it starts tracking immediately — including backwards, over history that's already recorded."
          action={<Btn variant="primary" onClick={() => open(null)}>+ New goal</Btn>}
        />
      ) : (
        <div className="space-y-1.5">
          {goals.map((g) => (
            <div
              key={g.goal.id}
              className={`rounded-field border border-line bg-surface-2 p-3 ${g.goal.active ? "" : "opacity-60"}`}
            >
              <div className="flex flex-wrap items-center gap-3">
                <Target size={16} className="flex-none text-ink-3" />
                <div className="min-w-52 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink">
                    {g.goal.name}
                    <GoalStatus g={g} />
                  </p>
                  <p className="text-caption text-muted">
                    {GOAL_METRIC_LABELS[g.goal.metric]} ·{" "}
                    {g.goal.scope === "COMPANY"
                      ? "whole team"
                      : people.find((p) => p.id === g.goal.teamProfileId)?.fullName ?? "one person"}{" "}
                    · {periodLabel(g.goal.period, g.goal.periodStart)}
                  </p>
                </div>
                <div className="w-full max-w-64">
                  <div className="tnum mb-1 flex justify-between text-caption">
                    <span className="font-semibold text-ink">{showMetricValue(g.goal.metric, g.actual)}</span>
                    <span className="text-muted">of {showMetricValue(g.goal.metric, g.goal.targetValue)}</span>
                  </div>
                  <ProgressBar pct={g.pct} tone={g.met ? "good" : !g.open ? "bad" : "primary"} />
                </div>
                <div className="flex flex-none gap-2 text-sm">
                  <button type="button" className="font-medium text-accent hover:underline" onClick={() => open(g)}>
                    Edit
                  </button>
                  <button type="button" className="text-risk hover:underline" onClick={() => remove(g)}>
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-3">
        <Hint>
          A goal&apos;s progress is derived, never entered. Point a reward rule at a goal to pay out
          automatically the day it&apos;s met.
        </Hint>
      </div>

      <Modal
        open={creating || editing !== null}
        onClose={close}
        title={current ? "Edit goal" : "New goal"}
        subtitle="Progress is measured from work already recorded — nothing to enter."
      >
        <form action={submit} className="space-y-4">
          {current && <input type="hidden" name="id" value={current.id} />}
          <Field label="Goal name">
            <TextInput name="name" required defaultValue={current?.name} placeholder="e.g. 20 deals closed in Q3" />
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Metric">
              <Select name="metric" options={METRIC_OPTIONS} defaultValue={current?.metric ?? "wins"} />
            </Field>
            <Field label="Target" hint="A plain number. Revenue is in whole rupees.">
              {/* `money` (not `int`): a revenueInr goal is a rupee amount, and the count/XP
                  metrics are a strict subset of what it accepts. */}
              <TextInput name="targetValue" required kind="money" defaultValue={current ? String(current.targetValue) : ""} />
            </Field>
            <Field label="Whose goal">
              <Select
                name="scope"
                options={SCOPE_OPTIONS}
                value={scope}
                onChange={(e) => setScope(e.target.value as "COMPANY" | "USER")}
              />
            </Field>
            {scope === "USER" && (
              <Field label="Person">
                <Select
                  name="teamProfileId"
                  options={people.map((p) => ({ value: p.id, label: p.fullName }))}
                  defaultValue={current?.teamProfileId ?? undefined}
                />
              </Field>
            )}
            <Field label="Period">
              <Select name="period" options={PERIOD_OPTIONS} defaultValue={current?.period ?? "MONTH"} />
            </Field>
            <Field label="Starting" hint="Snapped to the first day of that month / quarter / year.">
              <TextInput
                type="date"
                name="periodStart"
                required
                defaultValue={current?.periodStart ?? new Date().toISOString().slice(0, 10)}
              />
            </Field>
          </div>
          <label className="flex items-center gap-2.5 text-sm font-medium">
            <input type="checkbox" name="active" defaultChecked={current?.active ?? true} className="h-4 w-4 accent-[var(--primary)]" />
            <span>
              Active
              <span className="block text-xs font-normal text-muted">
                Paused goals stop being tracked and stop paying reward rules.
              </span>
            </span>
          </label>
          <div className="flex items-center gap-3">
            <SubmitButton>{current ? "Save goal" : "Create goal"}</SubmitButton>
            <FormError message={error} />
          </div>
        </form>
      </Modal>
    </Card>
  );
}

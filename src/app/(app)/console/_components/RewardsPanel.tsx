"use client";

import { useState } from "react";
import { AlertTriangle, Gift, RefreshCw } from "lucide-react";
import { askConfirm, toast } from "@/components/ui/feedback";
import { Field, FormError, Select, SubmitButton, TextArea, TextInput } from "@/components/ui/form";
import { Modal } from "@/components/ui/Modal";
import { Tabs } from "@/components/ui/Tabs";
import { deleteRewardRule, saveRewardRule, scanRewards, setGrantStatus } from "@/server/console-actions";
import {
  describeTrigger,
  REWARD_KINDS,
  REWARD_TRIGGER_KINDS,
  REWARD_TRIGGER_LABELS,
  REWARD_WINDOWS,
  REWARD_WINDOW_LABELS,
  type RewardKind,
  type RewardTrigger,
  type RewardTriggerKind,
  type RewardWindow,
} from "@/lib/rewards";
import { COUNTABLE_METRICS, EMPLOYEE_METRIC_LABELS, type CountableMetric } from "@/lib/gamification";
import { APP_ROLES, type AppRole } from "@/lib/sections";
import { formatDate } from "@/lib/format";
import { Btn, Card, Hint, Toggle } from "./kit";

/**
 * Reward rules and the grants they produce.
 *
 * A rule says "when X, pay Y". Scanning re-derives every qualification in history and
 * inserts the new ones as PENDING — it's idempotent, so scan as often as you like:
 * nobody is ever paid twice, and a grant you declined never comes back.
 */

export type RuleRow = {
  id: string;
  name: string;
  description: string;
  kind: RewardKind;
  active: boolean;
  roles: string[];
  amountInrMinor: string; // BigInt is not serialisable across the server boundary
  amountEurMinor: string;
  perkLabel: string | null;
  trigger: RewardTrigger | null; // null = the stored trigger no longer parses
};

export type GrantView = {
  id: string;
  ruleName: string;
  ruleKind: string;
  perkLabel: string | null;
  personName: string;
  qualifiedOn: string;
  reason: string;
  status: "PENDING" | "APPROVED" | "DECLINED" | "PAID";
  amountInr: string;
  amountEur: string;
};

export type BadgeOption = { key: string; name: string; icon: string };
export type QuestOption = { key: string; title: string; icon: string };
export type GoalOption = { id: string; name: string };

const KIND_OPTIONS = REWARD_KINDS.map((k) => ({
  value: k,
  label: k === "BONUS" ? "Bonus" : k === "COMMISSION" ? "Commission" : "Perk (no money)",
}));
const TRIGGER_OPTIONS = REWARD_TRIGGER_KINDS.map((k) => ({ value: k, label: REWARD_TRIGGER_LABELS[k] }));
const WINDOW_OPTIONS = REWARD_WINDOWS.map((w) => ({ value: w, label: REWARD_WINDOW_LABELS[w] }));
const METRIC_OPTIONS = COUNTABLE_METRICS.map((m) => ({ value: m, label: EMPLOYEE_METRIC_LABELS[m] }));

const ROLE_LABELS: Record<AppRole, string> = {
  ADMIN: "Admin", HEAD: "Head coach", USER: "Telecaller", STUDENT: "Student", TUTOR: "Tutor",
};

const STATUS_STYLE: Record<GrantView["status"], { fg: string; bg: string }> = {
  PENDING: { fg: "var(--warn)", bg: "var(--warn-bg)" },
  APPROVED: { fg: "var(--primary-strong)", bg: "var(--primary-soft)" },
  DECLINED: { fg: "var(--muted)", bg: "var(--surface-2)" },
  PAID: { fg: "var(--good)", bg: "var(--good-bg)" },
};

/** Build the default trigger for a kind, so switching kinds never leaves a half-filled shape. */
function blankTrigger(kind: RewardTriggerKind, badges: BadgeOption[], quests: QuestOption[], goals: GoalOption[]): RewardTrigger {
  switch (kind) {
    case "STREAK_DAYS": return { kind, days: 30 };
    case "LEVEL_REACHED": return { kind, level: 5 };
    case "BADGE_EARNED": return { kind, badgeKey: badges[0]?.key ?? "" };
    case "QUEST_COMPLETED": return { kind, questKey: quests[0]?.key ?? "" };
    case "XP_THRESHOLD": return { kind, xp: 1000, window: "MONTH" };
    case "METRIC_THRESHOLD": return { kind, metric: "wins", target: 5, window: "MONTH" };
    case "GOAL_MET": return { kind, goalId: goals[0]?.id ?? "" };
  }
}

const money = (minor: string) => (Number(minor) / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 });

export function RewardsPanel({
  rules,
  grants,
  badges,
  quests,
  goals,
}: {
  rules: RuleRow[];
  grants: GrantView[];
  badges: BadgeOption[];
  quests: QuestOption[];
  goals: GoalOption[];
}) {
  const pending = grants.filter((g) => g.status === "PENDING");

  return (
    <Card
      title="Rewards & incentives"
      subtitle="Rules that decide who has earned a bonus, commission or perk — detected automatically."
      actions={<ScanButton />}
    >
      <Tabs
        tabs={[
          {
            label: `Pending (${pending.length})`,
            content: <GrantsTable grants={pending} empty="Nothing waiting on you. Scan after a rule change to look for new qualifiers." />,
          },
          { label: `Rules (${rules.length})`, content: <RulesTab rules={rules} badges={badges} quests={quests} goals={goals} /> },
          {
            label: "Ledger",
            content: <GrantsTable grants={grants} empty="No grants yet — create a rule, then scan." />,
          },
        ]}
      />
    </Card>
  );
}

function ScanButton() {
  const [busy, setBusy] = useState(false);
  return (
    <Btn
      busy={busy}
      onClick={async () => {
        setBusy(true);
        const res = await scanRewards();
        setBusy(false);
        if (!res.ok) return toast(res.error, "error");
        toast(
          res.created === 0
            ? "Scan complete — no new qualifiers"
            : `Scan complete — ${res.created} new ${res.created === 1 ? "grant" : "grants"} waiting for you`,
        );
      }}
    >
      <RefreshCw size={14} /> Scan for qualifiers
    </Btn>
  );
}

// ───────────────────────────── grants ─────────────────────────────

function GrantsTable({ grants, empty }: { grants: GrantView[]; empty: string }) {
  if (grants.length === 0) {
    return <p className="mt-4 rounded-field border border-line bg-surface-2 p-5 text-sm text-muted">{empty}</p>;
  }
  return (
    <div className="mt-4 space-y-2">
      {grants.map((g) => (
        <div key={g.id} className="flex flex-wrap items-center gap-3 rounded-field border border-line bg-surface-2 p-3">
          <Gift size={16} className="flex-none text-ink-3" />
          <div className="min-w-52 flex-1">
            <p className="text-sm font-semibold">
              {g.personName} · {g.ruleName}
            </p>
            <p className="text-xs text-muted">
              {g.reason} · qualified {formatDate(g.qualifiedOn)}
            </p>
          </div>
          <p className="tnum w-28 flex-none text-sm font-semibold">
            {g.ruleKind === "PERK"
              ? (g.perkLabel ?? "Perk")
              : [
                  Number(g.amountInr) > 0 ? `₹${money(g.amountInr)}` : null,
                  Number(g.amountEur) > 0 ? `€${money(g.amountEur)}` : null,
                ].filter(Boolean).join(" + ")}
          </p>
          <span
            className="flex-none rounded-full px-2.5 py-0.5 text-xs font-semibold"
            style={{ color: STATUS_STYLE[g.status].fg, background: STATUS_STYLE[g.status].bg }}
          >
            {g.status}
          </span>
          <GrantActions grant={g} />
        </div>
      ))}
    </div>
  );
}

function GrantActions({ grant }: { grant: GrantView }) {
  const act = async (status: GrantView["status"], confirm?: { title: string; body: string; danger?: boolean }) => {
    if (confirm && !(await askConfirm({ ...confirm, confirmLabel: "Confirm" }))) return;
    const res = await setGrantStatus(grant.id, status);
    if (!res.ok) return toast(res.error, "error");
    toast(`Marked ${status.toLowerCase()}`);
  };

  return (
    <div className="flex flex-none gap-2 text-sm">
      {grant.status === "PENDING" && (
        <>
          <button type="button" className="font-semibold text-good hover:underline" onClick={() => act("APPROVED")}>
            Approve
          </button>
          <button
            type="button"
            className="text-risk hover:underline"
            onClick={() =>
              act("DECLINED", {
                title: `Decline ${grant.personName}'s reward?`,
                body: "It won't be offered again, even after a rescan.",
                danger: true,
              })
            }
          >
            Decline
          </button>
        </>
      )}
      {grant.status === "APPROVED" && (
        <button type="button" className="font-semibold text-accent hover:underline" onClick={() => act("PAID")}>
          Mark paid
        </button>
      )}
      {(grant.status === "DECLINED" || grant.status === "PAID") && (
        <button type="button" className="text-muted hover:underline" onClick={() => act("PENDING")}>
          Reopen
        </button>
      )}
    </div>
  );
}

// ───────────────────────────── rules ─────────────────────────────

function RulesTab({
  rules,
  badges,
  quests,
  goals,
}: {
  rules: RuleRow[];
  badges: BadgeOption[];
  quests: QuestOption[];
  goals: GoalOption[];
}) {
  const [editing, setEditing] = useState<RuleRow | null>(null);
  const [creating, setCreating] = useState(false);

  const remove = async (r: RuleRow) => {
    const ok = await askConfirm({
      title: `Delete "${r.name}"?`,
      body: "Every grant this rule ever produced is deleted with it, including ones already marked paid.",
      confirmLabel: "Delete rule",
      danger: true,
    });
    if (!ok) return;
    const res = await deleteRewardRule(r.id);
    if (!res.ok) return toast(res.error, "error");
    toast("Rule deleted");
  };

  return (
    <div className="mt-4 space-y-2">
      <Btn variant="primary" onClick={() => setCreating(true)}>+ New reward rule</Btn>

      {rules.map((r) => (
        <div key={r.id} className="flex flex-wrap items-center gap-3 rounded-field border border-line bg-surface-2 p-3">
          <div className="min-w-52 flex-1">
            <p className="flex items-center gap-2 text-sm font-semibold">
              {r.name}
              {!r.active && <span className="text-xs font-normal text-muted">paused</span>}
              {!r.trigger && (
                <span className="flex items-center gap-1 text-xs font-semibold text-risk">
                  <AlertTriangle size={13} /> broken trigger — edit to fix
                </span>
              )}
            </p>
            <p className="text-xs text-muted">
              {r.trigger ? describeTrigger(r.trigger) : "Unrecognised trigger"} ·{" "}
              {r.roles.length ? r.roles.map((x) => ROLE_LABELS[x as AppRole] ?? x).join(", ") : "everyone"}
            </p>
          </div>
          <p className="tnum w-32 flex-none text-sm font-semibold">
            {r.kind === "PERK"
              ? (r.perkLabel ?? "Perk")
              : [
                  Number(r.amountInrMinor) > 0 ? `₹${money(r.amountInrMinor)}` : null,
                  Number(r.amountEurMinor) > 0 ? `€${money(r.amountEurMinor)}` : null,
                ].filter(Boolean).join(" + ")}
          </p>
          <div className="flex flex-none gap-2 text-sm">
            <button type="button" className="text-accent hover:underline" onClick={() => setEditing(r)}>Edit</button>
            <button type="button" className="text-risk hover:underline" onClick={() => remove(r)}>Delete</button>
          </div>
        </div>
      ))}

      <Hint>
        Editing a rule doesn&apos;t re-price grants it already produced — amounts are stamped when a
        grant is created. Scan again after editing to pick up anyone who now qualifies.
      </Hint>

      {(creating || editing) && (
        <RuleForm
          rule={editing}
          badges={badges}
          quests={quests}
          goals={goals}
          onClose={() => {
            setEditing(null);
            setCreating(false);
          }}
        />
      )}
    </div>
  );
}

function RuleForm({
  rule,
  badges,
  quests,
  goals,
  onClose,
}: {
  rule: RuleRow | null;
  badges: BadgeOption[];
  quests: QuestOption[];
  goals: GoalOption[];
  onClose: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<RewardKind>(rule?.kind ?? "BONUS");
  const [trigger, setTrigger] = useState<RewardTrigger>(
    rule?.trigger ?? blankTrigger("STREAK_DAYS", badges, quests, goals),
  );
  const [roles, setRoles] = useState<AppRole[]>((rule?.roles ?? []) as AppRole[]);

  const submit = async (form: FormData) => {
    setError(null);
    form.set("trigger", JSON.stringify(trigger));
    form.set("roles", roles.join(","));
    const res = await saveRewardRule(form);
    if (!res.ok) return setError(res.error);
    toast(rule ? "Rule updated — scan to find new qualifiers" : "Rule created — scan to find qualifiers");
    onClose();
  };

  return (
    <Modal open onClose={onClose} title={rule ? "Edit reward rule" : "New reward rule"} subtitle="When this happens, that person has earned it.">
      <form action={submit} className="space-y-4">
        {rule && <input type="hidden" name="id" value={rule.id} />}

        <Field label="Reward name">
          <TextInput name="name" required defaultValue={rule?.name} placeholder="e.g. Iron Discipline bonus" />
        </Field>
        <Field label="What it's for">
          <TextArea name="description" required defaultValue={rule?.description} placeholder="Shown on the grant so you remember why you set it." />
        </Field>

        <div className="rounded-field border border-line bg-surface-2 p-3">
          <p className="mb-2 text-sm font-semibold">Trigger</p>
          <TriggerBuilder trigger={trigger} onChange={setTrigger} badges={badges} quests={quests} goals={goals} />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="Reward type">
            <Select name="kind" options={KIND_OPTIONS} value={kind} onChange={(e) => setKind(e.target.value as RewardKind)} />
          </Field>
          {kind === "PERK" ? (
            <div className="sm:col-span-2">
              <Field label="The perk" hint="No money changes hands — it's recorded, approved and tracked all the same.">
                <TextInput name="perkLabel" defaultValue={rule?.perkLabel ?? ""} placeholder="e.g. An extra day off" />
              </Field>
            </div>
          ) : (
            <>
              <Field label="Amount ₹" hint="Leave blank if paying in EUR only">
                <TextInput name="amountInr" inputMode="decimal" defaultValue={rule && Number(rule.amountInrMinor) > 0 ? money(rule.amountInrMinor) : ""} />
              </Field>
              <Field label="Amount €">
                <TextInput name="amountEur" inputMode="decimal" defaultValue={rule && Number(rule.amountEurMinor) > 0 ? money(rule.amountEurMinor) : ""} />
              </Field>
            </>
          )}
        </div>

        <div>
          <p className="mb-1.5 text-sm font-medium">Who can earn it</p>
          <div className="flex flex-wrap gap-3">
            {APP_ROLES.map((r) => (
              <Toggle
                key={r}
                checked={roles.includes(r)}
                onChange={() => setRoles((prev) => (prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r]))}
                label={ROLE_LABELS[r]}
              />
            ))}
          </div>
          <p className="mt-1 text-xs text-muted">{roles.length === 0 ? "Nothing ticked — everyone can earn it." : ""}</p>
        </div>

        <label className="flex items-center gap-2.5 text-sm font-medium">
          <input type="checkbox" name="active" defaultChecked={rule?.active ?? true} className="h-4 w-4 accent-[var(--primary)]" />
          <span>
            Active
            <span className="block text-xs font-normal text-muted">A paused rule stops producing new grants.</span>
          </span>
        </label>

        <div className="flex items-center gap-3">
          <SubmitButton>{rule ? "Save rule" : "Create rule"}</SubmitButton>
          <FormError message={error} />
        </div>
      </form>
    </Modal>
  );
}

/** The discriminated union, as a form. Changing the kind resets the shape to a valid default. */
function TriggerBuilder({
  trigger,
  onChange,
  badges,
  quests,
  goals,
}: {
  trigger: RewardTrigger;
  onChange: (t: RewardTrigger) => void;
  badges: BadgeOption[];
  quests: QuestOption[];
  goals: GoalOption[];
}) {
  const num = (v: number, set: (n: number) => void, label: string, min = 1) => (
    <input
      type="number"
      aria-label={label}
      value={v}
      min={min}
      onChange={(e) => set(Number.isFinite(e.target.valueAsNumber) ? e.target.valueAsNumber : min)}
      className="tnum w-28 rounded-field border border-line-strong bg-surface px-2.5 py-1.5 text-sm"
    />
  );
  const pick = <T extends string>(v: T, set: (x: T) => void, opts: ReadonlyArray<{ value: T; label: string }>, label: string) => (
    <select
      aria-label={label}
      value={v}
      onChange={(e) => set(e.target.value as T)}
      className="rounded-field border border-line-strong bg-surface px-2.5 py-1.5 text-sm"
    >
      {opts.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );

  return (
    <div className="flex flex-wrap items-center gap-2">
      {pick(
        trigger.kind,
        (k) => onChange(blankTrigger(k, badges, quests, goals)),
        TRIGGER_OPTIONS,
        "Trigger kind",
      )}

      {trigger.kind === "STREAK_DAYS" && (
        <>
          {num(trigger.days, (days) => onChange({ ...trigger, days }), "Streak days")}
          <span className="text-sm text-ink-2">consecutive days. Pays again on every new run that gets there.</span>
        </>
      )}

      {trigger.kind === "LEVEL_REACHED" && (
        <>{num(trigger.level, (level) => onChange({ ...trigger, level }), "Level")}<span className="text-sm text-ink-2">or above, once.</span></>
      )}

      {trigger.kind === "BADGE_EARNED" && (
        badges.length === 0
          ? <span className="text-sm text-risk">No badges defined — add one in Gamification first.</span>
          : pick(trigger.badgeKey, (badgeKey) => onChange({ ...trigger, badgeKey }), badges.map((b) => ({ value: b.key, label: `${b.icon} ${b.name}` })), "Badge")
      )}

      {trigger.kind === "QUEST_COMPLETED" && (
        quests.length === 0
          ? <span className="text-sm text-risk">No quests defined — add one in Gamification first.</span>
          : <>
              {pick(trigger.questKey, (questKey) => onChange({ ...trigger, questKey }), quests.map((q) => ({ value: q.key, label: `${q.icon} ${q.title}` })), "Quest")}
              <span className="text-sm text-ink-2">— pays once per week completed.</span>
            </>
      )}

      {trigger.kind === "XP_THRESHOLD" && (
        <>
          {num(trigger.xp, (xp) => onChange({ ...trigger, xp }), "XP")}
          <span className="text-sm text-ink-2">XP</span>
          {pick(trigger.window, (window) => onChange({ ...trigger, window: window as RewardWindow }), WINDOW_OPTIONS, "Window")}
        </>
      )}

      {trigger.kind === "METRIC_THRESHOLD" && (
        <>
          {num(trigger.target, (target) => onChange({ ...trigger, target }), "Target")}
          <span className="text-sm text-ink-2">×</span>
          {pick(trigger.metric, (metric) => onChange({ ...trigger, metric: metric as CountableMetric }), METRIC_OPTIONS, "Metric")}
          {pick(trigger.window, (window) => onChange({ ...trigger, window: window as RewardWindow }), WINDOW_OPTIONS, "Window")}
        </>
      )}

      {trigger.kind === "GOAL_MET" && (
        goals.length === 0
          ? <span className="text-sm text-risk">No goals yet — create one in the Goals tab first.</span>
          : pick(trigger.goalId, (goalId) => onChange({ ...trigger, goalId }), goals.map((g) => ({ value: g.id, label: g.name })), "Goal")
      )}
    </div>
  );
}

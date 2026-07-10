"use client";

import { useMemo, useState } from "react";
import { CalendarPlus, Info } from "lucide-react";
import { askConfirm, toast } from "@/components/ui/feedback";
import { Tabs } from "@/components/ui/Tabs";
import { resetGamificationConfig, saveGamificationConfig } from "@/server/console-actions";
import {
  EMPLOYEE_BADGE_METRICS,
  EMPLOYEE_METRIC_LABELS,
  MILESTONE_ORDER,
  QUEST_FIELDS,
  STAGE_LABELS_SHORT,
  STUDENT_BADGE_METRICS,
  STUDENT_METRIC_LABELS,
  sortedRulesets,
  type BadgeTier,
  type EmployeeBadgeMetric,
  type EmployeeBadgeRule,
  type GamificationConfig,
  type LevelDef,
  type QuestDef,
  type Ruleset,
  type StudentBadgeMetric,
  type StudentBadgeRule,
} from "@/lib/gamification";
import { Btn, Card, Hint, NumInput, Picker, Row, SaveBar, TextIn, Toggle } from "./kit";

/**
 * The gamification rules, versioned by effective date.
 *
 * Editing the CURRENT ruleset changes how today's and future work is scored. Editing
 * a PAST one re-scores the period it governed — which is occasionally what you want
 * (you mistyped a number) and usually not. So the primary action is "New version
 * from today": it clones the live rules, stamps tomorrow's date on the copy, and
 * leaves history untouched.
 */

const TIERS: ReadonlyArray<{ value: BadgeTier; label: string }> = [
  { value: "bronze", label: "Bronze" },
  { value: "silver", label: "Silver" },
  { value: "gold", label: "Gold" },
  { value: "legend", label: "Legend" },
];

const VARIANTS = [
  { value: "ANY", label: "Everyone" },
  { value: "DISCOVERY_SPECIALIST", label: "Discovery specialist" },
  { value: "APPOINTMENT_SETTER", label: "Appointment setter" },
  { value: "DELIVERY_COACH", label: "Delivery coach" },
] as const;

const QUEST_FIELD_OPTIONS = QUEST_FIELDS.map((f) => ({
  value: f,
  label: f === "__weekdayLogs" ? "Weekday logs (Mon–Fri count)" : f,
}));

const EMPLOYEE_METRIC_OPTIONS = EMPLOYEE_BADGE_METRICS.map((m) => ({
  value: m,
  label: EMPLOYEE_METRIC_LABELS[m],
}));

const STUDENT_METRIC_OPTIONS = STUDENT_BADGE_METRICS.map((m) => ({
  value: m,
  label: STUDENT_METRIC_LABELS[m],
}));

const MILESTONE_OPTIONS = MILESTONE_ORDER.map((m) => ({ value: m, label: m.replace(/_/g, " ") }));

const todayKey = () => new Date().toISOString().slice(0, 10);
const tomorrowKey = () => new Date(Date.now() + 86400000).toISOString().slice(0, 10);

/** Unique key within a list, so a fresh row can never shadow an existing one. */
function freshKey(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
}

export function GamificationPanel({ config }: { config: GamificationConfig }) {
  const [draft, setDraft] = useState<GamificationConfig>(config);
  const [selectedId, setSelectedId] = useState(() => {
    const all = sortedRulesets(config);
    return (all.filter((r) => r.effectiveFrom <= todayKey()).pop() ?? all[0]).id;
  });
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ordered = useMemo(() => sortedRulesets(draft), [draft]);
  const selected = ordered.find((r) => r.id === selectedId) ?? ordered[ordered.length - 1];
  const liveId = (ordered.filter((r) => r.effectiveFrom <= todayKey()).pop() ?? ordered[0]).id;

  const patch = (change: Partial<Ruleset>) => {
    setDraft((d) => ({
      rulesets: d.rulesets.map((r) => (r.id === selected.id ? { ...r, ...change } : r)),
    }));
    setDirty(true);
  };

  const addVersion = () => {
    const from = tomorrowKey();
    if (ordered.some((r) => r.effectiveFrom === from)) {
      return setError(`A ruleset already starts on ${from}. Edit that one, or pick another date.`);
    }
    const id = freshKey(`v${ordered.length + 1}`, new Set(ordered.map((r) => r.id)));
    const clone: Ruleset = { ...structuredClone(selected), id, label: `Rules from ${from}`, effectiveFrom: from };
    setDraft((d) => ({ rulesets: [...d.rulesets, clone] }));
    setSelectedId(id);
    setDirty(true);
    setError(null);
  };

  const removeVersion = async () => {
    if (ordered.length === 1) return setError("Keep at least one ruleset.");
    const ok = await askConfirm({
      title: `Delete "${selected.label}"?`,
      body: "Work scored under it will be re-scored by whichever ruleset then covers those dates.",
      confirmLabel: "Delete version",
      danger: true,
    });
    if (!ok) return;
    setDraft((d) => ({ rulesets: d.rulesets.filter((r) => r.id !== selected.id) }));
    setSelectedId(ordered.find((r) => r.id !== selected.id)!.id);
    setDirty(true);
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    const form = new FormData();
    form.set("config", JSON.stringify(draft));
    const res = await saveGamificationConfig(form);
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setDirty(false);
    toast("Gamification rules saved");
  };

  const reset = async () => {
    const ok = await askConfirm({
      title: "Reset all gamification rules?",
      body: "Every version you created is deleted and the original shipped rules take over all of history. XP, levels and badges will be recomputed.",
      confirmLabel: "Reset rules",
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    const res = await resetGamificationConfig();
    setBusy(false);
    if (!res.ok) return setError(res.error);
    toast("Gamification rules reset — reload to see them");
  };

  const isLive = selected.id === liveId;
  const isFuture = selected.effectiveFrom > todayKey();

  return (
    <Card
      title="Gamification"
      subtitle="XP values, the level ladder, badges, weekly quests and the student journey."
      actions={
        <>
          <Picker
            ariaLabel="Ruleset version"
            value={selected.id}
            onChange={setSelectedId}
            options={ordered.map((r) => ({
              value: r.id,
              label: `${r.label} · from ${r.effectiveFrom}${r.id === liveId ? " (live)" : ""}`,
            }))}
            className="w-72"
          />
          <Btn onClick={addVersion}>
            <CalendarPlus size={14} /> New version
          </Btn>
          {ordered.length > 1 && (
            <Btn variant="danger" onClick={removeVersion}>
              Delete version
            </Btn>
          )}
        </>
      }
    >
      <div
        className="mb-4 flex items-start gap-2 rounded-field px-3 py-2 text-xs"
        style={{
          background: isLive ? "var(--warn-bg)" : "var(--primary-soft)",
          color: isLive ? "var(--warn)" : "var(--primary-strong)",
        }}
      >
        <Info size={15} className="mt-px flex-none" />
        <p>
          {isFuture ? (
            <>
              This version starts on <b>{selected.effectiveFrom}</b>. Nothing changes until then —
              edit freely.
            </>
          ) : isLive ? (
            <>
              You are editing the <b>live</b> rules. Work already done keeps the XP it earned — but the
              rules in force since <b>{selected.effectiveFrom}</b> apply to every day from that date on, so
              recent XP will be recalculated. To change only future work, use <b>New version</b> instead.
            </>
          ) : (
            <>
              This is a <b>past</b> version. Editing it re-scores the work done while it was in force.
            </>
          )}
        </p>
      </div>

      <div className="mb-5 flex flex-wrap items-end gap-3">
        <label className="text-xs font-semibold uppercase tracking-wide text-ink-3">
          Version name
          <div className="mt-1">
            <TextIn value={selected.label} onChange={(label) => patch({ label })} className="w-64" />
          </div>
        </label>
        <label className="text-xs font-semibold uppercase tracking-wide text-ink-3">
          In force from
          <div className="mt-1">
            <input
              type="date"
              value={selected.effectiveFrom}
              onChange={(e) => e.target.value && patch({ effectiveFrom: e.target.value })}
              className="rounded-field border border-line-strong bg-surface px-2.5 py-1.5 text-sm text-ink"
            />
          </div>
        </label>
      </div>

      <Tabs
        tabs={[
          { label: "XP rules", content: <XpRulesEditor ruleset={selected} patch={patch} /> },
          { label: "Levels", content: <LevelsEditor ruleset={selected} patch={patch} /> },
          { label: `Badges (${selected.employeeBadges.length})`, content: <EmployeeBadgesEditor ruleset={selected} patch={patch} /> },
          { label: `Quests (${selected.quests.length})`, content: <QuestsEditor ruleset={selected} patch={patch} /> },
          { label: "Student journey", content: <StudentEditor ruleset={selected} patch={patch} /> },
        ]}
      />

      <SaveBar dirty={dirty} onSave={save} onReset={reset} busy={busy} error={error} />
    </Card>
  );
}

type EditorProps = { ruleset: Ruleset; patch: (change: Partial<Ruleset>) => void };

// ───────────────────────────── XP rules ─────────────────────────────

function XpRulesEditor({ ruleset, patch }: EditorProps) {
  const r = ruleset.xpRules;
  const set = (k: keyof typeof r, v: number) => patch({ xpRules: { ...r, [k]: v } });

  const streaks = Object.entries(r.STREAK_BONUS)
    .map(([d, xp]) => [Number(d), xp] as const)
    .sort((a, b) => a[0] - b[0]);

  const setStreaks = (rows: ReadonlyArray<readonly [number, number]>) =>
    patch({ xpRules: { ...r, STREAK_BONUS: Object.fromEntries(rows.map(([d, xp]) => [String(d), xp])) } });

  const SCALARS: Array<[keyof typeof r, string]> = [
    ["LOG_SUBMITTED", "Daily log submitted"],
    ["OUTCOME_LOGGED", "Call outcome logged"],
    ["OUTCOME_HQ_BONUS", "…bonus if Highly Qualified"],
    ["MILESTONE_ADVANCED", "Student milestone advanced"],
    ["MILESTONE_OFFER_BONUS", "…bonus for Offer received"],
    ["MILESTONE_COMPLETED_BONUS", "…bonus for Completed"],
    ["STUDENT_RESCUED", "Student rescued (red → green)"],
    ["OKR_HIT", "OKR completed at 100%"],
    ["OKR_NEAR", "OKR closed above 80%"],
  ];

  return (
    <div className="space-y-6 pt-4">
      <div>
        <h4 className="mb-2 text-sm font-semibold">Actions</h4>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {SCALARS.map(([key, label]) => (
            <label key={key} className="flex items-center justify-between gap-2 rounded-field border border-line bg-surface-2 px-3 py-2 text-sm">
              <span className="text-ink-2">{label}</span>
              <div className="w-24 flex-none">
                <NumInput ariaLabel={label} value={r[key] as number} onChange={(n) => set(key, n)} max={100000} />
              </div>
            </label>
          ))}
        </div>
      </div>

      <div>
        <h4 className="mb-1 text-sm font-semibold">Pipeline stage moves</h4>
        <Hint>XP earned for moving a lead into each stage. Set 0 to pay nothing.</Hint>
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {Object.entries(r.STAGE_MOVED).map(([stage, xp]) => (
            <label key={stage} className="flex items-center justify-between gap-2 rounded-field border border-line bg-surface-2 px-3 py-2 text-sm">
              <span className="text-ink-2">{STAGE_LABELS_SHORT[stage] ?? stage}</span>
              <div className="w-24 flex-none">
                <NumInput
                  ariaLabel={stage}
                  value={xp}
                  onChange={(n) => patch({ xpRules: { ...r, STAGE_MOVED: { ...r.STAGE_MOVED, [stage]: n } } })}
                />
              </div>
            </label>
          ))}
        </div>
      </div>

      <div>
        <h4 className="mb-1 text-sm font-semibold">Streak ladder</h4>
        <Hint>A bonus paid the day someone&apos;s consecutive-logging run reaches that length.</Hint>
        <div className="mt-2 space-y-2">
          {streaks.map(([days, xp], i) => (
            <Row key={i} onRemove={() => setStreaks(streaks.filter((_, j) => j !== i))}>
              <span className="text-sm text-ink-2">At</span>
              <div className="w-20">
                <NumInput
                  ariaLabel="Streak length in days"
                  value={days}
                  min={1}
                  onChange={(n) => setStreaks(streaks.map((s, j) => (j === i ? [n, s[1]] : s)))}
                />
              </div>
              <span className="text-sm text-ink-2">days, pay</span>
              <div className="w-24">
                <NumInput
                  ariaLabel="Streak bonus XP"
                  value={xp}
                  onChange={(n) => setStreaks(streaks.map((s, j) => (j === i ? [s[0], n] : s)))}
                />
              </div>
              <span className="text-sm text-ink-2">XP</span>
            </Row>
          ))}
          <Btn
            onClick={() => {
              const next = (streaks[streaks.length - 1]?.[0] ?? 0) + 7;
              setStreaks([...streaks, [next, 50]]);
            }}
          >
            + Add streak tier
          </Btn>
        </div>
      </div>
    </div>
  );
}

// ───────────────────────────── levels ─────────────────────────────

function LevelsEditor({ ruleset, patch }: EditorProps) {
  const levels = [...ruleset.levels].sort((a, b) => a.minXp - b.minXp);
  const set = (next: LevelDef[]) => patch({ levels: next });

  return (
    <div className="space-y-2 pt-4">
      <Hint>
        The lowest level must start at 0 XP, and each level up the ladder needs strictly more XP than
        the one below. Raising a threshold never demotes anyone who already climbed past it.
      </Hint>
      {levels.map((l, i) => (
        <Row key={i} onRemove={levels.length > 1 ? () => set(levels.filter((_, j) => j !== i)) : undefined}>
          <span className="w-16 flex-none text-sm font-semibold text-ink-3">Lvl</span>
          <div className="w-16">
            <NumInput
              ariaLabel="Level number"
              value={l.level}
              min={1}
              onChange={(n) => set(levels.map((x, j) => (j === i ? { ...x, level: n } : x)))}
            />
          </div>
          <TextIn
            ariaLabel="Level title"
            value={l.title}
            onChange={(title) => set(levels.map((x, j) => (j === i ? { ...x, title } : x)))}
            className="w-44"
          />
          <span className="text-sm text-ink-2">from</span>
          <div className="w-28">
            <NumInput
              ariaLabel="Minimum XP"
              value={l.minXp}
              onChange={(n) => set(levels.map((x, j) => (j === i ? { ...x, minXp: n } : x)))}
            />
          </div>
          <span className="text-sm text-ink-2">XP</span>
        </Row>
      ))}
      <Btn
        onClick={() => {
          const last = levels[levels.length - 1];
          set([...levels, { level: (last?.level ?? 0) + 1, title: "New level", minXp: (last?.minXp ?? 0) + 1000 }]);
        }}
      >
        + Add level
      </Btn>
    </div>
  );
}

// ───────────────────────────── employee badges ─────────────────────────────

function EmployeeBadgesEditor({ ruleset, patch }: EditorProps) {
  const badges = ruleset.employeeBadges;
  const set = (next: EmployeeBadgeRule[]) => patch({ employeeBadges: next });
  const upd = (i: number, p: Partial<EmployeeBadgeRule>) => set(badges.map((b, j) => (j === i ? { ...b, ...p } : b)));

  return (
    <div className="space-y-2 pt-4">
      <Hint>
        Pick what a badge counts and how many it takes. Raising a threshold only affects people who
        haven&apos;t earned it yet — a badge already unlocked stays unlocked.
      </Hint>
      {badges.map((b, i) => (
        <Row key={b.key} onRemove={() => set(badges.filter((_, j) => j !== i))}>
          <TextIn ariaLabel="Emoji" value={b.icon} onChange={(icon) => upd(i, { icon })} className="w-16 text-center" />
          <TextIn ariaLabel="Badge name" value={b.name} onChange={(name) => upd(i, { name })} className="w-40" />
          <Picker
            ariaLabel="Metric"
            value={b.metric}
            onChange={(metric) => upd(i, { metric: metric as EmployeeBadgeMetric })}
            options={EMPLOYEE_METRIC_OPTIONS}
            className="w-56"
          />
          <span className="text-sm text-ink-2">≥</span>
          <div className="w-24">
            <NumInput ariaLabel="Threshold" value={b.threshold} min={1} onChange={(threshold) => upd(i, { threshold })} />
          </div>
          <Picker ariaLabel="Tier" value={b.tier} onChange={(tier) => upd(i, { tier: tier as BadgeTier })} options={TIERS} className="w-28" />
          <Toggle checked={b.enabled} onChange={(enabled) => upd(i, { enabled })} label="On" />
          <div className="w-full">
            <TextIn
              ariaLabel="Badge description"
              value={b.description}
              onChange={(description) => upd(i, { description })}
              placeholder="What earns this badge"
            />
          </div>
        </Row>
      ))}
      <Btn
        onClick={() => {
          const key = freshKey("new-badge", new Set(badges.map((b) => b.key)));
          set([...badges, {
            key, name: "New badge", description: "Describe what earns this.", icon: "🏅",
            tier: "bronze", metric: "logs", threshold: 10, enabled: true,
          }]);
        }}
      >
        + Add badge
      </Btn>
    </div>
  );
}

// ───────────────────────────── quests ─────────────────────────────

function QuestsEditor({ ruleset, patch }: EditorProps) {
  const quests = ruleset.quests;
  const set = (next: QuestDef[]) => patch({ quests: next });
  const upd = (i: number, p: Partial<QuestDef>) => set(quests.map((q, j) => (j === i ? { ...q, ...p } : q)));

  return (
    <div className="space-y-2 pt-4">
      <Hint>
        Weekly quests are scored from the daily log — no extra data entry. A quest is assigned by the
        person&apos;s log variant, and pays out for every past week that already met the bar.
      </Hint>
      {quests.map((q, i) => (
        <Row key={q.key} onRemove={() => set(quests.filter((_, j) => j !== i))}>
          <TextIn ariaLabel="Emoji" value={q.icon} onChange={(icon) => upd(i, { icon })} className="w-16 text-center" />
          <TextIn ariaLabel="Quest title" value={q.title} onChange={(title) => upd(i, { title })} className="w-40" />
          <Picker
            ariaLabel="Metric field"
            value={q.field}
            onChange={(field) => upd(i, { field })}
            options={QUEST_FIELD_OPTIONS}
            className="w-56"
          />
          <span className="text-sm text-ink-2">≥</span>
          <div className="w-20">
            <NumInput ariaLabel="Weekly target" value={q.target} min={1} onChange={(target) => upd(i, { target })} />
          </div>
          <span className="text-sm text-ink-2">pays</span>
          <div className="w-20">
            <NumInput ariaLabel="Quest XP" value={q.xp} onChange={(xp) => upd(i, { xp })} />
          </div>
          <span className="text-sm text-ink-2">XP</span>
          <Picker
            ariaLabel="Who gets this quest"
            value={q.variant}
            onChange={(variant) => upd(i, { variant: variant as QuestDef["variant"] })}
            options={VARIANTS}
            className="w-44"
          />
          <Toggle checked={q.enabled} onChange={(enabled) => upd(i, { enabled })} label="On" />
          <div className="w-full">
            <TextIn ariaLabel="Quest description" value={q.description} onChange={(description) => upd(i, { description })} />
          </div>
        </Row>
      ))}
      <Btn
        onClick={() => {
          const key = freshKey("new-quest", new Set(quests.map((q) => q.key)));
          set([...quests, {
            key, title: "New quest", description: "Describe the weekly target.", icon: "🎯",
            field: "discoveryCallsCompleted", target: 10, xp: 60, variant: "ANY", enabled: true,
          }]);
        }}
      >
        + Add quest
      </Btn>
    </div>
  );
}

// ───────────────────────────── student journey ─────────────────────────────

function StudentEditor({ ruleset, patch }: EditorProps) {
  const s = ruleset.student;
  const setStudent = (p: Partial<typeof s>) => patch({ student: { ...s, ...p } });
  const badges = ruleset.studentBadges;
  const setBadges = (next: StudentBadgeRule[]) => patch({ studentBadges: next });
  const updBadge = (i: number, p: Partial<StudentBadgeRule>) =>
    setBadges(badges.map((b, j) => (j === i ? { ...b, ...p } : b)));

  const totalXp = MILESTONE_ORDER.reduce((a, m) => a + (s.milestoneXp[m] ?? 0), 0);

  return (
    <div className="space-y-6 pt-4">
      <div>
        <h4 className="mb-1 text-sm font-semibold">Milestone weights &amp; stage titles</h4>
        <Hint>
          The weights add up to {totalXp.toLocaleString("en-IN")} XP, and that total is the 100% mark on the
          journey ring — reweight freely without the progress drifting.
        </Hint>
        <div className="mt-2 space-y-2">
          {MILESTONE_ORDER.map((m, i) => (
            <Row key={m}>
              <span className="w-52 flex-none text-sm text-ink-2">{m.replace(/_/g, " ")}</span>
              <div className="w-24">
                <NumInput
                  ariaLabel={`${m} XP weight`}
                  value={s.milestoneXp[m] ?? 0}
                  onChange={(n) => setStudent({ milestoneXp: { ...s.milestoneXp, [m]: n } })}
                />
              </div>
              <span className="text-sm text-ink-2">XP · stage title</span>
              <TextIn
                ariaLabel={`${m} stage title`}
                value={s.stageTitles[i] ?? ""}
                onChange={(v) => setStudent({ stageTitles: s.stageTitles.map((t, j) => (j === i ? v : t)) })}
                className="w-44"
              />
            </Row>
          ))}
        </div>
      </div>

      <div>
        <h4 className="mb-1 text-sm font-semibold">Bonus XP &amp; momentum</h4>
        <Hint>Bonus XP is added per unit of work on top of the milestone weights.</Hint>
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
          {([
            ["perSession", "Per coaching session"],
            ["perApplication", "Per application"],
            ["perInterview", "Per interview"],
          ] as const).map(([k, label]) => (
            <label key={k} className="flex items-center justify-between gap-2 rounded-field border border-line bg-surface-2 px-3 py-2 text-sm">
              <span className="text-ink-2">{label}</span>
              <div className="w-20 flex-none">
                <NumInput ariaLabel={label} value={s.bonusXp[k]} onChange={(n) => setStudent({ bonusXp: { ...s.bonusXp, [k]: n } })} />
              </div>
            </label>
          ))}
        </div>
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
          {([
            ["hot", "🔥 Hot — idle up to"],
            ["steady", "🚶 Steady — idle up to"],
            ["cooling", "🌥️ Cooling — idle up to"],
          ] as const).map(([k, label]) => (
            <label key={k} className="flex items-center justify-between gap-2 rounded-field border border-line bg-surface-2 px-3 py-2 text-sm">
              <span className="text-ink-2">{label}</span>
              <div className="w-20 flex-none">
                <NumInput ariaLabel={label} value={s.momentumDays[k]} min={1} onChange={(n) => setStudent({ momentumDays: { ...s.momentumDays, [k]: n } })} />
              </div>
            </label>
          ))}
        </div>
        <Hint>Days must widen: hot &lt; steady &lt; cooling. Anything past cooling reads as 🧊 Stalled.</Hint>
      </div>

      <div>
        <h4 className="mb-1 text-sm font-semibold">Student badges</h4>
        <div className="mt-2 space-y-2">
          {badges.map((b, i) => {
            const needsMilestone = b.metric === "milestoneReached" || b.metric === "milestoneWithinDays";
            return (
              <Row key={b.key} onRemove={() => setBadges(badges.filter((_, j) => j !== i))}>
                <TextIn ariaLabel="Emoji" value={b.icon} onChange={(icon) => updBadge(i, { icon })} className="w-16 text-center" />
                <TextIn ariaLabel="Badge name" value={b.name} onChange={(name) => updBadge(i, { name })} className="w-40" />
                <Picker
                  ariaLabel="Metric"
                  value={b.metric}
                  onChange={(metric) => {
                    const m = metric as StudentBadgeMetric;
                    const wantsMilestone = m === "milestoneReached" || m === "milestoneWithinDays";
                    updBadge(i, { metric: m, milestone: wantsMilestone ? (b.milestone ?? "RESUME_BUILD") : null });
                  }}
                  options={STUDENT_METRIC_OPTIONS}
                  className="w-64"
                />
                {needsMilestone && (
                  <Picker
                    ariaLabel="Milestone"
                    value={b.milestone ?? "RESUME_BUILD"}
                    onChange={(milestone) => updBadge(i, { milestone })}
                    options={MILESTONE_OPTIONS}
                    className="w-48"
                  />
                )}
                {b.metric !== "comeback" && b.metric !== "greenSignal" && b.metric !== "milestoneReached" && (
                  <>
                    <span className="text-sm text-ink-2">{b.metric === "milestoneWithinDays" ? "within" : "≥"}</span>
                    <div className="w-20">
                      <NumInput ariaLabel="Threshold" value={b.threshold} min={1} onChange={(threshold) => updBadge(i, { threshold })} />
                    </div>
                    {b.metric === "milestoneWithinDays" && <span className="text-sm text-ink-2">days</span>}
                  </>
                )}
                <Picker ariaLabel="Tier" value={b.tier} onChange={(tier) => updBadge(i, { tier: tier as BadgeTier })} options={TIERS} className="w-28" />
                <Toggle checked={b.enabled} onChange={(enabled) => updBadge(i, { enabled })} label="On" />
                <div className="w-full">
                  <TextIn ariaLabel="Badge description" value={b.description} onChange={(description) => updBadge(i, { description })} />
                </div>
              </Row>
            );
          })}
          <Btn
            onClick={() => {
              const key = freshKey("new-student-badge", new Set(badges.map((b) => b.key)));
              setBadges([...badges, {
                key, name: "New badge", description: "Describe what earns this.", icon: "🌟",
                tier: "bronze", metric: "applications", threshold: 5, milestone: null, enabled: true,
              }]);
            }}
          >
            + Add student badge
          </Btn>
        </div>
      </div>

      <div>
        <h4 className="mb-1 text-sm font-semibold">Coaching next steps</h4>
        <Hint>Shown to the student on their portal for whichever milestone they are on. One step per line.</Hint>
        <div className="mt-2 space-y-3">
          {MILESTONE_ORDER.map((m) => {
            const entry = s.nextSteps[m] ?? { focus: "", steps: [] };
            return (
              <div key={m} className="rounded-field border border-line bg-surface-2 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="w-52 flex-none text-sm font-semibold text-ink-2">{m.replace(/_/g, " ")}</span>
                  <TextIn
                    ariaLabel={`${m} focus`}
                    value={entry.focus}
                    placeholder="Focus for this stage"
                    onChange={(focus) => setStudent({ nextSteps: { ...s.nextSteps, [m]: { ...entry, focus } } })}
                    className="min-w-64 flex-1"
                  />
                </div>
                <textarea
                  aria-label={`${m} steps`}
                  rows={3}
                  value={entry.steps.join("\n")}
                  onChange={(e) =>
                    setStudent({
                      nextSteps: {
                        ...s.nextSteps,
                        [m]: { ...entry, steps: e.target.value.split("\n").map((x) => x.trim()).filter(Boolean) },
                      },
                    })
                  }
                  className="mt-2 w-full rounded-field border border-line-strong bg-surface px-2.5 py-1.5 text-sm text-ink outline-none focus:border-primary focus:ring-2 focus:ring-primary-soft"
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

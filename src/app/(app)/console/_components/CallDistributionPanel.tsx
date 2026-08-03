"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, Hint, NumInput, SaveBar, Toggle } from "./kit";
import { toast } from "@/components/ui/feedback";
import { previewSplit } from "@/lib/call-distribution";
import { DEFAULT_CALL_DISTRIBUTION, type CallDistributionConfig } from "@/lib/config-schema";
import { saveCallDistribution } from "@/server/console-actions";

/**
 * Console → Call Distribution: who gets the calls, and which lead is worked first.
 *
 * ── Why this screen exists ───────────────────────────────────────────────────────
 * Both dials existed but neither was usable. Shares were editable one person at a time, buried
 * in a twelve-field profile form on another page, with no way to see the roster together and no
 * check that they added up — and because the engine normalises them, a founder who typed 5 and 2
 * got 71/29 while the Pipeline card cheerfully printed "5% target". The ranking weights were not
 * editable at all; they were two divergent hardcoded formulas.
 *
 * So the design rule here is: SHOW WHAT WILL ACTUALLY HAPPEN. The preview is computed with the
 * same function the hand-out uses, not an illustration of it, because a settings screen that can
 * disagree with the engine is worse than no settings screen.
 */

export type RosterMember = {
  profileId: string;
  name: string;
  roleTitle: string;
  sharePct: number;
  worksSaturdays: boolean;
};

export function CallDistributionPanel({
  config,
  roster,
}: {
  config: CallDistributionConfig;
  roster: RosterMember[];
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<CallDistributionConfig>(config);
  const [shares, setShares] = useState<Record<string, number>>(
    Object.fromEntries(roster.map((r) => [r.profileId, r.sharePct])),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const savedShares = Object.fromEntries(roster.map((r) => [r.profileId, r.sharePct]));
  const dirty =
    JSON.stringify(draft) !== JSON.stringify(config) ||
    JSON.stringify(shares) !== JSON.stringify(savedShares);

  const inRotation = roster.filter((r) => (shares[r.profileId] ?? 0) > 0);
  const shareTotal = inRotation.reduce((s, r) => s + (shares[r.profileId] ?? 0), 0);
  // The same call `assignLeadBatch` makes — so this cannot drift from what runs.
  const preview = previewSplit(
    inRotation.map((r) => ({ userId: r.profileId, name: r.name, sharePct: shares[r.profileId] ?? 0 })),
  );

  const setWeight = (k: keyof CallDistributionConfig["priority"], v: number) =>
    setDraft((d) => ({ ...d, priority: { ...d.priority, [k]: v } }));

  async function save() {
    setBusy(true);
    setError(null);
    const res = await saveCallDistribution({
      config: draft,
      shares: roster.map((r) => ({ profileId: r.profileId, sharePct: shares[r.profileId] ?? 0 })),
    });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    toast("Call distribution saved");
    router.refresh();
  }

  function reset() {
    setDraft(DEFAULT_CALL_DISTRIBUTION);
    setShares(savedShares);
  }

  return (
    <div className="space-y-5">
      <Hint>
        Who receives the calls, and which lead rises to the top of their queue. Shares are
        <strong> relative weights</strong> — they need not total 100, and the engine normalises
        them. The preview below is computed exactly the way the hand-out computes it.
      </Hint>

      {/* ── Shares ──────────────────────────────────────────────────────────────── */}
      <Card>
        <p className="text-caption font-semibold uppercase text-ink-3">
          Share of new leads ({inRotation.length} in the rotation)
        </p>

        {roster.length === 0 ? (
          <p className="mt-2 text-sm text-ink-3">
            No active team profiles yet. Add people in People → Team &amp; org chart first.
          </p>
        ) : (
          <>
            <div className="mt-3 space-y-2">
              {roster.map((r) => {
                const value = shares[r.profileId] ?? 0;
                const share = preview.find((p) => p.userId === r.profileId);
                return (
                  <div key={r.profileId} className="flex flex-wrap items-center gap-3 rounded-field border border-line p-3">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-ink">{r.name}</div>
                      <div className="text-caption text-ink-3">
                        {r.roleTitle}
                        {!r.worksSaturdays && " · off Saturdays"}
                      </div>
                    </div>
                    <label className="flex items-center gap-2 text-caption text-ink-3">
                      Share
                      <input
                        type="number"
                        min={0}
                        max={100}
                        value={value}
                        onChange={(e) =>
                          setShares((s) => ({
                            ...s,
                            [r.profileId]: Math.max(0, Math.min(100, Math.floor(Number(e.target.value) || 0))),
                          }))
                        }
                        className="w-20 rounded-field border border-line bg-surface px-2 py-1 text-sm text-ink"
                      />
                    </label>
                    <span className="w-40 flex-none text-right text-caption tnum text-ink-3">
                      {value === 0 ? (
                        "not in the rotation"
                      ) : (
                        <>
                          <strong className="text-ink">{share?.count ?? 0}</strong> of the next 100
                        </>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Explain rather than block. The engine copes fine with any total; the founder just
                needs to know the numbers they typed are not the numbers that will run. */}
            {shareTotal !== 100 && inRotation.length > 0 && (
              <p className="mt-3 rounded-field bg-surface-2 px-3 py-2 text-caption text-ink-3">
                Your shares add up to <strong>{shareTotal}</strong>, not 100. That is allowed —
                they are relative weights — but it means the split that actually runs is the one
                shown on the right, not the numbers you typed.
              </p>
            )}
            {inRotation.length === 0 && roster.length > 0 && (
              <p className="mt-3 rounded-field border border-warn bg-warn-soft px-3 py-2 text-caption text-warn-ink">
                Nobody has a share above 0, so <strong>no new lead will be auto-assigned to
                anyone</strong> — they will arrive unowned and sit in the unassigned pile.
              </p>
            )}
          </>
        )}
      </Card>

      {/* ── Rotation rules ──────────────────────────────────────────────────────── */}
      <Card>
        <p className="text-caption font-semibold uppercase text-ink-3">Rotation rules</p>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <label className="text-caption uppercase text-ink-3">
            Fairness window (days)
            <span className="mt-1 block">
              <NumInput
                value={draft.lookbackDays}
                min={1}
                max={365}
                onChange={(v) => setDraft((d) => ({ ...d, lookbackDays: v }))}
              />
            </span>
            <span className="mt-1 block normal-case text-ink-3">
              How far back the engine looks when deciding who is behind their share. Short reacts
              fast but swings after one day off; long is steady but slow to correct.
            </span>
          </label>

          <label className="text-caption uppercase text-ink-3">
            Daily cap per person (0 = none)
            <span className="mt-1 block">
              <NumInput
                value={draft.dailyCapPerPerson}
                min={0}
                max={500}
                onChange={(v) => setDraft((d) => ({ ...d, dailyCapPerPerson: v }))}
              />
            </span>
            <span className="mt-1 block normal-case text-ink-3">
              A hard stop on auto-assignment. Past it the rotation skips that person rather than
              piling onto a queue they cannot work. Separate from their daily call target, which is
              an expectation, not a limit.
            </span>
          </label>
        </div>

        <div className="mt-4 border-t border-line pt-4">
          <Toggle
            checked={draft.handOutSplitsByShare}
            onChange={(v) => setDraft((d) => ({ ...d, handOutSplitsByShare: v }))}
            label="Hand out leads by share, not to one person"
          />
          <p className="mt-1 text-caption text-ink-3">
            The backlog is where the volume is — far more than daily intake — so with this off your
            shares govern only a trickle. On, &ldquo;Hand out leads&rdquo; splits each batch across
            the rotation in the proportions above.
          </p>
        </div>
      </Card>

      {/* ── Ranking ─────────────────────────────────────────────────────────────── */}
      <Card>
        <p className="text-caption font-semibold uppercase text-ink-3">Which lead comes first</p>
        <p className="mt-1 text-caption text-ink-3">
          Applied to both the caller&apos;s own queue and the pipeline&apos;s &ldquo;call these
          first&rdquo; list — one ranking, not two. The shipped values reproduce the behaviour the
          app had before these were adjustable.
        </p>

        <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Weight
            label="Points per BANT dimension"
            hint="A 4/4 lead gains four times this. Raise it to let a strongly-qualified older lead outrank a fresh unqualified one."
            value={draft.priority.bantPerPoint}
            max={50}
            onChange={(v) => setWeight("bantPerPoint", v)}
          />
          <Weight
            label="Highly-qualified bonus"
            hint="Added when a discovery specialist has marked them highly qualified."
            value={draft.priority.highlyQualifiedBonus}
            max={100}
            onChange={(v) => setWeight("highlyQualifiedBonus", v)}
          />
          <Weight
            label="Fresh for (days)"
            hint="Speed-to-lead: how long a new lead counts as fresh."
            value={draft.priority.freshWithinDays}
            max={90}
            onChange={(v) => setWeight("freshWithinDays", v)}
          />
          <Weight
            label="Freshness bonus"
            hint="Added while a lead is still fresh."
            value={draft.priority.freshBonus}
            max={100}
            onChange={(v) => setWeight("freshBonus", v)}
          />
          <Weight
            label="Idle allowed (days)"
            hint="Days of no movement forgiven before the penalty starts."
            value={draft.priority.idleAfterDays}
            max={365}
            onChange={(v) => setWeight("idleAfterDays", v)}
          />
          <Weight
            label="Idle penalty per day"
            hint="Subtracted for each idle day beyond the allowance."
            value={draft.priority.idlePenaltyPerDay}
            max={20}
            onChange={(v) => setWeight("idlePenaltyPerDay", v)}
          />
          <Weight
            label="Most a lead can be penalised"
            hint="Caps the idle penalty. Without a ceiling an old lead sinks so far it can never resurface — which is abandoning it, not deprioritising it."
            value={draft.priority.idlePenaltyMax}
            max={200}
            onChange={(v) => setWeight("idlePenaltyMax", v)}
          />
        </div>
      </Card>

      <SaveBar dirty={dirty} onSave={save} onReset={reset} busy={busy} error={error} />
    </div>
  );
}

function Weight({
  label,
  hint,
  value,
  max,
  onChange,
}: {
  label: string;
  hint: string;
  value: number;
  max: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="text-caption uppercase text-ink-3">
      {label}
      <span className="mt-1 block">
        <NumInput value={value} min={0} max={max} onChange={onChange} />
      </span>
      <span className="mt-1 block normal-case text-ink-3">{hint}</span>
    </label>
  );
}

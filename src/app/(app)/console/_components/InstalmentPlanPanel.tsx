"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import {
  DEFAULT_INSTALMENT_PLAN_CONFIG,
  INSTALMENT_COUNT_MAX,
  INSTALMENT_COUNT_MIN,
  type InstalmentPlanConfig,
} from "@/lib/config-schema";
import { instalmentDueDates, instalmentExtraFor, splitInstalments } from "@/lib/instalment-plan";
import { Field } from "@/components/ui/form";
import { toast } from "@/components/ui/feedback";
import { saveInstalmentPlanConfig } from "@/server/console-actions";
import { formatDate, formatEurMinor, formatInrMinor } from "@/lib/format";
import { Btn, Card, ColHead, ColRow, ColScroll, Hint, NameCell, NumInput, RemoveCell, SaveBar } from "./kit";

/**
 * Instalment plan pricing (Founder Console → Instalment Plans).
 *
 * Two rules live here and nowhere else:
 *   1. what a plan of N instalments COSTS EXTRA — a flat amount added once to the agreed fee,
 *      so "3 → ₹600" means ₹1,50,000 becomes ₹1,50,600, not ₹1,800 of surcharge;
 *   2. how many days apart the instalments fall by default.
 *
 * Both feed the EMI generator on Finance → Pending payments. A length with no row costs
 * nothing, which is why the shipped table lists the common lengths at ₹0 — a surcharge should
 * only ever exist because somebody typed it.
 *
 * The preview is the point of the screen. A surcharge and a split are abstract until you see
 * the schedule they produce, and the boundary this rule is easiest to get wrong on is the
 * remainder — so the preview walks a real fee and shows every instalment, including the last
 * one that absorbs the rounding.
 */

/** The fee the preview splits. Not configurable — it exists to make the arithmetic legible. */
const PREVIEW_FEE_INR_MINOR = BigInt(15_000_000); // ₹1,50,000, the Guided fee
const PREVIEW_FIRST_DUE = new Date(Date.UTC(2026, 7, 15)); // a fixed date: this is an example

const COLS = "5rem 1fr 1fr 2rem";

const rupees = (paise: number) => formatInrMinor(BigInt(Math.round(paise)));

export function InstalmentPlanPanel({ config }: { config: InstalmentPlanConfig }) {
  const router = useRouter();
  const [draft, setDraft] = useState<InstalmentPlanConfig>(config);
  const [saved, setSaved] = useState<InstalmentPlanConfig>(config);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Which plan length the preview is showing. Defaults to the founder's 3-part plan. */
  const [previewCount, setPreviewCount] = useState(3);

  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);

  const patchTier = (count: number, key: "extraInrMinor" | "extraEurMinor", n: number) =>
    setDraft((d) => ({
      ...d,
      tiers: d.tiers.map((t) => (t.count === count ? { ...t, [key]: Math.max(0, Math.round(n)) } : t)),
    }));

  /** Next unpriced length, so "Add" never produces the duplicate the schema rejects. */
  const nextFreeCount = () => {
    const used = new Set(draft.tiers.map((t) => t.count));
    for (let c = INSTALMENT_COUNT_MIN; c <= INSTALMENT_COUNT_MAX; c += 1) if (!used.has(c)) return c;
    return null;
  };

  const addTier = () => {
    const count = nextFreeCount();
    if (count === null) return;
    setDraft((d) => ({
      ...d,
      tiers: [...d.tiers, { count, extraInrMinor: 0, extraEurMinor: 0 }].sort((a, b) => a.count - b.count),
    }));
  };

  const removeTier = (count: number) =>
    setDraft((d) => ({ ...d, tiers: d.tiers.filter((t) => t.count !== count) }));

  async function save() {
    setBusy(true);
    setError(null);
    const res = await saveInstalmentPlanConfig(draft);
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setSaved(draft);
    toast("Instalment plans saved");
    router.refresh();
  }

  // ── the preview, computed with the SAME functions the server uses ──
  const previewExtra = instalmentExtraFor(previewCount, draft);
  const previewTotal = PREVIEW_FEE_INR_MINOR + previewExtra.inr;
  const previewRows = splitInstalments({ inr: previewTotal, eur: BigInt(0) }, previewCount);
  const previewDates = instalmentDueDates(PREVIEW_FIRST_DUE, previewCount, draft.defaultIntervalDays);

  const previewLengths = draft.tiers.map((t) => t.count);
  const canAdd = nextFreeCount() !== null;

  return (
    <div className="space-y-5">
      <Hint>
        What it <strong>costs</strong> to pay in instalments, and how far apart they fall. The extra is
        added <strong>once</strong> to the agreed fee — so a 3-part plan at ₹600 turns a ₹1,50,000 fee
        into ₹1,50,600, split three ways. A plan length that isn&apos;t listed here adds nothing.
      </Hint>

      <Card>
        <div className="space-y-6">
          <Field
            label="Days between instalments"
            hint="The default gap when a schedule is generated. Every plan can override it."
          >
            <div className="max-w-[12rem]">
              <NumInput
                ariaLabel="Default days between instalments"
                value={draft.defaultIntervalDays}
                onChange={(n) => setDraft((d) => ({ ...d, defaultIntervalDays: n }))}
                min={1}
                max={180}
              />
            </div>
          </Field>

          <section>
            <p className="text-caption font-semibold uppercase text-ink-3">Extra amount per plan length</p>
            <p className="mt-0.5 max-w-2xl text-sm text-muted">
              Minor units are handled for you — type <strong>600</strong> for ₹600. Both currencies are
              here because a €-billed student&apos;s plan must not inherit a rupee surcharge.
            </p>
            <ColScroll>
            <div className="mt-3 space-y-1.5">
              <ColHead cols={COLS} labels={["Instalments", "Extra (₹)", "Extra (€)", ""]} />
              {draft.tiers.length === 0 ? (
                <p className="rounded-field border border-dashed border-line px-3 py-4 text-center text-sm text-muted">
                  No plan lengths priced — every instalment plan will add nothing extra.
                </p>
              ) : (
                draft.tiers.map((t, i) => (
                  <ColRow key={t.count} cols={COLS} index={i}>
                    <NameCell className="font-semibold text-ink">{t.count}×</NameCell>
                    <NumInput
                      ariaLabel={`Extra INR for ${t.count} instalments`}
                      value={Math.round(t.extraInrMinor / 100)}
                      onChange={(n) => patchTier(t.count, "extraInrMinor", n * 100)}
                      min={0}
                      max={1_000_000}
                    />
                    <NumInput
                      ariaLabel={`Extra EUR for ${t.count} instalments`}
                      value={Math.round(t.extraEurMinor / 100)}
                      onChange={(n) => patchTier(t.count, "extraEurMinor", n * 100)}
                      min={0}
                      max={1_000_000}
                    />
                    <RemoveCell
                      onClick={() => removeTier(t.count)}
                      label={`Remove the ${t.count}-instalment plan`}
                    />
                  </ColRow>
                ))
              )}
              {canAdd && (
                <Btn variant="ghost" size="sm" onClick={addTier}>
                  <Plus size={14} /> Add a plan length
                </Btn>
              )}
            </div>
            </ColScroll>
          </section>

          {/*
            The schedule these numbers produce, on a real fee. Rendered from lib/instalment-plan,
            i.e. the exact functions generateInstalmentPlan calls — so what is previewed here and
            what gets written cannot disagree.
          */}
          <div className="overflow-x-auto rounded-field border border-line bg-surface-2 px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-caption font-semibold uppercase text-ink-3">
                The plan a ₹1,50,000 fee produces
              </p>
              {previewLengths.length > 1 && (
                <div className="flex flex-wrap items-center gap-1">
                  {previewLengths.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setPreviewCount(c)}
                      aria-pressed={previewCount === c}
                      className={`press h-7 rounded-full px-2.5 text-caption font-semibold transition-colors ${
                        previewCount === c ? "bg-primary text-on-accent" : "text-ink-2 hover:text-ink"
                      }`}
                    >
                      {c}×
                    </button>
                  ))}
                </div>
              )}
            </div>

            <dl className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm">
              <div className="flex gap-2">
                <dt className="text-muted">Fee</dt>
                <dd className="tnum text-ink-2">{formatInrMinor(PREVIEW_FEE_INR_MINOR)}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="text-muted">+ plan extra</dt>
                <dd className="tnum text-ink-2">
                  {rupees(Number(previewExtra.inr))}
                  {previewExtra.eur > BigInt(0) && ` · ${formatEurMinor(previewExtra.eur)}`}
                </dd>
              </div>
              <div className="flex gap-2">
                <dt className="text-muted">Total to collect</dt>
                <dd className="tnum font-semibold text-ink">{formatInrMinor(previewTotal)}</dd>
              </div>
            </dl>

            <table className="mt-3 w-full text-sm text-ink-2">
              <thead>
                <tr className="text-left text-caption uppercase text-ink-3">
                  <th className="py-1 pr-4 font-medium">#</th>
                  <th className="py-1 pr-4 font-medium">Amount</th>
                  <th className="py-1 font-medium">Due</th>
                </tr>
              </thead>
              <tbody>
                {previewRows.map((r, i) => (
                  <tr key={i}>
                    <td className="py-1 pr-4">{i + 1}</td>
                    <td className="tnum py-1 pr-4 font-semibold">{formatInrMinor(r.inr)}</td>
                    <td className="py-1">{formatDate(previewDates[i].toISOString())}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-caption text-muted">
              Every {draft.defaultIntervalDays} days from the first due date. The last instalment absorbs
              any rounding, so the schedule always sums to the total exactly.
            </p>
          </div>
        </div>

        <SaveBar
          dirty={dirty}
          onSave={save}
          onReset={() => setDraft(DEFAULT_INSTALMENT_PLAN_CONFIG)}
          busy={busy}
          error={error}
        />
      </Card>
    </div>
  );
}

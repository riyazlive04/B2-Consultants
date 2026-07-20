"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  DEFAULT_BOOK_ORDER_CONFIG,
  DEFAULT_PIPELINE_CONFIG,
  type BookOrderConfig,
  type PipelineConfig,
} from "@/lib/config-schema";
import { decideBookOrder } from "@/lib/book-order";
import { Field } from "@/components/ui/form";
import { toast } from "@/components/ui/feedback";
import { saveBookOrderConfig, savePipelineConfig } from "@/server/console-actions";
import { Card, Hint, NumInput, Picker, SaveBar, Toggle } from "./kit";

/**
 * Two small operational rules that share a tab (Founder Console → Operations):
 * when book orders release, and how the pipeline is driven.
 *
 * Both are config rather than code for the same reason as the commission rates — the spec
 * lists each as still open (§18.3 the threshold, §18.6 the pipeline mode), so the numbers the
 * founders said on a call are defaults to start from, not facts to compile in.
 */

export function OperationsPanel({
  bookOrders,
  pipeline,
}: {
  bookOrders: BookOrderConfig;
  pipeline: PipelineConfig;
}) {
  return (
    <div className="space-y-6">
      <BookOrderSection config={bookOrders} />
      <PipelineSection config={pipeline} />
    </div>
  );
}

function BookOrderSection({ config }: { config: BookOrderConfig }) {
  const router = useRouter();
  const [draft, setDraft] = useState<BookOrderConfig>(config);
  const [saved, setSaved] = useState<BookOrderConfig>(config);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  // The editor works in rupees; the config stores paise.
  const thresholdRupees = Math.round(draft.orderThresholdInrMinor / 100);

  async function save() {
    setBusy(true);
    setError(null);
    const res = await saveBookOrderConfig(draft);
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setSaved(draft);
    toast("Book-order rule saved");
    router.refresh();
  }

  // Show the decision at real payment levels, including the boundary itself.
  const samples = [0, Math.round(thresholdRupees / 3), thresholdRupees - 1, thresholdRupees, thresholdRupees * 2];

  return (
    <div className="space-y-5">
      <Hint>
        When we place a student&apos;s book order with the publisher. The rule reads{" "}
        <strong>cash actually collected</strong>, not the payment plan — an EMI student who has
        genuinely paid past the threshold gets their books, because the point of holding back is
        unpaid money, not the existence of instalments.
      </Hint>

      <Card>
        <div className="space-y-5">
          <Field
            label="Order threshold (₹ collected)"
            hint="Once a student has paid at least this much in total, their order releases to the publisher. Below it, the order is held and says why."
          >
            <div className="max-w-[14rem]">
              <NumInput
                ariaLabel="Book order threshold rupees"
                value={thresholdRupees}
                onChange={(n) => setDraft((d) => ({ ...d, orderThresholdInrMinor: Math.round(n * 100) }))}
                min={0}
                max={10_000_000}
              />
            </div>
          </Field>

          <Toggle
            checked={draft.requireFreshQuotePerLevel}
            onChange={(b) => setDraft((d) => ({ ...d, requireFreshQuotePerLevel: b }))}
            label="Take a fresh quotation before each level"
            title="Order A1's books first, then re-quote before moving the student to A2."
          />

          <div className="overflow-x-auto rounded-field border border-line bg-surface-2 px-4 py-3">
            <p className="text-caption font-semibold uppercase text-ink-3">What happens at each amount paid</p>
            <ul className="mt-2 space-y-1 text-sm text-ink-2">
              {samples
                .filter((r, i, a) => r >= 0 && a.indexOf(r) === i)
                .map((r) => {
                  const d = decideBookOrder(r * 100, draft);
                  return (
                    <li key={r}>
                      Paid ₹{r.toLocaleString("en-IN")} →{" "}
                      <span className={`font-semibold ${d.order ? "text-ink" : "text-ink-3"}`}>
                        {d.order ? "order now" : "hold"}
                      </span>
                      {!d.order && d.shortfallInrMinor > 0 && (
                        <span className="text-ink-3">
                          {" "}
                          (₹{Math.round(d.shortfallInrMinor / 100).toLocaleString("en-IN")} short)
                        </span>
                      )}
                    </li>
                  );
                })}
            </ul>
          </div>
        </div>

        <SaveBar
          dirty={dirty}
          onSave={save}
          onReset={() => setDraft(DEFAULT_BOOK_ORDER_CONFIG)}
          busy={busy}
          error={error}
        />
      </Card>
    </div>
  );
}

function PipelineSection({ config }: { config: PipelineConfig }) {
  const router = useRouter();
  const [draft, setDraft] = useState<PipelineConfig>(config);
  const [saved, setSaved] = useState<PipelineConfig>(config);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = draft.mode !== saved.mode;

  async function save() {
    setBusy(true);
    setError(null);
    const res = await savePipelineConfig(draft);
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setSaved(draft);
    toast("Pipeline mode saved");
    router.refresh();
  }

  return (
    <div className="space-y-5">
      <Hint>
        How a lead moves between pipeline stages. Same data either way — this only decides
        whether a <strong>rule</strong> moves the card or a <strong>hand</strong> does.
      </Hint>

      <Card>
        <div className="space-y-4">
          <Field
            label="Pipeline mode"
            hint="Rules-driven: stages advance when the underlying record changes, so the board can't disagree with the data. Drag-and-drop: the team moves cards themselves."
          >
            <div className="max-w-[16rem]">
              <Picker
                ariaLabel="Pipeline mode"
                value={draft.mode}
                onChange={(mode) => setDraft({ mode })}
                options={[
                  { value: "rules", label: "Rules-driven (current)" },
                  { value: "drag_drop", label: "Drag and drop" },
                ]}
              />
            </div>
          </Field>
          {draft.mode === "drag_drop" && (
            <p className="rounded-field border border-line bg-surface-2 px-4 py-3 text-sm text-ink-2">
              In drag-and-drop, a card moved by hand stays where it was put — the stage rules
              stop correcting it. That is the trade: control over consistency.
            </p>
          )}
        </div>

        <SaveBar
          dirty={dirty}
          onSave={save}
          onReset={() => setDraft(DEFAULT_PIPELINE_CONFIG)}
          busy={busy}
          error={error}
        />
      </Card>
    </div>
  );
}

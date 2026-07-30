"use client";

import { useRouter } from "next/navigation";
import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { SegmentedControl, Btn } from "@/components/ui/controls";
import { Card } from "@/components/ui/kit";
import { toast } from "@/components/ui/feedback";
import {
  MEASURES,
  RANGE_OPTIONS,
  reportHref,
  type GroupByField,
  type ReportMeasure,
  type ReportObject,
  type ReportRangeKey,
} from "@/lib/reports";

/**
 * The whole report, as four choices: object · group-by · measure · period.
 *
 * Every choice is a `router.push` to a new URL rather than local state — the URL *is* the current
 * report, which is what makes one shareable and bookmarkable without a saved-report table.
 *
 * Switching object deliberately drops `groupBy` and `measure`: neither is usually valid for the
 * new object's field list (Contacts has no money field, so "Pipeline value" cannot survive a jump
 * from Opportunities), and the server picks that object's defaults. `range` is kept, because a
 * period is a question about *when* and stays true across objects.
 */
export default function ReportControls({
  object,
  groupBy,
  measure,
  range,
  objects,
  fields,
}: {
  object: ReportObject;
  groupBy: string;
  measure: ReportMeasure;
  range: ReportRangeKey;
  objects: readonly { key: ReportObject; label: string }[];
  fields: readonly GroupByField[];
}) {
  const router = useRouter();
  const [copied, setCopied] = useState(false);
  const measures = MEASURES[object];

  const go = (next: Partial<{ object: ReportObject; groupBy: string; measure: ReportMeasure; range: ReportRangeKey }>) =>
    router.push(
      reportHref({
        object: next.object ?? object,
        groupBy: next.groupBy ?? groupBy,
        measure: next.measure ?? measure,
        range: next.range ?? range,
      }),
    );

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(
        `${window.location.origin}${reportHref({ object, groupBy, measure, range })}`,
      );
      setCopied(true);
      toast("Report link copied", "success");
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast("Could not copy the link — copy it from the address bar", "error");
    }
  };

  return (
    <Card>
      <div className="grid gap-5 lg:grid-cols-2">
        <Field label="Object">
          <SegmentedControl
            ariaLabel="Report object"
            value={object}
            // A new object invalidates the other two picks; the server resolves its own defaults.
            onChange={(next) => router.push(`/reports?object=${next}&range=${range}`)}
            options={objects.map((o) => ({ value: o.key, label: o.label }))}
          />
        </Field>

        <Field label="Period">
          <SegmentedControl
            ariaLabel="Reporting period"
            value={range}
            onChange={(next) => go({ range: next })}
            options={RANGE_OPTIONS.map((r) => ({ value: r.value, label: r.label }))}
          />
        </Field>

        <Field label="Group by">
          <SegmentedControl
            ariaLabel="Group by field"
            value={groupBy}
            onChange={(next) => go({ groupBy: next })}
            options={fields.map((f) => ({ value: f.key, label: f.label }))}
          />
        </Field>

        {/* A single-measure object (Contacts has only Count) gets a static caption instead of a
            one-option control — a segmented control with nothing to switch to is a dead affordance. */}
        <Field label="Measure" hint={measures.length === 1 ? "Contacts carry no money or outcome field" : undefined}>
          {measures.length === 1 ? (
            <p className="text-sm text-ink-2">{measures[0].label}</p>
          ) : (
            <SegmentedControl
              ariaLabel="Measure to chart"
              value={measure}
              onChange={(next) => go({ measure: next })}
              options={measures.map((m) => ({ value: m.key, label: m.label }))}
            />
          )}
        </Field>
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
        <p className="text-caption text-ink-3">
          This report lives entirely in its URL — copy the link to save or share it.
        </p>
        <Btn variant="soft" size="sm" onClick={copyLink} icon={copied ? <Check size={15} /> : <Copy size={15} />}>
          {copied ? "Copied" : "Copy report link"}
        </Btn>
      </div>
    </Card>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-2 text-label font-semibold uppercase text-ink-3">{label}</p>
      {children}
      {hint && <p className="mt-1.5 text-caption text-ink-3">{hint}</p>}
    </div>
  );
}

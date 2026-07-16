"use client";

import { useRouter } from "next/navigation";
import { SegmentedControl } from "@/components/ui/controls";
import { Card } from "@/components/ui/kit";
import type { GroupByField, ReportObject } from "@/lib/reports";

/**
 * Object + group-by picker. Every choice here is a `router.push` to a new `?object=&groupBy=`
 * URL rather than local state — the URL is the whole "current report", which is what makes a
 * report shareable/bookmarkable (§10's stand-in for a saved-report table).
 *
 * Switching object deliberately drops `groupBy` from the URL: the old value is almost never valid
 * for the new object's field list, and the server picks that object's default group-by for us.
 */
export default function ReportControls({
  object,
  groupBy,
  objects,
  fields,
}: {
  object: ReportObject;
  groupBy: string;
  objects: readonly { key: ReportObject; label: string }[];
  fields: readonly GroupByField[];
}) {
  const router = useRouter();

  return (
    <Card>
      <div className="space-y-5">
        <div>
          <p className="mb-2 text-label font-semibold uppercase text-ink-3">Object</p>
          <SegmentedControl
            ariaLabel="Report object"
            value={object}
            onChange={(next) => router.push(`/reports?object=${next}`)}
            options={objects.map((o) => ({ value: o.key, label: o.label }))}
          />
        </div>
        <div>
          <p className="mb-2 text-label font-semibold uppercase text-ink-3">Group by</p>
          <SegmentedControl
            ariaLabel="Group by field"
            value={groupBy}
            onChange={(next) => router.push(`/reports?object=${object}&groupBy=${next}`)}
            options={fields.map((f) => ({ value: f.key, label: f.label }))}
          />
        </div>
      </div>
    </Card>
  );
}

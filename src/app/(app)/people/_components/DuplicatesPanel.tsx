"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Copy, Merge } from "lucide-react";
import type { DuplicateGroup, DuplicatesReport } from "@/server/duplicates-metrics";
import { mergeLeads } from "@/server/duplicates-actions";
import { Card, EmptyState, Pill } from "@/components/ui/kit";
import { Btn } from "@/components/ui/controls";
import { Tabs } from "@/components/ui/Tabs";
import { DateText } from "@/components/ui/DateText";
import { askConfirm, toast } from "@/components/ui/feedback";

/**
 * "Who is in here twice?" - People → Duplicates.
 *
 * Duplicate detection was write-time only: it stopped a rep typing the same person again and
 * linked a returning opt-in, but nothing could tell you about the duplicates already in the
 * table - and 23,429 of the 23,545 leads arrived through a bulk import that ran outside both
 * those paths.
 *
 * ── Why merging is manual ───────────────────────────────────────────────────────
 * The screen shows each candidate's call, booking and deal counts, because the row carrying the
 * history is almost always the one to keep - and merging in the wrong direction is not undoable
 * by re-running anything. So there is no "merge all": a human picks the survivor, every time.
 */

const ON_LABEL: Record<DuplicateGroup["on"], { text: string; tone: "warn" | "info" | "neutral" }> = {
  phone: { text: "Same phone number", tone: "warn" },
  email: { text: "Same email", tone: "warn" },
  // Weaker evidence, and labelled as such - two real people can share a name.
  name: { text: "Same name & city, no phone or email", tone: "neutral" },
};

function GroupCard({ group, mergeable }: { group: DuplicateGroup; mergeable: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const merge = async (keepId: string, keepName: string, loseId: string, loseName: string) => {
    const ok = await askConfirm({
      title: `Merge ${loseName} into ${keepName}?`,
      body:
        `Every call, booking, deal, message and note on ${loseName} moves onto ${keepName}, and ` +
        `blank fields are filled in from it. ${loseName} is then archived - nothing is deleted, ` +
        `and you can restore it from Contacts → Archived.`,
      confirmLabel: "Merge records",
    });
    if (!ok) return;
    setBusy(true);
    const res = await mergeLeads(keepId, loseId);
    setBusy(false);
    if (!res.ok) return toast(res.error, "error");
    toast(`Merged into ${keepName}`);
    router.refresh();
  };

  const meta = ON_LABEL[group.on];

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Pill tone={meta.tone}>{meta.text}</Pill>
        <code className="text-caption text-ink-3">{group.key}</code>
      </div>

      <ul className="mt-3 divide-y divide-line">
        {group.members.map((m) => {
          // The row with history is the sensible survivor - say so rather than making the
          // reader add up three numbers.
          const activity = m.calls + m.bookings + m.opportunities;
          const richest = Math.max(...group.members.map((x) => x.calls + x.bookings + x.opportunities));
          return (
            <li key={m.id} className="flex flex-wrap items-center gap-3 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Link href={`/contacts/${m.id}`} className="truncate font-medium text-ink hover:underline">
                    {m.name}
                  </Link>
                  {m.stage && <Pill tone="info">{m.stage.replaceAll("_", " ").toLowerCase()}</Pill>}
                  {activity > 0 && activity === richest && <Pill tone="good">Most history</Pill>}
                </div>
                <p className="mt-0.5 truncate text-caption text-muted">
                  {[m.phone, m.email, m.ownerName].filter(Boolean).join(" · ") || "No contact details"}
                </p>
                <p className="text-caption text-ink-3">
                  Added <DateText date={m.createdAt} />
                  {activity > 0 && (
                    <> · {m.calls} call{m.calls === 1 ? "" : "s"} · {m.bookings} booking{m.bookings === 1 ? "" : "s"} · {m.opportunities} deal{m.opportunities === 1 ? "" : "s"}</>
                  )}
                </p>
              </div>
              {mergeable && group.members.length === 2 && (
                <Btn
                  variant="soft"
                  size="sm"
                  disabled={busy}
                  onClick={() => {
                    const other = group.members.find((x) => x.id !== m.id)!;
                    merge(m.id, m.name, other.id, other.name);
                  }}
                >
                  <Merge size={14} /> Keep this one
                </Btn>
              )}
            </li>
          );
        })}
      </ul>

      {mergeable && group.members.length > 2 && (
        <p className="mt-2 text-caption text-ink-3">
          Three or more records matched. Open each and merge them in pairs - a bulk merge across
          more than two rows is too easy to get the wrong way round.
        </p>
      )}
    </Card>
  );
}

function GroupList({
  groups,
  mergeable,
  emptyBody,
}: {
  groups: DuplicateGroup[];
  mergeable: boolean;
  emptyBody: string;
}) {
  if (groups.length === 0) {
    return <EmptyState icon={<Copy size={20} />} title="No duplicates found" body={emptyBody} />;
  }
  return (
    <div className="space-y-3">
      {groups.map((g) => (
        <GroupCard key={`${g.on}-${g.key}`} group={g} mergeable={mergeable} />
      ))}
    </div>
  );
}

export function DuplicatesPanel({ report, canMerge }: { report: DuplicatesReport; canMerge: boolean }) {
  return (
    <div className="space-y-4">
      {report.truncated && (
        <p className="rounded-card border border-warn bg-warn-soft px-4 py-3 text-caption text-warn-ink">
          More duplicate groups exist than are shown - this list is capped. Merge these, then
          reload to see the next batch.
        </p>
      )}
      {report.unidentifiableLeads > 0 && (
        <p className="rounded-card border border-line bg-surface-2 px-4 py-3 text-caption text-ink-2">
          <strong>{report.unidentifiableLeads.toLocaleString("en-IN")}</strong> contacts have
          neither a phone number nor an email. They cannot be matched against anything, so they
          are invisible to the phone and email checks - the &ldquo;Same name&rdquo; tab is the
          only view of them, and it is a weaker signal.
        </p>
      )}

      <Tabs
        tabs={[
          {
            label: `Contacts (${report.leads.length})`,
            content: (
              <GroupList
                groups={report.leads}
                mergeable={canMerge}
                emptyBody="No two contacts share a phone number, an email, or a name-and-city with no other details."
              />
            ),
          },
          {
            label: `Students (${report.students.length})`,
            content: (
              <GroupList
                groups={report.students}
                // Merging students would move payments, agreements and tracker history between
                // records - a bigger decision than a contact merge, and not built yet. The
                // report still surfaces them, because a split student record misreports revenue.
                mergeable={false}
                emptyBody="No two students share an email address."
              />
            ),
          },
          {
            label: `Logins (${report.users.length})`,
            content: (
              <GroupList
                groups={report.users}
                mergeable={false}
                emptyBody="No two logins share an email address (ignoring capitalisation)."
              />
            ),
          },
        ]}
      />
    </div>
  );
}

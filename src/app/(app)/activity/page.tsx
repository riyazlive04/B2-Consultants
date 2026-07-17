import Link from "next/link";
import { LayoutList, ShieldCheck, Table2 } from "lucide-react";
import { Card, CardTitle, EmptyState, Grid, PageHeader, Panel, Stat } from "@/components/ui/kit";
import { requireSection } from "@/lib/rbac";
import {
  getActivityFilterOptions,
  getActivityPage,
  getActivityStats,
  hasActiveFilters,
  parseActivityFilters,
} from "@/server/activity-metrics";
import { ActivityFilters } from "./_components/ActivityFilters";
import { ActivityFeed, ActivityTable } from "./_components/ActivityViews";

export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;

/**
 * The activity log — who did what, when, across the whole app.
 *
 * Gated on the `activity` section, which is `locked` in the catalogue: ADMIN-only and not
 * switchable off. A log the people it reports on can read or hide is not a log.
 *
 * Two views over one query. The FEED is for "what's been happening today"; the TABLE is for
 * "what exactly did Asma do at 3pm" — timestamps to the second, in IST, always. Both live in
 * the URL alongside the filters, so any view of this page is a link worth sending.
 */
export default async function ActivityPage({ searchParams }: { searchParams: SP }) {
  await requireSection("activity");

  const view = (Array.isArray(searchParams.view) ? searchParams.view[0] : searchParams.view) === "table" ? "table" : "feed";
  const filters = parseActivityFilters(searchParams);
  const active = hasActiveFilters(filters);

  const [{ rows, total, pages }, options, stats] = await Promise.all([
    getActivityPage(filters),
    getActivityFilterOptions(),
    getActivityStats(),
  ]);

  const qs = (over: Record<string, string | number | undefined>) => {
    const p = new URLSearchParams();
    const merged = {
      view,
      q: filters.q,
      actor: filters.actorId,
      section: filters.section,
      action: filters.action,
      from: filters.from,
      to: filters.to,
      page: filters.page > 1 ? filters.page : undefined,
      ...over,
    };
    for (const [k, v] of Object.entries(merged)) if (v !== undefined && v !== "") p.set(k, String(v));
    return `/activity?${p.toString()}`;
  };

  return (
    <div className="w-full space-y-6">
      <PageHeader
        icon={<ShieldCheck size={22} strokeWidth={1.8} />}
        eyebrow="Oversight"
        title="Activity Log"
        subtitle="Every action anyone takes in the app, stamped with the exact time it happened. Append-only — entries can never be edited or removed, including by an admin."
      />

      <Grid cols={3}>
        <Panel>
          <Stat label="Actions today" value={stats.today.toLocaleString("en-IN")} />
        </Panel>
        <Panel>
          <Stat label="People active today" value={stats.actors.toLocaleString("en-IN")} />
        </Panel>
        <Panel>
          <Stat label="Actions on record" value={stats.total.toLocaleString("en-IN")} />
        </Panel>
      </Grid>

      {stats.total === 0 ? (
        <Card title={<CardTitle icon={<ShieldCheck size={17} />}>Activity</CardTitle>}>
          <EmptyState
            title="Nothing logged yet"
            body="The log starts filling the moment anyone records a call, edits a lead, or changes a setting. It only captures actions taken from now on — it can't reconstruct what happened before it existed."
          />
        </Card>
      ) : (
        <Card
          title={<CardTitle icon={<ShieldCheck size={17} />}>Activity</CardTitle>}
          subtitle={
            total === 0
              ? "No actions match these filters"
              : `${total.toLocaleString("en-IN")} action${total === 1 ? "" : "s"}${active ? " matching" : ""} · newest first`
          }
        >
          <div className="space-y-4">
            <ActivityFilters options={options} current={{ actor: filters.actorId, section: filters.section, action: filters.action, from: filters.from, to: filters.to, q: filters.q }} view={view} active={active} />

            {/* Tabs as links, not client state: the view has to survive a filter submit and
                be part of the URL the founder copies. */}
            <div className="flex items-center gap-1.5 border-b border-line pb-3">
              <ViewTab href={qs({ view: "feed", page: undefined })} current={view === "feed"} icon={<LayoutList size={14} />}>
                Feed
              </ViewTab>
              <ViewTab href={qs({ view: "table", page: undefined })} current={view === "table"} icon={<Table2 size={14} />}>
                Table
              </ViewTab>
            </div>

            {view === "feed" ? <ActivityFeed rows={rows} /> : <ActivityTable rows={rows} />}

            {pages > 1 && (
              <div className="flex items-center justify-between border-t border-line pt-3 text-sm">
                <span className="text-muted">
                  Page {filters.page} of {pages} · showing {rows.length} of {total.toLocaleString("en-IN")}
                </span>
                <div className="flex gap-3">
                  {filters.page > 1 && (
                    <Link href={qs({ page: filters.page - 1 })} className="font-semibold text-primary-strong hover:underline">
                      ← Newer
                    </Link>
                  )}
                  {filters.page < pages && (
                    <Link href={qs({ page: filters.page + 1 })} className="font-semibold text-primary-strong hover:underline">
                      Older →
                    </Link>
                  )}
                </div>
              </div>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}

function ViewTab({
  href,
  current,
  icon,
  children,
}: {
  href: string;
  current: boolean;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={current ? "page" : undefined}
      className={`inline-flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-caption font-semibold transition-colors ${
        current
          ? "border-primary bg-primary text-on-accent"
          : "border-line bg-surface text-ink-2 hover:border-line-strong hover:bg-surface-2"
      }`}
    >
      {icon}
      {children}
    </Link>
  );
}

export const metadata = { title: "Activity Log" };

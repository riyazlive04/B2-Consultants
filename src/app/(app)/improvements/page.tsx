import Link from "next/link";
import { Inbox, MessageSquareWarning, PowerOff } from "lucide-react";
import { Card, CardTitle, EmptyState, Grid, PageHeader, Panel, Stat } from "@/components/ui/kit";
import { requireSection } from "@/lib/rbac";
import { hasCapability } from "@/lib/capabilities";
import { getResolvedSections } from "@/server/founder-config";
import {
  getImprovementDetail,
  getImprovementPage,
  getImprovementReporters,
  getImprovementSectionTally,
  getImprovementStats,
  hasActiveImprovementFilters,
  parseImprovementFilters,
} from "@/server/improvements";
import { ImprovementFilters } from "./_components/ImprovementFilters";
import { ImprovementTable } from "./_components/ImprovementTable";
import { ImprovementDetail } from "./_components/ImprovementDetail";

export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;

/**
 * IMPROVEMENT REPORTS - what people hit while using the app.
 *
 * Gated on the `improvements` section (ADMIN by default). Reading and WORKING the queue are separate:
 * the status buttons need `improvements.triage`, which exists so a developer can hold a seat that works
 * this screen and nothing else.
 *
 * Everyone can FILE one - the Report button is in the shell for all six roles. That asymmetry is
 * the design, not an oversight: the people most likely to hit a dead end are the ones least
 * likely to have any other way of telling anybody.
 *
 * Both the open report and the filters live in the URL, so any view of this screen is a link
 * worth sending - and the notification email's deep link is just `?ref=IMP-0001`.
 */
export default async function ImprovementsPage({ searchParams }: { searchParams: SP }) {
  const session = await requireSection("improvements");
  const canTriage = hasCapability(session.role, session.capabilities, "improvements.triage");

  const filters = parseImprovementFilters(searchParams);
  const active = hasActiveImprovementFilters(filters);
  const openId = (Array.isArray(searchParams.improvement) ? searchParams.improvement[0] : searchParams.improvement) || null;

  const [{ rows, total, pages }, stats, tally, reporters, sections] = await Promise.all([
    getImprovementPage(filters),
    getImprovementStats(),
    getImprovementSectionTally(),
    getImprovementReporters(),
    getResolvedSections(),
  ]);

  /**
   * `?ref=` (from an email) resolves to the report it names, so a deep link opens the thing it
   * promised rather than a filtered list of one.
   */
  const detailId = openId ?? (filters.ref && rows.length === 1 ? rows[0].id : null);
  const detail = detailId ? await getImprovementDetail(detailId) : null;

  const label = (key: string | null) =>
    key ? (sections.find((s) => s.key === key)?.label ?? key) : "Elsewhere";

  const qs = (over: Record<string, string | number | undefined>) => {
    const p = new URLSearchParams();
    const merged = {
      status: filters.status,
      kind: filters.kind ?? undefined,
      severity: filters.severity ?? undefined,
      section: filters.section ?? undefined,
      reporter: filters.reporterId ?? undefined,
      ref: filters.ref ?? undefined,
      page: filters.page > 1 ? filters.page : undefined,
      ...over,
    };
    for (const [k, v] of Object.entries(merged)) if (v !== undefined && v !== "") p.set(k, String(v));
    return `/improvements?${p.toString()}`;
  };

  return (
    <div className="w-full space-y-6">
      <PageHeader
        icon={<MessageSquareWarning size={22} strokeWidth={1.8} />}
        eyebrow="Oversight"
        title="Improvements"
        subtitle="Everything people hit while using the app, with the screen and the context already attached. Anyone can file one - the button is in the top bar on every screen."
      />

      <Grid cols={4}>
        <Panel>
          <Stat label="Waiting to be read" value={stats.untriaged} tone={stats.untriaged ? "primary" : "neutral"} />
        </Panel>
        <Panel>
          <Stat label="Open" value={stats.open} />
        </Panel>
        <Panel>
          <Stat
            label="Blocking someone"
            value={stats.blocking}
            tone={stats.blocking ? "bad" : "neutral"}
          />
        </Panel>
        {/*
          The fourth number is the one worth having. It counts open reports filed against a screen
          whose engine was switched OFF at the time - which in this app is usually not a bug at
          all. Seeing it here is what stops somebody working through six of them one at a time.
        */}
        <Panel>
          <Stat
            label="Screen was switched off"
            value={stats.engineOff}
            tone={stats.engineOff ? "warn" : "neutral"}
          />
        </Panel>
      </Grid>

      {detail && <ImprovementDetail detail={detail} canTriage={canTriage} />}

      <Card
        title={<CardTitle icon={<Inbox size={17} />}>Queue</CardTitle>}
        subtitle={
          stats.total === 0
            ? undefined
            : total === 0
              ? "No improvements match these filters"
              : `${total} improvement${total === 1 ? "" : "s"}${active ? " matching" : ""} · newest first`
        }
      >
        <div className="space-y-4">
          {stats.total === 0 ? (
            /*
              A genuine good-news empty state: nothing has been reported. No action belongs on it -
              the control that fills this screen is the Suggest-an-improvement button in the top bar, which is
              already on every screen including this one. Listed as a deliberate exception in
              lib/__tests__/empty-states.test.ts.
            */
            <EmptyState
              icon={<Inbox size={22} />}
              title="Nothing reported yet"
              body="When anyone suggests an improvement from the top bar, it lands here with the screen they were on, their role, and whether the engine behind that screen was even switched on."
            />
          ) : (
            <>
              <ImprovementFilters
                current={{
                  status: filters.status,
                  kind: filters.kind,
                  severity: filters.severity,
                  section: filters.section,
                  reporter: filters.reporterId,
                }}
                sections={tally.map((t) => ({
                  value: t.sectionKey ?? "",
                  label: `${label(t.sectionKey)} (${t.count})`,
                }))}
                reporters={reporters.map((r) => ({ value: r.id, label: r.name }))}
                active={active}
              />

              {rows.length === 0 ? (
                <EmptyState
                  title="Nothing matches"
                  body="Nothing fits these filters."
                  action={
                    <Link
                      href="/improvements"
                      className="inline-flex h-10 items-center rounded-btn bg-primary px-4 text-sm font-semibold text-on-accent"
                    >
                      Clear the filters
                    </Link>
                  }
                />
              ) : (
                <ImprovementTable rows={rows} openId={detail?.id ?? null} />
              )}

              {pages > 1 && (
                <div className="flex items-center justify-between border-t border-line pt-3 text-sm">
                  <span className="text-muted">
                    Page {filters.page} of {pages} · showing {rows.length} of {total}
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
            </>
          )}
        </div>
      </Card>

      {/*
        WHICH PART OF THE APP HURTS.
        The only evidence-based answer to "where should the next week of work go", and this app has
        never had it. Open reports only - a section that generated ten reports and had them all
        fixed is not where the next week goes.
      */}
      {tally.length > 1 && (
        <Card title={<CardTitle icon={<PowerOff size={17} />}>Where the reports come from</CardTitle>}>
          <ul className="space-y-2">
            {tally.slice(0, 10).map((t) => (
              <li key={t.sectionKey ?? "none"} className="flex items-center gap-3">
                <Link
                  href={qs({ section: t.sectionKey ?? undefined, page: undefined })}
                  className="w-44 flex-none truncate text-sm font-medium text-primary-strong hover:underline"
                >
                  {label(t.sectionKey)}
                </Link>
                <span className="h-2 flex-1 overflow-hidden rounded-full bg-surface-2">
                  <span
                    className="block h-full rounded-full bg-primary"
                    style={{ width: `${Math.round((t.count / tally[0].count) * 100)}%` }}
                  />
                </span>
                <span className="w-8 flex-none text-right text-caption tnum text-ink-2">{t.count}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

export const metadata = { title: "Improvements" };

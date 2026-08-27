import { AlertTriangle, Award, BarChart3, Kanban, MessageCircle, Percent, Phone, PhoneCall, PhoneOff, TrendingUp, Trophy, UserPlus, Workflow } from "lucide-react";
import { MetricCard } from "@/components/ui/MetricCard";
import { LeadFlowChart } from "./_components/LeadFlowChart";
import { Tabs } from "@/components/ui/Tabs";
import { SendWhatsAppButton } from "@/components/ui/SendWhatsAppButton";
import { sendLeadReminder } from "@/server/whatsapp-actions";
import { istMonthRange, istToday, toDateInputValue } from "@/lib/dates";
import { formatDate, formatInrMinor, formatPct } from "@/lib/format";
import { hasCapability, requireSection } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { getActiveLevels } from "@/server/levels";
import { levelOptions } from "@/lib/levels";
import { Card, CardTitle, PageHeader, Pill } from "@/components/ui/kit";
import { LEAD_SOURCE_LABELS } from "@/lib/labels";
import { getPipelineOverview, getKanbanLeads, getPipelineAging, KANBAN_STAGES } from "@/server/pipeline-metrics";
import { getPipelineConfig, getCallDistribution } from "@/server/founder-config";
import { getWhatsAppStatusMap } from "@/server/whatsapp";
import { getFirstCallSplit } from "@/server/assignment";
import { countAssignableLeads } from "@/server/pipeline-actions";
import { LeadSection } from "./_components/LeadSection";
import { HandOutLeads } from "./_components/HandOutLeads";
import { KanbanBoard } from "./_components/KanbanBoard";
import { OutcomeSection } from "./_components/OutcomeSection";
import { StageChart } from "./_components/StageChart";
import { TargetBar } from "./_components/TargetBar";
import { AgingSection } from "./_components/AgingSection";
import { ArchivedGroups } from "@/components/ui/ArchivedGroups";
import { InfoHint } from "@/components/ui/InfoHint";
import { PeriodBar } from "@/components/ui/PeriodBar";
import { SectionLink } from "@/components/ui/SectionLink";
import { parsePeriod, resolvePeriod } from "@/lib/period";
import { getArchivedLeads } from "@/server/archive-metrics";
import { restoreLead, purgeLead } from "@/server/contacts-actions";

export const dynamic = "force-dynamic";

export default async function PipelinePage({
  searchParams,
}: {
  searchParams?: { period?: string; on?: string; from?: string; to?: string; range?: string };
}) {
  const session = await requireSection("pipeline");
  // The window every "this month" figure below covers. Previously fixed to the current calendar
  // month, advertised by a `<Pill>This month</Pill>` that was text, not a control.
  const periodSpec = parsePeriod(searchParams ?? {});
  const period = resolvePeriod(periodSpec);
  // Two different questions, deliberately answered by two different things:
  //   isAdmin           → WHOSE leads you see (everyone's, or only your own)
  //   canConfigure      → whether you may set the target, reassign, or delete
  // Admins always hold the capability, so nothing changes for them.
  const isAdmin = session.role === "ADMIN";
  const canConfigure = hasCapability(session.role, session.capabilities, "pipeline.configure");
  const canPurge = session.role === "ADMIN";
  // ── Wave 1: every independent read in one round-trip. On Supabase (~204ms RTT,
  // connection_limit) these used to run as ~7 sequential awaits (~1.4s of pure latency);
  // none of them depends on another, so they fan out in a single Promise.all.
  //   · aging (1.7) is founder-facing - a non-admin only sees their own board, so a global
  //     aging table would surface leads that aren't theirs. Admin-only, like the split card.
  //   · the viewer's log variant is only needed for a non-admin (admins see both tabs).
  const [
    archLeads,
    overview,
    callSplit,
    aging,
    activeLevels,
    pipelineConfig,
    viewerProfile,
    callDistribution,
  ] = await Promise.all([
      getArchivedLeads(),
      getPipelineOverview(session.user.id, isAdmin, period),
      isAdmin ? getFirstCallSplit() : Promise.resolve(null),
      isAdmin ? getPipelineAging() : Promise.resolve([] as Awaited<ReturnType<typeof getPipelineAging>>),
      getActiveLevels(),
      getPipelineConfig(),
      isAdmin
        ? Promise.resolve(null)
        : prisma.teamProfile.findUnique({
            where: { userId: session.user.id },
            select: { logVariant: true },
          }),
      getCallDistribution(),
    ]);

  const archivedCount = archLeads.length;
  const { metrics, target, leads, outcomes, leadOptions, assignees, callFirst, riskDeals } = overview;
  const levelOpts = levelOptions(activeLevels); // wonLevel accepts any level
  const { mode: pipelineMode } = pipelineConfig;
  const today = toDateInputValue(istToday());
  // PRD1 §5.1 duty split: the appointment setter (Nilofer) enters leads/outreach; the
  // discovery specialist (Asma) enters call outcomes. A member with no log variant set
  // sees both, so nobody is ever locked out of entry.
  const viewerVariant = isAdmin ? null : viewerProfile?.logVariant ?? null;

  // ── Wave 2: the only two reads that genuinely depend on Wave 1's results -
  // WhatsApp status needs the lead IDs, and the Kanban read is opt-in (Founder Console →
  // Operations), gated on the config mode so we don't pay for it unless it's chosen.
  const [waByLead, kanbanLeads, assignableCount] = await Promise.all([
    getWhatsAppStatusMap("leadId", leads.map((l) => l.id)),
    pipelineMode === "drag_drop"
      ? getKanbanLeads(session.role, session.user.id)
      : Promise.resolve([] as Awaited<ReturnType<typeof getKanbanLeads>>),
    // Only the people who can assign need the figure, and it is a count over a growth table.
    canConfigure ? countAssignableLeads() : Promise.resolve(0),
  ]);
  const showLeads = isAdmin || viewerVariant === null || viewerVariant === "APPOINTMENT_SETTER";
  const showOutcomes = isAdmin || viewerVariant === null || viewerVariant === "DISCOVERY_SPECIALIST";

  const conv = metrics.conversionsByLevel;
  const wonCount = conv.SOLO + conv.GUIDED + conv.ELITE;

  // % of target the calendar expects by today - the TargetBar judges pace with it
  const now = istToday();
  const monthRange = istMonthRange(now);
  const daysInMonth = Math.round((monthRange.end.getTime() - monthRange.start.getTime()) / 86400000);
  const expectedPct = Math.min(100, (now.getUTCDate() / daysInMonth) * 100);

  // Lead flow, one column per day for the last 7 days (+ delta vs the 7 before)
  const t = istToday();
  const dayKey = (d: Date) => d.toISOString().slice(0, 10);
  const countOn = (k: string) => leads.filter((l) => l.dateIn.slice(0, 10) === k).length;
  const weekdayFmt = new Intl.DateTimeFormat("en-GB", { weekday: "short" });
  const dayItems = Array.from({ length: 7 }, (_, idx) => {
    const d = new Date(t);
    d.setUTCDate(t.getUTCDate() - (6 - idx));
    const count = countOn(dayKey(d));
    // The SAME weekday one week earlier. Lead flow is strongly day-of-week shaped - a quiet
    // Sunday against a busy Saturday reads as a collapse, against last Sunday it reads as normal.
    // This is the honest comparator, and it is why the compare series is offset by exactly 7 days
    // rather than being the previous 7-day block slid along.
    const prior = new Date(t);
    prior.setUTCDate(t.getUTCDate() - (6 - idx) - 7);
    return {
      label: weekdayFmt.format(d),
      fullLabel: formatDate(d),
      value: count,
      priorValue: countOn(dayKey(prior)),
      display: String(count),
    };
  });
  const last7 = dayItems.reduce((s, i) => s + i.value, 0);
  const prior7 = dayItems.reduce((s, i) => s + i.priorValue, 0);
  const weekDeltaPct = prior7 > 0 ? Math.round(((last7 - prior7) / prior7) * 100) : null;

  // close-rate gauge (ring fills with close rate; centre = won count)
  const gaugeR = 62;
  const gaugeC = 2 * Math.PI * gaugeR;
  const gaugeFrac = Math.max(0, Math.min(1, metrics.closePct / 100));

  return (
    <div className="w-full space-y-6">
      <PageHeader
        icon={<Workflow size={20} />}
        title="Pipeline"
        subtitle={
          isAdmin
            ? "Every lead from first contact to paid student - auto-calculated for the window you pick."
            : "Enter leads and discovery call outcomes. You see only your own entries."
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {/* Opportunities and Outreach came OFF the sidebar (the Sales group was five entries
                for what is one job). They are reachable from here - the screen they belong to -
                so nothing became unreachable, and `requireSection` still gates each one. */}
            <SectionLink href="/opportunities" sectionKey="opportunities">
              <Kanban size={14} /> Board view
            </SectionLink>
            <SectionLink href="/outreach" sectionKey="outreach">
              <MessageCircle size={14} /> Outreach queue
            </SectionLink>
            <PeriodBar spec={periodSpec} />
          </div>
        }
      />

      {/* The target bar follows the CAPABILITY, not the role - that's what makes
          "Configure telecaller board" worth granting to a non-Admin. */}
      {canConfigure && (
        <TargetBar
          month={target.month}
          targetInrMinor={target.targetInrMinor}
          revenueInrMinor={target.revenueInrMinor}
          pct={target.pct}
          expectedPct={expectedPct}
          isAdmin={canConfigure}
          avgFeeInrMajor={metrics.avgFeeInrMajor}
          avgFeeFromIncome={metrics.avgFeeFromIncome}
        />
      )}

      {isAdmin && (
        <>
          {/* Hero bento - value cards, completion progress, close-rate gauge */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="flex flex-col gap-4">
              <div className="hero-sky flex-1 rounded-card p-5 shadow-card">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[13px] font-medium text-ink-2">Pipeline value</p>
                  <span className="rounded-full bg-surface/70 px-2 py-0.5 text-caption font-medium text-ink-2">
                    <TrendingUp size={11} className="mr-1 inline" />
                    {formatInrMinor(metrics.forecast30Inr, { compact: true })} 30-day forecast
                  </span>
                </div>
                <p className="mt-2 font-display text-3xl font-bold tracking-tight text-ink">
                  {formatInrMinor(metrics.pipelineValueInr, { compact: true })}
                </p>
                <p className="mt-1 text-xs text-ink-3">
                  {metrics.avgFeeKnown ? "Open leads × avg program fee" : "Needs income history to learn avg fee"}
                </p>
              </div>
              <div className="flex-1 rounded-card border border-line bg-surface p-5 shadow-card">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[13px] font-medium text-muted">Leads · {period.label}</p>
                  <Pill tone="primary">+{metrics.leadsThisWeek} this week</Pill>
                </div>
                <p className="mt-2 font-display text-3xl font-bold tracking-tight">{metrics.leadsThisMonth}</p>
                <p className="mt-1 text-xs text-muted">First contact to closed, all sources</p>
              </div>
            </div>

            <Card title={<CardTitle icon={<PhoneCall size={18} />}>Calls completed</CardTitle>}>
              <p className="font-display text-4xl font-bold tracking-tight">
                {metrics.completed}
                <span className="ml-2 align-middle text-sm font-medium text-muted">of {metrics.booked} booked</span>
              </p>
              <div className="mt-4 h-3 overflow-hidden rounded-full bg-surface-2">
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${metrics.booked > 0 ? Math.min(100, (metrics.completed / metrics.booked) * 100) : 0}%`,
                    background: "var(--primary)",
                  }}
                />
              </div>
              <div className="mt-3 flex items-center justify-between text-xs text-muted">
                <span>Show-up rate {formatPct(metrics.showUpPct)}</span>
                <span>No-show {formatPct(metrics.noShowPct)}</span>
              </div>
            </Card>

            <Card title={<CardTitle icon={<Trophy size={18} />}>Won · {period.label}</CardTitle>}>
              <div className="flex flex-col items-center">
                <div className="relative grid place-items-center">
                  <svg width={156} height={156} viewBox="0 0 156 156" className="-rotate-90">
                    <circle cx="78" cy="78" r={gaugeR} fill="none" stroke="var(--surface-2)" strokeWidth="12" />
                    <circle
                      cx="78"
                      cy="78"
                      r={gaugeR}
                      fill="none"
                      stroke="var(--ok)"
                      strokeWidth="12"
                      strokeLinecap="round"
                      strokeDasharray={gaugeC}
                      strokeDashoffset={gaugeC * (1 - gaugeFrac)}
                    />
                  </svg>
                  <div className="absolute flex flex-col items-center">
                    <span className="font-display text-4xl font-bold tracking-tight">{wonCount}</span>
                    <span className="text-xs font-medium text-muted">new students</span>
                  </div>
                </div>
                <p className="mt-2 text-xs text-muted">
                  Close rate {formatPct(metrics.closePct)}
                  <InfoHint
                    className="ml-1"
                    text="Deals won ÷ discovery calls conducted in the selected window - the share of completed calls that turned into paying students."
                  />
                  {" · "}Solo {conv.SOLO} · Guided {conv.GUIDED} · Elite {conv.ELITE}
                </p>
                <p className="tnum mt-1 text-caption text-ink-3">typical 2026 month ≈ 4 wins (range 2–7)</p>
              </div>
            </Card>
          </div>

          {/* Lead flow by day + hottest leads */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card
              title={<CardTitle icon={<BarChart3 size={18} />}>New leads - last 7 days</CardTitle>}
              subtitle={`${last7} lead(s) in the last 7 days.`}
              actions={
                weekDeltaPct !== null ? (
                  <Pill tone={weekDeltaPct >= 0 ? "good" : "bad"}>
                    {weekDeltaPct >= 0 ? "+" : ""}
                    {weekDeltaPct}% vs prior week
                  </Pill>
                ) : undefined
              }
            >
              <LeadFlowChart items={dayItems} />
            </Card>

            <Card
              title={<CardTitle icon={<Phone size={18} />}>Call these first</CardTitle>}
              subtitle="Ranked by BANT, qualification, stage and freshness - the hottest open leads."
            >
              <ol className="space-y-2">
                {callFirst.map((l, i) => (
                  <li key={l.id} className="flex flex-wrap items-center gap-2 rounded-field border border-line bg-surface-2 px-3 py-2 text-sm">
                    <span className="font-display font-semibold text-muted">{i + 1}.</span>
                    <span className="font-semibold">{l.name}</span>
                    <span className="tnum text-xs text-muted">{l.phone}</span>
                    <span className="ml-auto flex flex-wrap items-center gap-1">
                      {l.reasons.map((r) => (
                        <Pill key={r} tone="primary">{r}</Pill>
                      ))}
                      <SendWhatsAppButton action={sendLeadReminder.bind(null, l.id)} label="Remind" />
                    </span>
                  </li>
                ))}
                {callFirst.length === 0 && <p className="text-sm text-muted">No open leads to rank.</p>}
              </ol>
            </Card>
          </div>

          {/* Live funnel + deal risk */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <StageChart leads={leads} />
            </div>
            <Card
              title={<CardTitle icon={<AlertTriangle size={18} className="text-risk" />}>Deals at risk</CardTitle>}
              subtitle="Ghosted, stalled or aging - recover these before they die in the follow-up gap."
            >
              <ul className="space-y-2">
                {riskDeals.map((l) => (
                  <li key={l.id} className="flex flex-wrap items-center gap-2 rounded-field px-3 py-2 text-sm" style={{ background: "var(--risk-soft)" }}>
                    <span className="font-semibold">{l.name}</span>
                    <span className="tnum text-xs text-muted">{l.phone}</span>
                    <span className="ml-auto flex items-center gap-2 text-xs font-medium text-risk">
                      {l.risk}
                      <SendWhatsAppButton action={sendLeadReminder.bind(null, l.id)} label="Remind" />
                    </span>
                  </li>
                ))}
                {riskDeals.length === 0 && <p className="text-sm text-muted">Nothing at risk right now. 🌿</p>}
              </ul>
            </Card>
          </div>

          {/* Remaining KPIs not already on a bento card */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <MetricCard
              label="Leads this week"
              value={metrics.leadsThisWeek}
              icon={<UserPlus size={18} />}
              detail={{
                rows: metrics.leadsThisWeekBySource.map((s) => ({
                  label: LEAD_SOURCE_LABELS[s.source] ?? s.source,
                  value: s.count,
                })),
              }}
            />
            <MetricCard
              label="Calls booked"
              value={metrics.booked}
              icon={<PhoneCall size={18} />}
              detail={{
                rows: [
                  { label: "Completed", value: metrics.completed },
                  { label: "No-show", value: metrics.noShows },
                  { label: "Awaiting outcome", value: Math.max(0, metrics.booked - metrics.completed - metrics.noShows) },
                ],
              }}
            />
            {/* Rate tiles carry the 2026 sheet benchmarks (SALES-LOGIC §4) - a rate
                without its normal range is just a number. Signals band vs the range,
                not vs generic 50/80 cutoffs. */}
            <MetricCard
              label="Show-up rate"
              value={formatPct(metrics.showUpPct)}
              secondary="Completed ÷ booked"
              target="typ. 52–70%"
              tooltip="Discovery calls conducted ÷ booked. The 2026 sheets run 52–70% at this stage (the famous 91.6% show rate is the later sales call, not this one)."
              progress={metrics.showUpPct / 100}
              icon={<Percent size={18} />}
              signal={metrics.booked === 0 ? undefined : metrics.showUpPct >= 52 ? "ok" : metrics.showUpPct >= 40 ? "watch" : "risk"}
              detail={{
                rows: [
                  { label: "Completed", value: metrics.completed },
                  { label: "Booked", value: metrics.booked },
                  { label: "No-show", value: metrics.noShows },
                ],
              }}
            />
            <MetricCard
              label="No-show rate"
              value={formatPct(metrics.noShowPct)}
              secondary="No shows ÷ booked"
              target="goal ≤ 20%"
              progress={metrics.noShowPct / 100}
              icon={<PhoneOff size={18} />}
              signal={metrics.booked === 0 ? undefined : metrics.noShowPct <= 20 ? "ok" : metrics.noShowPct <= 40 ? "watch" : "risk"}
              detail={{
                rows: [
                  { label: "No-shows", value: metrics.noShows },
                  { label: "Booked", value: metrics.booked },
                  { label: "Completed", value: metrics.completed },
                ],
              }}
            />
            <MetricCard
              label="Highly qualified rate"
              value={formatPct(metrics.hqPct)}
              secondary="HQ calls ÷ completed"
              target="typ. 27–47%"
              tooltip="Highly-qualified outcomes ÷ discovery calls conducted. 2026 sheet average is 37%, ranging 27–47% - below 27% means lead quality or triage is slipping."
              progress={metrics.hqPct / 100}
              icon={<Award size={18} />}
              signal={metrics.monthOutcomes === 0 ? undefined : metrics.hqPct >= 27 ? "ok" : metrics.hqPct >= 15 ? "watch" : "risk"}
              detail={{
                rows: [
                  { label: "Highly qualified", value: metrics.hqOutcomes },
                  { label: "Completed calls", value: metrics.monthOutcomes },
                  { label: "Not highly qualified", value: Math.max(0, metrics.monthOutcomes - metrics.hqOutcomes) },
                ],
              }}
            />
            <MetricCard
              label="Conversions by level"
              value={
                <span className="text-2xl">
                  {conv.SOLO} · {conv.GUIDED} · {conv.ELITE}
                </span>
              }
              secondary={`Won · ${period.label}: Solo · Guided · Elite`}
              icon={<Trophy size={18} />}
              detail={{
                rows: [
                  { label: "Solo", value: conv.SOLO },
                  { label: "Guided", value: conv.GUIDED },
                  { label: "Elite", value: conv.ELITE },
                  { label: "Other", value: conv.OTHER },
                ],
              }}
            />
          </div>

          {/* First-call split - target vs actual per the assignment rules (client notes) */}
          {callSplit && (
            <Card
              title={
                <CardTitle icon={<PhoneCall size={18} />}>
                  First-call split - last {callSplit.lookbackDays} days
                </CardTitle>
              }
              subtitle="New leads are auto-assigned toward each person's target share; reassign any lead below. Set the shares and the rules in Console → Call Distribution."
              actions={
                callSplit.isSaturday && callSplit.members.some((m) => m.offToday) ? (
                  <Pill tone="warn">
                    Saturday - {callSplit.members.filter((m) => m.offToday).map((m) => m.name).join(", ")} off today
                  </Pill>
                ) : undefined
              }
            >
              {callSplit.members.length === 0 ? (
                <p className="text-sm text-muted">
                  No one is in the first-call rotation yet - set a &quot;First-call share %&quot; on a team profile.
                </p>
              ) : (
                <div className="space-y-3">
                  {/* The engine normalises the shares, so a set that doesn't total 100 still works
                      - it just doesn't mean what the raw numbers say. This card used to print the
                      raw figure, so 5 and 2 read as "5% target / 2% target" while the engine ran
                      71/29. Say so rather than quietly showing a number nothing uses. */}
                  {callSplit.sharesNormalised && (
                    <p className="rounded-field bg-surface-2 px-3 py-2 text-xs text-muted">
                      The configured shares don&apos;t total 100, so they are treated as relative
                      weights. The percentages below are what the rotation actually targets.
                    </p>
                  )}
                  {callSplit.members.map((m) => (
                    <div key={m.userId} className="flex items-center gap-3">
                      <span className="w-24 flex-none truncate text-sm font-medium sm:w-32" title={m.name}>{m.name}</span>
                      <div className="relative h-3 flex-1 overflow-hidden rounded-full bg-surface-2">
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${Math.min(100, m.actualPct)}%`, background: "var(--accent)" }}
                        />
                        <span
                          aria-hidden
                          title={`Target ${Math.round(m.effectivePct)}%`}
                          className="absolute top-[-2px] h-4 w-0.5 rounded bg-ink/50"
                          style={{ left: `${Math.min(100, m.effectivePct)}%` }}
                        />
                      </div>
                      <span className="w-48 flex-none text-right text-xs text-muted tnum">
                        {Math.round(m.actualPct)}% actual · {Math.round(m.effectivePct)}% target ·{" "}
                        {m.assignedInWindow} lead{m.assignedInWindow === 1 ? "" : "s"}
                        {m.atDailyCap && <span className="ml-1 text-warn">· at daily cap</span>}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          )}
        </>
      )}

      <Tabs
        tabs={[
          // Board first when the founder has chosen drag-and-drop - the mode they picked
          // should be the one they land on, not a tab they have to go find.
          ...(pipelineMode === "drag_drop"
            ? [{
                label: "Board",
                content: <KanbanBoard leads={kanbanLeads} stages={[...KANBAN_STAGES]} />,
              }]
            : []),
          ...(showLeads
            ? [{
                label: "Leads",
                content: (
                  <div className="space-y-5">
                    {/* Above the table on purpose: with 23,430 leads unowned, giving someone a
                        day's work is the first thing to do here, not a per-row afterthought. */}
                    {canConfigure && (
                      <HandOutLeads
                        assignees={assignees}
                        available={assignableCount}
                        splitByShareDefault={callDistribution.handOutSplitsByShare}
                      />
                    )}
                    <LeadSection rows={leads} today={today} isAdmin={canConfigure} assignees={assignees} levelOptions={levelOpts} waStatus={waByLead} />
                  </div>
                ),
              }]
            : []),
          ...(showOutcomes
            ? [{
                label: "Discovery call outcomes",
                content: (
                  <OutcomeSection rows={outcomes} leadOptions={leadOptions} today={today} isAdmin={canConfigure} />
                ),
              }]
            : []),
          ...(isAdmin
            ? [{
                label: "Aging",
                content: <AgingSection rows={aging} />,
              }]
            : []),
          {
            label: `Archived${archivedCount ? ` (${archivedCount})` : ""}`,
            content: (
              <ArchivedGroups
                canPurge={canPurge}
                groups={[
                  { label: "Leads", noun: "lead", rows: archLeads, restore: restoreLead, purge: purgeLead },
                ]}
              />
            ),
          },
        ]}
      />
    </div>
  );
}

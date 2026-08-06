import { SlidersHorizontal } from "lucide-react";
import { requireSection } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { istToday } from "@/lib/dates";
import { currentRuleset } from "@/lib/gamification";
import { Tabs } from "@/components/ui/Tabs";
import { PageHeader } from "@/components/ui/kit";
import {
  getAgreementWorkflow,
  getBookOrderConfig,
  getCommissionRulesConfig,
  getPipelineConfig,
  getTutorFeeConfig,
  getDailyLogEod,
  getDailyLogTargets,
  getGamificationConfig,
  getResolvedSections,
  getMaintenanceConfig,
  getScheduledReportConfig,
  getFinancePostingConfig,
  getInstalmentPlanConfig,
  getBookingCalendars,
  getSssPatternConfig,
  getSssConfig,
  getBookingRulesConfig,
  getSpeedToLeadAlertConfig,
  getDunningConfig,
  getAttendanceConfig,
} from "@/server/founder-config";
import { getGoalsWithProgress } from "@/server/goals";
import { listTutorFees } from "@/server/tutor-fees";
import { getAllQualificationQuestions, shadowAgreement } from "@/server/qualification";
import { getIntakeMappingReport } from "@/server/intake-inspection";
import { getCallDistribution } from "@/server/founder-config";
import { getBookableTeamMembers } from "@/server/booking-metrics";
import { listRewardGrants, listRewardRules } from "@/server/rewards";
import { SectionsPanel } from "./_components/SectionsPanel";
import { AccessMatrixPanel } from "./_components/AccessMatrixPanel";
import { GamificationPanel } from "./_components/GamificationPanel";
import { GoalsPanel } from "./_components/GoalsPanel";
import { RewardsPanel, type GrantView, type RuleRow } from "./_components/RewardsPanel";
import { CommissionPanel } from "./_components/CommissionPanel";
import { DailyTargetsPanel } from "./_components/DailyTargetsPanel";
import { DailyLogEodPanel } from "./_components/DailyLogEodPanel";
import { AgreementWorkflowPanel } from "./_components/AgreementWorkflowPanel";
import { TutorFeePanel } from "./_components/TutorFeePanel";
import { InstalmentPlanPanel } from "./_components/InstalmentPlanPanel";
import { TutorFeeLedgerPanel } from "./_components/TutorFeeLedgerPanel";
import { QualificationPanel } from "./_components/QualificationPanel";
import { CallDistributionPanel } from "./_components/CallDistributionPanel";
import { OperationsPanel } from "./_components/OperationsPanel";
import { AvailabilityPanel } from "./_components/AvailabilityPanel";
import { MaintenancePanel } from "./_components/MaintenancePanel";
import { AlertsPanel } from "./_components/AlertsPanel";
import { cronHealth } from "@/server/uptime";
import { errorCountLastHour, observabilityRuntime, recentErrors } from "@/lib/observability";
import { CAPABILITIES, effectiveCapabilities } from "@/lib/capabilities";
import type { AppRole } from "@/lib/sections";
import { PerPersonPanel } from "./_components/PerPersonPanel";
import { NotArmedPanel } from "./_components/NotArmedPanel";
import { getNotArmedReport } from "@/server/not-armed";

export const dynamic = "force-dynamic";

/**
 * Founder Console — the one screen where the app's own rules live.
 *
 * Everything here is config, not code: the sidebar, the XP engine, the goals the
 * team is chasing and the rewards that pay out when they hit them. The section is
 * `locked` in the catalogue, so it can never be switched off or handed to a
 * non-admin — there'd be no way back.
 */
export default async function ConsolePage() {
  await requireSection("console");

  const [
    sections,
    config,
    goals,
    rules,
    grants,
    people,
    commissionRules,
    dailyTargets,
    agreementWorkflow,
    dailyLogEod,
    tutorFee,
    bookOrders,
    pipelineConfig,
  ] = await Promise.all([
      getResolvedSections(),
      getGamificationConfig(),
      getGoalsWithProgress(),
      listRewardRules(),
      listRewardGrants(),
      prisma.teamProfile.findMany({
        where: { status: "ACTIVE" },
        select: { id: true, fullName: true },
        orderBy: { orderIndex: "asc" },
      }),
      getCommissionRulesConfig(),
      getDailyLogTargets(),
      getAgreementWorkflow(),
      getDailyLogEod(),
      getTutorFeeConfig(),
      getBookOrderConfig(),
      getPipelineConfig(),
    ]);

  // ER v2 Tracks C + D. Kept in their own Promise.all rather than appended to the tuple
  // above: that one is already at the length where an added entry silently shifts a
  // destructured name, and these two are unrelated to the config block.
  const [tutorFeeRows, qualificationQuestions, shadowStatus, inboundReport, callDistribution, roster, capabilityPeople, notArmed] =
    await Promise.all([
      listTutorFees(),
      getAllQualificationQuestions(),
      shadowAgreement(),
      getIntakeMappingReport(),
      getCallDistribution(),
      // The rotation roster. ACTIVE only — a former team member must not be offered a share of
      // future work, and `pickFirstCaller` excludes them anyway, so listing them would show a
      // control that does nothing.
      prisma.teamProfile.findMany({
        where: { status: "ACTIVE", userId: { not: null } },
        select: { id: true, fullName: true, roleTitle: true, firstCallSharePct: true, worksSaturdays: true },
        orderBy: [{ firstCallSharePct: "desc" }, { orderIndex: "asc" }],
      }),
      // Everyone with a login, for the per-person capability matrix. ACTIVE only: a suspended
      // account earns nothing and cannot sign in, so offering toggles for it is noise.
      prisma.user.findMany({
        where: { status: "ACTIVE" },
        orderBy: [{ role: "asc" }, { name: "asc" }],
        select: { id: true, name: true, role: true, capabilities: true },
      }),
      // "What is built, switched off, and silently doing nothing" — the one screen that tells a
      // disarmed feature apart from a broken one.
      getNotArmedReport(),
    ]);

  /**
   * Resolve each person's EFFECTIVE capabilities — role defaults merged with their overrides —
   * so the matrix shows what is actually true today, not just what has been explicitly set. A
   * grid that rendered only stored overrides would show every unset cell as "off" when the role
   * in fact grants it.
   */
  const perPersonRows = capabilityPeople.map((u) => {
    const held = effectiveCapabilities(u.role as AppRole, u.capabilities as Record<string, boolean> | null);
    return {
      id: u.id,
      name: u.name,
      role: u.role,
      held: Object.fromEntries(CAPABILITIES.map((c) => [c.key, held.has(c.key)])),
    };
  });

  const [
    maintenanceConfig,
    scheduledReportConfig,
    financePostingConfig,
    slotPattern,
    sssPattern,
    sssConfig,
    bookingRules,
    bookableMembers,
    instalmentPlans,
    speedToLeadConfig,
    dunningConfig,
    attendanceConfig,
  ] = await Promise.all([
    getMaintenanceConfig(),
    getScheduledReportConfig(),
    getFinancePostingConfig(),
    getBookingCalendars(),
    getSssPatternConfig(),
    getSssConfig(),
    getBookingRulesConfig(),
    // The same list the manual slot generator offers, so a pattern can't assign to someone the
    // hand-made path wouldn't.
    getBookableTeamMembers(),
    getInstalmentPlanConfig(),
    getSpeedToLeadAlertConfig(),
    getDunningConfig(),
    getAttendanceConfig(),
  ]);

  // The SSS diary's owner is a User (the founder), not a TeamProfile — resolve the name so the
  // panel can say whose calendar it is rather than showing a raw id.
  const sssOwner = sssConfig.ownerId
    ? await prisma.user.findUnique({ where: { id: sssConfig.ownerId }, select: { name: true, email: true } })
    : null;

  // Auto-save is the only rule here that needs an external clock. Read the seam's real
  // precondition so the panel can warn instead of claiming a rule that can never fire.
  const cronArmed = !!process.env.CRON_SECRET;
  // Same reasoning as cronArmed: a panel that claims a rule will email someone, when the email
  // channel is unarmed, is describing something that cannot happen.
  const emailArmed =
    process.env.EMAIL_ENABLED?.trim().toLowerCase() === "true" && !!process.env.RESEND_API_KEY?.trim();

  // System health for the Maintenance tab. `cronHealth` hits the database; the error ring buffer
  // and the runtime flags are in-process reads, so they cost nothing.
  const [cronRows] = await Promise.all([cronHealth()]);
  const obs = observabilityRuntime();
  const health = {
    crons: cronRows,
    errors: recentErrors(),
    errorsLastHour: errorCountLastHour(),
    trackingArmed: obs.armed,
    heartbeatArmed: !!process.env.UPTIME_HEARTBEAT_URL,
    environment: obs.environment,
  };

  // Reward triggers point at badges and quests by key — offer today's, not the code defaults.
  const live = currentRuleset(config, istToday().toISOString().slice(0, 10));
  const badgeOptions = live.employeeBadges.filter((b) => b.enabled).map((b) => ({ key: b.key, name: b.name, icon: b.icon }));
  const questOptions = live.quests.filter((q) => q.enabled).map((q) => ({ key: q.key, title: q.title, icon: q.icon }));
  const goalOptions = goals.filter((g) => g.goal.active).map((g) => ({ id: g.goal.id, name: g.goal.name }));

  // BigInt and Decimal don't cross the server/client boundary — send strings.
  const ruleRows: RuleRow[] = rules.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    kind: r.kind,
    active: r.active,
    roles: r.roles,
    amountInrMinor: r.amountInrMinor.toString(),
    amountEurMinor: r.amountEurMinor.toString(),
    perkLabel: r.perkLabel,
    trigger: r.parsedTrigger,
  }));

  const grantViews: GrantView[] = grants.map((g) => ({
    id: g.id,
    ruleName: g.ruleName,
    ruleKind: g.ruleKind,
    perkLabel: g.perkLabel,
    personName: g.personName,
    qualifiedOn: g.qualifiedOn.toISOString(),
    reason: g.reason,
    status: g.status,
    amountInr: g.amountInrMinor.toString(),
    amountEur: g.amountEurMinor.toString(),
  }));

  const pendingCount = grantViews.filter((g) => g.status === "PENDING").length;

  return (
    <div className="w-full space-y-6">
      <PageHeader
        eyebrow="Admin only"
        icon={<SlidersHorizontal size={20} />}
        title="Founder Console"
        subtitle="The rules of the app, in one place. Sections, the XP engine, the team's goals, and the rewards that pay out when they're hit — all editable, none of it hardcoded."
      />

      {/* -- TWO LEVELS, NOT TWENTY-ONE TABS -------------------------------------------
          This strip held 21 flat tabs. Nobody scans 21 of anything: "where do I set the
          commission split" became a left-to-right read every time, and adding the per-person
          matrix would have made it 22. Grouping is the whole fix - five families, each opening
          onto the tabs it owns, using the nested `underline` variant the Gamification panel
          already uses inside itself.

          Grouped by WHO ASKS THE QUESTION, not by which table the answer is stored in:
            Access      who can see and do what
            Money       every figure that turns into a rupee
            Sales ops   how leads are routed, scored and chased
            Delivery    students, tutors, agreements
            System      the plumbing: crons, alerts, health
      */}
      <Tabs
        tabs={[
          {
            label: "Access",
            content: (
              <Tabs
                variant="underline"
                tabs={[
                  { label: "Sections", content: <SectionsPanel sections={sections} /> },
                  // Read-only companion to Sections: the same access rules, checked against spec 3 (O3).
                  { label: "Access Matrix", content: <AccessMatrixPanel sections={sections} /> },
                  {
                    // The per-person half of the commission question, and of every other
                    // capability. Lives under Access because that is what it is.
                    label: "Per-person rules",
                    content: <PerPersonPanel people={perPersonRows} />,
                  },
                ]}
              />
            ),
          },
          {
            label: "Money",
            content: (
              <Tabs
                variant="underline"
                tabs={[
                  { label: "Commission", content: <CommissionPanel rules={commissionRules} /> },
                  // Next to Commission because it is the same kind of rule: a money figure the
                  // founder sets that Finance then applies to every new deal.
                  { label: "Instalment Plans", content: <InstalmentPlanPanel config={instalmentPlans} /> },
                  { label: "Tutor Fee", content: <TutorFeePanel config={tutorFee} /> },
                  {
                    label: `Tutor Fees${tutorFeeRows.filter((f) => f.status === "DRAFT").length ? ` (${tutorFeeRows.filter((f) => f.status === "DRAFT").length})` : ""}`,
                    content: (
                      <TutorFeeLedgerPanel
                        fees={tutorFeeRows}
                        accrualOn={financePostingConfig.tutorFeeAccrual.enabled}
                      />
                    ),
                  },
                ]}
              />
            ),
          },
          {
            label: "Sales ops",
            content: (
              <Tabs
                variant="underline"
                tabs={[
                  {
                    label: "Qualification",
                    content: (
                      <QualificationPanel
                        questions={qualificationQuestions}
                        shadow={shadowStatus}
                        inbound={inboundReport}
                      />
                    ),
                  },
                  {
                    label: "Call Distribution",
                    content: (
                      <CallDistributionPanel
                        config={callDistribution}
                        roster={roster.map((r) => ({
                          profileId: r.id,
                          name: r.fullName,
                          roleTitle: r.roleTitle,
                          sharePct: r.firstCallSharePct,
                          worksSaturdays: r.worksSaturdays,
                        }))}
                      />
                    ),
                  },
                  {
                    // The only tab here whose absence had a visible OUTWARD symptom: an empty
                    // public /book page, which is what "the booking section feels broken" was.
                    label: "Availability",
                    content: (
                      <AvailabilityPanel
                        calendars={slotPattern}
                        sss={sssPattern}
                        people={bookableMembers}
                        sssOwnerName={sssOwner?.name ?? sssOwner?.email ?? null}
                        sssDurationMins={sssConfig.slotDurationMins}
                        bookingBufferMins={bookingRules.bufferMinutes}
                        bookingMaxAdvanceDays={bookingRules.maxAdvanceDays}
                      />
                    ),
                  },
                  {
                    label: "Operations",
                    content: <OperationsPanel bookOrders={bookOrders} pipeline={pipelineConfig} />,
                  },
                ]}
              />
            ),
          },
          {
            label: "Delivery & team",
            content: (
              <Tabs
                variant="underline"
                tabs={[
                  { label: "Agreements", content: <AgreementWorkflowPanel config={agreementWorkflow} /> },
                  {
                    label: "Daily Targets",
                    content: (
                      <div className="space-y-6">
                        <DailyTargetsPanel targets={dailyTargets} />
                        <DailyLogEodPanel config={dailyLogEod} cronArmed={cronArmed} />
                      </div>
                    ),
                  },
                  { label: "Gamification", content: <GamificationPanel config={config} /> },
                  { label: `Goals${goals.length ? ` (${goals.length})` : ""}`, content: <GoalsPanel goals={goals} people={people} /> },
                  {
                    label: `Rewards${pendingCount ? ` (${pendingCount})` : ""}`,
                    content: (
                      <RewardsPanel
                        rules={ruleRows}
                        grants={grantViews}
                        badges={badgeOptions}
                        quests={questOptions}
                        goals={goalOptions}
                      />
                    ),
                  },
                ]}
              />
            ),
          },
          {
            label: "System",
            content: (
              <Tabs
                variant="underline"
                tabs={[
                  {
                    // FIRST in System, deliberately: it answers "what is built but switched off",
                    // which is the question behind most of what looks broken in this app.
                    label: `Not armed${notArmed.filter((i) => !i.armed).length ? ` (${notArmed.filter((i) => !i.armed).length})` : ""}`,
                    content: <NotArmedPanel items={notArmed} />,
                  },
                  {
                    // Its own tab rather than a section of Maintenance: these are the rules that
                    // decide when the app TALKS TO SOMEBODY, which is a different kind of
                    // decision from housekeeping and deserves to be found without scrolling.
                    label: "Alerts & Chasing",
                    content: (
                      <AlertsPanel
                        speedToLead={speedToLeadConfig}
                        dunning={dunningConfig}
                        attendance={attendanceConfig}
                        cronArmed={cronArmed}
                        emailArmed={emailArmed}
                      />
                    ),
                  },
                  {
                    label: "Maintenance",
                    content: (
                      <MaintenancePanel
                        maintenance={maintenanceConfig}
                        report={scheduledReportConfig}
                        posting={financePostingConfig}
                        cronArmed={cronArmed}
                        health={health}
                      />
                    ),
                  },
                ]}
              />
            ),
          },
        ]}
      />
    </div>
  );
}

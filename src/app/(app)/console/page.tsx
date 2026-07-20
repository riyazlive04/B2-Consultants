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
} from "@/server/founder-config";
import { getGoalsWithProgress } from "@/server/goals";
import { listRewardGrants, listRewardRules } from "@/server/rewards";
import { SectionsPanel } from "./_components/SectionsPanel";
import { GamificationPanel } from "./_components/GamificationPanel";
import { GoalsPanel } from "./_components/GoalsPanel";
import { RewardsPanel, type GrantView, type RuleRow } from "./_components/RewardsPanel";
import { CommissionPanel } from "./_components/CommissionPanel";
import { DailyTargetsPanel } from "./_components/DailyTargetsPanel";
import { DailyLogEodPanel } from "./_components/DailyLogEodPanel";
import { AgreementWorkflowPanel } from "./_components/AgreementWorkflowPanel";
import { TutorFeePanel } from "./_components/TutorFeePanel";
import { OperationsPanel } from "./_components/OperationsPanel";
import { MaintenancePanel } from "./_components/MaintenancePanel";

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

  const [maintenanceConfig, scheduledReportConfig, financePostingConfig] = await Promise.all([
    getMaintenanceConfig(),
    getScheduledReportConfig(),
    getFinancePostingConfig(),
  ]);

  // Auto-save is the only rule here that needs an external clock. Read the seam's real
  // precondition so the panel can warn instead of claiming a rule that can never fire.
  const cronArmed = !!process.env.CRON_SECRET;

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

      <Tabs
        tabs={[
          { label: "Sections", content: <SectionsPanel sections={sections} /> },
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
          { label: "Commission", content: <CommissionPanel rules={commissionRules} /> },
          { label: "Tutor Fee", content: <TutorFeePanel config={tutorFee} /> },
          {
            label: "Operations",
            content: <OperationsPanel bookOrders={bookOrders} pipeline={pipelineConfig} />,
          },
          {
            label: "Daily Targets",
            content: (
              <div className="space-y-6">
                <DailyTargetsPanel targets={dailyTargets} />
                <DailyLogEodPanel config={dailyLogEod} cronArmed={cronArmed} />
              </div>
            ),
          },
          { label: "Agreements", content: <AgreementWorkflowPanel config={agreementWorkflow} /> },
          {
            label: "Maintenance",
            content: (
              <MaintenancePanel
                maintenance={maintenanceConfig}
                report={scheduledReportConfig}
                posting={financePostingConfig}
                cronArmed={cronArmed}
              />
            ),
          },
        ]}
      />
    </div>
  );
}

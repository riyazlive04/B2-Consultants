"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { capabilityCheck, requireAdmin } from "@/lib/rbac";
import { getTodayInrPerEur } from "@/lib/fx";
import { majorStringToMinor } from "@/lib/format";
import {
  agreementWorkflowSchema,
  coerceAgreementWorkflow,
  coerceBookOrderConfig,
  coerceCommissionRulesConfig,
  coercePipelineConfig,
  coerceTutorFeeConfig,
  coerceDailyLogEod,
  coerceDailyLogTargets,
  coerceGamificationConfig,
  coerceSectionsConfig,
  bookOrderConfigSchema,
  commissionRulesConfigSchema,
  pipelineConfigSchema,
  tutorFeeConfigSchema,
  dailyLogEodSchema,
  dailyLogTargetsSchema,
  gamificationConfigSchema,
  goalPeriodSchema,
  goalScopeSchema,
  goalMetricSchema,
  parseRewardTrigger,
  rewardTriggerSchema,
  sectionsConfigSchema,
} from "@/lib/config-schema";
import type { GamificationConfig } from "@/lib/gamification";
import type { SectionsConfig } from "@/lib/sections";
import {
  AGREEMENT_WORKFLOW_KEY,
  BOOK_ORDER_KEY,
  COMMISSION_RULES_KEY,
  DAILY_LOG_EOD_KEY,
  DAILY_LOG_TARGETS_KEY,
  GAMIFICATION_KEY,
  PIPELINE_KEY,
  SECTIONS_KEY,
  TUTOR_FEE_KEY,
  writeAgreementWorkflow,
  writeBookOrderConfig,
  writeCommissionRulesConfig,
  writePipelineConfig,
  writeTutorFeeConfig,
  writeDailyLogEod,
  writeDailyLogTargets,
  writeGamificationConfig,
  writeSectionsConfig,
} from "./founder-config";
import { logActivity, diffFields } from "./activity-log";
import { syncRewardGrants } from "./rewards";

/**
 * The Founder Console writes. Everything here is Admin-only and re-checks — a page
 * guard doesn't protect a server action.
 *
 * The two config documents arrive as a JSON string from a client editor that manages
 * rows in local state. They're parsed here, not trusted: the same schema that guards
 * the read guards the write, so nothing invalid can ever reach the database.
 */

export type ActionResult = { ok: true } | { ok: false; error: string };

function firstError(e: z.ZodError): string {
  const issue = e.issues[0];
  if (!issue) return "Invalid input";
  const where = issue.path.length ? `${issue.path.join(" → ")}: ` : "";
  return `${where}${issue.message}`;
}

const minor = (v?: string) => (v?.trim() ? majorStringToMinor(v) : BigInt(0));

function parseJson(raw: FormDataEntryValue | null): unknown {
  try {
    return JSON.parse(String(raw ?? ""));
  } catch {
    return null;
  }
}

/** Nav layout changes the sidebar for everyone, so the whole app tree revalidates. */
function revalidateShell() {
  revalidatePath("/", "layout");
}

/**
 * The pre-write value of a config document, for the activity diff.
 *
 * Read raw rather than through founder-config's `get*Config` readers: those are React.cache'd,
 * so priming one here would hand this stale pre-write value straight back to the re-render that
 * follows the action. Passing `undefined` to a coercer yields the shipped defaults, which is
 * exactly what "no row yet" means to every reader.
 */
async function settingValue(key: string): Promise<unknown> {
  const row = await prisma.appSetting.findUnique({ where: { key }, select: { value: true } });
  return row?.value;
}

/** Keyed by section/ruleset so a diff reads "finance, pipeline" instead of two whole arrays. */
const sectionsByKey = (c: SectionsConfig): Record<string, unknown> =>
  Object.fromEntries(c.entries.map((e) => [e.key, e]));

const rulesetsById = (c: GamificationConfig): Record<string, unknown> =>
  Object.fromEntries(c.rulesets.map((r) => [r.id, r]));

/** Amounts are BigInt paise, and JSON.stringify — which diffFields and the log's Json column
 *  both run on — throws on those. */
function ruleSnapshot(r: {
  name: string;
  description: string;
  kind: string;
  roles: string[];
  trigger: unknown;
  perkLabel: string | null;
  active: boolean;
  amountInrMinor: bigint;
  amountEurMinor: bigint;
}): Record<string, unknown> {
  return {
    name: r.name,
    description: r.description,
    kind: r.kind,
    roles: r.roles,
    trigger: r.trigger,
    perkLabel: r.perkLabel,
    active: r.active,
    amountInrMinor: r.amountInrMinor.toString(),
    amountEurMinor: r.amountEurMinor.toString(),
  };
}

// ───────────────────────────── commission rates ─────────────────────────────

/**
 * Retune the deal-team commission rates. Admin-only and re-validated with the same schema
 * that guards the read, so nothing invalid can reach the store. Finance revalidates so the
 * commission report reflects the new rates on the next view.
 */
export async function saveCommissionRules(input: unknown): Promise<ActionResult> {
  const session = await requireAdmin();
  const parsed = commissionRulesConfigSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const before = coerceCommissionRulesConfig(await settingValue(COMMISSION_RULES_KEY));
  await writeCommissionRulesConfig(parsed.data);
  const diff = diffFields(
    before as unknown as Record<string, unknown>,
    parsed.data as unknown as Record<string, unknown>,
  );
  if (diff.changed.length > 0) {
    await logActivity(session, {
      action: "console.commission.update",
      section: "console",
      entityType: "AppSetting",
      entityId: COMMISSION_RULES_KEY,
      summary: `Changed the deal-team commission rates`,
      meta: { changed: diff.changed, before: diff.before, after: diff.after },
    });
  }
  revalidatePath("/finance");
  revalidatePath("/console");
  return { ok: true };
}

/**
 * Choose when the Agreement module starts PROMPTING "ready to send".
 *
 * This is a nudge threshold, not a gate: whatever is saved here, the founder can still draft and
 * send an agreement for anyone from the picker. It only decides who gets an action card and a
 * dashboard task before a draft exists. Every surface re-derives on the next view.
 */
export async function saveAgreementWorkflow(input: unknown): Promise<ActionResult> {
  const session = await requireAdmin();
  const parsed = agreementWorkflowSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const before = coerceAgreementWorkflow(await settingValue(AGREEMENT_WORKFLOW_KEY));
  await writeAgreementWorkflow(parsed.data);
  const diff = diffFields(
    before as unknown as Record<string, unknown>,
    parsed.data as unknown as Record<string, unknown>,
  );
  if (diff.changed.length > 0) {
    await logActivity(session, {
      action: "console.agreement-workflow.update",
      section: "console",
      entityType: "AppSetting",
      entityId: AGREEMENT_WORKFLOW_KEY,
      summary: `Changed when an agreement is prompted as ready to send`,
      meta: { changed: diff.changed, before: diff.before, after: diff.after },
    });
  }
  revalidatePath("/agreements");
  revalidatePath("/contacts");
  revalidatePath("/console");
  revalidatePath("/");
  return { ok: true };
}

/**
 * Set the per-variant daily targets that grade every Daily Log entry. Admin-only, same
 * validate-on-write guarantee. Both the personal log and the admin board re-derive their
 * status badges against the new targets on the next view.
 */
export async function saveDailyLogTargets(input: unknown): Promise<ActionResult> {
  const session = await requireAdmin();
  const parsed = dailyLogTargetsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const before = coerceDailyLogTargets(await settingValue(DAILY_LOG_TARGETS_KEY));
  await writeDailyLogTargets(parsed.data);
  const diff = diffFields(
    before as unknown as Record<string, unknown>,
    parsed.data as unknown as Record<string, unknown>,
  );
  if (diff.changed.length > 0) {
    await logActivity(session, {
      action: "console.daily-log-targets.update",
      section: "console",
      entityType: "AppSetting",
      entityId: DAILY_LOG_TARGETS_KEY,
      summary: `Changed the daily log targets`,
      meta: { changed: diff.changed, before: diff.before, after: diff.after },
    });
  }
  revalidatePath("/daily-log");
  revalidatePath("/people");
  revalidatePath("/console");
  return { ok: true };
}

export async function saveDailyLogEod(input: unknown): Promise<ActionResult> {
  const session = await requireAdmin();
  const parsed = dailyLogEodSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const before = coerceDailyLogEod(await settingValue(DAILY_LOG_EOD_KEY));
  await writeDailyLogEod(parsed.data);
  const diff = diffFields(
    before as unknown as Record<string, unknown>,
    parsed.data as unknown as Record<string, unknown>,
  );
  if (diff.changed.length > 0) {
    await logActivity(session, {
      action: "console.daily-log-eod.update",
      section: "console",
      entityType: "AppSetting",
      entityId: DAILY_LOG_EOD_KEY,
      summary: `Changed the daily log end-of-day rules`,
      meta: { changed: diff.changed, before: diff.before, after: diff.after },
    });
  }
  revalidatePath("/daily-log");
  revalidatePath("/people");
  revalidatePath("/console");
  return { ok: true };
}

// ───────────────────────────── sections ─────────────────────────────

export async function saveSectionsConfig(form: FormData): Promise<ActionResult> {
  const session = await requireAdmin();
  const parsed = sectionsConfigSchema.safeParse(parseJson(form.get("config")));
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };

  const before = coerceSectionsConfig(await settingValue(SECTIONS_KEY));
  const after = parsed.data as unknown as SectionsConfig;
  await writeSectionsConfig(after);
  const diff = diffFields(sectionsByKey(before), sectionsByKey(after));
  if (diff.changed.length > 0) {
    await logActivity(session, {
      action: "console.sections.update",
      section: "console",
      entityType: "AppSetting",
      entityId: SECTIONS_KEY,
      summary: `Changed the sidebar navigation — ${diff.changed.join(", ")}`,
      meta: { changed: diff.changed, before: diff.before, after: diff.after },
    });
  }
  revalidateShell();
  return { ok: true };
}

/** Drop the row entirely — `resolveSections(null)` is exactly the shipped defaults. */
export async function resetSectionsConfig(): Promise<ActionResult> {
  const session = await requireAdmin();
  const { count } = await prisma.appSetting.deleteMany({ where: { key: "sectionsConfig" } });
  if (count > 0) {
    await logActivity(session, {
      action: "console.sections.restore",
      section: "console",
      entityType: "AppSetting",
      entityId: SECTIONS_KEY,
      summary: `Reset the sidebar navigation to the shipped defaults`,
    });
  }
  revalidateShell();
  return { ok: true };
}

// ───────────────────────────── gamification ─────────────────────────────

export async function saveGamificationConfig(form: FormData): Promise<ActionResult> {
  const session = await requireAdmin();
  const parsed = gamificationConfigSchema.safeParse(parseJson(form.get("config")));
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };

  const before = coerceGamificationConfig(await settingValue(GAMIFICATION_KEY));
  const after = parsed.data as unknown as GamificationConfig;
  await writeGamificationConfig(after);
  const diff = diffFields(rulesetsById(before), rulesetsById(after));
  if (diff.changed.length > 0) {
    await logActivity(session, {
      action: "console.gamification.update",
      section: "console",
      entityType: "AppSetting",
      entityId: GAMIFICATION_KEY,
      summary: `Changed the gamification rules`,
      meta: { changed: diff.changed, before: diff.before, after: diff.after },
    });
  }
  // Scores are derived, so every screen that shows XP is now stale.
  revalidateShell();
  return { ok: true };
}

export async function resetGamificationConfig(): Promise<ActionResult> {
  const session = await requireAdmin();
  const { count } = await prisma.appSetting.deleteMany({ where: { key: "gamificationRulesets" } });
  if (count > 0) {
    await logActivity(session, {
      action: "console.gamification.restore",
      section: "console",
      entityType: "AppSetting",
      entityId: GAMIFICATION_KEY,
      summary: `Reset the gamification rules to the shipped defaults`,
    });
  }
  revalidateShell();
  return { ok: true };
}

// ───────────────────────────── goals ─────────────────────────────

const goalSchema = z
  .object({
    id: z.string().optional(),
    name: z.string().trim().min(1, "Give the goal a name").max(80),
    metric: goalMetricSchema,
    scope: goalScopeSchema,
    teamProfileId: z.string().optional(),
    period: goalPeriodSchema,
    periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a start date"),
    targetValue: z
      .string()
      .trim()
      .regex(/^\d{1,14}(\.\d{1,2})?$/, "Enter a plain target like 40 or 1200000"),
    active: z.string().optional(),
  })
  .superRefine((d, ctx) => {
    if (d.scope === "USER" && !d.teamProfileId) {
      ctx.addIssue({ code: "custom", path: ["teamProfileId"], message: "Choose whose goal this is" });
    }
  });

/** Snap the start date to the first day of its month / quarter / year, so windows tile. */
function normalisePeriodStart(period: string, dateKey: string): Date {
  const [y, m] = dateKey.split("-").map(Number);
  if (period === "YEAR") return new Date(Date.UTC(y, 0, 1));
  if (period === "QUARTER") return new Date(Date.UTC(y, Math.floor((m - 1) / 3) * 3, 1));
  return new Date(Date.UTC(y, m - 1, 1));
}

export async function saveGoal(form: FormData): Promise<ActionResult> {
  const session = await requireAdmin();
  const parsed = goalSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const d = parsed.data;

  const teamProfileId = d.scope === "USER" ? d.teamProfileId! : null;
  if (teamProfileId) {
    // Guard the FK so a stale/forged id can't 500 the action.
    const exists = await prisma.teamProfile.findUnique({ where: { id: teamProfileId }, select: { id: true } });
    if (!exists) return { ok: false, error: "That person no longer exists" };
  }

  const data = {
    name: d.name,
    metric: d.metric,
    scope: d.scope,
    teamProfileId,
    period: d.period,
    periodStart: normalisePeriodStart(d.period, d.periodStart),
    targetValue: d.targetValue,
    active: d.active === "on",
  };

  if (d.id) {
    const before = await prisma.goal.findUnique({
      where: { id: d.id },
      select: {
        name: true, metric: true, scope: true, teamProfileId: true,
        period: true, periodStart: true, targetValue: true, active: true,
      },
    });
    const goal = await prisma.goal.update({ where: { id: d.id }, data });
    // Diff the stored rows: `targetValue` goes in as a string and comes back a Decimal, so
    // comparing the row against the form would report every save as a change.
    const diff = before
      ? diffFields(before as Record<string, unknown>, {
          name: goal.name,
          metric: goal.metric,
          scope: goal.scope,
          teamProfileId: goal.teamProfileId,
          period: goal.period,
          periodStart: goal.periodStart,
          targetValue: goal.targetValue,
          active: goal.active,
        })
      : null;
    if (diff && diff.changed.length > 0) {
      await logActivity(session, {
        action: "console.goal.update",
        section: "console",
        entityType: "Goal",
        entityId: goal.id,
        summary: `Edited the goal "${goal.name}"`,
        meta: { changed: diff.changed, before: diff.before, after: diff.after },
      });
    }
  } else {
    const goal = await prisma.goal.create({ data });
    await logActivity(session, {
      action: "console.goal.create",
      section: "console",
      entityType: "Goal",
      entityId: goal.id,
      summary: `Created the goal "${goal.name}"`,
      meta: {
        metric: goal.metric,
        scope: goal.scope,
        period: goal.period,
        targetValue: String(goal.targetValue),
        active: goal.active,
      },
    });
  }

  revalidatePath("/console");
  revalidatePath("/");
  return { ok: true };
}

export async function deleteGoal(id: string): Promise<ActionResult> {
  const session = await requireAdmin();

  // A rule that pays on this goal can never fire again, so it goes too (its grants
  // cascade). Filtering in JS beats a JSON-path query: the trigger shape is owned by
  // zod, not by Postgres, and there are only ever a handful of rules.
  const orphaned = (await prisma.rewardRule.findMany({ select: { id: true, trigger: true } }))
    .filter((r) => {
      const t = parseRewardTrigger(r.trigger);
      return t?.kind === "GOAL_MET" && t.goalId === id;
    })
    .map((r) => r.id);

  const [, goal] = await prisma.$transaction([
    prisma.rewardRule.deleteMany({ where: { id: { in: orphaned } } }),
    prisma.goal.delete({ where: { id } }),
  ]);
  await logActivity(session, {
    action: "console.goal.delete",
    section: "console",
    entityType: "Goal",
    entityId: id,
    summary: `Deleted the goal "${goal.name}"`,
    meta: { metric: goal.metric, rewardRulesRemoved: orphaned.length },
  });

  revalidatePath("/console");
  revalidatePath("/");
  return { ok: true };
}

// ───────────────────────────── reward rules ─────────────────────────────

const moneyInput = z
  .string()
  .trim()
  .regex(/^\d{0,12}(\.\d{0,2})?$/, "Enter a plain amount like 2000 or 2000.50")
  .optional()
  .or(z.literal(""));

const rewardRuleSchema = z
  .object({
    id: z.string().optional(),
    name: z.string().trim().min(1, "Give the reward a name").max(80),
    description: z.string().trim().min(1, "Say what this reward is for").max(400),
    kind: z.enum(["BONUS", "COMMISSION", "PERK"]),
    roles: z.string().optional(), // comma-separated
    amountInr: moneyInput,
    amountEur: moneyInput,
    perkLabel: z.string().trim().max(120).optional(),
    trigger: z.string().min(2),
    active: z.string().optional(),
  })
  .superRefine((d, ctx) => {
    if (d.kind === "PERK") {
      if (!d.perkLabel?.trim()) {
        ctx.addIssue({ code: "custom", path: ["perkLabel"], message: "Say what the perk is" });
      }
    } else if (!d.amountInr?.trim() && !d.amountEur?.trim()) {
      ctx.addIssue({ code: "custom", path: ["amountInr"], message: "Enter an amount in INR, EUR, or both" });
    }
  });

const ROLE_VALUES = ["ADMIN", "HEAD", "USER", "STUDENT", "TUTOR"] as const;
const rolesSchema = z.array(z.enum(ROLE_VALUES));

export async function saveRewardRule(form: FormData): Promise<ActionResult> {
  const session = await requireAdmin();
  const parsed = rewardRuleSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const d = parsed.data;

  const trigger = rewardTriggerSchema.safeParse(parseJson(d.trigger));
  if (!trigger.success) return { ok: false, error: firstError(trigger.error) };

  const roles = rolesSchema.safeParse((d.roles ?? "").split(",").map((r) => r.trim()).filter(Boolean));
  if (!roles.success) return { ok: false, error: "Unknown role in the role filter" };

  // A GOAL_MET rule must point at a goal that exists, or it can never fire.
  if (trigger.data.kind === "GOAL_MET") {
    const goal = await prisma.goal.findUnique({ where: { id: trigger.data.goalId }, select: { id: true } });
    if (!goal) return { ok: false, error: "That goal no longer exists" };
  }

  const isPerk = d.kind === "PERK";
  const data = {
    name: d.name,
    description: d.description,
    kind: d.kind,
    roles: roles.data,
    trigger: trigger.data,
    amountInrMinor: isPerk ? BigInt(0) : minor(d.amountInr),
    amountEurMinor: isPerk ? BigInt(0) : minor(d.amountEur),
    perkLabel: isPerk ? d.perkLabel! : null,
    active: d.active === "on",
  };

  if (d.id) {
    const before = await prisma.rewardRule.findUnique({
      where: { id: d.id },
      select: {
        name: true, description: true, kind: true, roles: true, trigger: true,
        perkLabel: true, active: true, amountInrMinor: true, amountEurMinor: true,
      },
    });
    const rule = await prisma.rewardRule.update({ where: { id: d.id }, data });
    const diff = before ? diffFields(ruleSnapshot(before), ruleSnapshot(rule)) : null;
    if (diff && diff.changed.length > 0) {
      await logActivity(session, {
        action: "console.reward-rule.update",
        section: "console",
        entityType: "RewardRule",
        entityId: rule.id,
        summary: `Edited the reward "${rule.name}"`,
        meta: { changed: diff.changed, before: diff.before, after: diff.after },
      });
    }
  } else {
    const rule = await prisma.rewardRule.create({ data });
    await logActivity(session, {
      action: "console.reward-rule.create",
      section: "console",
      entityType: "RewardRule",
      entityId: rule.id,
      summary: `Created the reward "${rule.name}"`,
      meta: ruleSnapshot(rule),
    });
  }

  revalidatePath("/console");
  return { ok: true };
}

export async function deleteRewardRule(id: string): Promise<ActionResult> {
  const { allowed, denied, session } = await capabilityCheck("rewards.approve");
  if (!allowed) return denied;
  const rule = await prisma.rewardRule.delete({ where: { id } }); // grants cascade
  await logActivity(session, {
    action: "console.reward-rule.delete",
    section: "console",
    entityType: "RewardRule",
    entityId: id,
    summary: `Deleted the reward "${rule.name}"`,
    meta: { kind: rule.kind, active: rule.active },
  });
  revalidatePath("/console");
  return { ok: true };
}

/** Re-derive every qualification. Safe to run repeatedly — see server/rewards.ts. */
export async function scanRewards(): Promise<{ ok: true; created: number } | { ok: false; error: string }> {
  const session = await requireAdmin();
  const created = await syncRewardGrants();
  if (created > 0) {
    await logActivity(session, {
      action: "console.reward-grant.create",
      section: "console",
      entityType: "RewardGrant",
      // A scan mints many rows at once and syncRewardGrants only hands back a count, so there
      // is no one grant to point at; the fixed id keeps every scan under one entity history.
      entityId: "scan",
      summary: `Ran a reward scan — ${created} new reward${created === 1 ? "" : "s"} granted`,
      meta: { created },
    });
  }
  revalidatePath("/console");
  return { ok: true, created };
}

const grantStatusSchema = z.enum(["PENDING", "APPROVED", "DECLINED", "PAID"]);

export async function setGrantStatus(id: string, status: string): Promise<ActionResult> {
  const { allowed, denied, session } = await capabilityCheck("rewards.approve");
  if (!allowed) return denied;
  const parsed = grantStatusSchema.safeParse(status);
  if (!parsed.success) return { ok: false, error: "Unknown status" };

  const before = await prisma.rewardGrant.findUnique({
    where: { id },
    select: {
      status: true,
      rule: { select: { name: true } },
      teamProfile: { select: { fullName: true } },
    },
  });
  await prisma.rewardGrant.update({
    where: { id },
    data: { status: parsed.data, decidedById: session.user.id, decidedAt: new Date() },
  });
  const diff = before ? diffFields({ status: before.status }, { status: parsed.data }) : null;
  if (before && diff && diff.changed.length > 0) {
    const verb = parsed.data === "APPROVED" ? "approve" : parsed.data === "DECLINED" ? "reject" : "update";
    await logActivity(session, {
      action: `console.reward-grant.${verb}`,
      section: "console",
      entityType: "RewardGrant",
      entityId: id,
      summary: `Set the "${before.rule.name}" reward for ${before.teamProfile.fullName} to ${parsed.data.toLowerCase()}`,
      meta: { changed: diff.changed, before: diff.before, after: diff.after },
    });
  }
  revalidatePath("/console");
  return { ok: true };
}

// ───────────────────────────── tutor fee / operations ─────────────────────────────

/**
 * Retune the trainer-fee bands (Part 2 §5, and the answer to §18.2's open per-level table).
 * Same shape as saveCommissionRules: admin-only, re-validated with the read's schema, and
 * the German Note pages revalidate so batch costs reflect the new bands immediately.
 */
export async function saveTutorFee(input: unknown): Promise<ActionResult> {
  const session = await requireAdmin();
  const parsed = tutorFeeConfigSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const before = coerceTutorFeeConfig(await settingValue(TUTOR_FEE_KEY));
  await writeTutorFeeConfig(parsed.data);
  const diff = diffFields(
    before as unknown as Record<string, unknown>,
    parsed.data as unknown as Record<string, unknown>,
  );
  if (diff.changed.length > 0) {
    await logActivity(session, {
      action: "console.tutor-fee.update",
      section: "console",
      entityType: "AppSetting",
      entityId: TUTOR_FEE_KEY,
      summary: `Changed the tutor fee bands`,
      meta: { changed: diff.changed, before: diff.before, after: diff.after },
    });
  }
  revalidatePath("/german-note");
  revalidatePath("/german-note/manage");
  revalidatePath("/console");
  return { ok: true };
}

/** When a book order releases to the publisher (§9.2, Part 2 §4.4; threshold open per §18.3). */
export async function saveBookOrderConfig(input: unknown): Promise<ActionResult> {
  const session = await requireAdmin();
  const parsed = bookOrderConfigSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const before = coerceBookOrderConfig(await settingValue(BOOK_ORDER_KEY));
  await writeBookOrderConfig(parsed.data);
  const diff = diffFields(
    before as unknown as Record<string, unknown>,
    parsed.data as unknown as Record<string, unknown>,
  );
  if (diff.changed.length > 0) {
    await logActivity(session, {
      action: "console.book-orders.update",
      section: "console",
      entityType: "AppSetting",
      entityId: BOOK_ORDER_KEY,
      summary: `Changed the book-order rule`,
      meta: { changed: diff.changed, before: diff.before, after: diff.after },
    });
  }
  revalidatePath("/students");
  revalidatePath("/console");
  return { ok: true };
}

/** Rules-driven vs drag-and-drop pipeline (Part 2 §9, §18.6). */
export async function savePipelineConfig(input: unknown): Promise<ActionResult> {
  const session = await requireAdmin();
  const parsed = pipelineConfigSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const before = coercePipelineConfig(await settingValue(PIPELINE_KEY));
  await writePipelineConfig(parsed.data);
  if (before.mode !== parsed.data.mode) {
    await logActivity(session, {
      action: "console.pipeline.update",
      section: "console",
      entityType: "AppSetting",
      entityId: PIPELINE_KEY,
      summary: `Switched the pipeline to ${parsed.data.mode === "rules" ? "rules-driven" : "drag and drop"}`,
      meta: { before: before.mode, after: parsed.data.mode },
    });
  }
  revalidatePath("/pipeline");
  revalidatePath("/console");
  return { ok: true };
}

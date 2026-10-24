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
  callDistributionSchema,
  coerceCallDistribution,
  coerceBookOrderConfig,
  coerceCommissionRulesConfig,
  coercePipelineConfig,
  coerceTutorFeeConfig,
  coerceInstalmentPlanConfig,
  coercePaymentTypesConfig,
  coerceZoomConfig,
  coerceInvoiceSettings,
  invoiceSettingsSchema,
  instalmentPlanConfigSchema,
  cashTargetsConfigSchema,
  coerceCashTargetsConfig,
  paymentTypesConfigSchema,
  zoomConfigSchema,
  coerceDailyLogEod,
  coerceDailyLogTargets,
  coerceGamificationConfig,
  coerceSectionsConfig,
  coerceSlotPatternConfig,
  slotPatternConfigSchema,
  coerceBookingCalendarsConfig,
  bookingCalendarsConfigSchema,
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
  expenseCategoriesConfigSchema,
  coerceExpenseCategoriesConfig,
  NEW_EXPENSE_ACCOUNT,
} from "@/lib/config-schema";
import { CHART_OF_ACCOUNTS, CUSTOM_EXPENSE_CODE_RANGE } from "@/lib/chart-of-accounts";
import type { GamificationConfig } from "@/lib/gamification";
import type { SectionsConfig } from "@/lib/sections";
import {
  AGREEMENT_WORKFLOW_KEY,
  DELIVERY_DEFAULTS_KEY,
  getDeliveryDefaults,
  writeDeliveryDefaults,
  CALL_DISTRIBUTION_KEY,
  BOOK_ORDER_KEY,
  COMMISSION_RULES_KEY,
  DAILY_LOG_EOD_KEY,
  DAILY_LOG_TARGETS_KEY,
  GAMIFICATION_KEY,
  PIPELINE_KEY,
  SECTIONS_KEY,
  TUTOR_FEE_KEY,
  INSTALMENT_PLAN_KEY,
  CASH_TARGETS_KEY,
  SLOT_PATTERN_KEY,
  SSS_PATTERN_KEY,
  revalidateFounderConfig,
  writeAgreementWorkflow,
  writeCallDistribution,
  writeBookOrderConfig,
  writeCommissionRulesConfig,
  writePipelineConfig,
  writeTutorFeeConfig,
  writeInstalmentPlanConfig,
  writeCashTargetsConfig,
  writePaymentTypesConfig,
  PAYMENT_TYPES_KEY,
  writeZoomConfig,
  ZOOM_KEY,
  writeInvoiceSettings,
  INVOICE_SETTINGS_KEY,
  writeDailyLogEod,
  writeDailyLogTargets,
  writeGamificationConfig,
  writeSectionsConfig,
  writeBookingCalendars,
  writeSssPatternConfig,
  EXPENSE_CATEGORIES_KEY,
  writeExpenseCategoriesConfig,
} from "./founder-config";
import { logActivity, diffFields } from "./activity-log";
import { syncRewardGrants } from "./rewards";

/**
 * The Founder Console writes. Everything here is Admin-only and re-checks - a page
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

/** Amounts are BigInt paise, and JSON.stringify - which diffFields and the log's Json column
 *  both run on - throws on those. */
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
 * Call distribution: the rules AND each person's share, saved together.
 *
 * ── Why one action writes two different places ───────────────────────────────────
 * The rules live in `AppSetting("callDistribution")`; each individual's share lives on their
 * `TeamProfile`, because it belongs to them and follows them through the org chart. From the
 * founder's side that distinction is invisible and uninteresting - they are looking at one screen
 * called "who gets what", and a Save that persisted half of it would be indefensible.
 *
 * The shares are written in one transaction so a partial apply cannot leave the rotation in a
 * state nobody chose. The AppSetting write is separate and goes SECOND: if it fails, the shares
 * are still consistent with each other, which is the safer half to have landed.
 */
const shareRowSchema = z.object({
  profileId: z.string().min(1),
  // Same bounds the team-profile form enforces, re-checked here - this is a second door onto the
  // same column and a client can post whatever it likes.
  sharePct: z.number().int().min(0).max(100),
});

const callDistributionInputSchema = z.object({
  config: callDistributionSchema,
  shares: z.array(shareRowSchema).max(100),
});

export async function saveCallDistribution(input: unknown): Promise<ActionResult> {
  const session = await requireAdmin();
  const parsed = callDistributionInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const { config, shares } = parsed.data;

  const before = coerceCallDistribution(await settingValue(CALL_DISTRIBUTION_KEY));
  const profilesBefore = await prisma.teamProfile.findMany({
    where: { id: { in: shares.map((s) => s.profileId) } },
    select: { id: true, fullName: true, firstCallSharePct: true },
  });
  const wasById = new Map(profilesBefore.map((p) => [p.id, p]));

  const changedShares = shares.filter((s) => wasById.get(s.profileId)?.firstCallSharePct !== s.sharePct);
  if (changedShares.length) {
    await prisma.$transaction(
      changedShares.map((s) =>
        prisma.teamProfile.update({ where: { id: s.profileId }, data: { firstCallSharePct: s.sharePct } }),
      ),
    );
  }

  await writeCallDistribution(config);

  const diff = diffFields(
    before as unknown as Record<string, unknown>,
    config as unknown as Record<string, unknown>,
  );
  if (diff.changed.length > 0 || changedShares.length > 0) {
    // The share change is spelled out by NAME. "changed shares" would send the founder to the
    // meta blob to answer the only question the entry raises.
    const shareSummary = changedShares
      .map((s) => `${wasById.get(s.profileId)?.fullName ?? "?"} ${wasById.get(s.profileId)?.firstCallSharePct ?? 0}→${s.sharePct}`)
      .join(", ");
    await logActivity(session, {
      action: "console.call-distribution.update",
      section: "console",
      entityType: "AppSetting",
      entityId: CALL_DISTRIBUTION_KEY,
      summary: changedShares.length
        ? `Changed call distribution - ${shareSummary}`
        : "Changed the call distribution rules",
      meta: { changed: diff.changed, before: diff.before, after: diff.after, shares: changedShares },
    });
  }

  // Both surfaces the weights drive, plus the roster they were edited from.
  revalidatePath("/console");
  revalidatePath("/pipeline");
  revalidatePath("/my-desk");
  revalidatePath("/people");
  return { ok: true };
}

/**
 * Choose when the Agreement module starts PROMPTING "ready to send".
 *
 * This is a nudge threshold, not a gate: whatever is saved here, the founder can still draft and
 * send an agreement for anyone from the picker. It only decides who gets an action card and a
 * dashboard task before a draft exists. Every surface re-derives on the next view.
 */
/**
 * The default coach a new enrolment gets when the field is left blank.
 *
 * Replaces the literal "Karthick" that was written into four places in students-actions.ts.
 * It mattered more than it looked: the enrolment welcome falls back to the assigned coach when
 * a batch has no tutor, so that hardcoded name was on its way to being WhatsApped to students
 * as the person looking after them.
 */
export async function saveDeliveryDefaults(input: unknown): Promise<ActionResult> {
  const session = await requireAdmin();
  const parsed = z
    .object({ defaultCoach: z.string().trim().max(120, "Keep the name under 120 characters").default("") })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const before = await getDeliveryDefaults();
  await writeDeliveryDefaults(parsed.data);
  if (before.defaultCoach !== parsed.data.defaultCoach) {
    await logActivity(session, {
      action: "console.delivery-defaults.update",
      section: "console",
      entityType: "AppSetting",
      entityId: DELIVERY_DEFAULTS_KEY,
      summary: parsed.data.defaultCoach
        ? `Set the default coach for new enrolments to ${parsed.data.defaultCoach}`
        : "Cleared the default coach for new enrolments",
      meta: { before: before.defaultCoach, after: parsed.data.defaultCoach },
    });
  }
  return { ok: true };
}

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
      summary: `Changed the sidebar navigation - ${diff.changed.join(", ")}`,
      meta: { changed: diff.changed, before: diff.before, after: diff.after },
    });
  }
  revalidateShell();
  return { ok: true };
}

/** Drop the row entirely - `resolveSections(null)` is exactly the shipped defaults. */
export async function resetSectionsConfig(): Promise<ActionResult> {
  const session = await requireAdmin();
  const { count } = await prisma.appSetting.deleteMany({ where: { key: "sectionsConfig" } });
  // Deleting the row bypasses the write* helpers, so drop the cached copy by hand.
  revalidateFounderConfig();
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
  // Same as the sections reset above - a raw delete has no write helper to invalidate for it.
  revalidateFounderConfig();
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

const ROLE_VALUES = ["ADMIN", "HEAD", "USER", "STUDENT", "TUTOR", "COACH"] as const;
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

/** Re-derive every qualification. Safe to run repeatedly - see server/rewards.ts. */
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
      summary: `Ran a reward scan - ${created} new reward${created === 1 ? "" : "s"} granted`,
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

/**
 * The founder-editable "Payment type" list (Founder Console → Payment Types).
 *
 * Existing records are NOT touched. A type's code is what an Income row stores, so renaming the
 * label changes every screen at once (which is the point) while deactivating one only stops it
 * being offered - the historic rows keep reading correctly. The schema refuses to drop or re-kind
 * FULL_PAYMENT and INSTALMENT for exactly that reason: the settlement engine branches on those
 * two by name.
 *
 * Finance, the Quick Record modal and Cash all revalidate, because an operator who has just added
 * "Subscription" is usually about to record one.
 */
export async function savePaymentTypesConfig(input: unknown): Promise<ActionResult> {
  const session = await requireAdmin();
  const parsed = paymentTypesConfigSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const before = coercePaymentTypesConfig(await settingValue(PAYMENT_TYPES_KEY));
  await writePaymentTypesConfig(parsed.data);
  const diff = diffFields(
    before as unknown as Record<string, unknown>,
    parsed.data as unknown as Record<string, unknown>,
  );
  if (diff.changed.length > 0) {
    await logActivity(session, {
      action: "console.payment-types.update",
      section: "console",
      entityType: "AppSetting",
      entityId: PAYMENT_TYPES_KEY,
      summary: "Changed the payment types",
      meta: { changed: diff.changed, before: diff.before, after: diff.after },
    });
  }
  revalidatePath("/finance");
  revalidatePath("/console");
  return { ok: true };
}

/**
 * Which Zoom account hosts whose calls (Console → Sales ops → Availability).
 *
 * Only the MAPPING is editable here - the credentials are env secrets and the arming flag is
 * `ZOOM_ENABLED`, because a founder who can turn on outbound sending from a web form is a founder
 * who can turn it on by accident. An empty mapping is a valid, working state: every meeting is
 * then hosted from the Zoom account owner.
 */
export async function saveZoomConfig(input: unknown): Promise<ActionResult> {
  const session = await requireAdmin();
  const parsed = zoomConfigSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const before = coerceZoomConfig(await settingValue(ZOOM_KEY));
  await writeZoomConfig(parsed.data);
  const diff = diffFields(
    before as unknown as Record<string, unknown>,
    parsed.data as unknown as Record<string, unknown>,
  );
  if (diff.changed.length > 0) {
    await logActivity(session, {
      action: "console.zoom.update",
      section: "console",
      entityType: "AppSetting",
      entityId: ZOOM_KEY,
      summary: "Changed which Zoom account hosts which calls",
      meta: { changed: diff.changed, before: diff.before, after: diff.after },
    });
  }
  revalidatePath("/bookings");
  revalidatePath("/console");
  return { ok: true };
}

/**
 * Who invoices are FROM, and what tax they charge per currency (Console → Money → Invoicing).
 *
 * The tax rate is a DEFAULT, not a repricing. Each invoice snapshots the label and percent it
 * actually charged, so changing a rate here never rewrites a document already sent to a customer
 * - it only changes what the next new invoice starts with. Setting a rate to 0 removes the tax
 * line altogether, which is how a customer who should not be taxed is invoiced.
 *
 * The issuer block is the opposite: it is read at print time, so correcting a typo in the
 * registered address fixes it on every document, including ones already issued. That is the
 * behaviour you want for an address and emphatically not for a tax rate.
 */
export async function saveInvoiceSettings(input: unknown): Promise<ActionResult> {
  const session = await requireAdmin();
  const parsed = invoiceSettingsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const before = coerceInvoiceSettings(await settingValue(INVOICE_SETTINGS_KEY));
  await writeInvoiceSettings(parsed.data);
  const diff = diffFields(
    before as unknown as Record<string, unknown>,
    parsed.data as unknown as Record<string, unknown>,
  );
  if (diff.changed.length > 0) {
    await logActivity(session, {
      action: "console.invoicing.update",
      section: "console",
      entityType: "AppSetting",
      entityId: INVOICE_SETTINGS_KEY,
      summary: `Changed invoicing settings - ₹ ${parsed.data.tax.INR.label} ${parsed.data.tax.INR.percent}%, € ${parsed.data.tax.EUR.label} ${parsed.data.tax.EUR.percent}%`,
      meta: { changed: diff.changed, before: diff.before, after: diff.after },
    });
  }
  revalidatePath("/payments");
  revalidatePath("/console");
  return { ok: true };
}

/**
 * Price the instalment plans (Founder Console → Instalment Plans): what each plan length costs
 * extra, and how many days apart the instalments fall by default.
 *
 * Existing plans are NOT re-priced. Each receivable snapshots its surcharge when its schedule is
 * generated, so a change here only affects plans built after it - the same discipline as
 * TutorFee.ratePerHead. Finance revalidates so the EMI generator offers the new numbers at once.
 */
export async function saveInstalmentPlanConfig(input: unknown): Promise<ActionResult> {
  const session = await requireAdmin();
  const parsed = instalmentPlanConfigSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const before = coerceInstalmentPlanConfig(await settingValue(INSTALMENT_PLAN_KEY));
  await writeInstalmentPlanConfig(parsed.data);
  const diff = diffFields(
    before as unknown as Record<string, unknown>,
    parsed.data as unknown as Record<string, unknown>,
  );
  if (diff.changed.length > 0) {
    await logActivity(session, {
      action: "console.instalment-plans.update",
      section: "console",
      entityType: "AppSetting",
      entityId: INSTALMENT_PLAN_KEY,
      summary: "Changed the instalment plan pricing",
      meta: { changed: diff.changed, before: diff.before, after: diff.after },
    });
  }
  revalidatePath("/finance");
  revalidatePath("/console");
  return { ok: true };
}

/**
 * Cash Health's targets (Founder Console → Money → Cash targets).
 *
 * Four numbers that were literals in the code: the monthly revenue bar the "months to target"
 * card counts towards, the runway green/amber bands, the buffer that flags a payable as
 * underfunded, and how many months burn averages over. None of them is an engineering constant -
 * they are this business's definition of healthy, and until now raising the bar meant a deploy.
 *
 * Changing them re-reads every screen that judges cash: Cash Health, the home KPI strip and the
 * top-bar runway pill, which all share `getRunwaySnapshot`.
 */
export async function saveCashTargetsConfig(input: unknown): Promise<ActionResult> {
  const session = await requireAdmin();
  const parsed = cashTargetsConfigSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const before = coerceCashTargetsConfig(await settingValue(CASH_TARGETS_KEY));
  await writeCashTargetsConfig(parsed.data);
  const diff = diffFields(
    before as unknown as Record<string, unknown>,
    parsed.data as unknown as Record<string, unknown>,
  );
  if (diff.changed.length > 0) {
    await logActivity(session, {
      action: "console.cash-targets.update",
      section: "console",
      entityType: "AppSetting",
      entityId: CASH_TARGETS_KEY,
      summary: "Changed the Cash Health targets",
      meta: { changed: diff.changed, before: diff.before, after: diff.after },
    });
  }
  // Every screen that renders a runway verdict, not just /cash: the badge is in the shell.
  revalidatePath("/cash");
  revalidatePath("/");
  revalidatePath("/console");
  return { ok: true };
}

/**
 * THE EXPENSE CATEGORY LIST (Console → Money → Expense categories).
 *
 * ── Why a category is more than a label ──────────────────────────────────────────
 * Every category names the EXPENSE account its costs are debited to, which is what makes it a
 * line in the P&L rather than a word on a report. A founder adding "Rent" therefore has two
 * honest answers: post it to a line that already exists (Operations, say), or give it a line of
 * its own. `NEW_EXPENSE_ACCOUNT` is that second answer, and this action is where it is granted:
 * the ledger account is CREATED FIRST and the config is stored with its real code, so the saved
 * configuration can never name an account that does not exist. (It could not quietly fail
 * either - `postEntry` refuses a code it cannot resolve - but refusing at the next expense
 * somebody records is no way to find out.)
 *
 * Codes are allocated from 6100-6899, after the eight seeded ones and before the FX account at
 * 7000, so the Ledger view stays in chart order. The range is deliberately finite: an install
 * that has used all 800 has a taxonomy problem, not a numbering one.
 */
export async function saveExpenseCategoriesConfig(input: unknown): Promise<ActionResult> {
  const session = await requireAdmin();
  const parsed = expenseCategoriesConfigSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };

  const before = coerceExpenseCategoriesConfig(await settingValue(EXPENSE_CATEGORIES_KEY));
  const wantsAccount = parsed.data.categories.filter((c) => c.accountCode === NEW_EXPENSE_ACCOUNT);
  const created: { code: string; name: string }[] = [];

  if (wantsAccount.length > 0) {
    // One read of the taken codes, then allocate in memory: two categories asking for a line in
    // the same save must not both be given 6100.
    const taken = new Set(
      (await prisma.ledgerAccount.findMany({ select: { code: true } })).map((a) => a.code),
    );
    let next = CUSTOM_EXPENSE_CODE_RANGE.first;
    const sortKeyBase = CHART_OF_ACCOUNTS.length;
    for (const category of wantsAccount) {
      while (taken.has(String(next)) && next <= CUSTOM_EXPENSE_CODE_RANGE.last) next += 1;
      if (next > CUSTOM_EXPENSE_CODE_RANGE.last) {
        return {
          ok: false,
          error: "There is no room left for another P&L line - point this category at an existing one.",
        };
      }
      const code = String(next);
      taken.add(code);
      await prisma.ledgerAccount.create({
        data: {
          code,
          name: category.label,
          type: "EXPENSE",
          currency: null,
          isCogs: category.isCogs,
          sortKey: sortKeyBase + created.length,
        },
      });
      created.push({ code, name: category.label });
      // The parsed object is what gets written, so the sentinel is replaced in place.
      category.accountCode = code;
    }
  }

  /**
   * An account's COGS flag mirrors its category's, so gross profit stays one answer whether it
   * is sliced from the account or from the row. Only the accounts this list owns are touched:
   * re-pointing a category at Operations must not re-flag Operations for everything else that
   * posts there, so the seeded eight are left exactly as `seedChartOfAccounts` set them.
   */
  const customCodes = new Set(created.map((c) => c.code));
  for (const category of parsed.data.categories) {
    if (!customCodes.has(category.accountCode) && Number(category.accountCode) >= CUSTOM_EXPENSE_CODE_RANGE.first
      && Number(category.accountCode) <= CUSTOM_EXPENSE_CODE_RANGE.last) {
      await prisma.ledgerAccount.updateMany({
        where: { code: category.accountCode },
        data: { name: category.label, isCogs: category.isCogs },
      });
    }
  }

  await writeExpenseCategoriesConfig(parsed.data);
  const diff = diffFields(
    before as unknown as Record<string, unknown>,
    parsed.data as unknown as Record<string, unknown>,
  );
  if (diff.changed.length > 0 || created.length > 0) {
    await logActivity(session, {
      action: "console.expense-categories.update",
      section: "console",
      entityType: "AppSetting",
      entityId: EXPENSE_CATEGORIES_KEY,
      summary:
        created.length > 0
          ? `Changed the expense categories and opened ${created.length} new P&L line${created.length === 1 ? "" : "s"}`
          : "Changed the expense categories",
      meta: { changed: diff.changed, before: diff.before, after: diff.after, accountsCreated: created },
    });
  }
  // The three cost forms, the P&L lines on the reports, and the Ledger's chart of accounts.
  revalidatePath("/finance");
  revalidatePath("/cash");
  revalidatePath("/reports");
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

/**
 * Standing weekly availability for the public /book calendar.
 *
 * THIS ACTION IS THE POINT. `ensureBookingSlots()` - a correct, idempotent, hourly job - had no
 * writer anywhere in the codebase: `SLOT_PATTERN_KEY` was read in two places and written in
 * none, so the config sat on its `enabled: false, weekdays: []` default forever and the job
 * returned `{ran: false, reason: "slot pattern disabled"}` on every tick. The fix for the empty
 * booking calendar shipped in a state where it could not be switched on. This is the switch.
 */
export async function saveBookingCalendars(input: unknown): Promise<ActionResult> {
  const session = await requireAdmin();
  const parsed = bookingCalendarsConfigSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };

  const list = parsed.data.calendars;
  // A pattern with no weekday generates nothing, so "on" with an empty week is a trap, not a
  // valid state - refuse it here rather than letting the job silently no-op like the default did.
  const toothless = list.find((c) => c.enabled && c.weekdays.length === 0);
  if (toothless) {
    return { ok: false, error: `"${toothless.name}" is on but has no weekday selected. Pick one, or switch it off.` };
  }
  // Ids address a calendar across a rename, so a duplicate would make two rows fight over one
  // identity - the second silently winning every read.
  const ids = new Set<string>();
  for (const c of list) {
    if (ids.has(c.id)) return { ok: false, error: `Two calendars share the id "${c.id}".` };
    ids.add(c.id);
  }
  /**
   * Two live calendars on one person would generate one set of slots (the per-owner dedupe in
   * `ensureBookingSlots` collapses them) while the console showed two - the sort of disagreement
   * that gets diagnosed as "the second calendar doesn't work".
   */
  const owners = new Set<string>();
  for (const c of list.filter((c) => c.enabled && c.assignedToId)) {
    if (owners.has(c.assignedToId)) {
      return { ok: false, error: `Two live calendars are assigned to the same person. Give one a different owner, or switch it off.` };
    }
    owners.add(c.assignedToId);
  }

  const before = coerceBookingCalendarsConfig(await settingValue(SLOT_PATTERN_KEY));
  await writeBookingCalendars(list);

  const summarise = (cs: typeof list) =>
    cs.map((c) => `${c.name}${c.enabled ? ` (${c.weekdays.join("/")} ${c.startTime}-${c.endTime})` : " - off"}`).join("; ");
  const beforeText = summarise(before.calendars);
  const afterText = summarise(list);
  if (beforeText !== afterText) {
    await logActivity(session, {
      action: "console.slot-pattern.update",
      section: "console",
      entityType: "AppSetting",
      entityId: SLOT_PATTERN_KEY,
      summary: list.some((c) => c.enabled)
        ? `Booking calendars - ${afterText}`
        : "Switched off all booking availability",
      meta: { before: beforeText, after: afterText, count: list.length },
    });
  }
  revalidatePath("/bookings");
  revalidatePath("/console");
  return { ok: true };
}

/** The same, for the founder's SSS (sales) diary - see `sss-topup.ts`. */
export async function saveSssPatternConfig(input: unknown): Promise<ActionResult> {
  const session = await requireAdmin();
  const parsed = slotPatternConfigSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  if (parsed.data.enabled && parsed.data.weekdays.length === 0) {
    return { ok: false, error: "Pick at least one weekday, or switch the pattern off." };
  }
  const before = coerceSlotPatternConfig(await settingValue(SSS_PATTERN_KEY));
  await writeSssPatternConfig(parsed.data);
  const diff = diffFields(
    before as unknown as Record<string, unknown>,
    parsed.data as unknown as Record<string, unknown>,
  );
  if (diff.changed.length > 0) {
    await logActivity(session, {
      action: "console.sss-pattern.update",
      section: "console",
      entityType: "AppSetting",
      entityId: SSS_PATTERN_KEY,
      summary: parsed.data.enabled
        ? `Set standing SSS availability - ${parsed.data.weekdays.join(", ")} ${parsed.data.startTime}-${parsed.data.endTime}`
        : "Switched off standing SSS availability",
      meta: { changed: diff.changed, before: diff.before, after: diff.after },
    });
  }
  revalidatePath("/bookings");
  revalidatePath("/console");
  return { ok: true };
}

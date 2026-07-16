"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { capabilityCheck, requireAdmin } from "@/lib/rbac";
import { getTodayInrPerEur } from "@/lib/fx";
import { majorStringToMinor } from "@/lib/format";
import {
  commissionRulesConfigSchema,
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
import { writeCommissionRulesConfig, writeGamificationConfig, writeSectionsConfig } from "./founder-config";
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

// ───────────────────────────── commission rates ─────────────────────────────

/**
 * Retune the deal-team commission rates. Admin-only and re-validated with the same schema
 * that guards the read, so nothing invalid can reach the store. Finance revalidates so the
 * commission report reflects the new rates on the next view.
 */
export async function saveCommissionRules(input: unknown): Promise<ActionResult> {
  await requireAdmin();
  const parsed = commissionRulesConfigSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  await writeCommissionRulesConfig(parsed.data);
  revalidatePath("/finance");
  revalidatePath("/console");
  return { ok: true };
}

// ───────────────────────────── sections ─────────────────────────────

export async function saveSectionsConfig(form: FormData): Promise<ActionResult> {
  await requireAdmin();
  const parsed = sectionsConfigSchema.safeParse(parseJson(form.get("config")));
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };

  await writeSectionsConfig(parsed.data as unknown as SectionsConfig);
  revalidateShell();
  return { ok: true };
}

/** Drop the row entirely — `resolveSections(null)` is exactly the shipped defaults. */
export async function resetSectionsConfig(): Promise<ActionResult> {
  await requireAdmin();
  await prisma.appSetting.deleteMany({ where: { key: "sectionsConfig" } });
  revalidateShell();
  return { ok: true };
}

// ───────────────────────────── gamification ─────────────────────────────

export async function saveGamificationConfig(form: FormData): Promise<ActionResult> {
  await requireAdmin();
  const parsed = gamificationConfigSchema.safeParse(parseJson(form.get("config")));
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };

  await writeGamificationConfig(parsed.data as unknown as GamificationConfig);
  // Scores are derived, so every screen that shows XP is now stale.
  revalidateShell();
  return { ok: true };
}

export async function resetGamificationConfig(): Promise<ActionResult> {
  await requireAdmin();
  await prisma.appSetting.deleteMany({ where: { key: "gamificationRulesets" } });
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
  await requireAdmin();
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

  if (d.id) await prisma.goal.update({ where: { id: d.id }, data });
  else await prisma.goal.create({ data });

  revalidatePath("/console");
  revalidatePath("/");
  return { ok: true };
}

export async function deleteGoal(id: string): Promise<ActionResult> {
  await requireAdmin();

  // A rule that pays on this goal can never fire again, so it goes too (its grants
  // cascade). Filtering in JS beats a JSON-path query: the trigger shape is owned by
  // zod, not by Postgres, and there are only ever a handful of rules.
  const orphaned = (await prisma.rewardRule.findMany({ select: { id: true, trigger: true } }))
    .filter((r) => {
      const t = parseRewardTrigger(r.trigger);
      return t?.kind === "GOAL_MET" && t.goalId === id;
    })
    .map((r) => r.id);

  await prisma.$transaction([
    prisma.rewardRule.deleteMany({ where: { id: { in: orphaned } } }),
    prisma.goal.delete({ where: { id } }),
  ]);

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
  await requireAdmin();
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

  if (d.id) await prisma.rewardRule.update({ where: { id: d.id }, data });
  else await prisma.rewardRule.create({ data });

  revalidatePath("/console");
  return { ok: true };
}

export async function deleteRewardRule(id: string): Promise<ActionResult> {
  const { allowed, denied } = await capabilityCheck("rewards.approve");
  if (!allowed) return denied;
  await prisma.rewardRule.delete({ where: { id } }); // grants cascade
  revalidatePath("/console");
  return { ok: true };
}

/** Re-derive every qualification. Safe to run repeatedly — see server/rewards.ts. */
export async function scanRewards(): Promise<{ ok: true; created: number } | { ok: false; error: string }> {
  await requireAdmin();
  const created = await syncRewardGrants();
  revalidatePath("/console");
  return { ok: true, created };
}

const grantStatusSchema = z.enum(["PENDING", "APPROVED", "DECLINED", "PAID"]);

export async function setGrantStatus(id: string, status: string): Promise<ActionResult> {
  const { allowed, denied, session } = await capabilityCheck("rewards.approve");
  if (!allowed) return denied;
  const parsed = grantStatusSchema.safeParse(status);
  if (!parsed.success) return { ok: false, error: "Unknown status" };

  await prisma.rewardGrant.update({
    where: { id },
    data: { status: parsed.data, decidedById: session.user.id, decidedAt: new Date() },
  });
  revalidatePath("/console");
  return { ok: true };
}

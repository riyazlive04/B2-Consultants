import "server-only";
import { cache } from "react";
import { getEmailRuntime } from "@/lib/email";
import { getWatiRuntime } from "@/lib/wati";
import { ENGINES, type EngineKey, type EngineCopy } from "@/lib/engines";
import {
  getAgreementWorkflow,
  getBookingCalendars,
  getBookingRulesConfig,
  getDunningConfig,
  getFinancePostingConfig,
  getMaintenanceConfig,
  getPipelineConfig,
  getSpeedToLeadAlertConfig,
} from "./founder-config";

/**
 * IS THIS SCREEN'S ENGINE ON? (refactor step E5)
 *
 * `not-armed.ts` answers "what is off?" across all sixteen engines, for the founder who goes
 * looking on the Console. This answers the narrower question the person standing on an empty
 * screen is actually asking - "why is nothing happening here?" - and it answers it there.
 *
 * ── Why this is not just a filter over getNotArmedReport() ──────────────────────────────
 * That report loads everything for everything: a cron heartbeat row, the delivery-status table,
 * the booking calendars, five founder-config blobs. Calling it to put one line on /payments
 * would add uncached round trips to a screen the founders open all day, and at ~200ms to
 * Supabase Singapore that is a visible cost for a notice that is usually not even shown.
 *
 * So each engine has its own check here, and a screen pays only for the engines it names. Every
 * one of these reads `founder-config`, whose `readSetting` is wrapped in `unstable_cache` with
 * the `founder-config` tag - so a warm request costs nothing and a Console save invalidates it.
 * The two env-backed runtimes (email, WhatsApp) read process env and the cached settings blob.
 *
 * `cron` and `intake` are deliberately NOT here. Both need genuinely uncached queries (a
 * heartbeat row, the delivery-status table) and neither belongs to one screen - they are
 * upstream of nearly everything, which is what the Console list is for.
 */

const CHECKS: Record<Exclude<EngineKey, "cron" | "intake">, () => Promise<boolean>> = {
  // Armed when at least ONE calendar can actually produce a slot - the same rule the Console
  // list uses, so the two can never disagree about the same cohort of calendars.
  availability: async () => (await getBookingCalendars()).some((c) => c.enabled && c.weekdays.length > 0),
  email: async () => (await getEmailRuntime()).enabled,
  whatsapp: async () => (await getWatiRuntime()).enabled,
  confirmLoop: async () => (await getBookingRulesConfig()).autoCancelEnabled,
  studentWelcome: async () => (await getWatiRuntime()).settings.cadence.studentWelcomeEnabled,
  // Enabled-but-rehearsing counts as OFF. A dry-run engine is doing its job perfectly and
  // still nobody is being reminded of anything.
  classReminders: async () => {
    const { cadence } = (await getWatiRuntime()).settings;
    return cadence.classReminderEnabled && !cadence.classReminderDryRun;
  },
  speedToLead: async () => (await getSpeedToLeadAlertConfig()).enabled,
  dunning: async () => (await getDunningConfig()).enabled,
  agreementReminders: async () => (await getAgreementWorkflow()).reminderDays.length > 0,
  retention: async () => (await getMaintenanceConfig()).retention.enabled,
  commissionAccrual: async () => (await getFinancePostingConfig()).commissionAccrual.enabled,
  tutorFeeAccrual: async () => (await getFinancePostingConfig()).tutorFeeAccrual.enabled,
  invoicePosting: async () => (await getFinancePostingConfig()).invoiceIssuancePosting.enabled,
  autoCreateOpportunity: async () => (await getPipelineConfig()).autoCreateOpportunity,
};

export type EngineNotice = EngineCopy & { key: EngineKey };

/** Screen-level engines a page may ask about - everything except the two upstream ones. */
export type ScreenEngineKey = keyof typeof CHECKS;

/**
 * The engines among `keys` that are currently OFF, in the order given.
 *
 * Returns `[]` when everything is on, which is the case a page renders nothing for. Wrapped in
 * React's `cache` so two components on one page asking about the same engine share the read.
 */
export const enginesOff = cache(async (keys: readonly ScreenEngineKey[]): Promise<EngineNotice[]> => {
  const states = await Promise.all(keys.map((k) => CHECKS[k]()));
  return keys
    .map((k, i) => ({ key: k, armed: states[i] }))
    .filter((x) => !x.armed)
    .map((x) => ({ key: x.key, ...ENGINES[x.key] }));
});

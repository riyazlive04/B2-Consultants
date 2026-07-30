import "server-only";

import type { LeadStage } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getEmailRuntime } from "@/lib/email";
import { getSmsRuntime } from "@/lib/sms";
import { getWorkflowSettings } from "./founder-config";
import {
  simulateWorkflow,
  type DryRunChannel,
  type DryRunEvent,
  type DryRunLead,
  type DryRunResult,
  type DryRunTemplate,
} from "@/lib/automation-dryrun";
import type { TriggerConfig, TriggerType, WorkflowAction } from "@/lib/automation-types";

/**
 * Dry run — the READ half. Finds the trigger occurrences that really happened inside a window,
 * loads just enough about each contact to project an outcome, and hands the whole lot to the
 * pure simulator in lib/automation-dryrun.ts. Nothing here writes.
 *
 * EVERY TRIGGER HAS A DIFFERENT HISTORY TABLE, and they are not equally complete. Rather than
 * quietly paper over that, each source declares its own coverage note, which the panel prints
 * under the numbers:
 *
 *   CONTACT_CREATED  Lead.createdAt                 exact
 *   FORM_SUBMITTED   FormSubmission.createdAt       exact (submissions that matched a contact)
 *   BOOKING_CREATED  BookingRequest.createdAt       exact (bookings that matched a contact)
 *   INVOICE_PAID     Invoice.paidAt                 exact
 *   STAGE_CHANGED    LeadStageHistory.changedAt     UPPER BOUND — history records every stage
 *                                                   move, but the live trigger only fires on a
 *                                                   pipeline card move (opportunities-actions).
 *   TAG_ADDED        ActivityLog "contact.tag.create"  LOWER BOUND — only tags a person added
 *                                                   through the app since the activity feed
 *                                                   shipped. Imports and pre-feed tags are
 *                                                   invisible, and the engine's own ADD_TAG
 *                                                   deliberately doesn't re-trigger, so it is
 *                                                   excluded here too.
 *
 * Archived contacts are excluded everywhere — a soft-deleted lead is not going to be enrolled.
 */

/** Hard ceiling on events pulled per preview. Past this the projection is a floor, and says so. */
const EVENT_CAP = 5000;

export type DryRunSource = { label: string; coverage: string; exact: boolean };

export type DryRunReport = {
  result: DryRunResult;
  source: DryRunSource;
  /** the global kill switch — a preview is still useful when it's off, but the panel must say so */
  engineEnabled: boolean;
  allowReEnrollment: boolean;
  quietHours: { enabled: boolean; startHour: number; endHour: number };
  channels: { email: DryRunChannel; sms: DryRunChannel };
  windowDays: number;
};

export const DRY_RUN_WINDOWS = [7, 30, 90] as const;
export type DryRunWindow = (typeof DRY_RUN_WINDOWS)[number];

const SOURCES: Record<TriggerType, DryRunSource> = {
  CONTACT_CREATED: {
    label: "contact records",
    coverage: "Every contact created in the window — an exact replay.",
    exact: true,
  },
  FORM_SUBMITTED: {
    label: "form submissions",
    coverage: "Every submission that matched a contact. Submissions with no contact never trigger.",
    exact: true,
  },
  BOOKING_CREATED: {
    label: "booking requests",
    coverage: "Every booking linked to a contact — an exact replay.",
    exact: true,
  },
  INVOICE_PAID: {
    label: "invoices marked paid",
    coverage: "Every invoice that reached Paid in the window — an exact replay.",
    exact: true,
  },
  STAGE_CHANGED: {
    label: "stage history",
    coverage:
      "Every stage move recorded. The live trigger only fires when a pipeline card is moved, so treat this as the upper bound.",
    exact: false,
  },
  TAG_ADDED: {
    label: "the activity feed",
    coverage:
      "Only tags a person added through the app, since the activity feed shipped. Imported or older tags aren't recorded, so the real number can be higher.",
    exact: false,
  },
};

/** Turn a channel runtime into "would this actually deliver, and if not, why not". */
function channelState(rt: { enabled: boolean; configured: boolean; envEnabled: boolean; paused: boolean }, name: string): DryRunChannel {
  if (rt.enabled) return { live: true, reason: `${name} is live` };
  if (!rt.configured) return { live: false, reason: `${name} isn't configured` };
  if (rt.paused) return { live: false, reason: `${name} is paused` };
  if (!rt.envEnabled) return { live: false, reason: `${name} sending is switched off` };
  return { live: false, reason: `${name} is off` };
}

/**
 * Trigger occurrences in [from, to], oldest first, capped at EVENT_CAP + 1 so the caller can
 * detect truncation. The trigger config is pushed into the query where the column exists (form,
 * stage) — the simulator re-applies it anyway, but filtering in Postgres keeps the cap meaningful
 * for a workflow that watches one specific form.
 */
async function fetchEvents(
  triggerType: TriggerType,
  cfg: TriggerConfig,
  from: Date,
  to: Date,
): Promise<DryRunEvent[]> {
  const take = EVENT_CAP + 1;
  const window = { gte: from, lte: to };

  switch (triggerType) {
    case "CONTACT_CREATED": {
      const rows = await prisma.lead.findMany({
        where: { deletedAt: null, createdAt: window },
        select: { id: true, createdAt: true },
        orderBy: { createdAt: "asc" },
        take,
      });
      return rows.map((r) => ({ leadId: r.id, at: r.createdAt }));
    }
    case "FORM_SUBMITTED": {
      const rows = await prisma.formSubmission.findMany({
        where: {
          createdAt: window,
          leadId: { not: null },
          lead: { deletedAt: null },
          ...(cfg.formId ? { formId: cfg.formId } : {}),
        },
        select: { leadId: true, formId: true, createdAt: true },
        orderBy: { createdAt: "asc" },
        take,
      });
      return rows.map((r) => ({ leadId: r.leadId!, at: r.createdAt, formId: r.formId }));
    }
    case "STAGE_CHANGED": {
      const rows = await prisma.leadStageHistory.findMany({
        where: {
          changedAt: window,
          lead: { deletedAt: null },
          ...(cfg.stage ? { toStage: cfg.stage as LeadStage } : {}),
        },
        select: { leadId: true, toStage: true, changedAt: true },
        orderBy: { changedAt: "asc" },
        take,
      });
      return rows.map((r) => ({ leadId: r.leadId, at: r.changedAt, stage: r.toStage }));
    }
    case "BOOKING_CREATED": {
      const rows = await prisma.bookingRequest.findMany({
        where: { createdAt: window, leadId: { not: null }, lead: { deletedAt: null } },
        select: { leadId: true, createdAt: true },
        orderBy: { createdAt: "asc" },
        take,
      });
      return rows.map((r) => ({ leadId: r.leadId!, at: r.createdAt }));
    }
    case "INVOICE_PAID": {
      const rows = await prisma.invoice.findMany({
        where: { paidAt: window, leadId: { not: null }, deletedAt: null, lead: { deletedAt: null } },
        select: { leadId: true, paidAt: true },
        orderBy: { paidAt: "asc" },
        take,
      });
      return rows.map((r) => ({ leadId: r.leadId!, at: r.paidAt! }));
    }
    case "TAG_ADDED": {
      // No tag_added table exists — the m:n join carries no timestamp — so the activity feed is
      // the only record of WHEN a tag went on. `contact.tag.create` covers both the single-contact
      // and bulk paths (contacts-actions.ts), which are exactly the two that call emitTrigger.
      const rows = await prisma.activityLog.findMany({
        where: { at: window, action: "contact.tag.create" },
        select: { at: true, entityType: true, entityId: true, meta: true },
        orderBy: { at: "asc" },
        take,
      });
      const out: DryRunEvent[] = [];
      for (const r of rows) {
        const meta = (r.meta ?? {}) as { tag?: unknown; leadIds?: unknown };
        const tag = typeof meta.tag === "string" ? meta.tag : null;
        if (r.entityType === "Lead") {
          out.push({ leadId: r.entityId, at: r.at, tag });
        } else if (Array.isArray(meta.leadIds)) {
          // The bulk row is one feed entry for many contacts; the engine saw one trigger each.
          for (const id of meta.leadIds) {
            if (typeof id === "string") out.push({ leadId: id, at: r.at, tag });
          }
        }
      }
      return out;
    }
  }
}

/** The facts the simulator needs about each contact an event touched. */
async function fetchLeadFacts(ids: string[]): Promise<Record<string, DryRunLead>> {
  if (ids.length === 0) return {};
  const rows = await prisma.lead.findMany({
    where: { id: { in: ids }, deletedAt: null },
    select: { id: true, name: true, email: true, phone: true, stage: true, tags: { select: { name: true } } },
  });
  const out: Record<string, DryRunLead> = {};
  for (const r of rows) {
    out[r.id] = {
      id: r.id,
      name: r.name,
      hasEmail: Boolean(r.email?.trim()),
      hasPhone: Boolean(r.phone?.trim()),
      stage: r.stage,
      tags: r.tags.map((t) => t.name.toLowerCase()),
    };
  }
  return out;
}

/** Only the templates this definition actually references — a deleted one stays absent, which is the signal. */
async function fetchTemplates(actions: WorkflowAction[]): Promise<Record<string, DryRunTemplate>> {
  const ids = [...new Set(actions.map((a) => a.templateId).filter((id): id is string => Boolean(id)))];
  if (ids.length === 0) return {};
  const rows = await prisma.messageTemplate.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true, channel: true, subject: true, body: true },
  });
  const out: Record<string, DryRunTemplate> = {};
  for (const r of rows) {
    out[r.id] = { name: r.name, channel: r.channel as "EMAIL" | "SMS", subject: r.subject, body: r.body };
  }
  return out;
}

/**
 * Replay `definition` over the last `windowDays` days and report what it would have done.
 *
 * The definition is passed in rather than read from the row on purpose: the builder previews what
 * is on screen, including unsaved edits. That's the whole point — you check the thing before you
 * arm it, not after you've committed it.
 */
export async function dryRunWorkflow(
  definition: { triggerType: TriggerType; triggerConfig: TriggerConfig; actions: WorkflowAction[] },
  windowDays: number,
  now: Date = new Date(),
): Promise<DryRunReport> {
  const days = Math.max(1, Math.min(365, Math.round(windowDays)));
  const windowStart = new Date(now.getTime() - days * 86_400_000);

  const [settings, emailRt, smsRt, rawEvents, templates] = await Promise.all([
    getWorkflowSettings(),
    getEmailRuntime(),
    getSmsRuntime(),
    fetchEvents(definition.triggerType, definition.triggerConfig, windowStart, now),
    fetchTemplates(definition.actions),
  ]);

  const truncated = rawEvents.length > EVENT_CAP;
  const events = truncated ? rawEvents.slice(0, EVENT_CAP) : rawEvents;
  const leads = await fetchLeadFacts([...new Set(events.map((e) => e.leadId))]);
  // An event whose contact has since been archived isn't a candidate at all — drop it rather than
  // counting it as "scanned but never enrolled", which would read as a filter that didn't fire.
  const live = events.filter((e) => leads[e.leadId]);

  const result = simulateWorkflow({
    triggerType: definition.triggerType,
    triggerConfig: definition.triggerConfig,
    actions: definition.actions,
    events: live,
    leads,
    templates,
    channels: {
      email: channelState(emailRt, "Email"),
      sms: channelState(smsRt, "SMS"),
    },
    settings: { allowReEnrollment: settings.allowReEnrollment, quietHours: settings.quietHours },
    windowStart,
    windowEnd: now,
    truncated,
  });

  return {
    result,
    source: SOURCES[definition.triggerType],
    engineEnabled: settings.engineEnabled,
    allowReEnrollment: settings.allowReEnrollment,
    quietHours: settings.quietHours,
    channels: {
      email: channelState(emailRt, "Email"),
      sms: channelState(smsRt, "SMS"),
    },
    windowDays: days,
  };
}

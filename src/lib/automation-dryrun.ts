/**
 * Workflow DRY RUN — "if this workflow had been live last month, what would it have done?"
 *
 * PURE and isomorphic (no prisma, no server-only, no hidden `new Date()`), same contract as
 * automation-quiet-hours.ts and outreach-engine.ts: every input — the trigger events, the
 * contacts' facts, the clock — is handed in, so the whole projection is testable without a
 * database. `server/automation-dryrun.ts` does the fetching; this file does the thinking.
 *
 * FIDELITY IS THE WHOLE POINT. Nobody arms an automation they can't preview, and a preview
 * nobody trusts is worse than none — so the walk below mirrors `server/automation.ts`
 * (`emitTrigger` + `advanceEnrollment`) step for step, including the parts that are easy to
 * forget:
 *   - trigger-config filtering (form / tag / stage), with the same case rules;
 *   - the re-enrollment gate, both settings (ACTIVE-blocks vs once-per-contact-ever);
 *   - WAIT advancing a virtual clock rather than ending the run;
 *   - IF_TAG jumping — forwards, backwards, or into a cycle — under the same step cap;
 *   - quiet hours parking a send until the window closes, which shifts every later step too;
 *   - a send to a contact with no email/phone failing WITHOUT failing the enrollment.
 *
 * WHAT IT CANNOT KNOW, and therefore says out loud (`approximations` on the result):
 *   - Contact state (tags, stage) is today's, not the state on the day the trigger fired.
 *     Within one run we mutate a local copy, so an ADD_TAG at step 1 is visible to an IF_TAG
 *     at step 4 — but the starting point is the present.
 *   - Only enrollments inside the window count toward the re-enrollment gate; a contact the
 *     real workflow enrolled last year is invisible here.
 *   - The cron resumes waits on a tick, so real sends land a little later than projected.
 * These are stated, never silently smoothed over — an over-confident preview is the failure
 * mode this feature exists to prevent.
 *
 * NOTHING HERE WRITES. The projection is a value; the caller renders it and throws it away.
 */

import { inQuietWindow, quietWindowEndsAt } from "./automation-quiet-hours";
import { ACTION_LABELS, type TriggerConfig, type TriggerType, type WorkflowAction, type WorkflowActionType } from "./automation-types";

// ───────────────────────────── inputs ─────────────────────────────

/** One historical trigger occurrence, already sourced from the table that recorded it. */
export type DryRunEvent = {
  leadId: string;
  at: Date;
  /** FORM_SUBMITTED */
  formId?: string | null;
  /** TAG_ADDED — the tag that was added, lowercase as the app stores it */
  tag?: string | null;
  /** STAGE_CHANGED — the LeadStage moved INTO */
  stage?: string | null;
};

/** What the engine needs to know about a contact to project a step's outcome. */
export type DryRunLead = {
  id: string;
  name: string;
  hasEmail: boolean;
  hasPhone: boolean;
  stage: string;
  /** current tag names, lowercase */
  tags: string[];
};

/** A template referenced by a SEND_ step, resolved so a deleted one is detectable. */
export type DryRunTemplate = { name: string; channel: "EMAIL" | "SMS"; subject: string | null; body: string };

/** Whether a channel would really deliver, and the one-line reason when it wouldn't. */
export type DryRunChannel = { live: boolean; reason: string };

export type DryRunSettings = {
  allowReEnrollment: boolean;
  quietHours: { enabled: boolean; startHour: number; endHour: number };
};

export type DryRunInput = {
  triggerType: TriggerType;
  triggerConfig: TriggerConfig;
  actions: WorkflowAction[];
  /** every candidate occurrence in the window, any order */
  events: DryRunEvent[];
  /** facts for each lead referenced by `events`, keyed by lead id */
  leads: Record<string, DryRunLead>;
  templates: Record<string, DryRunTemplate>;
  channels: { email: DryRunChannel; sms: DryRunChannel; whatsapp: DryRunChannel };
  settings: DryRunSettings;
  windowStart: Date;
  windowEnd: Date;
  /** true when the event fetch hit its cap — the projection is a floor, not a total */
  truncated?: boolean;
};

// ───────────────────────────── outputs ─────────────────────────────

export type StepOutcome =
  /** a real message reached the contact */
  | "DELIVERED"
  /** the channel is off, so the app logs a SKIPPED message nobody receives */
  | "LOGGED_ONLY"
  /** no email address / no phone number on the contact */
  | "UNREACHABLE"
  /** empty body or a template that no longer exists — the step is a no-op */
  | "NOTHING_TO_SEND"
  /** the contact record changed (tag, stage, task) */
  | "CHANGED"
  /** the step ran but changed nothing (already tagged, already on that stage) */
  | "NO_CHANGE"
  /** the step is missing the field it needs to do anything */
  | "MISCONFIGURED"
  /** IF_TAG chose a branch */
  | "BRANCH"
  /** WAIT parked the run */
  | "WAITED";

export const OUTCOME_LABELS: Record<StepOutcome, string> = {
  DELIVERED: "Delivered",
  LOGGED_ONLY: "Logged only (channel off)",
  UNREACHABLE: "Can't reach contact",
  NOTHING_TO_SEND: "Nothing to send",
  CHANGED: "Changed the contact",
  NO_CHANGE: "No change",
  MISCONFIGURED: "Step misconfigured",
  BRANCH: "Branched",
  WAITED: "Waited",
};

/** Outcomes that mean a human on the other end actually hears from you. */
const REACHING_OUTCOMES: StepOutcome[] = ["DELIVERED"];

export type ProjectedStep = {
  /** 0-based index into `actions` — the builder shows it 1-based */
  index: number;
  type: WorkflowActionType;
  at: Date;
  outcome: StepOutcome;
  detail: string;
  /** the send was pushed out of quiet hours to this instant */
  heldUntil?: Date;
};

export type ProjectedEnrollment = {
  leadId: string;
  leadName: string;
  enrolledAt: Date;
  /** when the last step would run (enrolledAt + every WAIT + any quiet-hours hold) */
  finishesAt: Date;
  steps: ProjectedStep[];
  /** set when the step cap tripped — an IF_TAG cycle */
  cutShort: boolean;
};

export type ActionBreakdown = {
  index: number;
  type: WorkflowActionType;
  label: string;
  runs: number;
  outcomes: { outcome: StepOutcome; count: number }[];
};

export type DryRunResult = {
  windowStart: Date;
  windowEnd: Date;
  truncated: boolean;
  /** trigger occurrences found in the window */
  scanned: number;
  /** …of those, the ones this workflow's trigger config accepts */
  matched: number;
  /** …of those, the ones that would actually create an enrollment */
  enrolled: number;
  /** blocked because the contact was still mid-run (allowReEnrollment on) */
  blockedInFlight: number;
  /** blocked because the contact had already been through once (allowReEnrollment off) */
  blockedAlreadyRan: number;
  /** distinct contacts enrolled */
  contacts: number;
  messages: {
    delivered: { email: number; sms: number; whatsapp: number };
    loggedOnly: { email: number; sms: number; whatsapp: number };
    unreachable: { email: number; sms: number; whatsapp: number };
    nothingToSend: number;
    heldByQuietHours: number;
  };
  changes: { tagsAdded: number; tagsRemoved: number; stageMoves: number; tasksCreated: number; noChange: number };
  byAction: ActionBreakdown[];
  /** the first few enrollments, step by step, for the "show me one" question */
  sample: ProjectedEnrollment[];
  /** longest projected run in the window, in minutes — "this workflow tails a contact for 9 days" */
  longestRunMinutes: number;
  cyclesHit: number;
  /** problems with the workflow itself: an empty SMS, a deleted template, a branch cycle */
  warnings: string[];
  /** honest limits of the projection, rendered next to the numbers */
  approximations: string[];
};

const SAMPLE_SIZE = 25;

// ───────────────────────────── trigger matching ─────────────────────────────

/** Mirrors emitTrigger's three `continue` guards — including the case rules. */
export function matchesTriggerConfig(type: TriggerType, cfg: TriggerConfig, ev: DryRunEvent): boolean {
  if (type === "FORM_SUBMITTED" && cfg.formId) return cfg.formId === ev.formId;
  if (type === "TAG_ADDED" && cfg.tag) return cfg.tag.trim().toLowerCase() === (ev.tag ?? "").trim().toLowerCase();
  if (type === "STAGE_CHANGED" && cfg.stage) return cfg.stage === ev.stage;
  return true;
}

// ───────────────────────────── static workflow lint ─────────────────────────────

/**
 * Problems visible without running anything. Reported even when the window is empty — a
 * workflow that would never have enrolled anyone should still tell you its SMS has no body.
 */
export function lintActions(actions: WorkflowAction[], templates: Record<string, DryRunTemplate>): string[] {
  const out: string[] = [];
  const at = (i: number, a: WorkflowAction) => `Step ${i + 1} (${ACTION_LABELS[a.type]})`;
  actions.forEach((a, i) => {
    const tpl = a.templateId ? templates[a.templateId] : undefined;
    switch (a.type) {
      case "SEND_EMAIL":
        if (a.templateId && !tpl) out.push(`${at(i, a)} uses a template that no longer exists — it would send nothing.`);
        else if (!a.templateId && !(a.body ?? "").trim()) out.push(`${at(i, a)} has an empty body.`);
        else if (tpl && tpl.channel !== "EMAIL") out.push(`${at(i, a)} points at an SMS template.`);
        break;
      case "SEND_SMS":
        if (a.templateId && !tpl) out.push(`${at(i, a)} uses a template that no longer exists — it would send nothing.`);
        else if (!a.templateId && !(a.body ?? "").trim()) out.push(`${at(i, a)} has no message body, so it would do nothing.`);
        else if (tpl && tpl.channel !== "SMS") out.push(`${at(i, a)} points at an email template.`);
        break;
      case "SEND_WHATSAPP":
        if (!(a.whatsappKind ?? "").trim()) {
          out.push(`${at(i, a)} has no WhatsApp template chosen, so it would send nothing.`);
        }
        break;
      case "ADD_TAG":
      case "REMOVE_TAG":
        if (!(a.tag ?? "").trim()) out.push(`${at(i, a)} has no tag name.`);
        break;
      case "IF_TAG": {
        if (!(a.tag ?? "").trim()) out.push(`${at(i, a)} has no tag to check, so it always takes the "no" branch.`);
        const self = [a.thenStep, a.elseStep].filter((s) => s === i);
        if (self.length) out.push(`${at(i, a)} branches to itself — that's a loop.`);
        break;
      }
      case "MOVE_STAGE":
        if (!a.stage) out.push(`${at(i, a)} has no stage picked.`);
        break;
      case "CREATE_TASK":
        if (!(a.taskTitle ?? "").trim()) out.push(`${at(i, a)} has no task title.`);
        break;
      case "WAIT":
        break;
    }
  });
  return out;
}

// ───────────────────────────── the projection ─────────────────────────────

export function simulateWorkflow(input: DryRunInput): DryRunResult {
  const { actions, settings, channels, templates, leads } = input;
  const warnings = new Set<string>(lintActions(actions, templates));
  const approximations: string[] = [];

  const result: DryRunResult = {
    windowStart: input.windowStart,
    windowEnd: input.windowEnd,
    truncated: Boolean(input.truncated),
    scanned: input.events.length,
    matched: 0,
    enrolled: 0,
    blockedInFlight: 0,
    blockedAlreadyRan: 0,
    contacts: 0,
    messages: {
      delivered: { email: 0, sms: 0, whatsapp: 0 },
      loggedOnly: { email: 0, sms: 0, whatsapp: 0 },
      unreachable: { email: 0, sms: 0, whatsapp: 0 },
      nothingToSend: 0,
      heldByQuietHours: 0,
    },
    changes: { tagsAdded: 0, tagsRemoved: 0, stageMoves: 0, tasksCreated: 0, noChange: 0 },
    byAction: actions.map((a, index) => ({ index, type: a.type, label: ACTION_LABELS[a.type], runs: 0, outcomes: [] })),
    sample: [],
    longestRunMinutes: 0,
    cyclesHit: 0,
    warnings: [],
    approximations,
  };

  const tally = (index: number, outcome: StepOutcome) => {
    const row = result.byAction[index];
    if (!row) return;
    row.runs++;
    const hit = row.outcomes.find((o) => o.outcome === outcome);
    if (hit) hit.count++;
    else row.outcomes.push({ outcome, count: 1 });
  };

  // Chronological, because the re-enrollment gate depends on what already happened.
  const events = [...input.events].sort((a, b) => a.at.getTime() - b.at.getTime());

  /** Contact state as the run mutates it — starts from today's facts (see the header note). */
  const state = new Map<string, { tags: Set<string>; stage: string }>();
  const busyUntil = new Map<string, number>(); // leadId → projected finish of its last run
  const everEnrolled = new Set<string>();

  // IF_TAG can jump backwards, so a run can cycle. Same cap as advanceEnrollment.
  const maxSteps = Math.max(actions.length * 4, 100);

  for (const ev of events) {
    if (!matchesTriggerConfig(input.triggerType, input.triggerConfig, ev)) continue;
    result.matched++;

    const lead = leads[ev.leadId];
    if (!lead) continue; // contact archived/deleted since — nothing to project onto

    // The enrollment gate, both settings (emitTrigger's `blocking` query).
    if (!settings.allowReEnrollment) {
      if (everEnrolled.has(ev.leadId)) {
        result.blockedAlreadyRan++;
        continue;
      }
    } else if ((busyUntil.get(ev.leadId) ?? -Infinity) > ev.at.getTime()) {
      result.blockedInFlight++;
      continue;
    }

    if (!state.has(ev.leadId)) {
      state.set(ev.leadId, { tags: new Set(lead.tags.map((t) => t.toLowerCase())), stage: lead.stage });
    }
    const st = state.get(ev.leadId)!;

    result.enrolled++;
    everEnrolled.add(ev.leadId);

    const steps: ProjectedStep[] = [];
    let clock = ev.at;
    let step = 0;
    let guard = 0;
    let cutShort = false;

    while (step < actions.length) {
      if (++guard > maxSteps) {
        cutShort = true;
        result.cyclesHit++;
        warnings.add(
          `A run exceeded ${maxSteps} steps and was cut short — check the IF_TAG branches for a loop. The live engine fails these enrollments.`,
        );
        break;
      }
      const a = actions[step];
      const push = (outcome: StepOutcome, detail: string, heldUntil?: Date) => {
        steps.push({ index: step, type: a.type, at: clock, outcome, detail, heldUntil });
        tally(step, outcome);
      };

      if (a.type === "WAIT") {
        const mins = Math.max(1, a.waitMinutes ?? 60);
        clock = new Date(clock.getTime() + mins * 60_000);
        push("WAITED", `Waits ${formatMinutes(mins)}`);
        step++;
        continue;
      }

      if (a.type === "IF_TAG") {
        const tag = (a.tag ?? "").trim().toLowerCase();
        const has = tag ? st.tags.has(tag) : false;
        const target = has ? a.thenStep : a.elseStep;
        const next = typeof target === "number" && target >= 0 ? target : step + 1;
        push(
          "BRANCH",
          tag
            ? `${has ? "Has" : "Doesn't have"} "${tag}" → ${next >= actions.length ? "ends" : `step ${next + 1}`}`
            : `No tag set → ${next >= actions.length ? "ends" : `step ${next + 1}`}`,
        );
        step = next;
        continue;
      }

      // Quiet hours gate outbound sends only, and park ON the step — so the send still happens,
      // just later, and every step after it shifts with it.
      let heldUntil: Date | undefined;
      if (
        (a.type === "SEND_EMAIL" || a.type === "SEND_SMS" || a.type === "SEND_WHATSAPP") &&
        settings.quietHours.enabled
      ) {
        if (inQuietWindow(clock, settings.quietHours.startHour, settings.quietHours.endHour)) {
          clock = quietWindowEndsAt(clock, settings.quietHours.endHour);
          heldUntil = clock;
          result.messages.heldByQuietHours++;
        }
      }

      switch (a.type) {
        case "SEND_EMAIL": {
          const tpl = a.templateId ? templates[a.templateId] : undefined;
          const via = tpl ? `the "${tpl.name}" template` : "a custom email";
          if (a.templateId && !tpl) {
            result.messages.nothingToSend++;
            push("NOTHING_TO_SEND", "Template no longer exists", heldUntil);
          } else if (!lead.hasEmail) {
            result.messages.unreachable.email++;
            push("UNREACHABLE", "No email address on this contact", heldUntil);
          } else if (!channels.email.live) {
            result.messages.loggedOnly.email++;
            push("LOGGED_ONLY", `Would log ${via} — ${channels.email.reason}`, heldUntil);
          } else {
            result.messages.delivered.email++;
            push("DELIVERED", `Emails ${via}`, heldUntil);
          }
          break;
        }
        case "SEND_SMS": {
          const tpl = a.templateId ? templates[a.templateId] : undefined;
          const body = tpl ? tpl.body : (a.body ?? "");
          const via = tpl ? `the "${tpl.name}" SMS template` : "a custom SMS";
          if (!body.trim()) {
            // The engine's `if (body)` guard: an empty SMS is silently skipped.
            result.messages.nothingToSend++;
            push("NOTHING_TO_SEND", a.templateId ? "Template no longer exists" : "No message body", heldUntil);
          } else if (!lead.hasPhone) {
            result.messages.unreachable.sms++;
            push("UNREACHABLE", "No phone number on this contact", heldUntil);
          } else if (!channels.sms.live) {
            result.messages.loggedOnly.sms++;
            push("LOGGED_ONLY", `Would log ${via} — ${channels.sms.reason}`, heldUntil);
          } else {
            result.messages.delivered.sms++;
            push("DELIVERED", `Texts ${via}`, heldUntil);
          }
          break;
        }
        case "SEND_WHATSAPP": {
          const kind = (a.whatsappKind ?? "").trim();
          const via = kind ? `the "${kind}" WhatsApp template` : "a WhatsApp message";
          if (!kind) {
            result.messages.nothingToSend++;
            push("NOTHING_TO_SEND", "No WhatsApp template chosen", heldUntil);
          } else if (!lead.hasPhone) {
            result.messages.unreachable.whatsapp++;
            push("UNREACHABLE", "No phone number on this contact", heldUntil);
          } else if (!channels.whatsapp.live) {
            result.messages.loggedOnly.whatsapp++;
            push("LOGGED_ONLY", `Would log ${via} — ${channels.whatsapp.reason}`, heldUntil);
          } else {
            result.messages.delivered.whatsapp++;
            push("DELIVERED", `WhatsApps ${via}`, heldUntil);
          }
          break;
        }
        case "ADD_TAG": {
          const tag = (a.tag ?? "").trim().toLowerCase();
          if (!tag) push("MISCONFIGURED", "No tag name");
          else if (st.tags.has(tag)) {
            result.changes.noChange++;
            push("NO_CHANGE", `Already tagged "${tag}"`);
          } else {
            st.tags.add(tag);
            result.changes.tagsAdded++;
            push("CHANGED", `Tags "${tag}"`);
          }
          break;
        }
        case "REMOVE_TAG": {
          const tag = (a.tag ?? "").trim().toLowerCase();
          if (!tag) push("MISCONFIGURED", "No tag name");
          else if (!st.tags.has(tag)) {
            result.changes.noChange++;
            push("NO_CHANGE", `Doesn't have "${tag}"`);
          } else {
            st.tags.delete(tag);
            result.changes.tagsRemoved++;
            push("CHANGED", `Removes "${tag}"`);
          }
          break;
        }
        case "MOVE_STAGE": {
          if (!a.stage) push("MISCONFIGURED", "No stage picked");
          else if (st.stage === a.stage) {
            result.changes.noChange++;
            push("NO_CHANGE", `Already at ${a.stage}`);
          } else {
            const from = st.stage;
            st.stage = a.stage;
            result.changes.stageMoves++;
            push("CHANGED", `Moves ${from} → ${a.stage}`);
          }
          break;
        }
        case "CREATE_TASK": {
          const title = (a.taskTitle ?? "").trim();
          if (!title) push("MISCONFIGURED", "No task title");
          else {
            result.changes.tasksCreated++;
            push("CHANGED", `Creates task "${title}"`);
          }
          break;
        }
      }
      step++;
    }

    const finishesAt = clock;
    busyUntil.set(ev.leadId, finishesAt.getTime());
    result.longestRunMinutes = Math.max(
      result.longestRunMinutes,
      Math.round((finishesAt.getTime() - ev.at.getTime()) / 60_000),
    );
    if (result.sample.length < SAMPLE_SIZE) {
      result.sample.push({ leadId: ev.leadId, leadName: lead.name, enrolledAt: ev.at, finishesAt, steps, cutShort });
    }
  }

  result.contacts = everEnrolled.size;

  // ── honest caveats, only the ones that actually apply ──
  if (result.enrolled > 0) {
    if (actions.some((a) => a.type === "IF_TAG" || a.type === "ADD_TAG" || a.type === "REMOVE_TAG")) {
      approximations.push(
        "Tag checks use each contact's tags as they are today, not as they were when the trigger fired.",
      );
    }
    if (actions.some((a) => a.type === "MOVE_STAGE")) {
      approximations.push("Stage checks start from each contact's current stage, not their stage at the time.");
    }
    if (actions.some((a) => a.type === "WAIT")) {
      approximations.push("Waits are projected to the minute; the live engine resumes them on the next cron tick.");
    }
    approximations.push(
      "Only enrollments inside this window count toward re-enrollment — a contact the live workflow enrolled earlier isn't known here.",
    );
  }
  if (result.truncated) {
    warnings.add("The scan hit its cap, so these are the earliest events in the window — the real totals are higher.");
  }

  const reached = REACHING_OUTCOMES.reduce(
    (n, o) => n + result.byAction.reduce((m, r) => m + (r.outcomes.find((x) => x.outcome === o)?.count ?? 0), 0),
    0,
  );
  if (
    result.enrolled > 0 &&
    reached === 0 &&
    actions.some((a) => a.type === "SEND_EMAIL" || a.type === "SEND_SMS" || a.type === "SEND_WHATSAPP")
  ) {
    warnings.add("No message in this workflow would actually reach anyone — check the channel status and contact details above.");
  }

  result.warnings = [...warnings];
  return result;
}

/** "2 days", "90 minutes", "3 hours" — the builder's own WAIT vocabulary. */
export function formatMinutes(mins: number): string {
  if (mins % 1440 === 0) {
    const d = mins / 1440;
    return `${d} day${d === 1 ? "" : "s"}`;
  }
  if (mins % 60 === 0) {
    const h = mins / 60;
    return `${h} hour${h === 1 ? "" : "s"}`;
  }
  return `${mins} minute${mins === 1 ? "" : "s"}`;
}

/** One-line headline for the panel: what a founder reads before the tables. */
export function summarise(r: DryRunResult): string {
  if (r.scanned === 0) return "Nothing triggered this workflow in that window.";
  if (r.enrolled === 0) return `${r.scanned.toLocaleString("en-IN")} events, but none of them would have enrolled anyone.`;
  const sends =
    r.messages.delivered.email +
    r.messages.delivered.sms +
    r.messages.delivered.whatsapp +
    r.messages.loggedOnly.email +
    r.messages.loggedOnly.sms +
    r.messages.loggedOnly.whatsapp;
  const parts = [`would have enrolled ${r.enrolled.toLocaleString("en-IN")} contact${r.enrolled === 1 ? "" : "s"}`];
  if (sends > 0) parts.push(`sent ${sends.toLocaleString("en-IN")} message${sends === 1 ? "" : "s"}`);
  const touched = r.changes.tagsAdded + r.changes.tagsRemoved + r.changes.stageMoves + r.changes.tasksCreated;
  if (touched > 0) parts.push(`made ${touched.toLocaleString("en-IN")} change${touched === 1 ? "" : "s"} to contact records`);
  return `This workflow ${parts.join(", and ")}.`;
}

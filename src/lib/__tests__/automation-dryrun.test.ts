/**
 * Workflow dry run — projection tests.
 *
 * The dry run's only job is to tell the truth about what the live engine would do, so these
 * tests are written against `server/automation.ts`'s actual semantics, not against what a
 * reasonable engine "should" do. The cases that earn their keep are the ones where the
 * intuitive answer is wrong:
 *
 *   - a send to a contact with no email does NOT fail the enrollment, it just doesn't land;
 *   - an empty SMS body is silently skipped, but an empty EMAIL body still sends;
 *   - quiet hours delay a send rather than dropping it, so every later step shifts too;
 *   - IF_TAG reads the tag set as the run itself has mutated it;
 *   - a branch cycle is capped, not run forever.
 *
 * Everything is pure, so no DB, no fake timers. Run: npm test
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  lintActions,
  matchesTriggerConfig,
  simulateWorkflow,
  summarise,
  type DryRunEvent,
  type DryRunInput,
  type DryRunLead,
  type DryRunTemplate,
} from "../automation-dryrun";
import type { WorkflowAction } from "../automation-types";

// ───────────────────────────── fixtures ─────────────────────────────

/** An instant at a given IST wall-clock time on 15 Jul 2026 (IST is UTC+05:30). */
function ist(hour: number, minute = 0, day = 15): Date {
  return new Date(Date.UTC(2026, 6, day, hour, minute) - 5.5 * 3600_000);
}

let seq = 0;
const act = (a: Partial<WorkflowAction> & { type: WorkflowAction["type"] }): WorkflowAction => ({
  id: `a${seq++}`,
  ...a,
});

const LEAD: DryRunLead = { id: "l1", name: "Priya Sharma", hasEmail: true, hasPhone: true, stage: "NEW_LEAD", tags: [] };

function input(over: Partial<DryRunInput> & { actions: WorkflowAction[] }): DryRunInput {
  const leads: Record<string, DryRunLead> = over.leads ?? { l1: LEAD };
  return {
    triggerType: "CONTACT_CREATED",
    triggerConfig: {},
    events: [{ leadId: "l1", at: ist(11) }],
    leads,
    templates: {},
    channels: { email: { live: true, reason: "live" }, sms: { live: true, reason: "live" }, whatsapp: { live: true, reason: "live" } },
    settings: { allowReEnrollment: true, quietHours: { enabled: false, startHour: 21, endHour: 9 } },
    windowStart: ist(0, 0, 1),
    windowEnd: ist(23, 59, 30),
    ...over,
  };
}

// ───────────────────────────── trigger matching ─────────────────────────────

describe("matchesTriggerConfig", () => {
  const ev = (o: Partial<DryRunEvent>): DryRunEvent => ({ leadId: "l1", at: ist(9), ...o });

  test("an empty config matches everything — 'any form', 'any tag'", () => {
    assert.equal(matchesTriggerConfig("FORM_SUBMITTED", {}, ev({ formId: "f9" })), true);
    assert.equal(matchesTriggerConfig("TAG_ADDED", {}, ev({ tag: "vip" })), true);
    assert.equal(matchesTriggerConfig("STAGE_CHANGED", {}, ev({ stage: "WON" })), true);
  });

  test("a specific form / stage must match exactly", () => {
    assert.equal(matchesTriggerConfig("FORM_SUBMITTED", { formId: "f1" }, ev({ formId: "f1" })), true);
    assert.equal(matchesTriggerConfig("FORM_SUBMITTED", { formId: "f1" }, ev({ formId: "f2" })), false);
    assert.equal(matchesTriggerConfig("STAGE_CHANGED", { stage: "WON" }, ev({ stage: "LOST" })), false);
  });

  test("tags compare case-insensitively, like emitTrigger", () => {
    assert.equal(matchesTriggerConfig("TAG_ADDED", { tag: "VIP" }, ev({ tag: "vip" })), true);
    assert.equal(matchesTriggerConfig("TAG_ADDED", { tag: " vip " }, ev({ tag: "VIP" })), true);
    assert.equal(matchesTriggerConfig("TAG_ADDED", { tag: "vip" }, ev({ tag: "cold" })), false);
  });
});

// ───────────────────────────── enrollment gate ─────────────────────────────

describe("enrollment", () => {
  test("counts scanned, matched and enrolled separately", () => {
    const r = simulateWorkflow(
      input({
        triggerType: "TAG_ADDED",
        triggerConfig: { tag: "vip" },
        actions: [act({ type: "CREATE_TASK", taskTitle: "Call them" })],
        events: [
          { leadId: "l1", at: ist(9), tag: "vip" },
          { leadId: "l1", at: ist(10), tag: "cold" }, // filtered by config
        ],
      }),
    );
    assert.equal(r.scanned, 2);
    assert.equal(r.matched, 1);
    assert.equal(r.enrolled, 1);
  });

  test("a second trigger while still mid-run is blocked (allowReEnrollment on)", () => {
    const r = simulateWorkflow(
      input({
        actions: [act({ type: "WAIT", waitMinutes: 1440 }), act({ type: "CREATE_TASK", taskTitle: "t" })],
        events: [
          { leadId: "l1", at: ist(9) },
          { leadId: "l1", at: ist(12) }, // still inside the 1-day wait
        ],
      }),
    );
    assert.equal(r.enrolled, 1);
    assert.equal(r.blockedInFlight, 1);
    assert.equal(r.blockedAlreadyRan, 0);
  });

  test("…but re-enrolls once the earlier run has finished", () => {
    const r = simulateWorkflow(
      input({
        actions: [act({ type: "WAIT", waitMinutes: 60 }), act({ type: "CREATE_TASK", taskTitle: "t" })],
        events: [
          { leadId: "l1", at: ist(9) },
          { leadId: "l1", at: ist(12) }, // the 1-hour run ended at 10:00
        ],
      }),
    );
    assert.equal(r.enrolled, 2);
    assert.equal(r.blockedInFlight, 0);
  });

  test("allowReEnrollment off makes it once-per-contact-ever", () => {
    const r = simulateWorkflow(
      input({
        actions: [act({ type: "CREATE_TASK", taskTitle: "t" })],
        settings: { allowReEnrollment: false, quietHours: { enabled: false, startHour: 21, endHour: 9 } },
        events: [
          { leadId: "l1", at: ist(9) },
          { leadId: "l1", at: ist(18) }, // the first run finished instantly, but it still blocks
        ],
      }),
    );
    assert.equal(r.enrolled, 1);
    assert.equal(r.blockedAlreadyRan, 1);
    assert.equal(r.blockedInFlight, 0);
  });

  test("an event whose contact is gone is matched but never enrolled", () => {
    const r = simulateWorkflow(
      input({ actions: [act({ type: "CREATE_TASK", taskTitle: "t" })], events: [{ leadId: "ghost", at: ist(9) }] }),
    );
    assert.equal(r.matched, 1);
    assert.equal(r.enrolled, 0);
  });

  test("events are projected in time order regardless of input order", () => {
    // Fed newest-first (the order a `orderBy: desc` query returns) the gate must still see
    // 09:00 as the first run — otherwise the blocked/enrolled split inverts.
    const r = simulateWorkflow(
      input({
        actions: [act({ type: "WAIT", waitMinutes: 1440 })],
        events: [
          { leadId: "l1", at: ist(12) },
          { leadId: "l1", at: ist(9) },
        ],
      }),
    );
    assert.equal(r.enrolled, 1);
    assert.equal(r.sample[0].enrolledAt.getTime(), ist(9).getTime());
  });
});

// ───────────────────────────── sends ─────────────────────────────

describe("sends", () => {
  const oneEmail = [act({ type: "SEND_EMAIL", subject: "Hi", body: "Hello {{first_name}}" })];
  const oneSms = [act({ type: "SEND_SMS", body: "Hello" })];

  test("delivers when the contact is reachable and the channel is live", () => {
    const r = simulateWorkflow(input({ actions: oneEmail }));
    assert.equal(r.messages.delivered.email, 1);
    assert.equal(r.messages.loggedOnly.email, 0);
  });

  test("a channel that is off logs the message without delivering it", () => {
    const r = simulateWorkflow(
      input({
        actions: oneEmail,
        channels: { email: { live: false, reason: "email is not configured" }, sms: { live: true, reason: "live" }, whatsapp: { live: true, reason: "live" } },
      }),
    );
    assert.equal(r.messages.delivered.email, 0);
    assert.equal(r.messages.loggedOnly.email, 1);
    assert.match(r.sample[0].steps[0].detail, /not configured/);
  });

  test("no email address means unreachable — and the run continues to the next step", () => {
    const r = simulateWorkflow(
      input({
        actions: [...oneEmail, act({ type: "ADD_TAG", tag: "emailed" })],
        leads: { l1: { ...LEAD, hasEmail: false } },
      }),
    );
    assert.equal(r.messages.unreachable.email, 1);
    assert.equal(r.changes.tagsAdded, 1, "a failed send must not abort the enrollment");
    assert.equal(r.sample[0].steps.length, 2);
  });

  test("an SMS with no body is skipped; an email with no body still sends", () => {
    const sms = simulateWorkflow(input({ actions: [act({ type: "SEND_SMS", body: "  " })] }));
    assert.equal(sms.messages.nothingToSend, 1);
    assert.equal(sms.messages.delivered.sms, 0);

    // The engine defaults the subject and posts the (empty) body — faithful, if odd.
    const email = simulateWorkflow(input({ actions: [act({ type: "SEND_EMAIL", body: "" })] }));
    assert.equal(email.messages.delivered.email, 1);
  });

  test("a template that no longer exists sends nothing", () => {
    const r = simulateWorkflow(input({ actions: [act({ type: "SEND_EMAIL", templateId: "gone" })] }));
    assert.equal(r.messages.nothingToSend, 1);
    assert.match(r.warnings.join(" "), /no longer exists/);
  });

  test("a resolved template is used and named in the detail line", () => {
    const templates: Record<string, DryRunTemplate> = {
      t1: { name: "Welcome", channel: "EMAIL", subject: "Hi", body: "Hello" },
    };
    const r = simulateWorkflow(input({ actions: [act({ type: "SEND_EMAIL", templateId: "t1" })], templates }));
    assert.equal(r.messages.delivered.email, 1);
    assert.match(r.sample[0].steps[0].detail, /Welcome/);
  });

  test("warns when nothing in the workflow would reach anybody", () => {
    const r = simulateWorkflow(
      input({
        actions: oneSms,
        leads: { l1: { ...LEAD, hasPhone: false } },
      }),
    );
    assert.match(r.warnings.join(" "), /would actually reach anyone/);
  });
});

// ───────────────────────────── waits and quiet hours ─────────────────────────────

describe("clock", () => {
  test("WAIT advances the projected time, it does not end the run", () => {
    const r = simulateWorkflow(
      input({
        actions: [
          act({ type: "WAIT", waitMinutes: 2880 }), // 2 days
          act({ type: "SEND_EMAIL", body: "x" }),
        ],
      }),
    );
    assert.equal(r.messages.delivered.email, 1);
    assert.equal(r.longestRunMinutes, 2880);
    assert.equal(r.sample[0].steps[1].at.getTime(), ist(11).getTime() + 2880 * 60_000);
  });

  test("a send inside quiet hours is held to the window's end, and later steps shift with it", () => {
    const r = simulateWorkflow(
      input({
        events: [{ leadId: "l1", at: ist(22) }], // 22:00, inside 21:00→09:00
        settings: { allowReEnrollment: true, quietHours: { enabled: true, startHour: 21, endHour: 9 } },
        actions: [act({ type: "SEND_SMS", body: "hi" }), act({ type: "ADD_TAG", tag: "texted" })],
      }),
    );
    assert.equal(r.messages.heldByQuietHours, 1);
    assert.equal(r.messages.delivered.sms, 1, "held, not dropped");
    const [send, tag] = r.sample[0].steps;
    assert.equal(send.heldUntil?.getTime(), ist(9, 0, 16).getTime(), "resumes at 09:00 the next morning");
    assert.equal(tag.at.getTime(), ist(9, 0, 16).getTime(), "the following step shifts too");
  });

  test("quiet hours never touch non-message steps", () => {
    const r = simulateWorkflow(
      input({
        events: [{ leadId: "l1", at: ist(22) }],
        settings: { allowReEnrollment: true, quietHours: { enabled: true, startHour: 21, endHour: 9 } },
        actions: [act({ type: "ADD_TAG", tag: "night" })],
      }),
    );
    assert.equal(r.messages.heldByQuietHours, 0);
    assert.equal(r.sample[0].steps[0].at.getTime(), ist(22).getTime());
  });
});

// ───────────────────────────── record changes ─────────────────────────────

describe("contact changes", () => {
  test("adding a tag the contact already has is counted as no change", () => {
    const r = simulateWorkflow(
      input({ actions: [act({ type: "ADD_TAG", tag: "VIP" })], leads: { l1: { ...LEAD, tags: ["vip"] } } }),
    );
    assert.equal(r.changes.tagsAdded, 0);
    assert.equal(r.changes.noChange, 1);
  });

  test("removing a tag the contact doesn't have is counted as no change", () => {
    const r = simulateWorkflow(input({ actions: [act({ type: "REMOVE_TAG", tag: "cold" })] }));
    assert.equal(r.changes.tagsRemoved, 0);
    assert.equal(r.changes.noChange, 1);
  });

  test("a stage move to the stage they're already on is no change", () => {
    const r = simulateWorkflow(input({ actions: [act({ type: "MOVE_STAGE", stage: "NEW_LEAD" })] }));
    assert.equal(r.changes.stageMoves, 0);
    assert.equal(r.changes.noChange, 1);
  });

  test("changes made by the run are visible to its own later steps", () => {
    const r = simulateWorkflow(
      input({
        actions: [
          act({ type: "ADD_TAG", tag: "nurture" }),
          act({ type: "IF_TAG", tag: "nurture", thenStep: 2, elseStep: 3 }),
          act({ type: "CREATE_TASK", taskTitle: "Follow up" }),
        ],
      }),
    );
    assert.equal(r.changes.tasksCreated, 1, "the branch must see the tag its own step 1 added");
  });

  test("state carries across a contact's second enrollment", () => {
    const r = simulateWorkflow(
      input({
        actions: [act({ type: "ADD_TAG", tag: "touched" })],
        events: [
          { leadId: "l1", at: ist(9) },
          { leadId: "l1", at: ist(12) },
        ],
      }),
    );
    assert.equal(r.enrolled, 2);
    assert.equal(r.changes.tagsAdded, 1, "the second run finds the tag already there");
    assert.equal(r.changes.noChange, 1);
  });
});

// ───────────────────────────── branching ─────────────────────────────

describe("IF_TAG", () => {
  test("takes the else branch when the tag is absent", () => {
    const r = simulateWorkflow(
      input({
        actions: [
          act({ type: "IF_TAG", tag: "vip", thenStep: 1, elseStep: 2 }),
          act({ type: "CREATE_TASK", taskTitle: "VIP path" }),
          act({ type: "ADD_TAG", tag: "standard" }),
        ],
      }),
    );
    assert.equal(r.changes.tasksCreated, 0);
    assert.equal(r.changes.tagsAdded, 1);
  });

  test("a branch past the end of the list ends the workflow", () => {
    const r = simulateWorkflow(
      input({ actions: [act({ type: "IF_TAG", tag: "vip", thenStep: 9, elseStep: 9 })] }),
    );
    assert.equal(r.sample[0].steps.length, 1);
    assert.equal(r.sample[0].cutShort, false);
  });

  test("a cycle is capped, flagged, and warned about — never run forever", () => {
    const r = simulateWorkflow(
      input({
        // step 1 always jumps back to step 0: an infinite loop in the live engine, which fails
        // the enrollment once it trips the same cap.
        actions: [act({ type: "ADD_TAG", tag: "loop" }), act({ type: "IF_TAG", tag: "loop", thenStep: 0, elseStep: 0 })],
      }),
    );
    assert.equal(r.cyclesHit, 1);
    assert.equal(r.sample[0].cutShort, true);
    assert.match(r.warnings.join(" "), /loop/i);
  });
});

// ───────────────────────────── reporting ─────────────────────────────

describe("reporting", () => {
  test("byAction breaks each step down by outcome", () => {
    const r = simulateWorkflow(
      input({
        actions: [act({ type: "SEND_EMAIL", body: "x" })],
        leads: {
          l1: LEAD,
          l2: { ...LEAD, id: "l2", name: "No Email", hasEmail: false },
        },
        events: [
          { leadId: "l1", at: ist(9) },
          { leadId: "l2", at: ist(10) },
        ],
      }),
    );
    const [step0] = r.byAction;
    assert.equal(step0.runs, 2);
    assert.deepEqual(
      step0.outcomes.sort((a, b) => a.outcome.localeCompare(b.outcome)),
      [
        { outcome: "DELIVERED", count: 1 },
        { outcome: "UNREACHABLE", count: 1 },
      ],
    );
  });

  test("the sample is capped but the totals are not", () => {
    const leads: Record<string, DryRunLead> = {};
    const events: DryRunEvent[] = [];
    for (let i = 0; i < 40; i++) {
      leads[`x${i}`] = { ...LEAD, id: `x${i}`, name: `Lead ${i}` };
      events.push({ leadId: `x${i}`, at: ist(9, i) });
    }
    const r = simulateWorkflow(input({ actions: [act({ type: "SEND_EMAIL", body: "x" })], leads, events }));
    assert.equal(r.enrolled, 40);
    assert.equal(r.contacts, 40);
    assert.equal(r.messages.delivered.email, 40);
    assert.equal(r.sample.length, 25);
  });

  test("approximations are listed only when they actually bite", () => {
    const noState = simulateWorkflow(input({ actions: [act({ type: "SEND_EMAIL", body: "x" })] }));
    assert.equal(noState.approximations.some((a) => /tags/i.test(a)), false);

    const withTags = simulateWorkflow(input({ actions: [act({ type: "ADD_TAG", tag: "x" })] }));
    assert.equal(withTags.approximations.some((a) => /tags/i.test(a)), true);
  });

  test("an empty window is reported as such, with no caveats attached", () => {
    const r = simulateWorkflow(input({ actions: [act({ type: "ADD_TAG", tag: "x" })], events: [] }));
    assert.equal(r.enrolled, 0);
    assert.deepEqual(r.approximations, []);
    assert.match(summarise(r), /Nothing triggered/);
  });

  test("truncation is surfaced as a warning, not hidden", () => {
    const r = simulateWorkflow(input({ actions: [act({ type: "ADD_TAG", tag: "x" })], truncated: true }));
    assert.equal(r.truncated, true);
    assert.match(r.warnings.join(" "), /cap/);
  });

  test("summarise reads as a sentence", () => {
    const r = simulateWorkflow(
      input({ actions: [act({ type: "SEND_EMAIL", body: "x" }), act({ type: "ADD_TAG", tag: "welcomed" })] }),
    );
    assert.equal(summarise(r), "This workflow would have enrolled 1 contact, and sent 1 message, and made 1 change to contact records.");
  });
});

describe("lintActions", () => {
  test("catches the empty-bodied steps that would silently do nothing", () => {
    const out = lintActions(
      [act({ type: "SEND_SMS", body: "" }), act({ type: "ADD_TAG", tag: "" }), act({ type: "MOVE_STAGE" })],
      {},
    );
    assert.equal(out.length, 3);
    assert.match(out[0], /no message body/);
    assert.match(out[1], /no tag name/i);
    assert.match(out[2], /no stage/i);
  });

  test("catches a template pointed at the wrong channel", () => {
    const templates: Record<string, DryRunTemplate> = {
      t1: { name: "Welcome", channel: "SMS", subject: null, body: "hi" },
    };
    const out = lintActions([act({ type: "SEND_EMAIL", templateId: "t1" })], templates);
    assert.match(out[0], /SMS template/);
  });

  test("catches a branch that points at itself", () => {
    const out = lintActions([act({ type: "IF_TAG", tag: "vip", thenStep: 0, elseStep: 1 })], {});
    assert.match(out.join(" "), /branches to itself/);
  });

  test("says nothing about a well-formed workflow", () => {
    const out = lintActions(
      [act({ type: "SEND_SMS", body: "hi" }), act({ type: "WAIT", waitMinutes: 60 }), act({ type: "ADD_TAG", tag: "x" })],
      {},
    );
    assert.deepEqual(out, []);
  });
});

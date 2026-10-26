import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { NEEDS_ACTION, PENDING_SUBMISSION, TEMPLATES } from "../../../scripts/wati-templates-utility-docx";
import { SUBMISSION_TEMPLATES } from "../whatsapp-submission";
import { WHATSAPP_AVAILABLE_VARS, WHATSAPP_KINDS } from "../whatsapp";

/**
 * The submission pack vs. what the app can actually send.
 *
 * WHY THIS TEST EXISTS. A WATI template declares its variables; the app supplies them per
 * touchpoint from `WHATSAPP_AVAILABLE_VARS`. If an approved template asks for a variable its
 * touchpoint does not offer, `sendWhatsApp` reports it as unsupported and SKIPS the send - forever,
 * silently, for every prospect. The cost of finding that out is a Meta review cycle plus however
 * long it takes somebody to notice the messages are not arriving; in October 2026 a comparable
 * mismatch left agreement OTPs undeliverable for weeks while the app looked healthy.
 *
 * So the pack is checked against the app here, before anything is submitted. Every assertion below
 * is a thing a reviewer cannot catch by reading the document.
 */

const KNOWN_KINDS = new Set<string>(WHATSAPP_KINDS as readonly string[]);

describe("WATI submission pack - every template is sendable by the app", () => {
  it("binds each template to a touchpoint the app actually has", () => {
    // A template for a kind that does not exist can never be bound to anything.
    const unknown = TEMPLATES.filter((t) => !KNOWN_KINDS.has(t.kind)).map((t) => `${t.name} -> ${t.kind}`);
    assert.deepEqual(unknown, [], `templates naming a non-existent WhatsAppKind: ${unknown.join(", ")}`);
  });

  it("only declares variables its touchpoint offers", () => {
    const bad: string[] = [];
    for (const t of TEMPLATES) {
      if (!KNOWN_KINDS.has(t.kind)) continue; // already reported above
      const offered = new Set(WHATSAPP_AVAILABLE_VARS[t.kind as keyof typeof WHATSAPP_AVAILABLE_VARS] ?? []);
      for (const v of t.vars) {
        if (!offered.has(v.name)) bad.push(`${t.name} declares {{${v.name}}}, but ${t.kind} offers [${[...offered].join(", ")}]`);
      }
    }
    assert.deepEqual(bad, [], `these templates would be SKIPPED on every send:\n  ${bad.join("\n  ")}`);
  });

  it("uses every variable it declares, and declares every variable it uses", () => {
    // A declared-but-unused variable makes WATI's positional params drift by one, which is the
    // "it cannot have typos or blank text" rejection. An used-but-undeclared one renders literally.
    const bad: string[] = [];
    for (const t of TEMPLATES) {
      const used = new Set([...t.body.matchAll(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi)].map((m) => m[1]));
      const declared = new Set(t.vars.map((v) => v.name));
      for (const d of declared) if (!used.has(d)) bad.push(`${t.name} declares {{${d}}} but never uses it`);
      for (const u of used) if (!declared.has(u)) bad.push(`${t.name} uses {{${u}}} but never declares it`);
    }
    assert.deepEqual(bad, []);
  });

  it("gives Meta a sample for every variable", () => {
    // Meta requires one at submission; a blank sample is an instant rejection.
    const bad = TEMPLATES.flatMap((t) =>
      t.vars.filter((v) => !v.sample.trim()).map((v) => `${t.name}.${v.name}`),
    );
    assert.deepEqual(bad, []);
  });

  it("keeps template names to Meta's lowercase snake_case rule", () => {
    const bad = TEMPLATES.filter((t) => !/^[a-z0-9_]+$/.test(t.name)).map((t) => t.name);
    assert.deepEqual(bad, []);
  });

  it("has no duplicate template names", () => {
    const seen = new Set<string>();
    const dupes: string[] = [];
    for (const t of TEMPLATES) {
      if (seen.has(t.name)) dupes.push(t.name);
      seen.add(t.name);
    }
    assert.deepEqual(dupes, []);
  });

  it("stays inside Meta's 1024-character body limit", () => {
    const over = TEMPLATES.filter((t) => t.body.length > 1024).map((t) => `${t.name} (${t.body.length})`);
    assert.deepEqual(over, []);
  });
});

describe("the Zoom joining-link variants", () => {
  const zoomVariants = TEMPLATES.filter((t) => t.name.endsWith("_zoom"));

  it("covers all three booked-call touchpoints", () => {
    assert.deepEqual(
      zoomVariants.map((t) => t.kind).sort(),
      ["BOOKING_CONFIRMATION", "BOOKING_REMINDER", "BOOKING_RESCHEDULED"],
    );
  });

  it("each carries the link", () => {
    for (const t of zoomVariants) {
      assert.ok(t.vars.some((v) => v.name === "zoom_link"), `${t.name} has no zoom_link`);
      assert.match(t.body, /\{\{zoom_link\}\}/, `${t.name} never renders the link`);
    }
  });

  it("leaves the plain template of each touchpoint in place as the fallback", () => {
    // The whole reason these are separate names: if the plain ones were edited or dropped, a
    // booking with no link yet would get NO message rather than one without a link.
    for (const t of zoomVariants) {
      const plain = TEMPLATES.find((p) => p.kind === t.kind && !p.name.endsWith("_zoom"));
      assert.ok(plain, `${t.kind} has no non-Zoom template left to fall back to`);
      assert.ok(
        !plain!.vars.some((v) => v.name === "zoom_link"),
        `${plain!.name} is meant to be the no-Zoom fallback but declares zoom_link`,
      );
    }
  });

  it("never exposes the host start link", () => {
    // zoomStartUrl signs whoever opens it in AS the host. No template may reach for it.
    for (const t of TEMPLATES) {
      assert.doesNotMatch(t.body, /start_url|zoom_start/i, `${t.name} references a host start link`);
      assert.ok(!t.vars.some((v) => /start_url|zoom_start/i.test(v.name)), `${t.name} declares a host start link`);
    }
  });
});

describe("Enrolment welcome - the one message a new student gets", () => {
  const welcome = TEMPLATES.filter((t) => t.kind === "STUDENT_WELCOME");
  const plain = welcome.find((t) => !t.name.endsWith("_portal"));

  it("keeps a variant that cannot be skipped for want of a value", () => {
    // THE point of this touchpoint. `portal_url` is empty for any student without a login, and
    // an unresolved variable skips the whole send - so a pack where EVERY welcome template
    // declared it would mean the only enrolment message the app has silently never arrives for
    // the students who are hardest to reach any other way.
    assert.ok(plain, "no STUDENT_WELCOME template without a portal link");
    assert.ok(
      !plain!.vars.some((v) => v.name === "portal_url"),
      `${plain!.name} is the always-sendable variant but declares portal_url`,
    );
  });

  it("names the tutor and the first class, which is what it is for", () => {
    for (const t of welcome) {
      assert.match(t.body, /\{\{tutor_name\}\}/, `${t.name} never names the tutor`);
      assert.match(t.body, /\{\{first_class\}\}/, `${t.name} never names the first class`);
    }
  });

  it("is UTILITY - it is about a transaction the student has already entered into", () => {
    // Category mismatch is the most common rejection reason. Someone who has signed and paid
    // being told their tutor and start time is service information, not marketing.
    for (const t of welcome) assert.equal(t.category, "UTILITY", `${t.name} is ${t.category}`);
  });
});

describe("the batch awaiting submission", () => {
  /**
   * `PENDING_SUBMISSION` drives a SECOND document - `npm run docs:whatsapp:batch` - listing only
   * the templates nobody has typed into WATI yet: the seventeen pipeline stage messages that have
   * never had a template at all (issue W2), and the password reset code (issue C4).
   *
   * The count is not written here. It said "twenty-five: seven UTILITY rewrites whose names used
   * to collide with the SOP pack's (issue W1), seventeen pipeline stage messages ... and the
   * password reset code" - and then the approval sheet settled every one of the seven and they
   * were deleted, leaving a docblock describing a batch almost half of which no longer existed.
   * Read the count off the array; the assertions below already do.
   *
   * It is a hand-written list of NAMES, because being pending is a fact about a moment rather
   * than a property of a template - so it has to be maintained, which means it can rot. These
   * two assertions are what stop it rotting SILENTLY, and silence is the whole risk: a batch
   * document that quietly omits a template gives its reader no way to know it is short, and the
   * missing one simply never gets submitted.
   */
  it("names only templates that exist", () => {
    const names = new Set(TEMPLATES.map((t) => t.name));
    const missing = PENDING_SUBMISSION.filter((e) => !names.has(e.name)).map((e) => e.name);
    assert.deepEqual(
      missing,
      [],
      `PENDING_SUBMISSION names templates not in TEMPLATES - a typo or a rename: ${missing.join(", ")}`,
    );
  });

  it("names each one once, and says why each is here", () => {
    const seen = new Set<string>();
    const dupes = PENDING_SUBMISSION.filter((e) => (seen.has(e.name) ? true : (seen.add(e.name), false)));
    assert.deepEqual(dupes.map((e) => e.name), [], "a template listed twice would be submitted twice");
    for (const e of PENDING_SUBMISSION) {
      // The "why" is the column the person submitting actually reads - a rewrite that collides
      // with an approved template needs different care from a touchpoint that has never had one.
      assert.ok(e.why.trim().length > 10, `${e.name} needs a reason for being in the batch`);
    }
  });

  it("covers every stage message, because none of them has ever had a template", () => {
    // The seventeen are the bulk of the batch and the easiest to leave half-done: they were added
    // in one pass, and a stage omitted here is a stage whose WhatsApp half stays dead while the
    // other sixteen come alive - which looks like a bug in Stage Messages rather than a gap in a
    // submission list.
    const stageTemplates = TEMPLATES.filter((t) => t.kind.startsWith("STAGE_"));
    const batch = new Set(PENDING_SUBMISSION.map((e) => e.name));
    const absent = stageTemplates.filter((t) => !batch.has(t.name)).map((t) => t.name);
    assert.deepEqual(absent, [], `stage templates missing from the submission batch: ${absent.join(", ")}`);
    assert.equal(stageTemplates.length, 17, "there are 17 LeadStages, so there should be 17 stage templates");
  });
});

describe("the work list", () => {
  /**
   * `NEEDS_ACTION` drives a FOURTH document - `npm run docs:whatsapp:action` - and it answers a
   * different question from `PENDING_SUBMISSION`: not "what has never been submitted" but "what
   * do I have to do something about". The gap between those two is where a template gets lost. A
   * body edited after approval is pending on no list, and it is the most urgent item there is,
   * because Meta holds one body per (name, language) - so the edit REPLACES the approved template
   * in review and its touchpoint sends nothing until it clears, logging a skip rather than
   * failing. Nobody notices.
   *
   * These assertions guard the two ways that list can rot silently.
   */
  it("names only templates that exist in one of the two packs", () => {
    // Deliberately checked against BOTH packs: three entries are SOP templates, and that is the
    // reason the document is worth generating - "what needs approval" is a question about B2's
    // WATI account, not about a source file.
    const names = new Set([...TEMPLATES.map((t) => t.name), ...SUBMISSION_TEMPLATES.map((t) => t.name)]);
    const missing = NEEDS_ACTION.filter((e) => !names.has(e.name)).map((e) => e.name);
    assert.deepEqual(missing, [], `NEEDS_ACTION names templates in neither pack - a typo or a rename: ${missing.join(", ")}`);
  });

  it("names each one once, and says why", () => {
    const seen = new Set<string>();
    const dupes = NEEDS_ACTION.filter((e) => (seen.has(e.name) ? true : (seen.add(e.name), false)));
    assert.deepEqual(dupes.map((e) => e.name), [], "a template listed twice would be submitted twice");
    for (const e of NEEDS_ACTION) {
      assert.ok(e.why.trim().length > 20, `${e.name} needs a reason for being on the work list`);
    }
  });

  it("carries every unsubmitted template, so the two documents can never disagree", () => {
    // The first group of NEEDS_ACTION is DERIVED from PENDING_SUBMISSION rather than retyped, and
    // this is what holds that derivation in place: if somebody ever replaces the spread with a
    // hand-written copy of the names, the next template added to the batch is one the work list
    // silently omits - and the work list is the document people act on.
    const action = new Set(NEEDS_ACTION.map((e) => e.name));
    const absent = PENDING_SUBMISSION.filter((e) => !action.has(e.name)).map((e) => e.name);
    assert.deepEqual(absent, [], `awaiting submission but not on the work list: ${absent.join(", ")}`);
    for (const e of PENDING_SUBMISSION) {
      const entry = NEEDS_ACTION.find((a) => a.name === e.name)!;
      assert.equal(entry.action, "APPROVE", `${e.name} has never been submitted, so its action cannot be ${entry.action}`);
    }
  });

  it("only flags a category change on a re-submission", () => {
    // `categoryChanged` is a second thing to set inside an EDIT of an existing template. On a
    // first submission there is no old category to change from, so the flag there would print an
    // instruction with nothing to do, on the one page where a reader is already being careful.
    const wrong = NEEDS_ACTION.filter((e) => e.categoryChanged && e.action !== "RESUBMIT").map((e) => e.name);
    assert.deepEqual(wrong, [], `categoryChanged only means something on a re-submission: ${wrong.join(", ")}`);
  });

  it("marks a re-submission wherever the SOP pack records an accepted rewrite", () => {
    /**
     * THE CHECK THAT CATCHES THE EXPENSIVE MISTAKE.
     *
     * An `acceptedFix` in the SOP pack means the body B2 will submit is no longer the body B2
     * submitted last time. That is exactly the "approved once, then edited" case, so every such
     * template must appear on the work list - unless its rewrite predates the last submission
     * round, in which case the round carried the new body and there is nothing outstanding.
     *
     * Hard-coding the cutoff is the point: it is the date of the last round, a fact about history
     * that does not change. Anything decided AFTER it has not been through review.
     */
    const LAST_SUBMISSION_ROUND = "2026-08-03";
    const edited = SUBMISSION_TEMPLATES.filter((t) => t.acceptedFix && t.acceptedFix.decidedOn > LAST_SUBMISSION_ROUND);
    assert.ok(edited.length > 0, "fixture check - there should be rewrites newer than the last round");
    const onList = new Map(NEEDS_ACTION.map((e) => [e.name, e]));
    for (const t of edited) {
      const entry = onList.get(t.name);
      assert.ok(entry, `${t.name} was rewritten on ${t.acceptedFix!.decidedOn}, after the last submission round, but is not on the work list`);
      assert.equal(entry!.action, "RESUBMIT", `${t.name} has a changed body, so it is a re-submission, not ${entry!.action}`);
    }
  });
});

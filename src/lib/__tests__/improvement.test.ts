import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  ANSWER_MAX,
  IMPROVEMENT_KINDS,
  IMPROVEMENT_KIND_DEFS,
  IMPROVEMENT_KIND_SHORT,
  IMPROVEMENT_SEVERITIES,
  IMPROVEMENT_STATUSES,
  IMPROVEMENT_STATUS_FOR_REPORTER,
  IMPROVEMENT_STATUS_LABELS,
  IMPROVEMENT_TRANSITIONS,
  QUESTIONS,
  TITLE_MAX,
  answerDisplay,
  answersComplete,
  answersSchema,
  canTransition,
  isOpenStatus,
  notifiesImmediately,
  questionLabel,
  routePattern,
  submitImprovementSchema,
  suggestTitle,
  type ImprovementKind,
  type ImprovementStatus,
} from "../improvement";

/**
 * THE IMPROVEMENT-REPORT CONTRACT.
 *
 * The form and the server read one definition of "what this kind asks"; these tests pin the
 * properties that make that worth having. The two that matter most, and why:
 *
 *  1. A required question cannot be skipped, and the SERVER is what enforces it. The form's
 *     disabled Send button is UX; a crafted POST never renders it. This is the same lesson
 *     `access-requests.ts` records about its role enum ("the login screen's role picker is UX").
 *
 *  2. A route is stored as a PATTERN. `/students/<cuid>` must never be written to a column that
 *     gets rendered into a queue, a title and a notification email.
 */

describe("improvement kinds - the catalogue is complete", () => {
  test("every kind has a definition, a short label and questions", () => {
    for (const kind of IMPROVEMENT_KINDS) {
      assert.ok(
        IMPROVEMENT_KIND_DEFS.some((k) => k.key === kind),
        `${kind} has no label or hint for the picker`,
      );
      assert.ok(IMPROVEMENT_KIND_SHORT[kind], `${kind} has no short label for a table cell`);
      assert.ok(QUESTIONS[kind]?.length, `${kind} asks nothing`);
    }
    assert.equal(IMPROVEMENT_KIND_DEFS.length, IMPROVEMENT_KINDS.length, "a definition exists for a kind that does not");
  });

  /**
   * Two to four questions. The ceiling is not taste: a seven-field form gets abandoned, and an
   * abandoned report is worth less than a one-line one. The floor is because one free-text box is
   * the thing this whole module exists to replace.
   */
  test("no kind asks fewer than two or more than four questions", () => {
    for (const kind of IMPROVEMENT_KINDS) {
      const n = QUESTIONS[kind].length;
      assert.ok(n >= 2 && n <= 4, `${kind} asks ${n} questions`);
    }
  });

  test("every kind has at least one required question", () => {
    for (const kind of IMPROVEMENT_KINDS) {
      assert.ok(
        QUESTIONS[kind].some((q) => q.required),
        `${kind} requires nothing, so it can be filed empty`,
      );
    }
  });

  test("question ids are unique within a kind, and choices have options", () => {
    for (const kind of IMPROVEMENT_KINDS) {
      const ids = QUESTIONS[kind].map((q) => q.id);
      assert.equal(new Set(ids).size, ids.length, `${kind} reuses a question id, so one answer would overwrite another`);
      for (const q of QUESTIONS[kind]) {
        if (q.options) {
          assert.ok(q.options.length >= 2, `${kind}.${q.id} offers fewer than two choices`);
          const values = q.options.map((o) => o.value);
          assert.equal(new Set(values).size, values.length, `${kind}.${q.id} repeats an option value`);
        }
      }
    }
  });

  test("a label can be found for every stored answer key", () => {
    for (const kind of IMPROVEMENT_KINDS) {
      for (const q of QUESTIONS[kind]) {
        assert.equal(questionLabel(kind, q.id), q.label);
      }
    }
    // An id from an older version of the questions renders as itself rather than crashing the
    // triage screen - a report filed last month must still be readable today.
    assert.equal(questionLabel("NOT_WORKING", "retired_field"), "retired_field");
  });
});

describe("answers - the server is the gate, not the form", () => {
  test("a missing required answer is refused, and the message names the question", () => {
    const parsed = answersSchema("WRONG_RESULT").safeParse({ shows: "0" });
    assert.equal(parsed.success, false);
    assert.match(parsed.error!.issues[0].message, /What should it show/);
  });

  test("whitespace is not an answer", () => {
    const parsed = answersSchema("CONFUSING").safeParse({ expected: "   " });
    assert.equal(parsed.success, false);
  });

  test("an optional question may be left out entirely", () => {
    const parsed = answersSchema("CONFUSING").safeParse({ expected: "I expected it to save" });
    assert.equal(parsed.success, true);
    assert.deepEqual(parsed.data, { expected: "I expected it to save" });
  });

  /**
   * Keys this kind does not ask about are DROPPED, not stored. The triage screen renders whatever
   * is in this column, so a crafted POST must not be able to put arbitrary keys into it.
   */
  test("keys the kind does not ask about are dropped", () => {
    const parsed = answersSchema("CONFUSING").safeParse({
      expected: "I expected it to save",
      injected: "<script>alert(1)</script>",
      shows: "a field from a different kind",
    });
    assert.equal(parsed.success, true);
    assert.deepEqual(Object.keys(parsed.data!), ["expected"]);
  });

  test("a choice question refuses a value that is not one of its options", () => {
    const ok = answersSchema("NOT_WORKING").safeParse({
      doing: "pressing save",
      happened: "nothing",
      repro: "always",
    });
    assert.equal(ok.success, true);
    assert.equal(ok.data!.repro, "always");

    const bad = answersSchema("NOT_WORKING").safeParse({
      doing: "pressing save",
      happened: "nothing",
      repro: "whenever-it-feels-like-it",
    });
    assert.equal(bad.success, false);
  });

  test("an answer is truncated rather than refused", () => {
    const parsed = answersSchema("CONFUSING").safeParse({ expected: "x".repeat(ANSWER_MAX + 500) });
    assert.equal(parsed.success, true);
    assert.equal(parsed.data!.expected.length, ANSWER_MAX);
  });

  test("answersComplete agrees with the schema about what is fillable", () => {
    for (const kind of IMPROVEMENT_KINDS) {
      const filled: Record<string, string> = {};
      for (const q of QUESTIONS[kind]) {
        if (!q.required) continue;
        filled[q.id] = q.options ? q.options[0].value : "something a person typed";
      }
      assert.equal(answersComplete(kind, filled), true, `${kind} cannot be completed`);
      assert.equal(answersSchema(kind).safeParse(filled).success, true, `${kind} is refused when complete`);
    }
  });

  test("a stored choice renders as words, not as its value", () => {
    assert.equal(answerDisplay("NOT_WORKING", "repro", "always"), "Every time");
    // Free text comes back untouched.
    assert.equal(answerDisplay("NOT_WORKING", "doing", "pressing save"), "pressing save");
  });
});

describe("the suggested title", () => {
  test("is prefixed with the kind, so a queue of twenty is scannable", () => {
    const title = suggestTitle("WRONG_RESULT", { shows: "Paid so far: 0", should: "99,500" });
    assert.match(title, /^Wrong result: Paid so far: 0$/);
  });

  test("never exceeds the column it is stored in", () => {
    const title = suggestTitle("CONFUSING", { expected: "y".repeat(400) });
    assert.ok(title.length <= TITLE_MAX, `title is ${title.length} characters`);
  });

  test("falls back to the kind when nothing is filled in yet", () => {
    assert.equal(suggestTitle("NEW_FEATURE", {}), "New feature");
  });

  test("collapses newlines, so a pasted paragraph does not become the title", () => {
    const title = suggestTitle("CONFUSING", { expected: "line one\n\nline two" });
    assert.equal(title.includes("\n"), false);
  });
});

describe("the route is stored as a pattern", () => {
  test("a cuid segment becomes [id] and travels separately", () => {
    const { route, params } = routePattern("/students/cmh2k9x0a0001qn3f8g7h2jkl");
    assert.equal(route, "/students/[id]");
    assert.deepEqual(params, { id: "cmh2k9x0a0001qn3f8g7h2jkl" });
  });

  test("a uuid and a bare number are ids too", () => {
    assert.equal(routePattern("/batches/3f1a7b2c-5d6e-4a8b-9c0d-1e2f3a4b5c6d").route, "/batches/[id]");
    assert.equal(routePattern("/invoices/4821").route, "/invoices/[id]");
  });

  test("readable route structure is left alone", () => {
    assert.equal(routePattern("/batches/plans").route, "/batches/plans");
    assert.equal(routePattern("/finance").route, "/finance");
    assert.equal(routePattern("/").route, "/");
  });

  test("two ids on one route are both captured", () => {
    const { route, params } = routePattern("/batches/cmh2k9x0a0001qn3f8g7h2jkl/sessions/812");
    assert.equal(route, "/batches/[id]/sessions/[id2]");
    assert.equal(Object.keys(params).length, 2);
  });

  /**
   * The whole point. A signing or invoice token in a path must not end up in a column that is
   * rendered into a queue and an email - those links ARE the credential.
   */
  test("a long opaque token never survives into the route", () => {
    const token = "Xy7_Qa91ZbMnOpQrStUvWxYz0123456789";
    const { route, params } = routePattern(`/agreement/${token}`);
    assert.equal(route, "/agreement/[id]");
    assert.equal(route.includes(token), false);
    assert.equal(params.id, token.slice(0, 120));
  });
});

describe("the submit payload - what a client may and may not say", () => {
  /**
   * THE TRUST BOUNDARY, pinned.
   *
   * A browser cannot be trusted about its own permissions and does not know what is armed, so
   * the role, the capabilities, the arming verdict and the build are captured server-side. If
   * any of them are ever added to this schema, a client could file a report as somebody else, or
   * claim the engine behind the screen was on when it was not - so this test fails on sight.
   */
  test("the client cannot supply its own role, context or reference", () => {
    const parsed = submitImprovementSchema.safeParse({
      kind: "CONFUSING",
      severity: "MINOR",
      answers: { expected: "something" },
      route: "/finance",
      reporterRole: "ADMIN",
      reporterId: "someone-else",
      context: { enginesOff: [] },
      ref: "IMP-9999",
      status: "FIXED",
      appVersion: "pretend",
    });
    assert.equal(parsed.success, true);
    for (const forbidden of ["reporterRole", "reporterId", "context", "ref", "status", "appVersion"]) {
      assert.equal(
        forbidden in parsed.data!,
        false,
        `a client can set ${forbidden} - that belongs to the server`,
      );
    }
  });

  test("an unknown kind or severity is refused", () => {
    assert.equal(
      submitImprovementSchema.safeParse({ kind: "WHATEVER", severity: "MINOR", answers: {}, route: "/" }).success,
      false,
    );
    assert.equal(
      submitImprovementSchema.safeParse({ kind: "CONFUSING", severity: "URGENT", answers: {}, route: "/" }).success,
      false,
    );
  });

  test("the breadcrumb trail is capped", () => {
    const crumb = { at: "12:01", kind: "route" as const, label: "/finance" };
    assert.equal(
      submitImprovementSchema.safeParse({
        kind: "CONFUSING",
        severity: "MINOR",
        answers: { expected: "x" },
        route: "/",
        breadcrumbs: Array.from({ length: 50 }, () => crumb),
      }).success,
      false,
    );
  });

  test("the element tag refuses a field it does not define", () => {
    assert.equal(
      submitImprovementSchema.safeParse({
        kind: "CONFUSING",
        severity: "MINOR",
        answers: { expected: "x" },
        route: "/",
        elementTag: { text: "0", innerHTML: "<div>everything on the page</div>" },
      }).success,
      false,
    );
  });
});

describe("severity", () => {
  test("only blocking reaches anyone immediately", () => {
    assert.equal(notifiesImmediately("BLOCKING"), true);
    for (const s of IMPROVEMENT_SEVERITIES.filter((x) => x !== "BLOCKING")) {
      assert.equal(notifiesImmediately(s), false, `${s} pages somebody`);
    }
  });
});

describe("the status machine", () => {
  test("every status is reachable from NEW", () => {
    const seen = new Set<ImprovementStatus>(["NEW"]);
    const queue: ImprovementStatus[] = ["NEW"];
    while (queue.length) {
      for (const next of IMPROVEMENT_TRANSITIONS[queue.pop()!]) {
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    for (const status of IMPROVEMENT_STATUSES) {
      assert.ok(seen.has(status), `${status} can never be reached, so its buttons never appear`);
    }
  });

  test("every status names only real statuses as its next moves", () => {
    for (const status of IMPROVEMENT_STATUSES) {
      for (const next of IMPROVEMENT_TRANSITIONS[status]) {
        assert.ok(IMPROVEMENT_STATUSES.includes(next), `${status} can move to unknown status ${next}`);
      }
      assert.equal(
        IMPROVEMENT_TRANSITIONS[status].includes(status),
        false,
        `${status} lists itself as a move, which would render a button that does nothing`,
      );
    }
  });

  /**
   * FIXED and CLOSED are different states, and skipping from "being worked on" to "done" would
   * collapse them - which is how a tracker fills up with things everyone believes are finished.
   */
  test("nothing jumps straight to CLOSED except FIXED", () => {
    for (const status of IMPROVEMENT_STATUSES) {
      if (status === "FIXED") continue;
      assert.equal(canTransition(status, "CLOSED"), false, `${status} can close without being fixed`);
    }
    assert.equal(canTransition("FIXED", "CLOSED"), true);
  });

  /** "It is still happening" must always have somewhere to land. */
  test("a finished report can always be re-opened", () => {
    for (const status of ["FIXED", "CLOSED", "DECLINED", "DUPLICATE"] as ImprovementStatus[]) {
      assert.ok(IMPROVEMENT_TRANSITIONS[status].length > 0, `${status} is a trap - nothing can follow it`);
    }
  });

  test("a report cannot be marked a duplicate once work has started", () => {
    assert.equal(canTransition("IN_PROGRESS", "DUPLICATE"), false);
    assert.equal(canTransition("NEW", "DUPLICATE"), true);
  });

  test("open means still in play", () => {
    assert.equal(isOpenStatus("NEW"), true);
    assert.equal(isOpenStatus("IN_PROGRESS"), true);
    assert.equal(isOpenStatus("FIXED"), true, "a fix nobody has confirmed is not finished");
    for (const s of ["CLOSED", "DECLINED", "DUPLICATE"] as ImprovementStatus[]) {
      assert.equal(isOpenStatus(s), false, `${s} still counts as open`);
    }
  });

  test("every status has words for the triage screen AND for the reporter", () => {
    for (const status of IMPROVEMENT_STATUSES) {
      assert.ok(IMPROVEMENT_STATUS_LABELS[status], `${status} has no label`);
      assert.ok(
        IMPROVEMENT_STATUS_FOR_REPORTER[status],
        `${status} has nothing to tell the person who reported it`,
      );
    }
  });
});

describe("what the reporter is told", () => {
  /**
   * The internal vocabulary is for triage. "Triaged" means nothing to a telecaller, and a
   * reporting channel where nobody understands the answer goes quiet as surely as one where
   * nobody answers at all.
   */
  test("none of the reporter-facing words are the internal ones", () => {
    for (const status of IMPROVEMENT_STATUSES) {
      assert.notEqual(
        IMPROVEMENT_STATUS_FOR_REPORTER[status].toLowerCase(),
        IMPROVEMENT_STATUS_LABELS[status].toLowerCase(),
        `${status} shows the reporter its internal label`,
      );
    }
  });
});

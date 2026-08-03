/**
 * Reading an EXTERNAL form's answers — the landing page → Pabbly → CRM path.
 *
 * This is the layer where the band score is either captured or silently lost, and "silently" is
 * the operative word: an answer we fail to recognise does not raise anything, it just makes the
 * prospect score lower than they should. Before this path existed, every landing-page answer was
 * dropped at the webhook and every one of those leads reached the discovery specialist unscored.
 *
 * So the tests below are mostly about the failure modes, not the happy path:
 *   · the sender's wording differs from ours (the normal case, not the exception)
 *   · an answer matches no option — must be REPORTED, never scored as zero
 *   · a field matches no question — must be reported so the mapping can be fixed
 *
 * Run: npm test
 */

import assert from "node:assert/strict";
import { test, describe } from "node:test";
import { fold, mapInboundAnswers } from "../qualification-inbound";
import { catalogueFromIntake, scoreFromAnswers, type QuestionSpec } from "../qualification";

const CATALOGUE = catalogueFromIntake();

/** Copy the catalogue with inbound mapping applied to one question, as Console would store it. */
function withMapping(
  key: string,
  patch: { inboundKeys?: string[]; aliases?: Record<string, string[]> },
): QuestionSpec[] {
  return CATALOGUE.map((q) =>
    q.key !== key
      ? q
      : {
          ...q,
          inboundKeys: patch.inboundKeys ?? q.inboundKeys,
          options: q.options.map((o) =>
            patch.aliases?.[o.value] ? { ...o, aliases: patch.aliases[o.value] } : o,
          ),
        },
  );
}

describe("fold — the comparison form", () => {
  test("collapses case, spaces, dashes and underscores", () => {
    const same = ["when_start_germany", "When Start Germany", "WHEN-START-GERMANY", "whenStartGermany"];
    const folded = same.map(fold);
    assert.equal(new Set(folded).size, 1, "these are the same field name in four spellings");
  });

  test("keeps genuinely different names apart", () => {
    assert.notEqual(fold("currentIncome"), fold("currentJobTitle"));
  });

  test("strips punctuation a form question mark would add", () => {
    assert.equal(fold("Are you ready to invest?"), fold("are you ready to invest"));
  });
});

describe("mapInboundAnswers — matching without configuration", () => {
  test("reads our own slugs straight through", () => {
    const r = mapInboundAnswers(
      { whenStartGermany: "immediately", readyToInvest: "ready_now" },
      CATALOGUE,
    );
    assert.equal(r.answers.whenStartGermany, "immediately");
    assert.equal(r.answers.readyToInvest, "ready_now");
    assert.equal(r.unresolved.length, 0);
    assert.ok(r.scorable);
  });

  test("reads the human LABEL, which is what a landing page actually posts", () => {
    const r = mapInboundAnswers(
      {
        // Exactly the strings in INTAKE_OPTIONS' labels — a form built from our own wording.
        whenStartGermany: "In the next 3 months",
        commitment: "Fully committed to moving to Germany",
      },
      CATALOGUE,
    );
    assert.equal(r.answers.whenStartGermany, "3_months");
    assert.equal(r.answers.commitment, "fully");
  });

  test("matches a snake_case field name against a camelCase question key, unaided", () => {
    const r = mapInboundAnswers({ when_start_germany: "Immediately" }, CATALOGUE);
    assert.equal(r.answers.whenStartGermany, "immediately");
    assert.equal(r.unrecognisedKeys.length, 0, "the field WAS claimed, so it is not unrecognised");
  });

  test("matches the full question text as a field name", () => {
    // FlexiFunnels-style: the field name IS the question.
    const r = mapInboundAnswers({ "When are you looking to start your move to Germany?": "Immediately" }, CATALOGUE);
    assert.equal(r.answers.whenStartGermany, undefined, "the question text is not a key we know");
    // ...until the founder adds it, which is the point of inboundKeys.
    const mapped = mapInboundAnswers(
      { "When are you looking to start your move to Germany?": "Immediately" },
      withMapping("whenStartGermany", { inboundKeys: ["When are you looking to start your move to Germany?"] }),
    );
    assert.equal(mapped.answers.whenStartGermany, "immediately");
  });
});

describe("mapInboundAnswers — founder-configured mapping", () => {
  test("an alias resolves wording that matches neither value nor label", () => {
    const questions = withMapping("whenStartGermany", { aliases: { immediately: ["Right away", "ASAP"] } });
    for (const said of ["Right away", "asap", "A.S.A.P."]) {
      const r = mapInboundAnswers({ whenStartGermany: said }, questions);
      assert.equal(r.answers.whenStartGermany, "immediately", `"${said}" should resolve`);
    }
  });

  test("adding an alias never displaces value or label", () => {
    const questions = withMapping("whenStartGermany", { aliases: { immediately: ["Right away"] } });
    assert.equal(mapInboundAnswers({ whenStartGermany: "immediately" }, questions).answers.whenStartGermany, "immediately");
    assert.equal(mapInboundAnswers({ whenStartGermany: "Immediately" }, questions).answers.whenStartGermany, "immediately");
  });

  test("the first inbound key in catalogue order wins when a payload carries both", () => {
    const questions = withMapping("whenStartGermany", { inboundKeys: ["timeline", "when_start"] });
    const r = mapInboundAnswers({ when_start: "exploring", timeline: "Immediately" }, questions);
    assert.equal(r.answers.whenStartGermany, "immediately", "`timeline` is listed first");
  });
});

describe("mapInboundAnswers — the failure modes that matter", () => {
  test("an unrecognised ANSWER is reported, never scored as zero", () => {
    const r = mapInboundAnswers({ whenStartGermany: "Sometime next year maybe" }, CATALOGUE);

    assert.equal(r.answers.whenStartGermany, undefined, "must not be scored");
    assert.equal(r.unresolved.length, 1);
    assert.equal(r.unresolved[0].key, "whenStartGermany");
    assert.equal(r.unresolved[0].rawValue, "Sometime next year maybe");
    assert.equal(r.unresolved[0].score, null, "null is 'unknown'; 0 would be a real, wrong, score");
    // It IS in `mapped` — the question matched, only the answer did not. That distinction is
    // what the Console report leans on to say "these prospects are scoring too low".
    assert.equal(r.mapped.length, 1);
  });

  test("a scored-zero answer and an unrecognised answer are not the same thing", () => {
    const scoredZero = mapInboundAnswers({ readyToInvest: "No" }, CATALOGUE);
    assert.equal(scoredZero.answers.readyToInvest, "no");
    assert.equal(scoredZero.unresolved.length, 0);
    assert.equal(scoredZero.mapped[0].score, 0, "'No' genuinely scores 0 — that is evidence");

    const unknown = mapInboundAnswers({ readyToInvest: "Prefer not to say" }, CATALOGUE);
    assert.equal(unknown.unresolved.length, 1);
    assert.equal(unknown.mapped[0].score, null, "…whereas this is an absence of evidence");
  });

  test("a field matching no question is reported so the mapping can be fixed", () => {
    const r = mapInboundAnswers({ how_soon_can_you_start: "Immediately" }, CATALOGUE);
    assert.deepEqual(r.unrecognisedKeys, ["how_soon_can_you_start"]);
    assert.equal(r.scorable, false);
  });

  test("contact and tracking fields are not reported as unrecognised", () => {
    const r = mapInboundAnswers(
      {
        name: "Asha", phone: "+919876543210", email: "a@b.com", submission_id: "42",
        utm_source: "meta", utm_campaign: "germany-jan",
        whenStartGermany: "Immediately",
      },
      CATALOGUE,
    );
    assert.deepEqual(r.unrecognisedKeys, [], "a report full of plumbing is a report nobody reads");
    assert.equal(r.answers.whenStartGermany, "immediately");
  });

  test("`scorable` is false when only CONTEXT questions were answered", () => {
    // germanVisa and howKnowUs are dimension NONE — kept for the closer, worth nothing.
    const r = mapInboundAnswers({ germanVisa: "No German visa", howKnowUs: "Instagram" }, CATALOGUE);
    assert.equal(r.mapped.length, 2, "both were read");
    assert.equal(r.scorable, false, "…but there is no band score to compute");
  });

  test("an empty payload is quiet, not an error", () => {
    const r = mapInboundAnswers({}, CATALOGUE);
    assert.deepEqual(r.mapped, []);
    assert.deepEqual(r.unrecognisedKeys, []);
    assert.equal(r.scorable, false);
  });
});

describe("mapInboundAnswers — value coercion", () => {
  test("numbers and booleans are read, not discarded", () => {
    const questions = withMapping("willingnessLearnGerman", { aliases: { yes: ["true"] } });
    const r = mapInboundAnswers({ willingnessLearnGerman: true }, questions);
    assert.equal(r.answers.willingnessLearnGerman, "yes", "a checkbox posts a boolean");
  });

  test("blank and whitespace-only values are absent, not unresolved", () => {
    const r = mapInboundAnswers({ whenStartGermany: "   ", readyToInvest: "" }, CATALOGUE);
    assert.equal(r.mapped.length, 0, "an unanswered optional question is not a mapping failure");
    assert.equal(r.unresolved.length, 0);
  });
});

describe("end to end — a landing-page submission becomes a band score", () => {
  test("a strong prospect scores CONFIRM from labels alone", () => {
    const payload = {
      name: "Priya", phone: "+919000000000", email: "priya@example.com",
      "Are you ready to invest in the right program?": "Yes - ready to invest in the right program",
      "What is your current annual income?": "Over ₹20,00,000 / year",
      "Who makes the decision to go ahead?": "Yes - it's fully my decision",
      "Have you already applied for jobs in Germany?": "Yes - actively applying now",
      "When are you looking to start your move to Germany?": "Immediately",
    };
    // The founder has mapped each question text to its key — one Console edit per question.
    let questions = CATALOGUE;
    for (const [key, text] of [
      ["readyToInvest", "Are you ready to invest in the right program?"],
      ["currentIncome", "What is your current annual income?"],
      ["decisionMaking", "Who makes the decision to go ahead?"],
      ["alreadyApplied", "Have you already applied for jobs in Germany?"],
      ["whenStartGermany", "When are you looking to start your move to Germany?"],
    ] as const) {
      questions = questions.map((q) => (q.key === key ? { ...q, inboundKeys: [text] } : q));
    }

    const mapping = mapInboundAnswers(payload, questions);
    assert.equal(mapping.unresolved.length, 0);
    assert.ok(mapping.scorable);

    const bant = scoreFromAnswers(mapping.answers, questions);
    assert.equal(bant.bantAvg, 5, "every dimension answered at its maximum");
    assert.equal(bant.bantScore, 4);
    assert.equal(bant.bantVerdict, "CONFIRM");
  });

  test("a missing dimension drags the average down rather than being excluded", () => {
    // No Authority question answered at all: Authority scores 0 and STILL divides by four.
    const mapping = mapInboundAnswers(
      { readyToInvest: "ready_now", alreadyApplied: "actively", whenStartGermany: "immediately" },
      CATALOGUE,
    );
    const bant = scoreFromAnswers(mapping.answers, CATALOGUE);
    assert.equal(bant.bantAuthority, false);
    assert.equal(bant.bantAvg, 3.8, "(5 + 0 + 5 + 5) / 4");
    assert.equal(bant.bantScore, 3);
  });
});

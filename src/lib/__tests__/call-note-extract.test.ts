/**
 * Call note extraction - parsing, coercion and date bounds.
 *
 * Two things are being defended here, and they are different jobs:
 *
 *  1. `heuristicExtract` must be CONSERVATIVE. The dangerous failure is not a missed tick,
 *    it's a confident wrong one - "wants it but father decides" ticking Authority would put
 *    an unqualified lead into the SSS ladder. Every BANT dimension therefore gets a
 *    negative-veto case here, not just a positive one.
 *
 *  2. `coerceExtraction` must treat the model as hostile. It writes into fields that drive
 *    commission, so an unknown enum, a past date, a confidence of 7, or a tick with no
 *    evidence has to be dropped at this boundary - there is no second check downstream.
 *
 * Dates are passed in explicitly (no `new Date()`), so relative-date cases are exact.
 *
 * Run: npm test
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  boundFollowUp,
  coerceExtraction,
  fromDateKey,
  heuristicExtract,
  nextWeekday,
  parseRelativeDate,
  summariseExtraction,
  toDateKey,
} from "../call-note-extract";

// 2026-07-15 is a Wednesday - every weekday case below is anchored to it.
const TODAY = "2026-07-15";

describe("date helpers", () => {
  test("round-trips a date key", () => {
    assert.equal(toDateKey(fromDateKey(TODAY)!), TODAY);
  });

  test("rejects malformed and impossible dates", () => {
    assert.equal(fromDateKey("15-07-2026"), null);
    assert.equal(fromDateKey("2026-7-5"), null);
    assert.equal(fromDateKey("not a date"), null);
    // The trap: JS rolls 31 Feb forward to 3 March rather than failing.
    assert.equal(fromDateKey("2026-02-31"), null);
  });

  test("nextWeekday always moves forward, never returns today", () => {
    const wed = fromDateKey(TODAY)!;
    assert.equal(toDateKey(nextWeekday(wed, 0)), "2026-07-19", "Sunday");
    assert.equal(toDateKey(nextWeekday(wed, 4)), "2026-07-16", "Thursday is tomorrow");
    // Said on a Wednesday, "Wednesday" means next week - today's call already happened.
    assert.equal(toDateKey(nextWeekday(wed, 3)), "2026-07-22", "same weekday rolls a week");
  });
});

describe("boundFollowUp", () => {
  test("keeps a plausible follow-up", () => {
    assert.equal(boundFollowUp("2026-07-20", TODAY), "2026-07-20");
    assert.equal(boundFollowUp(TODAY, TODAY), TODAY, "same day is allowed");
  });

  test("drops a date before the call - the expensive mis-parse", () => {
    assert.equal(boundFollowUp("2026-07-14", TODAY), null);
    assert.equal(boundFollowUp("2019-01-01", TODAY), null);
  });

  test("drops a date beyond the 180-day horizon, keeps one inside it", () => {
    assert.equal(boundFollowUp("2026-12-31", TODAY), "2026-12-31", "169 days out is a real plan");
    assert.equal(boundFollowUp("2027-01-11", TODAY), "2027-01-11", "exactly 180 days is the boundary");
    assert.equal(boundFollowUp("2027-01-12", TODAY), null, "181 days is a mis-parse");
    assert.equal(boundFollowUp("2027-07-15", TODAY), null);
  });

  test("drops garbage rather than passing it through", () => {
    assert.equal(boundFollowUp("soon", TODAY), null);
    assert.equal(boundFollowUp(null, TODAY), null);
  });
});

describe("parseRelativeDate", () => {
  const on = (text: string) => parseRelativeDate(text, TODAY)?.key ?? null;

  test("tomorrow and its shorthand", () => {
    assert.equal(on("call tomorrow"), "2026-07-16");
    assert.equal(on("ring tmrw morning"), "2026-07-16");
  });

  test("weekday names, long and short", () => {
    assert.equal(on("call Sun"), "2026-07-19");
    assert.equal(on("call sunday"), "2026-07-19");
    assert.equal(on("follow up thurs"), "2026-07-16");
  });

  test("in N days", () => {
    assert.equal(on("revert in 3 days"), "2026-07-18");
    assert.equal(on("in 1 day"), "2026-07-16");
  });

  test("next week", () => {
    assert.equal(on("call next week"), "2026-07-22");
  });

  test("a weekday inside 'next week' resolves to the weekday", () => {
    // "next sunday" must be the Sunday, not today + 7.
    assert.equal(on("call next sunday"), "2026-07-19");
  });

  test("says nothing when the note says nothing", () => {
    assert.equal(on("wants it, good fit"), null);
    assert.equal(on(""), null);
  });

  test("ignores an absurd day count rather than inventing a date", () => {
    assert.equal(on("in 900 days"), null);
  });
});

describe("heuristicExtract - BANT", () => {
  const bant = (note: string) => heuristicExtract(note, TODAY).bant;

  test("ticks what the note actually says", () => {
    assert.deepEqual(bant("can afford it, he decides himself, really keen, wants to start asap"), {
      budget: true,
      authority: true,
      need: true,
      timeline: true,
    });
  });

  test("a decision-maker elsewhere vetoes Authority", () => {
    // The headline case: interest is real, authority is not.
    const b = bant("wants it but father decides");
    assert.equal(b.need, true);
    assert.equal(b.authority, false);
  });

  test("each negative vetoes its own dimension", () => {
    assert.equal(bant("keen but can't afford right now").budget, false);
    assert.equal(bant("wants it, needs to ask his wife").authority, false);
    assert.equal(bant("just looking for now").need, false);
    assert.equal(bant("interested but no rush, sometime later").timeline, false);
  });

  test("silence is not a tick", () => {
    assert.deepEqual(bant("spoke briefly, will send details"), {
      budget: false,
      authority: false,
      need: false,
      timeline: false,
    });
  });

  test("every tick carries the phrase that justified it", () => {
    const x = heuristicExtract("he decides himself and can afford it", TODAY);
    assert.ok(x.evidence.authority, "authority evidence");
    assert.ok(x.evidence.budget, "budget evidence");
    assert.equal(x.evidence.need, undefined);
  });
});

describe("heuristicExtract - outcome and objection", () => {
  const outcome = (note: string) => heuristicExtract(note, TODAY).outcome;

  test("reads the unambiguous outcomes", () => {
    assert.equal(outcome("prospect didn't show up"), "NO_SHOW");
    assert.equal(outcome("not qualified, wrong profile"), "NOT_QUALIFIED_FOR_SSS");
    assert.equal(outcome("qualified, booked the SSS"), "QUALIFIED_FOR_SSS");
    assert.equal(outcome("sent to workshop next batch"), "SENT_TO_WORKSHOP");
    assert.equal(outcome("will think about it, call back"), "FOLLOW_UP_NEEDED");
  });

  test("no-show wins over a follow-up mention - it describes the appointment", () => {
    assert.equal(outcome("no show, will call back later"), "NO_SHOW");
  });

  test("leaves the outcome alone when the note doesn't say", () => {
    assert.equal(outcome("nice chat about Berlin"), null);
  });

  test("tags the blocker", () => {
    assert.equal(heuristicExtract("wants it but father decides", TODAY).objection, "decision-maker absent");
    assert.equal(heuristicExtract("keen but too expensive", TODAY).objection, "budget");
  });
});

describe("heuristicExtract - the whole note", () => {
  test("the shorthand case end to end", () => {
    const x = heuristicExtract("wants it but father decides, call Sun", TODAY);
    assert.equal(x.source, "rules");
    assert.equal(x.bant.need, true);
    assert.equal(x.bant.authority, false);
    assert.equal(x.followUpDate, "2026-07-19");
    assert.equal(x.objection, "decision-maker absent");
    assert.ok(x.confidence > 0);
  });

  test("an empty note produces an empty suggestion, not a guess", () => {
    const x = heuristicExtract("   ", TODAY);
    assert.equal(x.outcome, null);
    assert.equal(x.followUpDate, null);
    assert.equal(x.confidence, 0);
    assert.deepEqual(x.evidence, {});
  });

  test("confidence rises with how much was actually found", () => {
    const thin = heuristicExtract("spoke to him", TODAY);
    const rich = heuristicExtract("can afford, decides himself, very keen, starting next month, call tomorrow", TODAY);
    assert.ok(rich.confidence > thin.confidence);
    assert.ok(rich.confidence <= 0.75, "a keyword pass never claims certainty");
  });
});

describe("coerceExtraction - the model is not trusted", () => {
  const ev = { outcome: "q", budget: "b", authority: "a", need: "n", timeline: "t" };

  test("accepts a well-formed payload", () => {
    const x = coerceExtraction(
      {
        outcome: "QUALIFIED_FOR_SSS",
        bant: { budget: true, authority: true, need: true, timeline: false },
        followUpDate: "2026-07-20",
        objection: "Budget",
        summary: "Ready to move, wants a July start.",
        highlyQualified: true,
        confidence: 0.8,
        evidence: ev,
      },
      TODAY,
    );
    assert.equal(x.outcome, "QUALIFIED_FOR_SSS");
    assert.deepEqual(x.bant, { budget: true, authority: true, need: true, timeline: false });
    assert.equal(x.followUpDate, "2026-07-20");
    assert.equal(x.objection, "budget", "objection tags are lowercased");
    assert.equal(x.confidence, 0.8);
    assert.equal(x.source, "ai");
  });

  test("drops an outcome that isn't in the enum", () => {
    assert.equal(coerceExtraction({ outcome: "MAYBE_LATER" }, TODAY).outcome, null);
    assert.equal(coerceExtraction({ outcome: 7 }, TODAY).outcome, null);
  });

  test("a tick with no evidence is dropped - the prompt requires the quote", () => {
    const x = coerceExtraction({ bant: { budget: true, need: true }, evidence: { need: "keen" } }, TODAY);
    assert.equal(x.bant.budget, false, "unsupported tick dropped");
    assert.equal(x.bant.need, true, "supported tick kept");
  });

  test("truthy-but-not-true values do not tick a box", () => {
    const x = coerceExtraction({ bant: { budget: "yes", authority: 1 }, evidence: ev }, TODAY);
    assert.equal(x.bant.budget, false);
    assert.equal(x.bant.authority, false);
  });

  test("a follow-up date before the call is dropped, along with its evidence", () => {
    const x = coerceExtraction({ followUpDate: "2026-01-01", evidence: { followUpDate: "January" } }, TODAY);
    assert.equal(x.followUpDate, null);
    assert.equal(x.evidence.followUpDate, undefined);
  });

  test("confidence is clamped into 0–1", () => {
    assert.equal(coerceExtraction({ confidence: 7 }, TODAY).confidence, 1);
    assert.equal(coerceExtraction({ confidence: -3 }, TODAY).confidence, 0);
    assert.equal(coerceExtraction({ confidence: "high" }, TODAY).confidence, 0);
    assert.equal(coerceExtraction({ confidence: NaN }, TODAY).confidence, 0);
  });

  test("survives the shapes a broken response actually takes", () => {
    for (const junk of [null, undefined, "text", 42, [], { bant: [] }, { evidence: "none" }]) {
      const x = coerceExtraction(junk, TODAY);
      assert.equal(x.outcome, null);
      assert.deepEqual(x.bant, { budget: false, authority: false, need: false, timeline: false });
      assert.equal(x.source, "ai");
    }
  });

  test("long free text is truncated rather than passed through", () => {
    const x = coerceExtraction({ summary: "x".repeat(400), objection: "y".repeat(80) }, TODAY);
    assert.ok(x.summary!.length <= 280);
    assert.ok(x.objection!.length <= 40);
  });

  test("highlyQualified is carried as a suggestion", () => {
    // It is deliberately never auto-applied by the UI - see the field's doc comment.
    assert.equal(coerceExtraction({ highlyQualified: true }, TODAY).highlyQualified, true);
    assert.equal(coerceExtraction({ highlyQualified: "true" }, TODAY).highlyQualified, false);
  });
});

describe("summariseExtraction", () => {
  test("names what it filled", () => {
    const x = heuristicExtract("wants it but father decides, call Sun", TODAY);
    const s = summariseExtraction(x);
    assert.match(s, /BANT/);
    assert.match(s, /follow-up date/);
  });

  test("says so plainly when nothing mapped", () => {
    assert.match(summariseExtraction(heuristicExtract("hmm", TODAY)), /Nothing in that note/);
  });
});

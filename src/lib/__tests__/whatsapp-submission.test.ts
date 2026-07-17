/**
 * WhatsApp submission pack — guards on the templates B2 sends to Meta for approval.
 *
 * The point of these: a rejection costs days of review queue, and the failure modes are all
 * mechanical (adjacent variables, undeclared parameters, a body over the limit). Catch them here,
 * not three days into a review.
 *
 * Run: npm test
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  SUBMISSION_TEMPLATES,
  submissionBody,
  lintTemplate,
  BODY_CHAR_LIMIT,
} from "../whatsapp-submission";
import { OUTREACH_STEPS, STEP_BY_KEY } from "../outreach-sop";
import { WHATSAPP_AVAILABLE_VARS, WHATSAPP_KINDS } from "../whatsapp";

describe("Submission pack — coverage", () => {
  test("every WhatsApp step in the SOP has exactly one template", () => {
    const messageSteps = OUTREACH_STEPS.filter((s) => s.channel === "WHATSAPP").map((s) => s.step);
    const covered = SUBMISSION_TEMPLATES.map((t) => t.step);
    assert.deepEqual([...covered].sort(), [...messageSteps].sort());
  });

  test("every template binds to a DISTINCT touchpoint", () => {
    // The app binds ONE WATI template per kind. Two SOP steps sharing a kind would send the
    // intro's text where the follow-up's belonged — silently, and with no type error.
    const kinds = SUBMISSION_TEMPLATES.map((t) => t.kind);
    assert.equal(new Set(kinds).size, kinds.length, `duplicate kind: ${kinds.join(", ")}`);
  });

  test("every bound touchpoint exists in the WhatsAppKind catalogue", () => {
    for (const t of SUBMISSION_TEMPLATES) {
      assert.ok(WHATSAPP_KINDS.includes(t.kind), `${t.kind} is not a known WhatsAppKind`);
    }
  });

  test("template names are unique and Meta-legal", () => {
    const names = SUBMISSION_TEMPLATES.map((t) => t.name);
    assert.equal(new Set(names).size, names.length, "duplicate template name");
    for (const n of names) assert.match(n, /^[a-z0-9_]+$/, `"${n}" must be lowercase/digits/underscore`);
  });
});

describe("Submission pack — the app can actually supply what the templates declare", () => {
  test("every declared variable is offered by its touchpoint", () => {
    // THE contract. If a template declares a variable the touchpoint can't fill, the app blocks
    // the send at runtime — correct, but a wasted approval cycle. Catch it now.
    for (const t of SUBMISSION_TEMPLATES) {
      const offered = WHATSAPP_AVAILABLE_VARS[t.kind];
      for (const v of t.vars) {
        assert.ok(offered.includes(v.name), `${t.name} declares {{${v.name}}} but ${t.kind} offers only: ${offered.join(", ")}`);
      }
    }
  });

  test("every variable the touchpoint offers is used by its template", () => {
    // The reverse: an offered-but-unused variable is dead config that will confuse whoever maps
    // the template in Settings.
    for (const t of SUBMISSION_TEMPLATES) {
      const declared = new Set(t.vars.map((v) => v.name));
      for (const v of WHATSAPP_AVAILABLE_VARS[t.kind]) {
        assert.ok(declared.has(v), `${t.kind} offers {{${v}}} but ${t.name} never declares it`);
      }
    }
  });
});

describe("Submission pack — bodies are derived from the SOP, not retyped", () => {
  test("each submitted body is the SOP body with variables translated", () => {
    for (const t of SUBMISSION_TEMPLATES) {
      const sop = STEP_BY_KEY[t.step]!.body!;
      const body = submissionBody(t);
      // Strip every variable from both sides; the surrounding prose must be identical. This is
      // what stops the pack drifting from what the app actually sends.
      const strip = (s: string) =>
        s
          .replace(/\{\{[\w.]+\}\}/g, "§")
          .replace(/\[Prospect’s First Name\]|\[Your Name\]|\[DATE\]|\[TIME\]|<<INSERT ZOOM LINK HERE>>/g, "§")
          .replace(/\s*<< ATTACH VIDEO TO THIS MESSAGE>>\s*/g, "")
          .replace(/\s+/g, " ")
          .trim();
      const sopStripped = strip(sop);
      const bodyStripped = strip(body);
      // Step 20 gets one documented closing line appended; everything else must match exactly.
      if (t.step === "SSS_CONFIRM_2") {
        assert.ok(bodyStripped.startsWith(sopStripped), `${t.name} must keep the SOP wording as its prefix`);
      } else {
        assert.equal(bodyStripped, sopStripped, `${t.name} drifted from the SOP text`);
      }
    }
  });

  test("the video placeholder never reaches the body — it is a media header", () => {
    const sss = SUBMISSION_TEMPLATES.find((t) => t.step === "SSS_CONFIRM_1")!;
    assert.ok(!submissionBody(sss).includes("ATTACH VIDEO"));
    assert.ok(sss.header, "SSS confirm 1 must declare a video header");
  });

  test("no SOP bracket variable survives translation", () => {
    for (const t of SUBMISSION_TEMPLATES) {
      const body = submissionBody(t);
      for (const v of ["[Prospect’s First Name]", "[Your Name]", "[DATE]", "[TIME]", "<<INSERT ZOOM LINK HERE>>"]) {
        assert.ok(!body.includes(v), `${t.name} still contains ${v}`);
      }
    }
  });

  test("the SOP's links survive verbatim", () => {
    const byStep = (s: string) => submissionBody(SUBMISSION_TEMPLATES.find((t) => t.step === s)!);
    assert.ok(byStep("INTRO_WHATSAPP").includes("https://optin.b2consultants.de/apply"));
    assert.ok(byStep("INTRO_WHATSAPP").includes("https://optin.b2consultants.de/lang"));
    assert.ok(byStep("DISCO_WELCOME").includes("https://casestudies.b2consultants.de/casestudies"));
    assert.ok(byStep("SSS_CANCEL_MSG").includes("https://optin.b2consultants.de/sss"));
  });

  test("WhatsApp bold markers survive", () => {
    assert.ok(submissionBody(SUBMISSION_TEMPLATES.find((t) => t.step === "DISCO_CONFIRM_1")!).includes("*YES*"));
  });
});

describe("Submission pack — Meta's mechanical rules", () => {
  test("every body is within Meta's character limit", () => {
    for (const t of SUBMISSION_TEMPLATES) {
      const len = submissionBody(t).length;
      assert.ok(len <= BODY_CHAR_LIMIT, `${t.name} is ${len} chars, over ${BODY_CHAR_LIMIT}`);
    }
  });

  test("no body ends with a variable (Step 20's known risk is fixed)", () => {
    for (const t of SUBMISSION_TEMPLATES) {
      assert.doesNotMatch(submissionBody(t), /\}\}\s*$/, `${t.name} ends with a variable`);
    }
  });

  test("no body starts with a variable", () => {
    for (const t of SUBMISSION_TEMPLATES) {
      assert.doesNotMatch(submissionBody(t), /^\s*\{\{/, `${t.name} starts with a variable`);
    }
  });

  /**
   * The one template with a known, deliberate issue is `b2_sop_intro`: the SOP's own first two
   * lines put {{name}} and {{sender}} back to back. We do NOT auto-fix it — changing what a
   * prospect reads is B2's call — so it carries a `proposedFix` instead.
   *
   * This test therefore asserts the ONLY acceptable state: an issue may exist, but only on a
   * template that openly proposes a fix for it. A NEW lint failure anywhere else fails the build.
   */
  test("any template that lints dirty must carry a proposed fix", () => {
    for (const t of SUBMISSION_TEMPLATES) {
      const { issues } = lintTemplate(t);
      if (issues.length) {
        assert.ok(
          t.proposedFix,
          `${t.name} has unresolved issues and no proposed fix:\n  - ${issues.join("\n  - ")}`,
        );
      }
    }
  });

  test("the intro's known adjacency issue is still surfaced (regression guard)", () => {
    const intro = SUBMISSION_TEMPLATES.find((t) => t.step === "INTRO_WHATSAPP")!;
    const { issues } = lintTemplate(intro);
    assert.ok(
      issues.some((i) => i.includes("adjacent")),
      "the intro's adjacent-variable risk must keep being reported until the wording changes",
    );
    assert.ok(intro.proposedFix, "…and it must keep proposing the fix");
    // The proposed wording must itself be legal, or we'd be recommending a second rejection.
    assert.doesNotMatch(intro.proposedFix!.body, /\}\}\s*\{\{/);
    assert.doesNotMatch(intro.proposedFix!.body, /\}\}\s*$/);
  });
});

describe("Submission pack — categories", () => {
  test("all nine are MARKETING", () => {
    // Meta allows UTILITY only for a template that is non-promotional and carries no persuasive
    // intent; mixed content defaults to MARKETING. Every body here sells while it informs, so
    // none of them clears that bar — see the rationale on SUBMISSION_TEMPLATES.
    //
    // This is not a rubber stamp on the current values: to make any of these UTILITY the
    // promotional copy has to come OUT of the body, which is a proposedFix and a business
    // decision. Flipping the category alone would earn a silent re-categorisation from Meta and
    // an abuse flag, which is exactly the mistake this test exists to catch.
    for (const t of SUBMISSION_TEMPLATES) {
      assert.equal(t.category, "MARKETING", `${t.name} should be MARKETING`);
    }
  });

  test("a template stays MARKETING on its copy, not on whether it asks for a YES", () => {
    // Guards the reasoning, not just the values. A "reply YES to confirm" is the textbook UTILITY
    // case and is NOT what disqualifies these. The proof is the two cancellations: they ask for
    // nothing, and they are still MARKETING, because they carry a re-booking CTA. If someone ever
    // strips the promo copy to win UTILITY back, the YES must not be what they remove.
    const cancels = SUBMISSION_TEMPLATES.filter(
      (t) => t.step === "DISCO_CANCEL_MSG" || t.step === "SSS_CANCEL_MSG",
    );
    assert.equal(cancels.length, 2);
    for (const t of cancels) {
      assert.doesNotMatch(submissionBody(t), /reply \*?YES/i, `${t.name} asks for no confirmation…`);
      assert.equal(t.category, "MARKETING", `…yet ${t.name} is still MARKETING`);
    }
  });

  test("every template explains its category", () => {
    for (const t of SUBMISSION_TEMPLATES) {
      assert.ok(t.categoryNote && t.categoryNote.length > 20, `${t.name} needs a category rationale`);
    }
  });

  test("every variable carries a sample — Meta requires one", () => {
    for (const t of SUBMISSION_TEMPLATES) {
      for (const v of t.vars) {
        assert.ok(v.sample && v.sample.trim().length > 0, `${t.name} {{${v.name}}} has no sample value`);
      }
    }
  });
});

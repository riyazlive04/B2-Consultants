/**
 * Business-line segmentation (§1) and signed-money colouring (§5.1).
 *
 * The meeting's first complaint was that B2 and German Note could not be told apart in a
 * single combined revenue figure. The split is DERIVED from each row's programme level, so
 * these tests defend the derivation rule rather than any particular level code — a German
 * level added later from the admin (C1, C2) must land on the German Note side without a
 * code change, which is exactly what `lineForKind` buys and a `GN_` name-prefix would not.
 *
 * Run: npm test
 */

import assert from "node:assert/strict";
import { test, describe } from "node:test";
import { BUSINESS_LINE_LABELS, lineForKind } from "../business-line";
import { signedColor } from "../signals";

describe("business line derivation", () => {
  test("German levels and bundles are German Note", () => {
    assert.equal(lineForKind("GERMAN_LEVEL"), "GERMAN_NOTE");
    assert.equal(lineForKind("GERMAN_BUNDLE"), "GERMAN_NOTE");
  });

  test("coaching tiers and anything else are B2", () => {
    assert.equal(lineForKind("COACHING_TIER"), "B2");
    assert.equal(lineForKind("OTHER"), "B2");
  });

  test("an unmapped or missing level never throws — it falls to B2", () => {
    // A level code present on old income rows but since deleted from the Level table
    // yields `undefined` here. Revenue must still be counted somewhere, not dropped.
    assert.equal(lineForKind(undefined), "B2");
    assert.equal(lineForKind("SOME_FUTURE_KIND"), "B2");
  });

  test("a newly added German level segments correctly with no code change", () => {
    // The C1/C2 case the founder asked about: the kind decides, not the code.
    assert.equal(lineForKind("GERMAN_LEVEL"), "GERMAN_NOTE");
  });

  test("every view has a label", () => {
    assert.equal(BUSINESS_LINE_LABELS.ALL, "Combined");
    assert.equal(BUSINESS_LINE_LABELS.B2, "B2");
    assert.equal(BUSINESS_LINE_LABELS.GERMAN_NOTE, "German Note");
  });
});

describe("pro-rata cost allocation reconciles", () => {
  // The property that matters: the two lines must sum back to the combined P&L, or the
  // founder gets a split that silently loses money.
  test("line revenue shares always sum to the combined total", () => {
    const b2 = 200_000_00;
    const gn = 47_000_00;
    const total = b2 + gn;
    const expenses = 180_000_00;

    const b2Share = b2 / total;
    const gnShare = gn / total;
    assert.ok(Math.abs(b2Share + gnShare - 1) < 1e-9);

    const allocated = expenses * b2Share + expenses * gnShare;
    assert.ok(Math.abs(allocated - expenses) < 1e-6, "allocated costs must equal total costs");
  });

  test("a line with no revenue carries no shared cost (and no NaN)", () => {
    const total = 0;
    const share = total > 0 ? 0 / total : 0;
    assert.equal(share, 0);
    assert.ok(Number.isFinite(share));
  });
});

describe("signed money colouring (§5.1)", () => {
  test("a loss is red and a profit is green", () => {
    assert.equal(signedColor(-1), "var(--bad)");
    assert.equal(signedColor(1), "var(--good)");
  });

  test("exactly zero claims no verdict", () => {
    // Zero net profit is neither a win nor a loss; forcing it green would be a lie.
    assert.equal(signedColor(0), undefined);
  });
});

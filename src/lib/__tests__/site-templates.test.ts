import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { SECTION_TEMPLATES, groupedTemplates, templateByKey } from "../site-templates";
import { normaliseSections } from "../site-types";

describe("section templates", () => {
  test("keys are unique — the picker addresses templates by key", () => {
    const keys = SECTION_TEMPLATES.map((t) => t.key);
    assert.equal(new Set(keys).size, keys.length);
  });

  test("normalisation loses nothing from a template", () => {
    // The round trip that matters: a template is built in the browser, saved to a JSON column,
    // then read back through normaliseSections by the renderer. A block or a field dropped here
    // shows up as a missing paragraph on a live page.
    //
    // Compared field-by-field rather than with deepEqual against the literal: the normaliser
    // deliberately materialises absent booleans (`forwardParams: false`) and fixes key order, so
    // strict equality would fail on a difference that carries no meaning.
    for (const t of SECTION_TEMPLATES) {
      const built = t.build(1);
      const [round] = normaliseSections([built]);

      assert.equal(round.id, built.id, `${t.key}: section id`);
      assert.equal(round.width, built.width, `${t.key}: width`);
      assert.deepEqual(round.background, built.background, `${t.key}: background`);
      assert.deepEqual(round.padding, built.padding, `${t.key}: padding`);
      assert.equal(round.columns.length, built.columns.length, `${t.key}: column count`);

      built.columns.forEach((col, ci) => {
        assert.equal(round.columns[ci].length, col.length, `${t.key}: column ${ci} block count`);
        col.forEach((b, bi) => {
          const r = round.columns[ci][bi];
          // Only the keys the template actually set — the rest are legitimately undefined.
          for (const k of Object.keys(b) as (keyof typeof b)[]) {
            assert.deepEqual(r[k], b[k], `${t.key}: block ${b.id} lost "${String(k)}"`);
          }
        });
      });
    }
  });

  test("normalisation is idempotent", () => {
    // Save → load → save must not drift. Without this, a page edited twice can differ from one
    // edited once, and a revision diff shows changes nobody made.
    for (const t of SECTION_TEMPLATES) {
      const once = normaliseSections([t.build(1)]);
      const twice = normaliseSections(once);
      assert.deepEqual(twice, once, `${t.key} is not stable under repeated normalisation`);
    }
  });

  test("block ids are unique within a section", () => {
    for (const t of SECTION_TEMPLATES) {
      const ids = t.build(1).columns.flat().map((b) => b.id);
      assert.equal(new Set(ids).size, ids.length, `${t.key} has duplicate block ids`);
    }
  });

  test("two sections from the same template do not collide", () => {
    // Seeds, not timestamps: two sections added in the same millisecond would otherwise share ids
    // and React would treat a re-render as a remount.
    for (const t of SECTION_TEMPLATES) {
      const a = t.build(1);
      const b = t.build(2);
      assert.notEqual(a.id, b.id, `${t.key} reuses its section id`);
      const overlap = a.columns.flat().map((x) => x.id)
        .filter((id) => b.columns.flat().some((y) => y.id === id));
      assert.deepEqual(overlap, [], `${t.key} reuses block ids across seeds`);
    }
  });

  test("every CTA pointing at the GHL funnel forwards attribution", () => {
    // The one default that must not regress. A button crossing to optin.b2consultants.de without
    // forwarding produces opt-ins that cannot be traced to the page that generated them.
    for (const t of SECTION_TEMPLATES) {
      for (const b of t.build(1).columns.flat()) {
        if (b.type === "button" && b.href?.includes("optin.b2consultants.de")) {
          assert.equal(b.forwardParams, true, `${t.key}: CTA to the opt-in funnel must forward params`);
        }
      }
    }
  });

  test("grouping covers every template exactly once", () => {
    const grouped = groupedTemplates().flatMap((g) => g.items);
    assert.equal(grouped.length, SECTION_TEMPLATES.length);
    assert.deepEqual(
      new Set(grouped.map((t) => t.key)),
      new Set(SECTION_TEMPLATES.map((t) => t.key)),
    );
  });

  test("templateByKey resolves known keys and refuses unknown ones", () => {
    assert.equal(templateByKey("hero-portrait")?.key, "hero-portrait");
    assert.equal(templateByKey("nope"), undefined);
  });
});

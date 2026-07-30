import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { resolveSections, SECTION_CATALOGUE, APP_ROLES } from "../sections";
import {
  PERMISSION_MATRIX,
  SPEC_ROLES,
  SPEC_ROLE_TO_APP_ROLE,
  levelsOf,
  specVisibility,
  conflictingSpecRoles,
  driftFor,
  matrixDrift,
  driftSummary,
} from "../permission-matrix";

const sections = resolveSections(null); // shipped defaults, no founder config saved

describe("permission matrix — the encoding itself", () => {
  test("every row carries exactly one level per spec role", () => {
    for (const row of PERMISSION_MATRIX) {
      const levels = levelsOf(row);
      assert.equal(Object.keys(levels).length, SPEC_ROLES.length, row.key);
    }
  });

  test("every section key named by a row actually exists in the catalogue", () => {
    // A typo here would silently report the module as hidden for everyone, which reads
    // as a compliant app rather than a broken comparison.
    const known = new Set(SECTION_CATALOGUE.map((s) => s.key));
    for (const row of PERMISSION_MATRIX) {
      for (const key of row.sections) {
        assert.ok(known.has(key), `row "${row.key}" names unknown section "${key}"`);
      }
    }
  });

  test("a row with no sections always carries a note explaining what enforces it", () => {
    for (const row of PERMISSION_MATRIX) {
      if (row.sections.length === 0) {
        assert.ok(row.note && row.note.length > 0, `row "${row.key}" is ungated with no explanation`);
      }
    }
  });
});

describe("collapsing eight spec roles onto five app roles", () => {
  test("Owner and Admin both land on ADMIN", () => {
    assert.equal(SPEC_ROLE_TO_APP_ROLE.OWNER, "ADMIN");
    assert.equal(SPEC_ROLE_TO_APP_ROLE.ADMIN, "ADMIN");
  });

  test("all three telecaller tiers land on USER", () => {
    assert.equal(SPEC_ROLE_TO_APP_ROLE.L1, "USER");
    assert.equal(SPEC_ROLE_TO_APP_ROLE.L2, "USER");
    assert.equal(SPEC_ROLE_TO_APP_ROLE.L3, "USER");
  });

  test("agreements is the row the collapse cannot express: L3 edits, L1 and L2 are locked out", () => {
    const row = PERMISSION_MATRIX.find((r) => r.key === "agreements")!;
    const levels = levelsOf(row);
    assert.equal(levels.L1, "-");
    assert.equal(levels.L2, "-");
    assert.equal(levels.L3, "E");
    assert.equal(specVisibility(row, "USER"), "CONFLICT");
    assert.deepEqual(conflictingSpecRoles(row, "USER"), ["L3"]);
  });

  test("a row where the collapsed roles agree resolves cleanly", () => {
    const row = PERMISSION_MATRIX.find((r) => r.key === "arena")!;
    assert.equal(specVisibility(row, "USER"), "VISIBLE"); // R for L1, L2 and L3 alike
    const finance = PERMISSION_MATRIX.find((r) => r.key === "finance-revenue")!;
    assert.equal(specVisibility(finance, "USER"), "HIDDEN"); // hidden for all three
  });

  test("a role no spec column maps to reads as hidden rather than throwing", () => {
    const row = PERMISSION_MATRIX.find((r) => r.key === "arena")!;
    // every AppRole is covered today, so assert the guard rather than a gap
    for (const r of APP_ROLES) {
      assert.ok(["VISIBLE", "HIDDEN", "CONFLICT"].includes(specVisibility(row, r)));
    }
  });
});

describe("drift against the live section config", () => {
  test("a module with no section is reported as ungateable, not as drift", () => {
    const row = PERMISSION_MATRIX.find((r) => r.key === "executive")!;
    assert.equal(driftFor(row, "USER", sections), "NOT_GATEABLE");
  });

  test("Finance is hidden from telecallers in both the spec and the app", () => {
    const row = PERMISSION_MATRIX.find((r) => r.key === "finance-revenue")!;
    assert.equal(driftFor(row, "USER", sections), "ALIGNED");
  });

  test("a per-user override that opens a hidden module is caught as APP_WIDER", () => {
    const row = PERMISSION_MATRIX.find((r) => r.key === "finance-revenue")!;
    assert.equal(driftFor(row, "USER", sections, { finance: true }), "APP_WIDER");
  });

  test("a per-user override that closes a granted module is caught as APP_NARROWER", () => {
    const row = PERMISSION_MATRIX.find((r) => r.key === "arena")!;
    assert.equal(driftFor(row, "USER", sections), "ALIGNED");
    assert.equal(driftFor(row, "USER", sections, { arena: false }), "APP_NARROWER");
  });

  test("the only modules Admin cannot reach are the ones switched off in code", () => {
    // `sectionAllowed` tests `enabled` BEFORE the ADMIN short-circuit, so a code-hidden section
    // (`hidden: true`) is closed even to the founder until the console turns it back on. Ledger is
    // the live example, and it is why the spec's `R` for Admin reads as a gap rather than a leak.
    const disabled = new Set(sections.filter((s) => !s.enabled).map((s) => s.key));
    for (const row of PERMISSION_MATRIX) {
      if (row.sections.length === 0) continue;
      const v = driftFor(row, "ADMIN", sections);
      if (v === "APP_NARROWER") {
        assert.ok(
          row.sections.every((k) => disabled.has(k)),
          `${row.key} is closed to Admin but is not code-hidden`,
        );
      } else {
        assert.ok(v === "ALIGNED" || v === "APP_WIDER", `${row.key} → ${v}`);
      }
    }
  });

  test("Ledger is that case: shipped off, so even Admin is narrower than the spec", () => {
    const row = PERMISSION_MATRIX.find((r) => r.key === "ledger")!;
    assert.equal(sections.find((s) => s.key === "ledger")!.enabled, false);
    assert.equal(driftFor(row, "ADMIN", sections), "APP_NARROWER");
  });

  test("the full grid covers every module for every app role", () => {
    const cells = matrixDrift(sections, APP_ROLES);
    assert.equal(cells.length, PERMISSION_MATRIX.length * APP_ROLES.length);
  });

  test("the summary separates leaks from gaps from unexpressible rules", () => {
    const s = driftSummary(matrixDrift(sections, APP_ROLES));
    // Agreements for USER is the known conflict; assert it surfaces rather than pinning a count
    // that would break every time a section's default role list is legitimately edited.
    assert.ok(s.conflicts.some((c) => c.row.key === "agreements" && c.appRole === "USER"));
    for (const c of s.wider) assert.equal(c.verdict, "APP_WIDER");
    for (const c of s.narrower) assert.equal(c.verdict, "APP_NARROWER");
  });
});

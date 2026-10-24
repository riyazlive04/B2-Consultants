import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { APP_ROLES, SECTION_CATALOGUE, resolveSections, sectionAllowed } from "../sections";
import { CAPABILITIES, hasCapability } from "../capabilities";
import { mergeBatchSeats } from "../batch";

/**
 * THE TWO STRUCTURAL FORKS THIS REFACTOR COULD CLOSE WITHOUT A MIGRATION.
 *
 *   P1 — `Batch` has two membership mechanisms, and nothing in the schema says which applies.
 *   P18 — `batches.manage` gated seating while the only screen with a roster was admin-only.
 *
 * Both are now held by rules rather than by habit, and these are the rules.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(here, "..", "..", "server");
const read = (f: string) => fs.readFileSync(path.join(SERVER, f), "utf8");

describe("batch membership - one roster from two tables (P1)", () => {
  const seats = mergeBatchSeats({
    members: [{ student: { id: "s1", fullName: "Anita Rao", code: "GN-0007" } }],
    enrollments: [
      {
        id: "e1",
        programLevel: "GUIDED",
        status: "ACTIVE",
        student: { id: "s2", fullName: "Vikram Shah", code: "B2-0012" },
        coach: { name: "Karthick" },
        assignedCoach: null,
      },
    ],
  });

  test("both mechanisms land in one list, each saying which door it came through", () => {
    assert.equal(seats.length, 2);
    assert.deepEqual(
      seats.map((s) => s.via),
      ["MEMBER", "ENROLLMENT"],
      "members come first, then enrolments - a reader scanning the list should not see them interleave",
    );
  });

  test("a German Note seat carries no enrolment, level, status or coach - and does not invent them", () => {
    const gn = seats.find((s) => s.via === "MEMBER")!;
    assert.equal(gn.enrollmentId, null);
    assert.equal(gn.programLevel, null, "a course is sat, not bought as a tier");
    assert.equal(gn.status, null);
    assert.equal(gn.coachName, null);
    // What it DOES carry is the person, which is the whole point of the unified shape.
    assert.equal(gn.name, "Anita Rao");
    assert.equal(gn.code, "GN-0007");
  });

  test("a coaching seat carries its enrolment and resolves the coach name", () => {
    const b2 = seats.find((s) => s.via === "ENROLLMENT")!;
    assert.equal(b2.enrollmentId, "e1");
    assert.equal(b2.programLevel, "GUIDED");
    assert.equal(b2.coachName, "Karthick");
  });

  /**
   * THE LATENT DUPLICATE this merge was changed to fix.
   *
   * Nothing in the schema stops one person holding a seat through BOTH mechanisms: `BatchMember`
   * is unique on `[batchId, studentId]` and `Enrollment.batchId` has no constraint against it.
   * The register had always deduped for exactly this reason; the cohort roster had not - so the
   * same cohort would have listed that person twice on one screen and once on the other.
   */
  test("one person in both mechanisms is one row, and the enrolment wins", () => {
    const both = mergeBatchSeats({
      members: [{ student: { id: "s1", fullName: "Anita Rao", code: "GN-0007" } }],
      enrollments: [
        {
          id: "e9",
          programLevel: "GN_A2",
          status: "ACTIVE",
          student: { id: "s1", fullName: "Anita Rao", code: "GN-0007" },
          coach: { name: "Karthick" },
          assignedCoach: null,
        },
      ],
    });
    assert.equal(both.length, 1, "the same person appeared twice");
    // The enrolment row is strictly richer - level, status, coach - so keeping the member row
    // would silently drop three facts we hold.
    assert.equal(both[0].via, "ENROLLMENT");
    assert.equal(both[0].enrollmentId, "e9");
    assert.equal(both[0].programLevel, "GN_A2");
  });

  /**
   * `optOut` is how the register keeps a departed student on sheets they were marked on while
   * taking them off future ones (`belongsOnRegister`). Members are never filtered: a
   * `BatchMember` row has no status to judge, so its existence IS the membership.
   */
  test("optOut drops enrolments the caller will not list, and never members", () => {
    const rows = {
      members: [{ student: { id: "m1", fullName: "Member Stays", code: null } }],
      enrollments: [
        {
          id: "e1",
          programLevel: "SOLO",
          status: "DROPPED",
          student: { id: "s1", fullName: "Dropped Out", code: null },
          coach: null,
          assignedCoach: null,
        },
      ],
    };
    const kept = mergeBatchSeats(rows, { optOut: (e) => e.status === "DROPPED" });
    assert.deepEqual(
      kept.map((k) => k.name),
      ["Member Stays"],
      "the dropped enrolment should be gone and the member untouched",
    );
    // Without the predicate the same rows produce both - the filter is the caller's, not the merge's.
    assert.equal(mergeBatchSeats(rows).length, 2);
  });

  test("a free-text coach is used when no coach account is linked", () => {
    const [only] = mergeBatchSeats({
      members: [],
      enrollments: [
        {
          id: "e2",
          programLevel: "SOLO",
          status: "ACTIVE",
          student: { id: "s3", fullName: "Meera N", code: null },
          coach: null,
          assignedCoach: "Ameen",
        },
      ],
    });
    assert.equal(only.coachName, "Ameen");
  });

  /**
   * The ratchet. `BatchMember` is the German Note mechanism, and reading it directly is how a
   * feature ends up written twice. The allowed list is the seam plus the German Note modules,
   * whose own screens are a community and a classroom rather than a cohort roster — they
   * legitimately know about members as people, not as seats.
   *
   * It may only ever SHRINK. A new module here means the fork spread.
   *
   * Converted so far: `attendance.ts` (both roster builds - the register sheet and the cohort
   * attendance table). Both were the same member-then-enrolment dedupe with `belongsOnRegister`
   * layered on, which is now `mergeBatchSeats(rows, { optOut })`.
   */
  const MAY_READ_MEMBERS_DIRECTLY = [
    "attendance-checkin-actions.ts",
    "attendance-checkin.ts",
    "batch-membership.ts",
    "batches.ts",
    "class-reminders.ts",
    "german-note-actions.ts",
    "german-note-metrics.ts",
    "notifications.ts",
    "session-tasks.ts",
    "tutor-desk.ts",
  ];

  test("the modules reaching past the seam are exactly the known list", () => {
    const direct = fs
      .readdirSync(SERVER)
      .filter((f) => f.endsWith(".ts"))
      .filter((f) => /batchMember\.|\bmembers:\s*\{/.test(read(f)))
      .sort();
    assert.deepEqual(
      direct,
      MAY_READ_MEMBERS_DIRECTLY,
      "a new module reads batch membership directly - use server/batch-membership.ts, and shrink " +
        "this list when you convert an old one",
    );
  });

  test("the cohort hub reads membership through the seam, not its own copy", () => {
    const src = read("batch-detail.ts");
    assert.match(src, /BATCH_MEMBERSHIP_SELECT/, "batch-detail should share the selection");
    assert.match(src, /mergeBatchSeats\(/, "batch-detail should share the merge");
    assert.doesNotMatch(
      src,
      /studentId:\s*m\.student\.id/,
      "batch-detail has grown its own roster merge again",
    );
  });
});

describe("batches.manage is exercisable by the role it was written for (P18)", () => {
  const sections = resolveSections(null);
  const batches = sections.find((s) => s.key === "batches")!;

  test("the capability exists and is granted to someone other than the founder", () => {
    const cap = CAPABILITIES.find((c) => c.key === "batches.manage");
    assert.ok(cap, "batches.manage is gone - the seating guard needs revisiting");
  });

  /**
   * `batches.manage` defaults to ADMIN only and is handed to a head coach as a PER-USER grant -
   * which is the right model (it is a trust decision about one person, not about a role). The
   * bug was that the grant could not be acted on: `/batches` was the only screen with a roster
   * and it was admin-only, so an admin could tick the box and nothing changed.
   *
   * So the thing to assert is the override path, not a role default.
   */
  test("a head coach granted batches.manage can open the screen that has the roster", () => {
    const granted = { "batches.manage": true } as const;
    assert.ok(
      hasCapability("HEAD", granted, "batches.manage"),
      "the per-user grant no longer takes effect",
    );
    assert.ok(
      sectionAllowed(batches, "HEAD", null),
      "a head coach cannot open /batches, so the grant above is unexercisable",
    );
  });

  test("the grant is still a decision about a person, not a role default", () => {
    // If this ever changes, every head coach gains seating at once - which is a product call.
    const byDefault = APP_ROLES.filter((r) => r !== "ADMIN" && hasCapability(r, null, "batches.manage"));
    assert.deepEqual(byDefault, [], `batches.manage is now a role default for: ${byDefault.join(", ")}`);
  });

  test("the page gates WRITING separately from being allowed in", () => {
    // Opening the screen must not imply creating a cohort: `upsertBatch` and `deleteBatch` are
    // `requireAdmin()`, so their controls have to be behind a flag rather than behind the route.
    const page = fs.readFileSync(
      path.join(here, "..", "..", "app", "(app)", "batches", "page.tsx"),
      "utf8",
    );
    assert.match(page, /canEdit\s*=\s*session\.role === "ADMIN"/, "the write flag is gone");
    assert.match(page, /hasCapability\([^)]*"batches\.manage"\)/, "the read gate is gone");
    assert.match(page, /canEdit=\{canEdit\}/, "the panels are no longer told what the viewer may do");
    // The prose above the function legitimately discusses `requireAdmin` - what must not come
    // back is the CALL, which is what shut the roster out in the first place.
    assert.doesNotMatch(page, /await requireAdmin\(/, "the blanket admin gate is back");
  });

  test("the catalogue entry still only widens READING, never writing", () => {
    // If this ever grows past ADMIN + HEAD, the write gating above is what has to be checked.
    assert.deepEqual([...batches.roles].sort(), ["ADMIN", "HEAD"]);
  });
});

describe("both business lines ask the same question about seating (24/10/2026)", () => {
  const SERVER = path.join(here, "..", "..", "server");
  const read2 = (f: string) => fs.readFileSync(path.join(SERVER, f), "utf8");

  /**
   * The permission model used to say two different things about one job: `seatEnrollment` (a
   * coaching seat) was `batches.manage`, and `addExistingMember` / `addNewMember` (a German Note
   * seat) were `requireAdmin()`. So the same head coach, granted the capability, could seat a
   * coaching client and not a German Note learner — and nobody had decided that; it fell out of
   * the two lines being built at different times.
   *
   * Both are `batches.manage` now. The capability is still a PER-PERSON grant and not a role
   * default, so the founder decides who — which is the point: the decision is theirs to make
   * rather than hardcoded in an action.
   */
  test("adding a German Note learner is a capability, not founder-only", () => {
    const src = read2("german-note-actions.ts");
    for (const fn of ["addExistingMember", "addNewMember", "removeBatchMember"]) {
      const at = src.indexOf(`export async function ${fn}`);
      assert.notEqual(at, -1, `${fn} is gone`);
      const body = src.slice(at, at + 1400);
      assert.match(
        body,
        /requireCapability\("batches\.manage"\)/,
        `${fn} is back to requireAdmin - a head coach granted batches.manage cannot use it`,
      );
    }
  });

  test("seating a coaching client asks for the same capability", () => {
    const src = read2("batch-actions.ts");
    const at = src.indexOf("export async function seatEnrollment");
    assert.match(src.slice(at, at + 400), /requireCapability\("batches\.manage"\)/);
  });

  test("the seat picker is drawn on the same rule, so no control is offered that the server refuses", () => {
    const src = read2("batch-detail.ts");
    const at = src.indexOf("export async function canSeatBatch");
    const body = src.slice(at, at + 1200);
    assert.match(body, /hasCapability\([^)]*"batches\.manage"\)/);
    assert.doesNotMatch(
      body,
      /session\.role === "ADMIN"/,
      "canSeatBatch branches on role again - it should ask the one capability question",
    );
  });
});

describe("the section catalogue still names every door", () => {
  test("batches is in the Classroom group, where a coach looks for it", () => {
    const entry = SECTION_CATALOGUE.find((s) => s.key === "batches")!;
    assert.equal(entry.group, "Classroom");
  });
});

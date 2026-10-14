import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { TEMPLATES } from "../../../scripts/wati-templates-utility-docx";
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

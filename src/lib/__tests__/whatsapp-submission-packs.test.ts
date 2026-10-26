import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *  THE TWO SUBMISSION PACKS MUST AGREE  (WATI approval audit, 26 Oct 2026)
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * B2 submits its WhatsApp templates to Meta from TWO documents built by two different code paths:
 *
 *   `src/lib/whatsapp-submission.ts`        the 13 Outreach SOP messages  → `npm run docs:whatsapp`
 *   `scripts/wati-templates-utility-docx.ts` the 38 transactional ones    → `npm run docs:whatsapp:utility`
 *
 * Ten template NAMES appear in both. On 26 Oct 2026, EIGHT of those ten disagreed, and every one
 * of the disagreements is a submission that cannot succeed as written:
 *
 * ── 1. SIX CATEGORY CONFLICTS ───────────────────────────────────────────────────────────────
 *   b2_sop_disco_welcome · b2_sop_disco_confirm_1 · b2_sop_disco_confirm_2
 *   b2_sop_sss_confirm_1 · b2_sop_sss_confirm_2   · b2_sop_sss_cancel
 *
 * Each is MARKETING in one pack and UTILITY in the other. Meta approves a template once per
 * (name, language) with ONE category, so these are not two templates - they are one template
 * described two ways. Whichever document is used second either collides or re-categorises the
 * first, and the category is not cosmetic: it decides the per-message price AND whether the
 * recipient's marketing opt-out suppresses the send. A UTILITY confirmation that gets approved
 * as MARKETING stops reaching anyone who ever opted out of marketing - silently, because
 * `lib/outbound-allowlist.ts` is not what is blocking it.
 *
 * ── 2. TWO TEMPLATES WIRED TO EACH OTHER'S TOUCHPOINT ───────────────────────────────────────
 *   b2_booking_auto_cancelled   SOP pack → SOP_DISCO_CANCEL      utility pack → BOOKING_AUTO_CANCELLED
 *   b2_sop_disco_cancel         SOP pack → SOP_DISCO_NOSHOW      utility pack → SOP_DISCO_CANCEL
 *
 * These are crossed. Bind from one document and submit from the other and a prospect who DID NOT
 * TURN UP is told their call has been cancelled, while a prospect whose unconfirmed call was
 * auto-released is told off for missing it. Both messages send successfully, so nothing anywhere
 * reports a fault - the only symptom is a prospect replying "but I was never told".
 *
 * ── WHY THIS IS A TEST AND NOT A FIXED SPREADSHEET ──────────────────────────────────────────
 * The packs are generated from code precisely so that "what we asked Meta to approve" and "what
 * the app expects back" cannot drift - that is the stated purpose at the top of
 * `whatsapp-submission.ts`. The guarantee held WITHIN each pack and nothing checked BETWEEN
 * them, which is how ten shared names became eight conflicts without anybody noticing.
 *
 * Reading source rather than importing: the utility pack is a `scripts/` module that renders a
 * .docx on import-time side effects, and the repo already takes this approach where the mistake
 * lives in a declaration rather than a value (`paid-so-far-excludes-archived.test.ts`,
 * `fx-missing-rate.test.ts`).
 */

const ROOT = process.cwd();
const SOP_PACK = path.join(ROOT, "src", "lib", "whatsapp-submission.ts");
const UTILITY_PACK = path.join(ROOT, "scripts", "wati-templates-utility-docx.ts");

type Entry = { name: string; category: string; kind: string };

/**
 * Every `{ name, category, kind }` in a pack file.
 *
 * Split on a two-space-indented `{` - the shape both files use for one template - then pick the
 * three fields off each block. `kind` tolerates digits (`SOP_SSS_CONFIRM_1`), which an earlier
 * version of this parser did not, and which silently reported four templates as unbound.
 */
function parsePack(file: string, from?: string): Entry[] {
  // CRLF normalised first. These files are checked out with Windows line endings, so a
  // `\n  {\n` split silently matched nothing and the guard passed on an empty list - which is
  // exactly the failure the "still parseable" test above exists to catch.
  let src = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
  if (from) src = src.slice(src.indexOf(from));
  const out: Entry[] = [];
  for (const block of src.split(/\n {2}\{\n/).slice(1)) {
    const name = /name: "([a-z0-9_]+)"/.exec(block);
    if (!name) continue;
    const category = /category: "([A-Z]+)"/.exec(block);
    const kind = /kind: "([A-Z][A-Z0-9_]*)"/.exec(block);
    out.push({
      name: name[1],
      category: category?.[1] ?? "(none)",
      kind: kind?.[1] ?? "(none)",
    });
  }
  return out;
}

const sopPack = () => parsePack(SOP_PACK, "SUBMISSION_TEMPLATES");
/**
 * SCOPED TO THE DECLARATION, like the SOP pack is.
 *
 * It used to parse the utility pack from the top of the file, which worked only for as long as
 * `TEMPLATES` was the sole two-space-indented `{` block in it. On 26 Oct 2026 the generator gained
 * `NEEDS_ACTION` - a list of `{ name, action, why }` in exactly that shape - and the parser read
 * its five SOP entries as utility-pack templates with no category and no kind, which made each of
 * them look like a name collision with the SOP pack. The guard failed on five templates that were
 * never in this pack at all.
 *
 * Anchored on the full declaration rather than the bare word: "TEMPLATES" first appears in this
 * file's own header comment ("Every count is read off `TEMPLATES`"), so `indexOf("TEMPLATES")`
 * would slice from line 9 and change nothing.
 */
const utilityPack = () => parsePack(UTILITY_PACK, "export const TEMPLATES: Tpl[] = [");

describe("the WATI submission packs", () => {
  test("are both still parseable, so this guard is pointed at something", () => {
    // A rename or a reformat that defeats the parser must fail loudly here rather than silently
    // passing every assertion below on an empty list.
    assert.ok(sopPack().length >= 10, `SOP pack parsed ${sopPack().length} templates - re-point this test`);
    assert.ok(utilityPack().length >= 30, `utility pack parsed ${utilityPack().length} templates - re-point this test`);
  });

  test("never give one template name two categories", () => {
    const byName = new Map<string, Set<string>>();
    for (const t of [...sopPack(), ...utilityPack()]) {
      if (t.category === "(none)") continue;
      byName.set(t.name, (byName.get(t.name) ?? new Set()).add(t.category));
    }
    const offenders = [...byName]
      .filter(([, cats]) => cats.size > 1)
      .map(([name, cats]) => `${name}: ${[...cats].sort().join(" vs ")}`);

    assert.deepEqual(
      offenders,
      [],
      "Meta approves one category per (name, language). These ask for two, so the second " +
        "submission re-categorises the first - changing its price and whether a marketing " +
        `opt-out suppresses it:\n  ${offenders.join("\n  ")}`,
    );
  });

  /**
   * ONE APPROVED TEMPLATE, DELIBERATELY SERVING TWO TOUCHPOINTS.
   *
   * The allow-list is short on purpose and every entry carries its reason. Reuse is legitimate
   * only when the SAME WORDS are true at both touchpoints - which is a strong condition, and
   * the thing that makes it checkable is writing down why rather than letting the test pass
   * on a coincidence of naming.
   */
  const SHARED_ON_PURPOSE: Record<string, string> = {
    // Currently EMPTY, and that is the healthy state - every template name serves exactly one
    // touchpoint. The mechanism is kept because reuse is legitimate when the SAME WORDS are true
    // at both touchpoints, and when that case arrives the reason belongs here rather than in a
    // commit message. An entry is a claim somebody has to defend, not a way to quiet the test.
  };

  test("never give one template name two touchpoints", () => {
    const byName = new Map<string, Set<string>>();
    for (const t of [...sopPack(), ...utilityPack()]) {
      if (t.kind === "(none)") continue;
      byName.set(t.name, (byName.get(t.name) ?? new Set()).add(t.kind));
    }
    const offenders = [...byName]
      .filter(([name, kinds]) => kinds.size > 1 && !SHARED_ON_PURPOSE[name])
      .map(([name, kinds]) => `${name}: ${[...kinds].sort().join(" vs ")}`);

    assert.deepEqual(
      offenders,
      [],
      "one WATI template is bound per WhatsAppKind, so a name claimed by two kinds means one " +
        "touchpoint sends the other's text - and both sends SUCCEED, so nothing reports it:\n  " +
        offenders.join("\n  "),
    );
  });

  /**
   * ── WHAT "TWO NAMES FOR ONE TOUCHPOINT" LEGITIMATELY MEANS ──────────────────────────────
   *
   * Several kinds genuinely need more than one approved template, and the app picks between
   * them at send time. Two established reasons, both already in the pack:
   *
   *   `_zoom` / `_portal` / `_link`   a WATI template with a DECLARED-BUT-EMPTY variable SKIPS
   *                                   the send outright, so a booking with no Zoom link cannot
   *                                   use the template that declares `{{zoom_link}}`. Two
   *                                   templates, chosen by what data exists.
   *   `_u`                            the UTILITY REWRITE of an SOP message - the same
   *                                   touchpoint with the promotional copy stripped so Meta can
   *                                   categorise it UTILITY. A different BODY, therefore a
   *                                   different template, therefore a different name.
   *
   * What is never legitimate is the SAME name meaning two things, which the two tests above
   * cover. This one catches the remaining case: an SOP kind served by a utility-pack template
   * whose name is neither the SOP pack's nor an acknowledged variant of it - i.e. the two
   * documents quietly proposing different submissions for one touchpoint.
   */
  const VARIANT_SUFFIX = /_(?:u|zoom|portal|link)$/;

  test("never give one touchpoint two unrelated names across the packs", () => {
    const sopByKind = new Map(sopPack().filter((t) => t.kind !== "(none)").map((t) => [t.kind, t.name]));
    const offenders: string[] = [];
    for (const t of utilityPack()) {
      if (t.kind === "(none)") continue;
      const canonical = sopByKind.get(t.kind);
      if (!canonical || canonical === t.name) continue;
      // An acknowledged variant of the canonical name is fine - that is the whole `_u` / `_zoom`
      // convention. A different name altogether is two documents disagreeing.
      if (VARIANT_SUFFIX.test(t.name) && t.name.replace(VARIANT_SUFFIX, "") === canonical.replace(VARIANT_SUFFIX, "")) {
        continue;
      }
      offenders.push(`${t.kind}: SOP pack says ${canonical}, utility pack says ${t.name}`);
    }

    assert.deepEqual(
      offenders,
      [],
      "the two packs propose different templates for the same touchpoint, and only one can end " +
        `up bound:\n  ${offenders.join("\n  ")}`,
    );
  });

  test("every UTILITY rewrite is a variant name, never a reuse of the SOP name", () => {
    /**
     * The rule that makes the above safe, asserted directly. The utility pack's own header says
     * its bodies are "the UTILITY rewrites" - a different body for the same message - and Meta
     * approves ONE body per (name, language). Six of them shared the SOP pack's names on
     * 26 Oct 2026, which made the two documents competing submissions: whichever was sent
     * second silently replaced the first, and which body a prospect read came down to which
     * .docx somebody happened to open.
     */
    const sopNames = new Set(sopPack().map((t) => t.name));
    const offenders = utilityPack()
      .filter((t) => sopNames.has(t.name))
      .filter((t) => {
        // Reuse across two touchpoints is allowed where it is written down and argued - see
        // SHARED_ON_PURPOSE. What this test is really about is the CATEGORY and the BODY, so a
        // listed name is judged on category alone.
        const mirror = sopPack().find((x) => x.name === t.name)!;
        if (SHARED_ON_PURPOSE[t.name]) return mirror.category !== t.category;
        // Otherwise sharing a name is only OK when both packs mean the identical template.
        // True of b2_sop_intro and b2_sop_followup_not_booked, which the utility pack carries
        // unchanged rather than rewriting.
        return mirror.category !== t.category || mirror.kind !== t.kind;
      })
      .map((t) => t.name);

    assert.deepEqual(
      offenders,
      [],
      `these reuse an SOP template name for a different template - give them a _u suffix:\n  ${offenders.join("\n  ")}`,
    );
  });
});

import test from "node:test";
import assert from "node:assert/strict";
import { LEAD_STAGE_LABELS, LEAD_STAGE_LABEL_ORDER, COLUMN_OWNING_STAGES } from "../labels";
import { SYNAMATE_STAGES, boardColumnFor, columnStageFor } from "../pipeline-stages";
import { LEAD_STAGE_OPTIONS } from "../automation-types";
import { STAGE_LABELS_SHORT } from "../gamification";

/**
 * The board column names the stage.
 *
 * This file exists because that rule was broken three ways at once: the board said
 * "Pre-Qualified & Confirmed", `LEAD_STAGE_LABELS` said "DISCO Call booked", and the Contacts
 * filter said "Disco Booked" - all for one enum value. Two of those names then sat next to each
 * other in the board's own lead-stage picker, and nobody could say what the difference was.
 *
 * Prose in a comment did not hold the line, so this does.
 */

/** Every lifecycle stage the labels map claims to cover. */
const STAGES = Object.keys(LEAD_STAGE_LABELS);

/** The board column a stage's cards are filed into, by name. */
function columnNameFor(stage: string): string | null {
  const col = boardColumnFor(stage as never, null);
  return SYNAMATE_STAGES.find((s) => s.legacyStage === col.legacyStage)?.name ?? null;
}

/**
 * The three stages with no column of their own. Each is named after the column it FOLDS INTO,
 * plus the word that tells it apart from the stage that owns that column.
 *
 * Listed explicitly rather than derived, so adding a fourth is a deliberate act with a test
 * change attached rather than something that slips through.
 */
const SHARES_A_COLUMN: Record<string, string> = {
  DISCO_NOT_BOOKED: "never booked",
  DISCO_COMPLETED: "call done",
  PROPOSAL_SENT: "awaiting decision",
};

/**
 * The one stage with TWO columns - "Split Pay" and "Full pay", told apart by `Lead.paymentPlan`.
 * There is no single column name to take, so the lifecycle name stands.
 */
const TWO_COLUMNS = new Set(["WON"]);

test("every stage that owns a column is labelled with that column's exact name", () => {
  for (const stage of STAGES) {
    if (TWO_COLUMNS.has(stage) || stage in SHARES_A_COLUMN) continue;
    const column = columnNameFor(stage);
    assert.ok(column, `${stage} maps to no board column at all`);
    assert.equal(
      LEAD_STAGE_LABELS[stage],
      column,
      `${stage} is labelled "${LEAD_STAGE_LABELS[stage]}" but its column is "${column}"`,
    );
  }
});

test("a stage sharing a column is its column's name plus one distinguishing word", () => {
  for (const [stage, suffix] of Object.entries(SHARES_A_COLUMN)) {
    const column = columnNameFor(stage);
    assert.equal(
      LEAD_STAGE_LABELS[stage],
      `${column} - ${suffix}`,
      `${stage} should read as its column plus "${suffix}"`,
    );
  }
});

test("no two stages share a label", () => {
  // The whole reason the three suffixes exist. Without this, the stage-distribution chart and
  // every stage filter would show identical rows the reader cannot tell apart.
  const seen = new Map<string, string>();
  for (const [stage, label] of Object.entries(LEAD_STAGE_LABELS)) {
    const clash = seen.get(label);
    assert.equal(clash, undefined, `${stage} and ${clash} are both labelled "${label}"`);
    seen.set(label, stage);
  }
});

test("the label order has one entry per stage and no duplicates", () => {
  // LEAD_STAGE_LABEL_ORDER is Object.values(LEAD_STAGE_LABELS), and it drives DataTable sorting
  // and CSV export. A duplicate there silently collapses two funnel positions into one.
  assert.equal(LEAD_STAGE_LABEL_ORDER.length, STAGES.length);
  assert.equal(new Set(LEAD_STAGE_LABEL_ORDER).size, STAGES.length);
});

test("COLUMN_OWNING_STAGES is exactly the stages a column can be mapped to", () => {
  // `columnStageFor(s) === s` IS the definition of owning a column: the other three are
  // redirected elsewhere, so a column mapped to one of them never receives a card.
  const owning = STAGES.filter((s) => columnStageFor(s as never) === s).sort();
  assert.deepEqual([...COLUMN_OWNING_STAGES].sort(), owning);
});

test("the three column-less stages are excluded from the mapping picker", () => {
  for (const stage of Object.keys(SHARES_A_COLUMN)) {
    assert.ok(
      !COLUMN_OWNING_STAGES.includes(stage),
      `${stage} has no column of its own and must not be offered as a column mapping`,
    );
  }
});

test("every board column's stage is labelled", () => {
  // A column bridged to a stage with no label renders its raw enum constant to the user.
  for (const col of SYNAMATE_STAGES) {
    assert.ok(LEAD_STAGE_LABELS[col.legacyStage], `column "${col.name}" has an unlabelled stage`);
  }
});

test("the two stages that started this no longer read as the same thing", () => {
  // The founder's report: "Discovery Call Booked" and "DISCO Call booked" sat next to each other
  // in one dropdown. They are different funnel points and must now read as different columns.
  assert.equal(LEAD_STAGE_LABELS.STRATEGY_CALL_BOOKED, "Discovery Call Booked");
  assert.equal(LEAD_STAGE_LABELS.DISCO_BOOKED, "Pre-Qualified & Confirmed");
  assert.notEqual(
    LEAD_STAGE_LABELS.STRATEGY_CALL_BOOKED.toLowerCase(),
    LEAD_STAGE_LABELS.DISCO_BOOKED.toLowerCase(),
  );
});

// ─────────────── one vocabulary, everywhere it is offered ───────────────

/**
 * There were FIVE lists of stage names in this codebase, and they disagreed.
 *
 *   lib/labels.ts            "DISCO Call booked"
 *   lib/pipeline-stages.ts   "Pre-Qualified & Confirmed"     (the board)
 *   ContactsFilterBar        "Disco Booked"
 *   lib/automation-types.ts  "Discovery Booked", patched by hand to the board name
 *   lib/gamification.ts      "Discovery call booked"
 *
 * Five names for one enum value, and a person configuring an automation or reading a scoreboard
 * had no way to tell which board column they were looking at. The two that remain as exported
 * lists now derive from LEAD_STAGE_LABELS; these tests are what stop someone re-typing them.
 */

test("the automation stage picker offers the same names as everywhere else", () => {
  assert.deepEqual(
    LEAD_STAGE_OPTIONS.map((o) => [o.value, o.label]),
    Object.entries(LEAD_STAGE_LABELS),
  );
});

test("the Arena and XP console name stages the same way the board does", () => {
  for (const [stage, label] of Object.entries(LEAD_STAGE_LABELS)) {
    assert.equal(STAGE_LABELS_SHORT[stage], label, `${stage} is named differently on the scoreboard`);
  }
});

test("no stage list renders a raw enum constant", () => {
  // The `?? stage` fallbacks at the call sites are a safety net, not a design. If one of them
  // ever fires the user sees "DEPOSIT_FOLLOWUP" on screen.
  for (const stage of STAGES) {
    assert.ok(LEAD_STAGE_LABELS[stage], `${stage} has no label`);
    assert.ok(STAGE_LABELS_SHORT[stage], `${stage} has no scoreboard label`);
    assert.ok(
      LEAD_STAGE_OPTIONS.some((o) => o.value === stage),
      `${stage} cannot be picked in an automation`,
    );
  }
});

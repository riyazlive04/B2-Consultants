import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  deriveIncomeForm, emptyDraft, nameKey,
  type IncomeFormCatalogues, type IncomeFormDraft, type IncomeFormEditing, type OpenPlan,
} from "../income-form";
import { DEFAULT_INSTALMENT_PLAN_CONFIG, DEFAULT_PAYMENT_TYPES_CONFIG } from "../config-schema";

const TODAY = "2026-10-07";

/**
 * A catalogue shaped like the real one: two businesses, three levels each side, so every
 * narrowing and coercion rule has something to narrow and coerce.
 */
const CAT: IncomeFormCatalogues = {
  levelOptions: [
    { value: "GUIDED", label: "Guided" },
    { value: "SELF_PACED", label: "Self paced" },
    { value: "GN_A1", label: "GN A1" },
    { value: "GN_A2", label: "GN A2" },
  ],
  levelLines: {
    GUIDED: "B2",
    SELF_PACED: "B2",
    GN_A1: "GERMAN_NOTE",
    GN_A2: "GERMAN_NOTE",
  },
  paymentTypes: DEFAULT_PAYMENT_TYPES_CONFIG,
  instalmentPlans: DEFAULT_INSTALMENT_PLAN_CONFIG,
  studentOptions: [
    { value: "s1", label: "Anna Smith" },
    { value: "s2", label: "Riyaz Khan" },
  ],
  openPlans: [],
  nextStudentCodes: { B2: "B2-0004", GERMAN_NOTE: "GN-0002" },
  today: TODAY,
};

const draft = (over: Partial<IncomeFormDraft> = {}): IncomeFormDraft => ({
  ...emptyDraft(TODAY),
  ...over,
});

const cat = (over: Partial<IncomeFormCatalogues> = {}): IncomeFormCatalogues => ({ ...CAT, ...over });

const derive = (
  d: Partial<IncomeFormDraft> = {},
  editing: IncomeFormEditing = null,
  c: Partial<IncomeFormCatalogues> = {},
) => deriveIncomeForm(draft(d), editing, cat(c));

const plan = (over: Partial<OpenPlan> = {}): OpenPlan => ({
  id: "p1",
  studentId: "s1",
  studentName: "Anna Smith",
  programLevel: "GUIDED",
  levelLabel: "Guided",
  balanceInr: 1_000_000,
  nextDueDate: "2026-11-01",
  ...over,
});

const EDITING: NonNullable<IncomeFormEditing> = {
  id: "i1",
  date: "2026-01-16T00:00:00.000Z",
  studentName: "Riyaz Khan",
  studentId: "s2",
  programLevel: "GN_A2",
  paymentType: "INSTALMENT",
  paymentMethod: "BANK_TRANSFER_EUR",
  pendingPaymentId: "p9",
  instalmentCount: 4,
  recurrenceInterval: null,
  recurrenceNextDate: null,
};

// ════════════════════════════════════════════════════════════════════════════════════
describe("the business narrows the levels, and the level decides the book", () => {
  test("a fresh form offers only B2 levels and defaults to the first", () => {
    const d = derive();
    assert.equal(d.line, "B2");
    assert.deepEqual(d.lineLevelOptions.map((o) => o.value), ["GUIDED", "SELF_PACED"]);
    assert.equal(d.programLevel, "GUIDED");
    assert.equal(d.entryLine, "B2");
    assert.equal(d.lineLabel, "B2");
  });

  test("switching business COERCES a level the new business does not sell", () => {
    // The bug this prevents: the select goes on showing "Guided" against a German Note list that
    // does not contain it, and submits a B2 level while the form says German Note.
    const d = derive({ businessLine: "GERMAN_NOTE", programLevel: "GUIDED" });
    assert.equal(d.programLevel, "GN_A1", "falls back to the first level this business sells");
    assert.equal(d.entryLine, "GERMAN_NOTE", "so the money credits the book on screen");
  });

  test("a level the business DOES sell survives the switch", () => {
    const d = derive({ businessLine: "GERMAN_NOTE", programLevel: "GN_A2" });
    assert.equal(d.programLevel, "GN_A2");
  });

  test("a business with no active level posts nothing rather than the other book's level", () => {
    const d = derive({ businessLine: "GERMAN_NOTE" }, null, {
      levelOptions: [{ value: "GUIDED", label: "Guided" }],
      levelLines: { GUIDED: "B2" },
    });
    assert.deepEqual(d.lineLevelOptions, []);
    assert.equal(d.programLevel, "", "the field says so; it does not guess");
  });

  test("editing a row adopts that row's business and level", () => {
    const d = derive({}, EDITING);
    assert.equal(d.line, "GERMAN_NOTE");
    assert.equal(d.programLevel, "GN_A2");
    assert.equal(d.entryLine, "GERMAN_NOTE");
  });

  test("an answer given on the form beats the row being edited", () => {
    const d = derive({ businessLine: "B2" }, EDITING);
    assert.equal(d.line, "B2");
    assert.equal(d.programLevel, "GUIDED", "coerced into B2's own list");
  });

  test("the student number follows the LEVEL's business, not the switch", () => {
    assert.equal(derive().suggestedCode, "B2-0004");
    assert.equal(derive({ businessLine: "GERMAN_NOTE" }).suggestedCode, "GN-0002");
  });
});

// ════════════════════════════════════════════════════════════════════════════════════
describe("the payment type decides which questions are asked", () => {
  test("a full payment asks for no schedule and blocks nothing", () => {
    const d = derive({ paymentType: "FULL_PAYMENT" });
    assert.equal(d.typeKind, "FULL");
    assert.equal(d.needsSchedule, false);
    assert.equal(d.planMode, false);
    assert.equal(d.blockSave, false);
    assert.deepEqual(d.shares, []);
  });

  test("an instalment payment asks for a schedule, and the top box becomes the whole fee", () => {
    const d = derive({ paymentType: "INSTALMENT" });
    assert.equal(d.typeKind, "INSTALMENT");
    assert.equal(d.needsSchedule, true);
    assert.equal(d.planMode, true);
  });

  test("EDITING an instalment row never redraws its schedule", () => {
    // A plan already under way is not something an income edit may silently restate; that
    // belongs in the receivable itself.
    const d = derive({}, EDITING);
    assert.equal(d.typeKind, "INSTALMENT");
    assert.equal(d.needsSchedule, false, "even though the type is INSTALMENT");
    assert.equal(d.blockSave, false, "so an edit is never held back by a schedule it cannot set");
  });

  test("the fee divides into equal instalments, the first of which is banked today", () => {
    const d = derive({
      paymentType: "INSTALMENT",
      instalmentCount: 4,
      fee: { inr: "10000", eur: "" },
      extra: { inr: "", eur: "" },
    });
    assert.equal(d.shares.length, 4);
    assert.equal(d.banked.inr, "2500.00");
  });
});

// ════════════════════════════════════════════════════════════════════════════════════
describe("the save is held back for a reason, and says which", () => {
  test("a plan with no count yet", () => {
    const d = derive({ paymentType: "INSTALMENT" });
    assert.equal(d.blockSave, true);
    assert.match(d.blockSaveReason!, /how many instalments/);
  });

  test("a plan with a count but unfilled dates", () => {
    const d = derive({ paymentType: "INSTALMENT", instalmentCount: 3, scheduleComplete: false });
    assert.equal(d.blockSave, true);
    assert.match(d.blockSaveReason!, /every due date/);
  });

  test("a complete plan saves", () => {
    const d = derive({ paymentType: "INSTALMENT", instalmentCount: 3, scheduleComplete: true });
    assert.equal(d.blockSave, false);
    assert.equal(d.blockSaveReason, null);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════
describe("the method is narrowed to the rails the money could have arrived by", () => {
  test("a rupee amount offers rupee rails and keeps UPI", () => {
    const d = derive({ fee: { inr: "5000", eur: "" } });
    assert.deepEqual(d.feeCurrencies, ["INR"]);
    assert.ok(d.methodOptions.some((o) => o.value === "UPI"));
    assert.equal(d.paymentMethod, "UPI");
  });

  test("typing a euro amount drops UPI, and the chosen method moves with it", () => {
    // The trap: the control goes on showing UPI while its own list no longer contains it, and
    // the form submits a method that is not on screen.
    const d = derive({ fee: { inr: "", eur: "100" }, paymentMethod: "UPI" });
    assert.deepEqual(d.feeCurrencies, ["EUR"]);
    assert.ok(!d.methodOptions.some((o) => o.value === "UPI"), "UPI is no longer offered");
    assert.ok(
      d.methodOptions.some((o) => o.value === d.paymentMethod),
      "and whatever is selected IS one of the options",
    );
  });

  test("both currencies in play offer the methods that serve both", () => {
    const d = derive({ fee: { inr: "5000", eur: "100" } });
    assert.deepEqual(d.feeCurrencies, ["INR", "EUR"]);
    assert.ok(d.methodOptions.length > 0);
    assert.ok(d.methodOptions.some((o) => o.value === d.paymentMethod));
  });

  test("every option carries a label, and the SCREAMING_CASE codes are humanised", () => {
    const d = derive({ fee: { inr: "5000", eur: "" } });
    for (const o of d.methodOptions) {
      assert.ok(o.label.length > 0, `${o.value} has no label`);
      // "UPI" is legitimately its own label; "BANK_TRANSFER_INR" is not.
      if (o.value.includes("_")) {
        assert.ok(!o.label.includes("_"), `${o.value} shows as a raw code`);
      }
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════════════
describe("the plan surcharge is priced from the Console, in the fee's own currency", () => {
  test("a rupee fee gets the rupee price and no euro one", () => {
    const d = derive({
      paymentType: "INSTALMENT",
      instalmentCount: 3,
      fee: { inr: "30000", eur: "" },
    });
    assert.notEqual(d.extraDefaults.inr, "", "the Console prices a 3-instalment plan");
    assert.equal(d.extraDefaults.eur, "", "a rupee surcharge beside a euro fee would be ADDED to it");
  });

  test("no plan length, no price", () => {
    const d = derive({ paymentType: "INSTALMENT", fee: { inr: "30000", eur: "" } });
    assert.equal(d.extraDefaults.inr, "");
  });

  test("the surcharge box re-keys on length and currency, and on nothing else", () => {
    const base = { paymentType: "INSTALMENT", instalmentCount: 3, fee: { inr: "30000", eur: "" } };
    const a = derive(base).extraKey;
    // Typing more digits into the fee must NOT remount the box - it would fight the typist.
    assert.equal(derive({ ...base, fee: { inr: "300000", eur: "" } }).extraKey, a);
    // Changing the length, or the currency, must.
    assert.notEqual(derive({ ...base, instalmentCount: 6 }).extraKey, a);
    assert.notEqual(derive({ ...base, fee: { inr: "", eur: "400" } }).extraKey, a);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════
describe("which receivable this payment settles (FIN-12)", () => {
  test("no plans for this payer means no plan named", () => {
    const d = derive({ student: { text: "Anna Smith", value: "s1" } });
    assert.deepEqual(d.plansForPayer, []);
    assert.equal(d.pendingPaymentId, "");
  });

  test("a LONE open plan is adopted - the only inference kept", () => {
    const d = derive({ student: { text: "Anna Smith", value: "s1" } }, null, {
      openPlans: [plan()],
    });
    assert.equal(d.pendingPaymentId, "p1");
  });

  test("TWO plans assume nothing - this is the ambiguity that broke the old matching", () => {
    const d = derive({ student: { text: "Anna Smith", value: "s1" } }, null, {
      openPlans: [plan({ id: "p1" }), plan({ id: "p2", programLevel: "GN_A1", levelLabel: "GN A1" })],
    });
    assert.equal(d.plansForPayer.length, 2);
    assert.equal(d.pendingPaymentId, "", "the person recording it decides");
  });

  test("an explicit choice of none beats the lone-plan default", () => {
    const d = derive({ student: { text: "Anna Smith", value: "s1" }, pendingPaymentId: "" }, null, {
      openPlans: [plan()],
    });
    assert.equal(d.pendingPaymentId, "", "\"not against a specific plan\" is a real answer");
  });

  test("plans are matched by student ID when one was picked", () => {
    const d = derive({ student: { text: "Anna Smith", value: "s1" } }, null, {
      openPlans: [plan({ id: "mine", studentId: "s1" }), plan({ id: "theirs", studentId: "s2" })],
    });
    assert.deepEqual(d.plansForPayer.map((p) => p.id), ["mine"]);
  });

  test("an unlinked plan is matched by name, case and spacing ignored", () => {
    const d = derive({ student: { text: "  anna   smith ", value: "" } }, null, {
      openPlans: [plan({ id: "byname", studentId: null, studentName: "Anna Smith" })],
    });
    assert.deepEqual(d.plansForPayer.map((p) => p.id), ["byname"]);
  });

  test("a NAME never reaches an ID-linked plan", () => {
    // Two students sharing a name is exactly the ambiguity the student code exists to settle.
    const d = derive({ student: { text: "Anna Smith", value: "" } }, null, {
      openPlans: [plan({ id: "linked", studentId: "s1", studentName: "Anna Smith" })],
    });
    assert.deepEqual(d.plansForPayer, []);
  });

  test("plans are NOT narrowed by level - a payment may settle any of the payer's plans", () => {
    const d = derive({ student: { text: "Anna Smith", value: "s1" }, programLevel: "GUIDED" }, null, {
      openPlans: [plan({ id: "a1", programLevel: "GN_A1", levelLabel: "GN A1" })],
    });
    assert.equal(d.plansForPayer.length, 1, "refusing to show it is how the old matching gave up");
  });

  test("the options always lead with an explicit \"none\"", () => {
    const d = derive({ student: { text: "Anna Smith", value: "s1" } }, null, { openPlans: [plan()] });
    assert.equal(d.planOptions[0].value, "");
    assert.match(d.planOptions[0].label, /Not against a specific plan/);
  });

  test("each option names the balance and the due date, not just the level", () => {
    // With two plans open, "GN A1" and "Guided" alone do not say which one the money is for.
    const d = derive({ student: { text: "Anna Smith", value: "s1" } }, null, {
      openPlans: [plan({ balanceInr: 1_250_000, nextDueDate: "2026-11-01" })],
    });
    assert.match(d.planOptions[1].label, /Guided/);
    assert.match(d.planOptions[1].label, /12,500/, "the balance, grouped the Indian way");
    assert.match(d.planOptions[1].label, /01\/11\/2026/, "and when it falls due");
  });

  test("a plan with no due date still labels cleanly", () => {
    const d = derive({ student: { text: "Anna Smith", value: "s1" } }, null, {
      openPlans: [plan({ nextDueDate: null })],
    });
    assert.ok(!d.planOptions[1].label.includes("due"));
    assert.match(d.planOptions[1].label, /left$/);
  });

  test("editing a row keeps the plan it was already credited to", () => {
    const d = derive({}, EDITING);
    assert.equal(d.pendingPaymentId, "p9");
  });
});

// ════════════════════════════════════════════════════════════════════════════════════
describe("a name that matches nobody is a student waiting to be created", () => {
  test("an unknown typed name is offered for minting", () => {
    const d = derive({ student: { text: "Brand New", value: "" } });
    assert.equal(d.newStudentName, "Brand New");
  });

  test("a name picked from the roster is not", () => {
    const d = derive({ student: { text: "Anna Smith", value: "s1" } });
    assert.equal(d.newStudentName, "");
  });

  test("a typed name that MATCHES the roster is not, whatever its case", () => {
    const d = derive({ student: { text: "anna  smith", value: "" } });
    assert.equal(d.newStudentName, "");
  });

  test("a payer known only by name from an old payment IS still offered", () => {
    // The one that still needs a record is exactly the name that is merely familiar. Tested
    // against studentOptions alone, never against the payer list.
    const d = derive({ student: { text: "Old Payer", value: "" } }, null, {
      studentOptions: [{ value: "s1", label: "Anna Smith" }],
    });
    assert.equal(d.newStudentName, "Old Payer");
  });

  test("whitespace alone is not a name", () => {
    assert.equal(derive({ student: { text: "   ", value: "" } }).newStudentName, "");
  });
});

// ════════════════════════════════════════════════════════════════════════════════════
describe("the draft is the only thing that carries over - the reset footgun", () => {
  test("a fresh draft derives the DEFAULTS, never the last entry's answers", () => {
    // This is the whole point of collapsing eighteen useState hooks into one object: there is
    // one thing to reset, so an answer cannot survive into the next entry because somebody
    // forgot a setter at one of two reset sites.
    const after = deriveIncomeForm(emptyDraft(TODAY), null, CAT);
    assert.equal(after.paymentType, "FULL_PAYMENT");
    assert.equal(after.programLevel, "GUIDED");
    assert.equal(after.pendingPaymentId, "");
    assert.deepEqual(after.shares, [], "no half-divided plan survives into the next entry");
    assert.equal(emptyDraft(TODAY).instalmentCount, null);
    assert.deepEqual(emptyDraft(TODAY).fee, { inr: "", eur: "" });
    assert.equal(emptyDraft(TODAY).scheduleComplete, false);
    assert.equal(after.date, TODAY);
  });

  test("every derived answer is a function of the draft alone, for a given catalogue", () => {
    const d = draft({ businessLine: "GERMAN_NOTE", programLevel: "GN_A2", paymentType: "INSTALMENT" });
    assert.deepEqual(deriveIncomeForm(d, null, CAT), deriveIncomeForm(d, null, CAT));
  });

  test("the date falls back to the edited row, then to today", () => {
    assert.equal(derive({ date: null }).date, TODAY);
    assert.equal(derive({ date: null }, EDITING).date, "2026-01-16");
    assert.equal(derive({ date: "2026-05-05" }, EDITING).date, "2026-05-05");
  });
});

describe("nameKey pairs the way the server pairs", () => {
  test("case and repeated whitespace fold", () => {
    assert.equal(nameKey("  Anna   SMITH "), "anna smith");
  });
  test("two different people stay different", () => {
    assert.notEqual(nameKey("Anna Smith"), nameKey("Anna Smyth"));
  });
});

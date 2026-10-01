import test from "node:test";
import assert from "node:assert/strict";
import { planEmailUpdate } from "../lead-emails";

/**
 * The cost of getting this wrong is silence: every email we send goes to a mailbox the prospect
 * has stopped reading, with no bounce and no log line. So the cases below are mostly about what
 * must NOT happen - losing an address, clearing one, or moving one on a form that never asked.
 */

test("a new address typed today becomes the one we write to", () => {
  const plan = planEmailUpdate({ currentPrimary: "old@college.edu", submitted: "new@work.com" });
  assert.equal(plan.primary, "new@work.com");
  assert.equal(plan.changed, true);
});

test("the address it displaces is kept, not lost", () => {
  const plan = planEmailUpdate({ currentPrimary: "old@college.edu", submitted: "new@work.com" });
  assert.deepEqual(plan.record, ["new@work.com", "old@college.edu"]);
});

test("an address already on file is not recorded twice", () => {
  // They came back on the address they started with. Nothing new to write down.
  const plan = planEmailUpdate({
    currentPrimary: "new@work.com",
    submitted: "old@college.edu",
    known: ["old@college.edu", "new@work.com"],
  });
  assert.equal(plan.primary, "old@college.edu");
  assert.deepEqual(plan.record, []);
  assert.equal(plan.changed, true);
});

test("the same mailbox in different case or spacing moves nothing", () => {
  const plan = planEmailUpdate({ currentPrimary: "Anna@Work.com", submitted: "  anna@work.com " });
  assert.equal(plan.primary, "Anna@Work.com"); // the stored spelling is left exactly as it is
  assert.equal(plan.changed, false);
});

test("a first address is recorded without counting as a change", () => {
  // Nothing was displaced, so there is no address-changed event to report to the desk.
  const plan = planEmailUpdate({ currentPrimary: null, submitted: "first@work.com" });
  assert.equal(plan.primary, "first@work.com");
  assert.deepEqual(plan.record, ["first@work.com"]);
  assert.equal(plan.changed, false);
});

test("a blank submission never clears the address we have", () => {
  // A form that does not ask for an email must not make someone unreachable.
  for (const blank of ["", "   ", null, undefined]) {
    const plan = planEmailUpdate({ currentPrimary: "anna@work.com", submitted: blank });
    assert.equal(plan.primary, "anna@work.com");
    assert.deepEqual(plan.record, []);
    assert.equal(plan.changed, false);
  }
});

test("no address anywhere stays no address", () => {
  const plan = planEmailUpdate({ currentPrimary: null, submitted: null });
  assert.equal(plan.primary, null);
  assert.deepEqual(plan.record, []);
  assert.equal(plan.changed, false);
});

test("aliasing is NOT folded - a dot is a different mailbox outside Gmail", () => {
  // Same reasoning as normalizeEmail: folding would cross one prospect onto another's record.
  const plan = planEmailUpdate({ currentPrimary: "a.b@yahoo.com", submitted: "ab@yahoo.com" });
  assert.equal(plan.primary, "ab@yahoo.com");
  assert.equal(plan.changed, true);
});

test("the third address keeps both earlier ones on file", () => {
  const plan = planEmailUpdate({
    currentPrimary: "second@work.com",
    submitted: "third@new.com",
    known: ["first@college.edu", "second@work.com"],
  });
  assert.equal(plan.primary, "third@new.com");
  assert.deepEqual(plan.record, ["third@new.com"]); // second is already on file
});

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * EVERY DEAD END NOW OFFERS A WAY OUT (refactor step E3).
 *
 * The count on 23 Oct 2026 (docs/refactor/01-inventory.md §5.4): of 64 `EmptyState` usages, 11
 * carried an `action` and 53 did not. Most of the 53 are fine - "No overdue balances" and "Your
 * queue is clear" are good news, and a button on them would be noise. About twenty were setup
 * dead ends: the screen needed something doing, said so in prose, and offered no way to do it.
 * The worst example is the one that started this refactor - a cohort's Roster tab reading "seat
 * students into this cohort from the Students board", which was both un-clickable and wrong
 * about where the control lived.
 *
 * ── What this test is, and is not ───────────────────────────────────────────────────────
 * It is a SOURCE scan, not a render test. There is no DOM here and these are deep inside client
 * components with their own state, so asserting on the file is what is actually available - and
 * it is enough, because the regression being guarded is somebody deleting the `action` prop.
 *
 * It is NOT a rule that every empty state must act. The second list below names the ones left
 * deliberately alone and says why for each, so the decision is written down rather than
 * rediscovered.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..", "..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");

/**
 * The slice of a file holding one `EmptyState` element, found by its title.
 *
 * Scans from the title back to the opening tag and forward to the matching close, so an `action`
 * belonging to a DIFFERENT element further down the file can never be mistaken for this one's.
 */
function emptyStateAround(src: string, title: string): string {
  const at = src.indexOf(title);
  assert.notEqual(at, -1, `no empty state titled ${title}`);
  const open = src.lastIndexOf("<EmptyState", at);
  assert.notEqual(open, -1, `${title} is not inside an <EmptyState`);
  // Self-closing (`/>`) in every current caller; `</EmptyState>` is handled for safety.
  const selfClose = src.indexOf("/>", at);
  const pairClose = src.indexOf("</EmptyState>", at);
  const end = pairClose === -1 ? selfClose : Math.min(selfClose === -1 ? Infinity : selfClose, pairClose);
  assert.ok(Number.isFinite(end) && end > open, `${title}'s element does not close`);
  return src.slice(open, end);
}

/** file → the empty-state titles in it that MUST carry an `action`. */
const MUST_ACT: Record<string, string[]> = {
  "components/batches/BatchesManager.tsx": ["No batches yet", "No programmes to run a batch for"],
  "components/batches/TimetablePanel.tsx": ["No timetable yet"],
  "components/curriculum/CurriculumPanel.tsx": ["No curriculum yet", "No sessions yet"],
  "app/(app)/payments/_components/ProductsTab.tsx": ["Nothing priced yet"],
  "app/(app)/payments/_components/SubscriptionsTab.tsx": ["No subscriptions"],
  "app/(app)/contacts/_components/CustomFieldsPanel.tsx": ["No custom fields"],
  "app/(app)/conversations/_components/TemplatesPanel.tsx": ["No templates"],
  "app/(app)/conversations/_components/Inbox.tsx": ["No conversations yet"],
  "app/(app)/sites/_components/SitesList.tsx": ["No website yet"],
  "app/(app)/sites/[id]/_components/SiteEditor.tsx": ["No pages yet"],
  "app/(app)/_components/GermanNoteDashboard.tsx": ["No workshops yet"],
  "app/(app)/arena/_components/ArenaClient.tsx": ["No quests are configured"],
  "app/(app)/my-desk/page.tsx": ["No team profile linked to your login"],
};

/**
 * Left alone on purpose. Each of these is a WAITING state, not a dead end: the thing that fills
 * the screen is somebody else's to do, and the reader cannot be handed a button for it.
 *
 * A coach cannot assign themselves a cohort; a student cannot publish their own timetable. The
 * honest empty state there says who will act and moves on - a button that only explained itself
 * would be worse than the sentence already present. The Arena's own emptiness is in the same
 * class and says so in its body: XP is derived from work logged elsewhere, so there is nothing
 * to enter there at all.
 */
const DELIBERATELY_TERMINAL: Record<string, string[]> = {
  "app/(app)/coaching/page.tsx": ["No cohorts yet", "No students assigned to you"],
  "app/(app)/attendance/_components/AttendanceDesk.tsx": ["No cohort assigned to you"],
  "app/(app)/classroom/_components/ClassroomTimetable.tsx": ["No classes scheduled yet"],
  "app/(app)/arena/_components/ArenaClient.tsx": ["The Arena is empty"],
};

describe("empty states - the setup dead ends offer the next step", () => {
  for (const [file, titles] of Object.entries(MUST_ACT)) {
    for (const title of titles) {
      test(`${title} (${file})`, () => {
        const block = emptyStateAround(read(file), title);
        assert.match(
          block,
          /\baction=/,
          `"${title}" needs something to do - it is a setup step, not good news`,
        );
      });
    }
  }
});

describe("empty states - the waiting states are left alone, on purpose", () => {
  for (const [file, titles] of Object.entries(DELIBERATELY_TERMINAL)) {
    for (const title of titles) {
      test(`${title} (${file}) still explains who acts, without a button`, () => {
        const block = emptyStateAround(read(file), title);
        // `body` is what carries "your coach will publish this" - without it the screen is just
        // blank, which is the failure whether or not there is a button.
        assert.match(block, /\bbody=/, `"${title}" says nothing about why it is empty`);
      });
    }
  }
});

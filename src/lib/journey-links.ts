import type { JourneyTarget } from "./journey-state";

/**
 * WHERE EACH NEXT ACTION ACTUALLY HAPPENS.
 *
 * `journey-state.ts` decides WHICH action is next and deliberately holds no route strings - the
 * rule is pure and should not have to be kept in step with the sitemap. This file is the other
 * half: one place that turns a target plus the ids we hold into a link.
 *
 * It lives in `lib` rather than beside the rail because the board, the rail on both person pages
 * and the wizard all need the same answer, and three copies of a URL table is how a link quietly
 * starts pointing at a screen that no longer does the job. Which is the failure this whole piece
 * of work exists to fix: the cohort's Roster tab used to tell people to go to a board that had no
 * seating control on it.
 *
 * ── Every route here was checked against the code ───────────────────────────────────────
 * Tab indices are real: `Tabs` takes `urlKey="tab"` and a NUMBER, so `?tab=2` is the third tab.
 *   · /pipeline      0 Board · 1 Leads · 2 Discovery call outcomes · 3 Aging · 4 Archived
 *   · /batches       0 Coaching cohorts · 1 German Note cohorts · 2 Plans
 *   · /batches/:id   0 Timetable · 1 Resources · 2 Roster
 * Returns null when there is genuinely nowhere to send someone, so callers render plain text
 * rather than a link to "#".
 */

export type JourneyIds = {
  leadId?: string | null;
  studentId?: string | null;
  agreementId?: string | null;
  batchId?: string | null;
};

export function journeyHref(target: JourneyTarget, ids: JourneyIds): string | null {
  switch (target) {
    // The contact record is where a call or a note is logged against a person.
    case "LOG_CONTACT":
      return ids.leadId ? `/contacts/${ids.leadId}` : null;

    // The whole-team calendar. Booking is not per-person-addressable, so this is the screen.
    case "BOOK_CALL":
      return "/bookings";

    case "RECORD_OUTCOME":
      return "/pipeline?tab=2";

    // The deal board, which is what the "Pipeline" nav item lands on today.
    case "MOVE_DEAL":
      return "/opportunities";

    /*
      Drafting is a picker on /agreements/new rather than a per-lead route - there is no
      /agreements/new?lead=<id>, so sending a `leadId` would be inventing a parameter.
    */
    case "SEND_AGREEMENT":
      return "/agreements/new";

    case "AWAIT_SIGNATURE":
      return ids.agreementId ? `/agreements/${ids.agreementId}` : "/agreements";

    /*
      Enrolling happens on the signed agreement - that is where `EnrolPrompt` lives, and it is
      the one handoff in the app that already named its next steps properly. Without an
      agreement id (a walk-in, or a student the income form minted) the student record is where
      the enrolment is added instead.
    */
    case "ENROL":
      if (ids.agreementId) return `/agreements/${ids.agreementId}`;
      return ids.studentId ? `/students/${ids.studentId}` : "/students";

    case "SET_PROGRAMME_LEVEL":
    case "CREATE_LOGIN":
      return ids.studentId ? `/students/${ids.studentId}` : null;

    // Income and payment plans are both entered from Finance.
    case "TAKE_PAYMENT":
      return "/finance";

    /*
      Seating now has two doors and they are for different moments. With a cohort already chosen,
      its Roster tab is the place - that is the control this project added. Without one, the
      cohort list is where you pick which cohort they should join.
    */
    case "SEAT_IN_COHORT":
      return ids.batchId ? `/batches/${ids.batchId}?tab=2` : "/batches";

    case "READY_COHORT":
      return ids.batchId ? `/batches/${ids.batchId}` : "/batches";

    case "NOTHING":
      return null;
  }
}

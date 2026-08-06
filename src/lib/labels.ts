/** Human labels for every Phase 1 enum - one place, used by forms, tables and CSV. */

export const PROGRAM_LEVEL_LABELS: Record<string, string> = {
  SOLO: "Solo",
  GUIDED: "Guided",
  ELITE: "Elite",
  GN_A1: "GN A1",
  GN_A2: "GN A2",
  GN_B1: "GN B1",
  GN_B2: "GN B2",
  GN_BUNDLE: "GN Bundle",
  OTHER: "Other",
};

export const PAYMENT_TYPE_LABELS: Record<string, string> = {
  FULL_PAYMENT: "Full payment",
  INSTALMENT: "Instalment",
};

/** German Note book-order status (Prisma `BookOrderStatus`). Every enum value has a label, so a
 *  new status can never fall through to a raw string on any screen that reads this. */
export const BOOK_ORDER_STATUS_LABELS: Record<string, string> = {
  DEFERRED: "Held — payment",
  QUOTE_REQUESTED: "Quote requested",
  QUOTED: "Quoted",
  ORDERED: "Ordered",
  PAID: "Paid",
  COURIERED: "Couriered",
  CANCELLED: "Cancelled",
};

export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  BANK_TRANSFER_INR: "Bank transfer (INR)",
  BANK_TRANSFER_EUR: "Bank transfer (EUR)",
  PAYPAL: "PayPal",
  RAZORPAY: "Razorpay",
  CASH: "Cash",
  UPI: "UPI",
  CREDIT_CARD: "Credit Card",
  OTHER: "Other",
};

export const EXPENSE_CATEGORY_LABELS: Record<string, string> = {
  MARKETING: "Marketing (Meta Ads, Google Ads, Influencers)",
  TOOLS_SOFTWARE: "Tools and Software",
  TEAM_SALARIES: "Team Salaries and Commissions",
  CONTENT_CREATION: "Content Creation",
  EVENTS_OFFLINE: "Events and Offline",
  OPERATIONS: "Operations",
  COGS_DIRECT_DELIVERY: "COGS - Direct Delivery Cost",
  OTHER: "Other",
};

/** Which business a cost belongs to (§1.4). SHARED is the default and gets apportioned. */
export const EXPENSE_BUSINESS_LINE_LABELS: Record<string, string> = {
  SHARED: "Shared (split across both)",
  B2: "B2 only",
  GERMAN_NOTE: "German Note only",
};

export const PENDING_STATUS_LABELS: Record<string, string> = {
  ACTIVE: "Active",
  PAID_IN_FULL: "Paid in full",
  OVERDUE: "Overdue",
  DROPPED: "Dropped",
};

// Telecaller bonus/commission payout state
export const PAYOUT_STATUS_LABELS: Record<string, string> = {
  PENDING: "Pending",
  PAID: "Paid",
};

export const LEAD_SOURCE_LABELS: Record<string, string> = {
  INSTAGRAM: "Instagram",
  YOUTUBE: "YouTube",
  LINKEDIN: "LinkedIn",
  WHATSAPP: "WhatsApp",
  REFERRAL: "Referral",
  SUMMIT: "Summit",
  WORKSHOP: "Workshop",
  META_ADS: "Meta Lead Ad",
  LANDING_PAGE: "Landing page",
  GHOSTED_BLUEPRINT: "Ghosted Blueprint",
  OTHER: "Other",
};

// Wave-1 (Synamate in-sourcing) - booking + slot status labels
export const BOOKING_STATUS_LABELS: Record<string, string> = {
  BOOKED: "Booked",
  RESCHEDULED: "Rescheduled",
  CANCELLED: "Cancelled",
  COMPLETED: "Completed",
  NO_SHOW: "No show",
};

export const SLOT_STATUS_LABELS: Record<string, string> = {
  OPEN: "Open",
  BOOKED: "Booked",
  BLOCKED: "Blocked",
};

// A bookable slot "type" is pure display layer - AppointmentSlot has no type/category
// field, just durationMins. Map the two durations the admin can choose between when
// generating slots to a human name; anything else (legacy data) falls back gracefully.
export const SLOT_TYPE_LABELS: Record<number, string> = {
  30: "Discovery Call (30 min)",
  60: "Strategy Session (60 min)",
};

export function slotTypeLabel(durationMins: number): string {
  return SLOT_TYPE_LABELS[durationMins] ?? `${durationMins} min call`;
}

export const SLOT_DURATION_OPTIONS = Object.entries(SLOT_TYPE_LABELS).map(([value, label]) => ({
  value,
  label,
}));

// Where a lead physically originated (the `source` provenance column, distinct from
// the marketing channel in LEAD_SOURCE_LABELS). Used on the lead inbox + bookings view.
export const SOURCE_LABELS: Record<string, string> = {
  MANUAL: "Manual entry",
  SYNAMATE: "Synamate (legacy)",
  RAZORPAY: "Razorpay",
  SHEET: "Sheet import",
  FATHOM: "Fathom",
  BOOKING_FORM: "Booking form",
  META_LEAD_AD: "Meta Lead Ad",
  FLEXIFUNNELS: "FlexiFunnels",
};

/**
 * Lead lifecycle stages, in funnel order.
 *
 * Worded as the live Synamate board words them — we are replacing that tool, and the team reads
 * both during the changeover, so "Offer and didn't buy" must not appear here as "Offer made -
 * didn't buy". The board's twelve columns use the same strings (`lib/pipeline-stages.ts`).
 *
 * NEW_LEAD, WHATSAPP_SENT and STRATEGY_CALL_BOOKED now DO have columns of their own (06/08/2026),
 * so they take the board's exact wording — "Fresh Optins", not "New lead".
 *
 * The remaining DISCO_ and PROPOSAL_SENT labels are still deliberately NOT the board's: those
 * stages have no column (they fold into "Pre-Qualified & Confirmed" and "Offer and didn't buy"),
 * so they keep the precise name the funnel %, commission and radar all describe them by.
 */
export const LEAD_STAGE_LABELS: Record<string, string> = {
  NEW_LEAD: "Fresh Optins",
  WHATSAPP_SENT: "WhatsApp Sent",
  STRATEGY_CALL_BOOKED: "Discovery Call Booked",
  DISCO_BOOKED: "DISCO Call booked",
  DISCO_NOT_BOOKED: "DISCO Call NOT booked",
  DISCO_COMPLETED: "DISCO Call completed",
  SSS_BOOKED: "SSS Call Booked",
  SSS_COMPLETED: "SSS Call Confirmed",
  PROPOSAL_SENT: "Proposal sent",
  SENT_TO_WORKSHOP: "Sent to Workshop",
  WORKSHOP_FOLLOWUP: "Summit Follow Up",
  OFFER_FOLLOWUP: "Offer and didn’t buy",
  DEPOSIT_FOLLOWUP: "No Deposit and follow up",
  DEPOSIT_PAID: "Confirmed Sign Up (With Deposit)",
  WON: "Won",
  LOST: "Cancelled/Unqualified",
  NO_SHOW: "No Shows/Rescheduled",
};

/**
 * Funnel order for a DataTable `order` prop — the LABELS, because a stage column's sort
 * value is its label (it also feeds CSV export and the text filter, both of which want
 * "New lead", not "NEW_LEAD").
 *
 * Derived from LEAD_STAGE_LABELS rather than retyped, so the two can never disagree: the
 * map is already written in funnel order and that order IS the spec. Module-level so the
 * array identity is stable across renders.
 */
export const LEAD_STAGE_LABEL_ORDER: readonly string[] = Object.values(LEAD_STAGE_LABELS);

export const PAYMENT_PLAN_LABELS: Record<string, string> = {
  SPLIT_PAY: "Split pay",
  FULL_PAY: "Full pay",
};

// Weighted BANT recommendation (client thresholds: >3 confirm · 2-3 doubt · <2 cancel)
export const BANT_VERDICT_LABELS: Record<string, string> = {
  CONFIRM: "Confirm call",
  DOUBT: "Go - conversion doubtful",
  CANCEL: "Cancel recommended",
};

export const SPRINT_STATUS_LABELS: Record<string, string> = {
  PENDING: "Pending",
  ACHIEVED: "Achieved",
  MISSED: "Missed",
};

export const CALL_OUTCOME_LABELS: Record<string, string> = {
  QUALIFIED_FOR_SSS: "Qualified for SSS",
  NOT_QUALIFIED_FOR_SSS: "Not qualified for SSS",
  FOLLOW_UP_NEEDED: "Follow up needed",
  NO_SHOW: "No show",
  SENT_TO_WORKSHOP: "Sent to Workshop",
};

// ── Phase 2 ──

export const MILESTONE_LABELS: Record<string, string> = {
  ONBOARDING: "Onboarding",
  RESUME_BUILD: "Resume build",
  LINKEDIN_OPTIMISATION: "LinkedIn optimisation",
  APPLICATIONS: "Applications",
  INTERVIEWS: "Interviews",
  OFFER_RECEIVED: "Offer received",
  COMPLETED: "Completed",
};

export const STUDENT_STATUS_LABELS: Record<string, string> = {
  ACTIVE: "Active",
  COMPLETED: "Completed",
  DROPPED: "Dropped",
  PAUSED: "Paused",
};

export const TEAM_STATUS_LABELS: Record<string, string> = {
  ACTIVE: "Active",
  ON_LEAVE: "On leave",
  INACTIVE: "Inactive",
};

export const TASK_COMPLETION_LABELS: Record<string, string> = {
  YES: "Yes",
  NO: "No",
  PENDING: "Pending",
};

export const OUTCOME_ACHIEVED_LABELS: Record<string, string> = {
  JOB_OFFER_RECEIVED: "Job offer received",
  INTERVIEWS_ONLY: "Interviews only",
  APPLICATIONS_STAGE: "Applications stage",
  NO_OUTCOME_YET: "No outcome yet",
};

export const LOG_VARIANT_LABELS: Record<string, string> = {
  DISCOVERY_SPECIALIST: "Discovery Call Specialist",
  APPOINTMENT_SETTER: "Appointment Setter",
  DELIVERY_COACH: "Program Delivery Coach",
};

export const SIGNAL_LABELS: Record<string, string> = {
  GREEN: "Green",
  AMBER: "Amber",
  RED: "Red",
};

/** Which numeric fields each daily-log variant captures (PRD2 §3.3). */
export const DAILY_LOG_FIELDS: Record<string, Array<[string, string]>> = {
  DISCOVERY_SPECIALIST: [
    ["discoveryCallsCompleted", "Discovery calls completed today"],
    ["highlyQualifiedCalls", "Calls marked Highly Qualified"],
    ["followUpsDone", "Follow-ups done today"],
    ["proposalsSent", "Proposals sent today"],
    ["noShows", "No shows today"],
  ],
  APPOINTMENT_SETTER: [
    ["newLeadsContacted", "New leads contacted today"],
    ["appointmentsSet", "Appointments set today"],
    ["followUpMessagesSent", "Follow-up messages sent"],
    ["leadsAddedToPipeline", "Leads added to pipeline"],
  ],
  DELIVERY_COACH: [
    ["sessionsDelivered", "Sessions delivered today"],
    ["studentsCheckedInOn", "Students checked in on"],
    ["assignmentsReviewed", "Assignments reviewed"],
    ["studentsFlaggedAtRisk", "Students flagged as at risk"],
  ],
};

/** Short labels for rollup tables / CSV headers. */
export const LOG_FIELD_SHORT: Record<string, string> = {
  discoveryCallsCompleted: "Disco calls",
  highlyQualifiedCalls: "HQ calls",
  followUpsDone: "Follow-ups",
  proposalsSent: "Proposals",
  noShows: "No shows",
  newLeadsContacted: "Leads contacted",
  appointmentsSet: "Appointments",
  followUpMessagesSent: "Follow-up msgs",
  leadsAddedToPipeline: "Pipeline adds",
  sessionsDelivered: "Sessions",
  studentsCheckedInOn: "Check-ins",
  assignmentsReviewed: "Assignments",
  studentsFlaggedAtRisk: "At-risk flags",
};

/** Human units for the Daily Log activity chips, e.g. "6 calls", "2 highly qualified". */
export const LOG_FIELD_UNIT: Record<string, string> = {
  discoveryCallsCompleted: "calls",
  highlyQualifiedCalls: "highly qualified",
  followUpsDone: "follow-ups",
  proposalsSent: "proposals",
  noShows: "no-shows",
  newLeadsContacted: "leads",
  appointmentsSet: "appointments",
  followUpMessagesSent: "follow-up messages",
  leadsAddedToPipeline: "pipeline adds",
  sessionsDelivered: "sessions",
  studentsCheckedInOn: "check-ins",
  assignmentsReviewed: "assignments",
  studentsFlaggedAtRisk: "at-risk flags",
};

/** Readable role name per log variant — used to label the person in the team feed. */
export const LOG_VARIANT_LABEL: Record<string, string> = {
  DISCOVERY_SPECIALIST: "Discovery Specialist",
  APPOINTMENT_SETTER: "Appointment Setter",
  DELIVERY_COACH: "Delivery Coach",
};

export function optionsFrom(labels: Record<string, string>) {
  return Object.entries(labels).map(([value, label]) => ({ value, label }));
}

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

export const PENDING_STATUS_LABELS: Record<string, string> = {
  ACTIVE: "Active",
  PAID_IN_FULL: "Paid in full",
  OVERDUE: "Overdue",
  DROPPED: "Dropped",
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

export const LEAD_STAGE_LABELS: Record<string, string> = {
  NEW_LEAD: "New lead",
  DISCO_BOOKED: "DISCO Call booked",
  DISCO_NOT_BOOKED: "DISCO Call NOT booked",
  DISCO_COMPLETED: "DISCO Call completed",
  SSS_BOOKED: "SSS Call booked",
  SSS_COMPLETED: "SSS Call completed",
  PROPOSAL_SENT: "Proposal sent",
  WON: "Won",
  LOST: "Lost",
  NO_SHOW: "No show",
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

export function optionsFrom(labels: Record<string, string>) {
  return Object.entries(labels).map(([value, label]) => ({ value, label }));
}

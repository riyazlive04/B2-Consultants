/** Shared shapes for the Automation engine (Phase 5) — Synamate "Workflows". Isomorphic. */

export type TriggerType =
  | "FORM_SUBMITTED"
  | "TAG_ADDED"
  | "STAGE_CHANGED"
  | "CONTACT_CREATED"
  | "INVOICE_PAID"
  | "BOOKING_CREATED";

export type WorkflowActionType =
  | "SEND_EMAIL"
  | "SEND_SMS"
  | "ADD_TAG"
  | "REMOVE_TAG"
  | "MOVE_STAGE"
  | "CREATE_TASK"
  | "WAIT"
  | "IF_TAG";

export type WorkflowAction = {
  id: string;
  type: WorkflowActionType;
  // SEND_EMAIL / SEND_SMS
  templateId?: string;
  subject?: string;
  body?: string;
  // ADD_TAG / REMOVE_TAG / IF_TAG (the tag being checked)
  tag?: string;
  // MOVE_STAGE (a legacy LeadStage value, write-through)
  stage?: string;
  // CREATE_TASK
  taskTitle?: string;
  taskAssigneeId?: string;
  // WAIT
  waitMinutes?: number;
  // IF_TAG — branch: jump to `thenStep` if the contact currently has `tag`, else `elseStep`.
  // Both are 0-based indexes into the workflow's `actions` array; a value >= actions.length ends
  // the workflow (same as running off the end of the list).
  thenStep?: number;
  elseStep?: number;
};

export type TriggerConfig = {
  formId?: string; // FORM_SUBMITTED — specific form, or empty = any
  tag?: string; // TAG_ADDED — specific tag, or empty = any
  stage?: string; // STAGE_CHANGED — specific LeadStage, or empty = any
};

export const TRIGGER_LABELS: Record<TriggerType, string> = {
  FORM_SUBMITTED: "Form submitted",
  TAG_ADDED: "Tag added",
  STAGE_CHANGED: "Pipeline stage changed",
  CONTACT_CREATED: "Contact created",
  INVOICE_PAID: "Invoice paid",
  BOOKING_CREATED: "Appointment booked",
};

export const ACTION_LABELS: Record<WorkflowActionType, string> = {
  SEND_EMAIL: "Send email",
  SEND_SMS: "Send SMS",
  ADD_TAG: "Add tag",
  REMOVE_TAG: "Remove tag",
  MOVE_STAGE: "Move pipeline stage",
  CREATE_TASK: "Create task",
  WAIT: "Wait",
  IF_TAG: "If contact has tag…",
};

export const LEAD_STAGE_OPTIONS: { value: string; label: string }[] = [
  { value: "NEW_LEAD", label: "New Lead" },
  { value: "DISCO_BOOKED", label: "Discovery Booked" },
  { value: "DISCO_NOT_BOOKED", label: "Discovery Not Booked" },
  { value: "DISCO_COMPLETED", label: "Discovery Completed" },
  { value: "SSS_BOOKED", label: "Strategy Session Booked" },
  { value: "SSS_COMPLETED", label: "Strategy Session Completed" },
  { value: "PROPOSAL_SENT", label: "Proposal Sent" },
  { value: "SENT_TO_WORKSHOP", label: "Sent to Workshop" },
  { value: "WORKSHOP_FOLLOWUP", label: "Workshop Follow-up" },
  { value: "OFFER_FOLLOWUP", label: "Offer Follow-up" },
  { value: "DEPOSIT_FOLLOWUP", label: "Deposit Follow-up" },
  { value: "DEPOSIT_PAID", label: "Deposit Paid" },
  { value: "WON", label: "Won" },
  { value: "LOST", label: "Lost" },
  { value: "NO_SHOW", label: "No Show" },
];

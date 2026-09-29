/** Shared shapes for the Automation engine (Phase 5) - Synamate "Workflows". Isomorphic. */

import { LEAD_STAGE_LABELS } from "./labels";

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
  | "SEND_WHATSAPP"
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
  /**
   * SEND_WHATSAPP - which WATI template slot to send, a `WhatsAppKind` (lib/whatsapp.ts).
   *
   * A KIND, not a template name: the WATI template each kind maps to is chosen in
   * WhatsApp → Settings, so a workflow keeps working when a template is re-approved under a
   * new name, and one place stays authoritative about which template is live.
   *
   * The engine supplies only the variables it can know about a contact (name, and links it can
   * build). A template needing per-booking values - `b2_booking_confirmation` wants slot_time -
   * cannot be filled from a workflow step, and `sendWhatsApp` refuses it as a SKIP with the
   * missing variable named, rather than sending a half-built message.
   */
  whatsappKind?: string;
  // ADD_TAG / REMOVE_TAG / IF_TAG (the tag being checked)
  tag?: string;
  // MOVE_STAGE (a legacy LeadStage value, write-through)
  stage?: string;
  // CREATE_TASK
  taskTitle?: string;
  taskAssigneeId?: string;
  // WAIT
  waitMinutes?: number;
  // IF_TAG - branch: jump to `thenStep` if the contact currently has `tag`, else `elseStep`.
  // Both are 0-based indexes into the workflow's `actions` array; a value >= actions.length ends
  // the workflow (same as running off the end of the list).
  thenStep?: number;
  elseStep?: number;
};

export type TriggerConfig = {
  formId?: string; // FORM_SUBMITTED - specific form, or empty = any
  tag?: string; // TAG_ADDED - specific tag, or empty = any
  stage?: string; // STAGE_CHANGED - specific LeadStage, or empty = any
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
  SEND_WHATSAPP: "Send WhatsApp",
  ADD_TAG: "Add tag",
  REMOVE_TAG: "Remove tag",
  MOVE_STAGE: "Move pipeline stage",
  CREATE_TASK: "Create task",
  WAIT: "Wait",
  IF_TAG: "If contact has tag…",
};

/**
 * The stages an automation trigger or action can name.
 *
 * Derived, not retyped. This list carried its own wording - "Discovery Not Booked", "Strategy
 * Session Booked", "Proposal Sent" - which meant an automation was configured against names that
 * appeared nowhere else in the app, and the person wiring it up had to guess which board column
 * they were actually targeting. One of those names had already collided once: DISCO_BOOKED was
 * hand-patched here off "Discovery Booked" when the column above claimed that name, and nowhere
 * else was corrected. That is the drift this removes.
 */
export const LEAD_STAGE_OPTIONS: { value: string; label: string }[] = Object.entries(
  LEAD_STAGE_LABELS,
).map(([value, label]) => ({ value, label }));

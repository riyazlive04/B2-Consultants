/**
 * Shared shapes for the Synamate Sites parity (Phase 2): Forms + Funnels.
 * These describe the JSON stored on Form.fields / Form.settings / FunnelStep.blocks.
 * Isomorphic — imported from both server (validation, rendering) and client (builders).
 */

// ─────────────────────────── Forms ───────────────────────────

export type FormFieldType =
  | "text" | "email" | "phone" | "textarea" | "select" | "checkbox" | "number";

export type FormField = {
  key: string; // maps to Lead.{name,email,phone,city,industry} if named so; else stored as answer
  label: string;
  type: FormFieldType;
  required?: boolean;
  placeholder?: string;
  options?: string[]; // for select
};

export type FormSettings = {
  submitText: string;
  successMessage: string;
  redirectUrl?: string;
  tag?: string; // tag applied to the created contact
  leadSource: string; // a LeadSource value
  createOpportunity?: boolean;
  pipelineId?: string;
  stageId?: string;
  opportunityValueInr?: string;
};

// Field keys that map onto the Lead/Contact record (vs. free-form answers).
export const CONTACT_FIELD_KEYS = ["name", "email", "phone", "city", "industry"] as const;

export function defaultFormFields(): FormField[] {
  return [
    { key: "name", label: "Full name", type: "text", required: true, placeholder: "Your name" },
    { key: "email", label: "Email", type: "email", required: true, placeholder: "you@example.com" },
    { key: "phone", label: "Phone / WhatsApp", type: "phone", required: true, placeholder: "+91…" },
  ];
}

export function defaultFormSettings(): FormSettings {
  return {
    submitText: "Submit",
    successMessage: "Thanks! We'll be in touch shortly.",
    leadSource: "LANDING_PAGE",
  };
}

// ─────────────────────────── Funnel page blocks ───────────────────────────

export type BlockType =
  | "heading" | "subheading" | "text" | "image" | "button" | "bullets"
  | "divider" | "spacer" | "video" | "form" | "row";

export type Block = {
  id: string;
  type: BlockType;
  text?: string;
  align?: "left" | "center" | "right";
  url?: string; // image src / video embed url
  alt?: string;
  label?: string; // button label
  href?: string; // button target
  variant?: "primary" | "soft" | "outline"; // button style
  items?: string[]; // bullets
  size?: number; // spacer height (px)
  formId?: string; // embedded form
  columns?: Block[][]; // "row" layout container — 2 (or more) columns, each a nested block list
};

export function blockLabel(type: BlockType): string {
  const map: Record<BlockType, string> = {
    heading: "Heading", subheading: "Subheading", text: "Paragraph", image: "Image",
    button: "Button / CTA", bullets: "Bullet list", divider: "Divider", spacer: "Spacer",
    video: "Video embed", form: "Form embed", row: "Row (2 columns)",
  };
  return map[type];
}

export function slugify(input: string): string {
  return input.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "untitled";
}

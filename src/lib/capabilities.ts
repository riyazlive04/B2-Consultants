/**
 * Capabilities - what a person may DO, as distinct from what they may SEE.
 *
 * Sections (sections.ts) answer "which screens open for you". Capabilities answer
 * "which privileged writes are you allowed to make once you're there". The two are
 * deliberately separate: a Head coach can be given the Finance screen to read the
 * numbers without being able to post to the ledger.
 *
 * The catalogue is code, not config: each key is enforced by a real guard in a real
 * server action (see `capabilityCheck` in rbac.ts). Inventing a key here without
 * wiring the guard would hand out a permission that means nothing, so the two are
 * written together and the `actions` note below says where each one bites.
 *
 * ADMIN implicitly holds every capability and can never lose one - the founder is
 * never locked out of their own business.
 *
 * Defaults are ADMIN-only across the board, which is exactly the behaviour the app
 * had before capabilities existed (every one of these actions was `requireAdmin`).
 * Granting a capability is therefore always a deliberate, additive act.
 */

import type { AppRole } from "./sections";

export type CapabilityDef = {
  readonly key: string;
  /** the label shown on the toggle */
  readonly name: string;
  /** the one-line subtitle under it */
  readonly description: string;
  /** which server actions this key guards - keep in step with the guards themselves */
  readonly actions: string;
  /** roles that hold it without a per-user override */
  readonly roles: readonly AppRole[];
};

export const CAPABILITIES = [
  {
    key: "finance.write",
    name: "Record income & expenses",
    description: "Post entries to the ledger",
    actions: "finance-actions (income, expenses, pending payments) · cash-actions (balances, payables)",
    roles: ["ADMIN"],
  },
  {
    key: "pipeline.configure",
    name: "Configure telecaller board",
    description: "Edit targets, leads & assignment",
    actions: "pipeline-actions (monthly target, lead assignment, deleting leads and outcomes)",
    roles: ["ADMIN"],
  },
  {
    key: "users.manage",
    name: "Manage team & access",
    description: "Invite users and grant access",
    actions: "users-actions (invite, edit access, suspend, delete) · access-requests",
    roles: ["ADMIN"],
  },
  {
    key: "rewards.approve",
    name: "Approve rewards & payouts",
    description: "Approve, decline and mark payouts paid",
    actions: "console-actions (scan, grant status) · telecaller-actions (payouts)",
    roles: ["ADMIN"],
  },
  {
    key: "agreements.issue",
    name: "Countersign & send agreements",
    description: "Draft, sign and issue coaching agreements",
    actions: "agreement-actions (create, update, issue, void, resend link)",
    roles: ["ADMIN"],
  },
  /**
   * The Outreach SOP's role boundary, made real.
   *
   * The SOP is explicit that "Highly Qualified" is the Discovery Specialist's verdict, and that
   * the Outreach Specialist merely reads it to decide whether to run Step 19 - they must never
   * write it. Before this key, the only gate was `requireSection("pipeline")`, which every USER
   * and HEAD passes, on any lead: the boundary existed in the printed SOP and in a hidden UI tab,
   * but not in the server.
   *
   * A capability rather than a new Role because this app's roles are named after people
   * (USER = "Asma / Nilofer" collapses the Discovery Specialist and the Outreach Specialist into
   * one role). Splitting the enum would touch every guard in the app; granting Asma this one key
   * expresses exactly the SOP's rule and nothing more.
   */
  {
    key: "outreach.qualify",
    name: "Set Highly Qualified (Discovery Specialist)",
    description: "Record the post-discovery verdict that unlocks the SSS sequence",
    actions: "outreach-actions (setHighlyQualified) · pipeline-actions (createOutcome, updateOutcome)",
    roles: ["ADMIN"],
  },
  /**
   * A READ key, unlike its neighbours - the exception the header's "privileged writes"
   * rule earns here.
   *
   * German Note's money is a TAB, not a route, so `sections.ts` cannot gate it: a
   * section needs an href. Without this key the only lever was the role itself, which
   * meant "does the Head see revenue?" was a code edit and a redeploy. It is a
   * business call the founder should make per person, so it is a capability.
   *
   * Guards it: the Financials tab on /german-note, and /german-note/workshops/[id],
   * which the tab links to (via `requireCapability` - a read gate, so it bounces
   * rather than returning an ActionResult). CREATING and editing workshops stays
   * `requireAdmin()` regardless: this key buys sight of the money, never control of it.
   */
  {
    key: "germanNote.finance",
    name: "See German Note financials",
    description: "Workshop revenue, outstanding payments and P&L",
    actions: "german-note Financials tab · german-note/workshops/[id] - read-only; creating & editing workshops stays Admin-only",
    roles: ["ADMIN"],
  },
  /**
   * The public marketing site, forms and funnels - everything a visitor can see before they are a
   * lead. A key of its own rather than `pipeline.configure`, which is what these actions borrowed
   * before it existed.
   *
   * The two powers have nothing to do with each other. `pipeline.configure` is an INTERNAL power:
   * reassign leads, edit targets, delete outcomes. This one is OUTWARD-FACING - publishing a page
   * changes what the public and every ad click sees, on a site that takes paid traffic. Someone
   * trusted to move a lead between telecallers has not thereby been trusted to edit the homepage,
   * and the reverse is just as true: whoever writes the copy should not need the power to delete
   * leads to do it.
   *
   * Guards the WRITE path only. Public rendering is unauthenticated by definition and gated on
   * `published`, never on this key.
   */
  {
    key: "sites.manage",
    name: "Edit the public website",
    description: "Pages, forms, funnels and published content",
    actions: "sites-actions (pages, sections, media) · funnels-actions · forms-actions - publishing included",
    roles: ["ADMIN"],
  },
  /**
   * ER v2 Track A. Seating is a delivery decision, not a finance one: the Head coach
   * plausibly decides which cohort a student joins, without being handed the Students board's
   * other write powers. Distinct from `pipeline.configure` for that reason.
   *
   * Creating and archiving BATCHES stays `requireAdmin()` - this key buys the right to move
   * people between existing cohorts, never to invent one.
   */
  {
    key: "batches.manage",
    name: "Seat students in batches",
    description: "Move enrollments between existing cohorts",
    actions: "batch-actions (seatEnrollment, unseatEnrollment); creating & archiving batches stays Admin-only",
    roles: ["ADMIN"],
  },
  /**
   * ER v2 Track D. Editing the qualification catalogue changes the BANT verdict that decides
   * WHO GETS CALLED, which is why it is a key of its own rather than folded into
   * `pipeline.configure`: someone who may reassign leads should not thereby be able to
   * silently re-tune what "qualified" means for everyone.
   */
  {
    key: "qualification.manage",
    name: "Edit qualification questions",
    description: "Add, reword and reweight the booking form's BANT questions",
    actions: "qualification-actions (create, update → new version, reorder, retire)",
    roles: ["ADMIN"],
  },
  /**
   * ── WHO EARNS WHICH COMMISSION LEG ──────────────────────────────────────────────
   * The three keys below are the exception to this file's "privileged writes" framing: they
   * gate no action at all. They are ELIGIBILITY - read by `getCommissionReport` when it splits
   * a payment across the deal team.
   *
   * Why a capability and not a new config shape: commission rates were global-only
   * (`bothCallsPct` / `splitPct` / `closerPct` / `substitutePct`), so "Nilofer is first-call
   * only" existed as an arrangement between people and nowhere in the system - it held only
   * because she happened not to run discovery calls. The moment she covered one, the report paid
   * her for it. Per-user overrides already exist (`User.capabilities`, edited from People →
   * Users & access), so this expresses the rule in the mechanism the app already has rather than
   * inventing a parallel one.
   *
   * DEFAULT: granted to ADMIN and USER, which reproduces today's behaviour exactly - everyone
   * is eligible for everything until the founder says otherwise. Revoking is the deliberate act.
   *
   * An ineligible leg is SHOWN and marked "not eligible", never silently zeroed. An invisible
   * deduction is how a payout dispute starts.
   */
  {
    key: "commission.firstCall",
    name: "Earns first-call commission",
    description: "Eligible for the lead-call leg of a deal split",
    actions: "commission-metrics (getCommissionReport) - eligibility only, gates no action",
    roles: ["ADMIN", "USER"],
  },
  {
    key: "commission.discovery",
    name: "Earns discovery-call commission",
    description: "Eligible for the discovery-call leg of a deal split",
    actions: "commission-metrics (getCommissionReport) - eligibility only, gates no action",
    roles: ["ADMIN", "USER"],
  },
  {
    key: "commission.closer",
    name: "Earns closer commission",
    description: "Eligible for the closer's share when a deal is won",
    actions: "commission-metrics (getCommissionReport) - eligibility only, gates no action",
    roles: ["ADMIN", "USER"],
  },
] as const satisfies readonly CapabilityDef[];

export type CapabilityKey = (typeof CAPABILITIES)[number]["key"];

/** Per-user grants and revocations, layered over the role defaults. Stored on User.capabilities. */
export type CapabilityOverrides = Partial<Record<CapabilityKey, boolean>>;

export function capabilityByKey(key: CapabilityKey): CapabilityDef {
  return CAPABILITIES.find((c) => c.key === key)!;
}

/** `as const` narrows each `roles` to its own literal tuple; widen to compare with any role. */
const rolesOf = (c: CapabilityDef): readonly AppRole[] => c.roles;

/**
 * THE capability rule. Same shape as `sectionAllowed`: admin wins, then the per-user
 * override, then the role default. Lives here so the admin UI renders exactly what
 * the server will decide.
 */
export function hasCapability(
  role: AppRole,
  overrides: CapabilityOverrides | null,
  key: CapabilityKey,
): boolean {
  if (role === "ADMIN") return true; // the founder always holds everything
  const override = overrides?.[key];
  if (override !== undefined) return override;
  return rolesOf(capabilityByKey(key)).includes(role);
}

/** The baseline a role starts from, before any per-user toggle. */
export function roleDefaultCapabilities(role: AppRole): CapabilityKey[] {
  if (role === "ADMIN") return CAPABILITIES.map((c) => c.key);
  return CAPABILITIES.filter((c) => rolesOf(c).includes(role)).map((c) => c.key);
}

/** Everything this person can actually do right now. */
export function effectiveCapabilities(
  role: AppRole,
  overrides: CapabilityOverrides | null,
): Set<CapabilityKey> {
  return new Set(CAPABILITIES.filter((c) => hasCapability(role, overrides, c.key)).map((c) => c.key));
}

/** "You don't have permission to record income & expenses." */
export function capabilityDeniedMessage(key: CapabilityKey): string {
  return `You don't have permission to ${capabilityByKey(key).name.toLowerCase()}.`;
}

/** Account lifecycle. A suspended account cannot sign in and has no live sessions. */
export type UserStatus = "ACTIVE" | "SUSPENDED";

/**
 * Capabilities — what a person may DO, as distinct from what they may SEE.
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
 * ADMIN implicitly holds every capability and can never lose one — the founder is
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
  /** which server actions this key guards — keep in step with the guards themselves */
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

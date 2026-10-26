"use client";

import { useState } from "react";
import { Lock } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { LOG_VARIANT_LABELS } from "@/lib/labels";
import { FormError } from "@/components/ui/form";
import { fieldKindProps } from "@/components/ui/field-base";
import { toast } from "@/components/ui/feedback";
import { Hint } from "@/components/ui/kit";
import { Btn, CheckCard, SegmentedControl, SubmitBtn, SwitchRow } from "@/components/ui/controls";
import { inviteUser, resetUserAccess, updateUserAccess, type ListedUser } from "@/server/users-actions";
import { safeAction } from "@/lib/action-guard";
import {
  CAPABILITIES,
  effectiveCapabilities,
  hasCapability,
  roleDefaultCapabilities,
  type CapabilityKey,
  type CapabilityOverrides,
} from "@/lib/capabilities";
import {
  effectiveSectionKeys,
  grantableTo,
  roleDefaultKeysFrom,
  type AppRole,
  type ResolvedSection,
} from "@/lib/sections";

/**
 * One dialog, two jobs: invite a new person, or edit an existing one. Both answer the
 * same two questions, and the split between them is the point of the screen:
 *
 *   Module access - what they can SEE   (checkboxes, one per nav section)
 *   Capabilities  - what they can DO    (switches, one per privileged action group)
 *
 * Picking a role is a preset, not a cage: it refills both lists with that role's
 * defaults, and every box stays editable afterwards.
 */

export type Actor = {
  id: string;
  role: AppRole;
  capabilities: CapabilityOverrides | null;
};

export const ROLE_PRESETS: { value: AppRole; label: string }[] = [
  { value: "ADMIN", label: "Admin" },
  { value: "HEAD", label: "Head coach" },
  { value: "USER", label: "Telecaller" },
  { value: "STUDENT", label: "Student" },
  { value: "TUTOR", label: "Tutor" },
  { value: "COACH", label: "Coach" },
];

const fieldCls =
  "mt-1.5 w-full rounded-field border border-line-strong bg-surface px-3 py-2.5 text-sm font-normal text-ink outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary-soft disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-muted";

export function AccessDialog({
  mode,
  user,
  prefill,
  sections,
  actor,
  onClose,
  onInvited,
}: {
  mode: "invite" | "edit";
  /** the person being edited; absent when inviting */
  user?: ListedUser;
  /** an approved access request, pre-filling the invite ("Review & grant") */
  prefill?: { name: string; email: string; role: string };
  sections: ResolvedSection[];
  actor: Actor;
  onClose: () => void;
  onInvited: (link: { url: string; expiresInDays: number }) => void;
}) {
  /**
   * A REQUESTED ROLE IS A SUGGESTION, NOT A GRANT (issue B2).
   *
   * Everything in a `prefill` arrived from an unauthenticated stranger on the login screen, so
   * the only safe thing to carry into a create-user form is the stuff an admin will read and
   * correct anyway (name, email). The ROLE decides what the account can do on the day it is
   * created, and it is the one field where a pre-ticked value plus a tired Friday is the whole
   * attack.
   *
   * So the allow-list here mirrors `submitAccessRequest`'s enum rather than being wider than it.
   * It used to admit "HEAD", which is the second-widest grant in the app - and that mattered
   * even after HEAD stopped being requestable, because rows filed BEFORE that change are still
   * sitting in the queue carrying `role: "HEAD"` (and some carry "ADMIN", from before that was
   * removed). An old row must not be able to pre-tick a grant the form no longer offers.
   *
   * Anything outside the list falls back to USER - the narrowest staff role - and
   * `prefillRoleIgnored` below tells the admin that is what happened, so the fallback is visible
   * rather than silent.
   */
  const REQUESTABLE: readonly AppRole[] = ["USER", "COACH", "TUTOR"];
  const requestedRole = prefill?.role as AppRole | undefined;
  const prefillRoleIgnored =
    !user && !!requestedRole && !REQUESTABLE.includes(requestedRole);
  const initialRole: AppRole =
    user?.role ?? (requestedRole && REQUESTABLE.includes(requestedRole) ? requestedRole : "USER");

  const [name, setName] = useState(user?.name ?? prefill?.name ?? "");
  const [email, setEmail] = useState(user?.email ?? prefill?.email ?? "");
  const [role, setRole] = useState<AppRole>(initialRole);
  const [modules, setModules] = useState<Set<string>>(() =>
    user
      ? effectiveSectionKeys(sections, user.role, user.sectionAccess)
      : new Set(roleDefaultKeysFrom(sections, initialRole)),
  );
  const [caps, setCaps] = useState<Set<string>>(() =>
    user ? effectiveCapabilities(user.role, user.capabilities) : new Set(roleDefaultCapabilities(initialRole)),
  );
  const [error, setError] = useState<string | null>(null);

  const isAdminRole = role === "ADMIN";

  /**
   * Depends on the role being edited, not just on the catalogue - so switching the role picker
   * re-draws the list. Dashboard, My Journey and My Classroom drop out for everyone but a
   * student: they read the signed-in person's OWN student record, so ticking them for a coach
   * would save a grant the server ignores. `grantableTo` is the same test `sectionAllowed` runs.
   */
  const grantable = sections.filter((s) => !s.locked && grantableTo(s, role));

  // Raw <input>s (this dialog predates the form kit), so the kind's attrs + character
  // filter are wired by hand. Not hooks - safe to call here. See lib/field-rules.ts.
  const nameField = fieldKindProps<HTMLInputElement>("name", (e) => setName(e.target.value));
  const emailField = fieldKindProps<HTMLInputElement>("email", (e) => setEmail(e.target.value));

  /** Choosing a role refills both lists from that role's defaults. */
  const pickRole = (next: AppRole) => {
    setRole(next);
    setModules(new Set(roleDefaultKeysFrom(sections, next)));
    setCaps(new Set(roleDefaultCapabilities(next)));
  };

  const toggle = (set: Set<string>, key: string): Set<string> => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  };

  /** A delegate can never hand out a capability they don't hold - the server says so too. */
  const canGrant = (key: CapabilityKey) => hasCapability(actor.role, actor.capabilities, key);

  const submit = async (form: FormData) => {
    setError(null);
    if (mode === "invite") {
      const res = await safeAction(() => inviteUser(form));
      if (!res.ok) return setError(res.error);
      onInvited({ url: res.inviteUrl, expiresInDays: res.expiresInDays });
      return;
    }
    const res = await safeAction(() => updateUserAccess(user!.id, form));
    if (!res.ok) return setError(res.error);
    toast(`Access updated for ${name} - applies on their next page load`);
    onClose();
  };

  const selectedCount = isAdminRole ? grantable.length : modules.size;

  const roleOptions = ROLE_PRESETS.map((r) => ({
    value: r.value,
    label: r.label,
    disabled: r.value === "ADMIN" && actor.role !== "ADMIN",
    title: r.value === "ADMIN" && actor.role !== "ADMIN" ? "Only an Admin can grant the Admin role" : undefined,
  }));

  return (
    <Modal
      open
      onClose={onClose}
      title={mode === "invite" ? "Invite user" : "Edit access"}
      subtitle={mode === "invite" ? "They'll get a single-use link to set their own password." : undefined}
    >
      <form action={submit} className="space-y-6">
        {/* identity */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="block text-sm font-medium text-ink">
            Full name
            <input {...nameField.attrs} name="name" required value={name} onChange={nameField.onChange} className={fieldCls} />
          </label>
          <label className="block text-sm font-medium text-ink">
            Work email
            <input
              {...emailField.attrs}
              name="email"
              required
              value={email}
              disabled={mode === "edit"}
              onChange={emailField.onChange}
              className={fieldCls}
            />
            {mode === "edit" && (
              <span className="mt-1 block text-xs font-normal text-muted">
                The email is the login and can&apos;t be changed here.
              </span>
            )}
          </label>
        </div>

        {/* role preset */}
        <div>
          <p className="text-sm font-medium text-ink">
            Role <span className="font-normal text-muted">- sets a starting access preset</span>
          </p>
          <input type="hidden" name="role" value={role} />
          <div className="mt-2">
            <SegmentedControl grow ariaLabel="Role" value={role} onChange={pickRole} options={roleOptions} />
          </div>
          {/* The fallback above, said out loud. An admin who sees "requested: Head coach" on the
              queue row and "Telecaller" pre-ticked here needs to know which one the form means. */}
          {prefillRoleIgnored && (
            <p role="status" className="mt-2 rounded-field bg-watch-soft px-3 py-2 text-xs font-medium text-watch">
              This request asked for <b>{requestedRole}</b>, which can&apos;t be granted from a public
              request. Starting from Telecaller - pick the role deliberately.
            </p>
          )}
        </div>

        {/*
          ── THE ONE PIECE OF ACCESS THIS DIALOG CANNOT SET (P11) ───────────────────────────
          Which My Desk a telecaller sees is decided by `TeamProfile.logVariant` - not by their
          role, not by a section, not by a capability. So an admin could set everything on this
          screen correctly, hand over the login, and the person would land on "No team profile
          linked to your login" with nothing here looking wrong.

          Stated, not editable. The Team & org chart tab owns the profile and holds far more of
          it than this one field (reporting line, first-call share, Saturday availability), and a
          second editor for one field of it is the duplication this refactor is reducing.

          Only for roles that HAVE a desk: a student or a tutor has no team profile by design,
          and telling an admin that is missing would be inventing a problem.
        */}
        {mode === "edit" && (role === "USER" || role === "HEAD") && (
          <div className="rounded-field border border-line bg-surface-2 px-3.5 py-3">
            <p className="text-sm font-medium text-ink">Team profile</p>
            {user?.teamProfile ? (
              <p className="mt-0.5 text-sm text-ink-2">
                Linked as <b className="font-semibold text-ink">{user.teamProfile.roleTitle}</b>, so
                their My Desk is the{" "}
                {LOG_VARIANT_LABELS[user.teamProfile.logVariant as keyof typeof LOG_VARIANT_LABELS] ??
                  user.teamProfile.logVariant}{" "}
                version. Change it on Team &amp; org chart.
              </p>
            ) : (
              <p className="mt-0.5 text-sm text-warn">
                <b className="font-semibold">No team profile is linked to this login.</b> Their My
                Desk cannot know whose calls are theirs, so it will show a dead end however much
                access you grant here. Link it on the Team &amp; org chart tab.
              </p>
            )}
          </div>
        )}

        {/* modules - what they can SEE */}
        <div>
          <div className="flex items-baseline justify-between">
            <p className="text-sm font-medium text-ink">Module access</p>
            <p className="text-xs text-muted">{selectedCount} selected</p>
          </div>
          {isAdminRole ? (
            <p className="mt-2 flex items-center gap-2 rounded-field border border-line bg-surface-2 px-3.5 py-3 text-sm text-muted">
              <Lock size={14} className="flex-none" />
              Admins always have access to everything.
            </p>
          ) : (
            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {grantable.map((s) => (
                <CheckCard
                  key={s.key}
                  name={`section_${s.key}`}
                  label={s.label}
                  checked={modules.has(s.key)}
                  onChange={() => setModules((m) => toggle(m, s.key))}
                  strikethrough={!s.enabled}
                  title={s.enabled ? undefined : "This section is switched off in the Founder Console"}
                />
              ))}
            </div>
          )}
        </div>

        {/* capabilities - what they can DO */}
        <div>
          <p className="text-sm font-medium text-ink">Capabilities</p>
          <div className="mt-2 space-y-2">
            {CAPABILITIES.map((c) => {
              const on = isAdminRole || caps.has(c.key);
              const blocked = isAdminRole || !canGrant(c.key);
              return (
                <div key={c.key}>
                  <SwitchRow
                    title={c.name}
                    description={c.description}
                    name={`cap_${c.key}`}
                    checked={on}
                    disabled={blocked}
                    onChange={() => setCaps((s) => toggle(s, c.key))}
                    hint={
                      isAdminRole
                        ? "Admins always hold every capability"
                        : blocked
                          ? "You can only grant capabilities you hold yourself"
                          : undefined
                    }
                  />
                  {/* A disabled input submits nothing, which would silently REVOKE a capability
                      this delegate isn't allowed to touch. Carry the existing value through. */}
                  {!isAdminRole && blocked && on && <input type="hidden" name={`cap_${c.key}`} value="on" />}
                </div>
              );
            })}
          </div>
          <div className="mt-2">
            <Hint>
              Modules decide what a person can open. Capabilities decide what they can change once
              they&apos;re there - a Head coach can read Finance without being able to post to the ledger.
            </Hint>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-line pt-4">
          <FormError message={error} />
          {mode === "edit" && (user!.sectionAccess !== null || user!.capabilities !== null) && (
            <button
              type="button"
              className="mr-auto text-sm text-accent hover:underline"
              onClick={async () => {
                const res = await safeAction(() => resetUserAccess(user!.id));
                if (!res.ok) return setError(res.error);
                toast("Access reset to role defaults");
                onClose();
              }}
            >
              Reset to role defaults
            </button>
          )}
          <Btn onClick={onClose}>Cancel</Btn>
          {/* "Create", not "Send": there is no mailer - the next dialog hands you the link. */}
          <SubmitBtn>{mode === "invite" ? "Create invite link" : "Save changes"}</SubmitBtn>
        </div>
      </form>
    </Modal>
  );
}

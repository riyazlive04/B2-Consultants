"use client";

import { useState } from "react";
import { Lock } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { FormError } from "@/components/ui/form";
import { fieldKindProps } from "@/components/ui/field-base";
import { toast } from "@/components/ui/feedback";
import { Hint } from "@/components/ui/kit";
import { Btn, CheckCard, SegmentedControl, SubmitBtn, SwitchRow } from "@/components/ui/controls";
import { inviteUser, resetUserAccess, updateUserAccess, type ListedUser } from "@/server/users-actions";
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
  roleDefaultKeysFrom,
  type AppRole,
  type ResolvedSection,
} from "@/lib/sections";

/**
 * One dialog, two jobs: invite a new person, or edit an existing one. Both answer the
 * same two questions, and the split between them is the point of the screen:
 *
 *   Module access — what they can SEE   (checkboxes, one per nav section)
 *   Capabilities  — what they can DO    (switches, one per privileged action group)
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
  const grantable = sections.filter((s) => !s.locked);
  // A requested role is a suggestion, not a grant — and never Admin off a public form.
  const initialRole: AppRole =
    user?.role ?? (prefill?.role === "HEAD" || prefill?.role === "USER" ? prefill.role : "USER");

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

  // Raw <input>s (this dialog predates the form kit), so the kind's attrs + character
  // filter are wired by hand. Not hooks — safe to call here. See lib/field-rules.ts.
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

  /** A delegate can never hand out a capability they don't hold — the server says so too. */
  const canGrant = (key: CapabilityKey) => hasCapability(actor.role, actor.capabilities, key);

  const submit = async (form: FormData) => {
    setError(null);
    if (mode === "invite") {
      const res = await inviteUser(form);
      if (!res.ok) return setError(res.error);
      onInvited({ url: res.inviteUrl, expiresInDays: res.expiresInDays });
      return;
    }
    const res = await updateUserAccess(user!.id, form);
    if (!res.ok) return setError(res.error);
    toast(`Access updated for ${name} — applies on their next page load`);
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
            Role <span className="font-normal text-muted">— sets a starting access preset</span>
          </p>
          <input type="hidden" name="role" value={role} />
          <div className="mt-2">
            <SegmentedControl grow ariaLabel="Role" value={role} onChange={pickRole} options={roleOptions} />
          </div>
        </div>

        {/* modules — what they can SEE */}
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

        {/* capabilities — what they can DO */}
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
              they&apos;re there — a Head coach can read Finance without being able to post to the ledger.
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
                const res = await resetUserAccess(user!.id);
                if (!res.ok) return setError(res.error);
                toast("Access reset to role defaults");
                onClose();
              }}
            >
              Reset to role defaults
            </button>
          )}
          <Btn onClick={onClose}>Cancel</Btn>
          {/* "Create", not "Send": there is no mailer — the next dialog hands you the link. */}
          <SubmitBtn>{mode === "invite" ? "Create invite link" : "Save changes"}</SubmitBtn>
        </div>
      </form>
    </Modal>
  );
}

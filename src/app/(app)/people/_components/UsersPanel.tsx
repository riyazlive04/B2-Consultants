"use client";

import { useState } from "react";
import { createUser, resetUserAccess, setUserPassword, updateUserAccess } from "@/server/users-actions";
import { askConfirm, toast } from "@/components/ui/feedback";
import { Field, FormError, Select, SubmitButton, TextInput } from "@/components/ui/form";
import { formatDate } from "@/lib/format";
import { roleDefaultKeys, SECTIONS, type AppRole, type SectionOverrides } from "@/lib/sections";

export type UserRow = {
  id: string;
  name: string;
  email: string;
  role: AppRole;
  sectionAccess: SectionOverrides | null;
  createdAt: string;
};

const ROLE_OPTIONS = [
  { value: "USER", label: "User - own daily log + own pipeline entry" },
  { value: "HEAD", label: "Head - students view + own daily log" },
  { value: "ADMIN", label: "Admin - everything, always" },
  { value: "STUDENT", label: "Student - own journey portal + CV check only" },
];

/** Which sections a user effectively sees right now (mirror of rbac.hasAccess). */
function effectiveKeys(role: AppRole, overrides: SectionOverrides | null): Set<string> {
  if (role === "ADMIN") return new Set(SECTIONS.map((s) => s.key));
  const defaults = new Set<string>(roleDefaultKeys(role));
  const out = new Set(defaults);
  for (const s of SECTIONS) {
    const o = overrides?.[s.key];
    if (o === true) out.add(s.key);
    if (o === false) out.delete(s.key);
  }
  return out;
}

/** Checkbox grid over every feature - used by both create and edit forms. */
function AccessGrid({ role, checked }: { role: AppRole; checked: Set<string> }) {
  if (role === "ADMIN") {
    return <p className="text-sm text-muted">Admins always have access to everything.</p>;
  }
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {SECTIONS.map((s) => (
        <label key={s.key} className="flex items-center gap-2 rounded-field border border-line bg-surface-2 px-3 py-2 text-sm">
          <input
            type="checkbox"
            name={`section_${s.key}`}
            defaultChecked={checked.has(s.key)}
            className="h-4 w-4 accent-[var(--accent)]"
          />
          <span>{s.label}</span>
        </label>
      ))}
    </div>
  );
}

export function UsersPanel({ users, currentUserId }: { users: UserRow[]; currentUserId: string }) {
  const [creating, setCreating] = useState(false);
  const [createRole, setCreateRole] = useState<AppRole>("USER");
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [editRole, setEditRole] = useState<AppRole>("USER");
  const [pwFor, setPwFor] = useState<UserRow | null>(null);
  const [error, setError] = useState<string | null>(null);

  const startEdit = (u: UserRow) => {
    setEditing(u);
    setEditRole(u.role);
    setPwFor(null);
    setCreating(false);
  };

  return (
    <section className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-display text-lg font-semibold">Users & access</h3>
          <p className="text-xs text-muted">
            Create logins and choose exactly which features each person can open. Role sets the
            baseline; the toggles override it per user.
          </p>
        </div>
        <button
          type="button"
          className="rounded-field bg-accent px-3 py-1.5 text-sm font-semibold text-white hover:opacity-95"
          onClick={() => { setCreating((v) => !v); setEditing(null); setPwFor(null); }}
        >
          {creating ? "Close" : "Create user"}
        </button>
      </div>

      {/* Create */}
      {creating && (
        <form
          action={async (form) => {
            setError(null);
            const res = await createUser(form);
            if (!res.ok) return setError(res.error);
            toast("User created - share the password securely");
            setCreating(false);
          }}
          className="rounded-card border border-line bg-surface p-5 shadow-card"
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Full name"><TextInput name="name" required /></Field>
            <Field label="Email (login)"><TextInput type="email" name="email" required /></Field>
            <Field label="Temporary password" hint="Min 8 characters; ask them to change it">
              <TextInput name="password" required minLength={8} />
            </Field>
            <Field label="Role (baseline access)">
              <Select
                name="role"
                options={ROLE_OPTIONS}
                value={createRole}
                onChange={(e) => setCreateRole(e.target.value as AppRole)}
              />
            </Field>
          </div>
          <div className="mt-4">
            <p className="mb-2 text-sm font-medium">Feature access</p>
            <AccessGrid key={createRole} role={createRole} checked={new Set(roleDefaultKeys(createRole))} />
          </div>
          <div className="mt-4 flex items-center gap-3">
            <SubmitButton>Create user</SubmitButton>
            <FormError message={error} />
          </div>
        </form>
      )}

      {/* User list */}
      <div className="overflow-hidden rounded-card border border-line bg-surface shadow-card">
        {users.map((u) => {
          const eff = effectiveKeys(u.role, u.sectionAccess);
          const customized = u.role !== "ADMIN" && u.sectionAccess !== null;
          return (
            <div key={u.id} className="border-b border-line px-5 py-4 last:border-b-0">
              <div className="flex flex-wrap items-center gap-3">
                <div className="w-44">
                  <p className="font-semibold">
                    {u.name}
                    {u.id === currentUserId && <span className="ml-1 text-xs text-muted">(you)</span>}
                  </p>
                  <p className="truncate text-xs text-muted">{u.email}</p>
                </div>
                <span
                  className="rounded-full px-2.5 py-0.5 text-xs font-semibold"
                  style={{
                    background: u.role === "ADMIN" ? "var(--accent-soft)" : "var(--surface-2)",
                    color: u.role === "ADMIN" ? "var(--accent)" : "var(--muted)",
                  }}
                >
                  {u.role}{customized ? " · customised" : ""}
                </span>
                <div className="flex min-w-0 flex-1 flex-wrap gap-1">
                  {SECTIONS.filter((s) => eff.has(s.key)).map((s) => (
                    <span key={s.key} className="rounded-full border border-line px-2 py-0.5 text-[11px] text-muted">
                      {s.label}
                    </span>
                  ))}
                </div>
                <div className="flex gap-2 text-sm">
                  <button type="button" className="py-1 text-accent hover:underline" onClick={() => startEdit(u)}>
                    Edit access
                  </button>
                  <button type="button" className="py-1 text-accent hover:underline" onClick={() => { setPwFor(u); setEditing(null); }}>
                    Reset password
                  </button>
                </div>
              </div>

              {/* Edit access */}
              {editing?.id === u.id && (
                <form
                  action={async (form) => {
                    setError(null);
                    const res = await updateUserAccess(u.id, form);
                    if (!res.ok) return setError(res.error);
                    toast(`Access updated for ${u.name} - applies on their next page load`);
                    setEditing(null);
                  }}
                  className="mt-4 space-y-4 border-t border-line pt-4"
                >
                  <div className="max-w-sm">
                    <Field label="Role (baseline)">
                      <Select
                        name="role"
                        options={ROLE_OPTIONS}
                        value={editRole}
                        onChange={(e) => setEditRole(e.target.value as AppRole)}
                      />
                    </Field>
                  </div>
                  <AccessGrid key={editRole} role={editRole} checked={editRole === u.role ? effectiveKeys(editRole, u.sectionAccess) : new Set(roleDefaultKeys(editRole))} />
                  <div className="flex items-center gap-3">
                    <SubmitButton>Save access</SubmitButton>
                    {u.sectionAccess !== null && (
                      <button
                        type="button"
                        className="text-sm text-accent hover:underline"
                        onClick={async () => {
                          const ok = await askConfirm({
                            title: `Reset ${u.name} to role defaults?`,
                            body: "All per-feature customisation is removed.",
                            confirmLabel: "Reset",
                          });
                          if (!ok) return;
                          await resetUserAccess(u.id);
                          toast("Access reset to role defaults");
                          setEditing(null);
                        }}
                      >
                        Reset to role defaults
                      </button>
                    )}
                    <button type="button" className="text-sm text-muted hover:underline" onClick={() => setEditing(null)}>
                      Cancel
                    </button>
                    <FormError message={error} />
                  </div>
                </form>
              )}

              {/* Reset password */}
              {pwFor?.id === u.id && (
                <form
                  action={async (form) => {
                    setError(null);
                    const res = await setUserPassword(u.id, form);
                    if (!res.ok) return setError(res.error);
                    toast(`Password updated for ${u.name}`);
                    setPwFor(null);
                  }}
                  className="mt-4 flex flex-wrap items-end gap-3 border-t border-line pt-4"
                >
                  <div className="w-64">
                    <Field label={`New password for ${u.name}`} hint="Min 8 characters">
                      <TextInput name="password" required minLength={8} />
                    </Field>
                  </div>
                  <SubmitButton>Set password</SubmitButton>
                  <button type="button" className="text-sm text-muted hover:underline" onClick={() => setPwFor(null)}>
                    Cancel
                  </button>
                  <FormError message={error} />
                </form>
              )}
            </div>
          );
        })}
      </div>
      <p className="text-xs text-muted">
        Created {users.length} account{users.length === 1 ? "" : "s"} · first account seeded{" "}
        {formatDate(users[0]?.createdAt ?? new Date().toISOString())}. Public sign-up is disabled -
        every account is created here.
      </p>
    </section>
  );
}

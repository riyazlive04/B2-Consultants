"use client";

import { useState } from "react";
import { Link2, Trash2, UserPlus } from "lucide-react";
import { declineAccessRequest, type AccessRequest } from "@/server/access-requests";
import {
  deleteUser,
  reactivateUser,
  resendInvite,
  setUserPassword,
  suspendUser,
  type ListedUser,
} from "@/server/users-actions";
import { askConfirm, toast } from "@/components/ui/feedback";
import { Modal } from "@/components/ui/Modal";
import { Field, FormError, TextInput } from "@/components/ui/form";
import { Card, Chip, Hint, PersonCell, Pill, Td, Th, TableShell, Toolbar, Tr, type Tone } from "@/components/ui/kit";
import { Btn, CopyField, IconButton, SubmitBtn } from "@/components/ui/controls";
import { formatDate } from "@/lib/format";
import { effectiveSectionKeys, type AppRole, type ResolvedSection } from "@/lib/sections";
import { AccessDialog, type Actor } from "./AccessDialog";

/**
 * Team & access.
 *
 * A scannable table — who, what role, what they can open, whether they're active —
 * with every change made in a modal so the list never leaves the screen. The two
 * destructive actions (suspend, delete) both confirm, and both are refused by the
 * server if they'd leave the business without an Admin.
 */

const ROLE_TONE: Record<AppRole, { tone: Tone; label: string }> = {
  ADMIN: { tone: "primary", label: "Admin" },
  HEAD: { tone: "info", label: "Head coach" },
  USER: { tone: "good", label: "Telecaller" },
  STUDENT: { tone: "neutral", label: "Student" },
  TUTOR: { tone: "neutral", label: "Tutor" },
};

const MAX_CHIPS = 4;

function StatusPill({ user }: { user: ListedUser }) {
  if (user.status === "SUSPENDED") return <Pill tone="bad">Suspended</Pill>;
  if (user.invite?.pending) return <Pill tone="warn">Invite pending</Pill>;
  if (user.invite?.expired) return <Pill tone="neutral">Invite expired</Pill>;
  return <Pill tone="good">Active</Pill>;
}

export function UsersPanel({
  users,
  currentUserId,
  accessRequests = [],
  sections,
  actor,
}: {
  users: ListedUser[];
  currentUserId: string;
  accessRequests?: AccessRequest[];
  /** the founder's live section layout — labels, order and on/off all come from here */
  sections: ResolvedSection[];
  /** whoever is looking at this screen; decides what they're allowed to hand out */
  actor: Actor;
}) {
  const [dialog, setDialog] = useState<
    { mode: "invite"; prefill?: AccessRequest } | { mode: "edit"; user: ListedUser } | null
  >(null);
  const [invite, setInvite] = useState<{ url: string; expiresInDays: number } | null>(null);
  const [pwFor, setPwFor] = useState<ListedUser | null>(null);
  const [pwError, setPwError] = useState<string | null>(null);

  const run = async (fn: () => Promise<{ ok: true } | { ok: false; error: string }>, success: string) => {
    const res = await fn();
    if (!res.ok) return toast(res.error, "error");
    toast(success);
  };

  const onSuspend = async (u: ListedUser) => {
    const ok = await askConfirm({
      title: `Suspend ${u.name}?`,
      body: "They're signed out immediately and can't sign in again until you reactivate them.",
      confirmLabel: "Suspend",
      danger: true,
    });
    if (ok) await run(() => suspendUser(u.id), `${u.name} suspended`);
  };

  const onDelete = async (u: ListedUser) => {
    const ok = await askConfirm({
      title: `Delete ${u.name}?`,
      body: "Their login is removed for good. Work they recorded stays, attributed to nobody.",
      confirmLabel: "Delete account",
      danger: true,
    });
    if (ok) await run(() => deleteUser(u.id), `${u.name} deleted`);
  };

  const onResend = async (u: ListedUser) => {
    const res = await resendInvite(u.id);
    if (!res.ok) return toast(res.error, "error");
    setInvite({ url: res.inviteUrl, expiresInDays: res.expiresInDays });
  };

  return (
    <section className="space-y-5">
      <Toolbar>
        <div>
          <h3 className="font-display text-lg font-semibold">Users &amp; access</h3>
          <Hint>Provision accounts, choose what each person can open, and what they&apos;re allowed to change.</Hint>
        </div>
        <Btn variant="primary" icon={<UserPlus size={16} />} onClick={() => setDialog({ mode: "invite" })}>
          Invite user
        </Btn>
      </Toolbar>

      {/* Pending access requests (from the login screen's "Request access") */}
      {accessRequests.length > 0 && (
        <Card
          flush
          title={
            <span className="flex items-center gap-2.5">
              <span aria-hidden className="h-2 w-2 rounded-full bg-watch" />
              <span className="font-display text-[15px] font-semibold">Pending access requests</span>
              <Pill tone="warn">{accessRequests.length} waiting</Pill>
            </span>
          }
        >
          {accessRequests.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center gap-3.5 border-b border-line px-5 py-4 last:border-b-0">
              <div className="min-w-[200px] flex-1">
                <div className="flex items-center gap-2.5">
                  <span className="text-sm font-semibold text-ink">{r.name}</span>
                  <Pill tone={ROLE_TONE[r.role as AppRole]?.tone ?? "neutral"}>
                    requested: {ROLE_TONE[r.role as AppRole]?.label ?? r.role}
                  </Pill>
                </div>
                <p className="mt-0.5 text-xs text-ink-3">
                  {r.email} · {formatDate(r.requestedAt)}
                </p>
                {r.note && <p className="mt-1 text-xs text-ink-2">{r.note}</p>}
              </div>
              <div className="flex gap-2">
                <Btn
                  size="sm"
                  onClick={async () => {
                    const ok = await askConfirm({
                      title: `Decline ${r.name}'s request?`,
                      body: "They won't be notified — the request is simply removed.",
                      confirmLabel: "Decline",
                    });
                    if (!ok) return;
                    await run(() => declineAccessRequest(r.id), "Access request declined");
                  }}
                >
                  Decline
                </Btn>
                <Btn size="sm" variant="primary" onClick={() => setDialog({ mode: "invite", prefill: r })}>
                  Review &amp; grant
                </Btn>
              </div>
            </div>
          ))}
        </Card>
      )}

      {/* Users table */}
      <Card flush>
        <TableShell
          minWidth={880}
          head={
            <>
              <Th>User</Th>
              <Th>Role</Th>
              <Th>Access</Th>
              <Th>Status</Th>
              <Th align="right">Manage</Th>
            </>
          }
        >
          {users.map((u) => {
            const allowed = effectiveSectionKeys(sections, u.role, u.sectionAccess);
            const visible = sections.filter((s) => allowed.has(s.key));
            const shown = visible.slice(0, MAX_CHIPS);
            const overflow = visible.length - shown.length;
            const role = ROLE_TONE[u.role];
            const isSelf = u.id === currentUserId;
            const awaitingInvite = Boolean(u.invite?.pending || u.invite?.expired);

            return (
              <Tr key={u.id}>
                <Td>
                  <PersonCell
                    name={u.name}
                    secondary={u.email}
                    badge={isSelf ? <span className="text-xs font-normal text-muted">(you)</span> : undefined}
                  />
                </Td>
                <Td>
                  <Pill tone={role.tone}>{role.label}</Pill>
                </Td>
                <Td>
                  <div className="flex max-w-md flex-wrap gap-1.5">
                    {shown.map((s) => (
                      <Chip key={s.key}>{s.label}</Chip>
                    ))}
                    {overflow > 0 && <span className="px-1 py-0.5 text-[11px] font-semibold text-ink-3">+{overflow}</span>}
                    {visible.length === 0 && <span className="text-[11px] text-ink-3">No modules</span>}
                  </div>
                </Td>
                <Td>
                  <StatusPill user={u} />
                </Td>
                <Td align="right">
                  <div className="flex justify-end gap-2">
                    <Btn size="sm" onClick={() => setDialog({ mode: "edit", user: u })}>
                      Edit access
                    </Btn>
                    {awaitingInvite ? (
                      <Btn size="sm" icon={<Link2 size={14} />} title="Mint a new single-use link" onClick={() => onResend(u)}>
                        Invite link
                      </Btn>
                    ) : (
                      <Btn size="sm" onClick={() => { setPwFor(u); setPwError(null); }}>
                        Reset password
                      </Btn>
                    )}
                    {u.status === "SUSPENDED" ? (
                      <Btn size="sm" onClick={() => run(() => reactivateUser(u.id), `${u.name} reactivated`)}>
                        Reactivate
                      </Btn>
                    ) : (
                      <Btn
                        size="sm"
                        disabled={isSelf}
                        title={isSelf ? "You cannot suspend your own account" : undefined}
                        onClick={() => onSuspend(u)}
                      >
                        Suspend
                      </Btn>
                    )}
                    <IconButton
                      label={`Delete ${u.name}`}
                      tone="danger"
                      disabled={isSelf}
                      onClick={() => onDelete(u)}
                    >
                      <Trash2 size={15} />
                    </IconButton>
                  </div>
                </Td>
              </Tr>
            );
          })}
        </TableShell>
      </Card>

      <Hint>
        {users.length} account{users.length === 1 ? "" : "s"}. Public sign-up is disabled — every account is created
        here, and everyone sets their own password from a single-use invite link.
      </Hint>

      {/* Invite / edit */}
      {dialog && (
        <AccessDialog
          key={dialog.mode === "edit" ? dialog.user.id : dialog.prefill?.id ?? "invite"}
          mode={dialog.mode}
          user={dialog.mode === "edit" ? dialog.user : undefined}
          prefill={dialog.mode === "invite" ? dialog.prefill : undefined}
          sections={sections}
          actor={actor}
          onClose={() => setDialog(null)}
          onInvited={(link) => {
            setDialog(null);
            setInvite(link);
          }}
        />
      )}

      {invite && <InviteLinkDialog invite={invite} onClose={() => setInvite(null)} />}

      {/* Reset password — the fallback for someone who can't use their link */}
      {pwFor && (
        <Modal
          open
          onClose={() => setPwFor(null)}
          title={`Reset password for ${pwFor.name}`}
          subtitle="Share it securely — then ask them to change it."
          size="sm"
        >
          <form
            action={async (form) => {
              setPwError(null);
              const res = await setUserPassword(pwFor.id, form);
              if (!res.ok) return setPwError(res.error);
              toast(`Password updated for ${pwFor.name}`);
              setPwFor(null);
            }}
            className="space-y-4"
          >
            <Field label="New password" hint="At least 8 characters">
              <TextInput type="password" name="password" required minLength={8} autoComplete="new-password" />
            </Field>
            <div className="flex items-center gap-3">
              <SubmitBtn>Set password</SubmitBtn>
              <Btn variant="ghost" onClick={() => setPwFor(null)}>
                Cancel
              </Btn>
              <FormError message={pwError} />
            </div>
          </form>
        </Modal>
      )}
    </section>
  );
}

/** The link is shown exactly once — it isn't recoverable, only re-mintable. */
function InviteLinkDialog({
  invite,
  onClose,
}: {
  invite: { url: string; expiresInDays: number };
  onClose: () => void;
}) {
  return (
    <Modal
      open
      onClose={onClose}
      title="Invite link ready"
      subtitle="Send this to them yourself — the app has no mailer."
      size="md"
    >
      <div className="space-y-4">
        <CopyField value={invite.url} label="Invite link" />
        <ul className="space-y-1 text-xs text-muted">
          <li>· Single use, and it expires in {invite.expiresInDays} days.</li>
          <li>· They set their own password — you will never see it.</li>
          <li>· Minting a new link for the same person immediately invalidates this one.</li>
        </ul>
        <div className="flex justify-end">
          <Btn onClick={onClose}>Done</Btn>
        </div>
      </div>
    </Modal>
  );
}

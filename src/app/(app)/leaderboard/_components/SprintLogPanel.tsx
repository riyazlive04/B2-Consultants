"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { logSprintEntry, withdrawSprintEntry } from "@/server/sprint-log-actions";
import type { SprintLogRow } from "@/server/sprint-log";
import { Btn } from "@/components/ui/controls";
import { Field, FormError, Select, TextInput } from "@/components/ui/form";
import { DatePicker } from "@/components/ui/DatePicker";
import { Card, Chip, Pill } from "@/components/ui/kit";
import { toast, askConfirm } from "@/components/ui/feedback";
import { formatDate } from "@/lib/format";

/**
 * WHAT THE APP CANNOT SEE FOR ITSELF - the student's own log.
 *
 * Four kinds only, and that restraint is the design. Attendance, watched recordings, coursework
 * and applications are all already recorded elsewhere and are read from there; offering a
 * student a box to also type those in would create a second copy of the same fact, free to
 * disagree with the register. What is left is the handful of things nobody else can tell us: a
 * German HR contact accepting a connection, an interview that came through a channel we never
 * saw, an application somebody actually read, a win.
 *
 * It scores immediately - the founders' choice - which is why the form fences the DATE at both
 * ends and why the weekly cap exists in the scoring. A student sees their place move the moment
 * they log something, and their coach sees the entry in a feed they can correct.
 */

const KIND_OPTIONS = [
  { value: "HR_CONNECTION", label: "HR connection accepted" },
  { value: "APPLICATION_REVIEWED", label: "Application reviewed by a company" },
  { value: "HR_INTERVIEW", label: "HR interview secured" },
  { value: "WIN", label: "Something else worth sharing" },
] as const;

const KIND_HINT: Record<string, string> = {
  HR_CONNECTION: "A German recruiter or hiring manager accepted your request.",
  APPLICATION_REVIEWED: "A recruiter viewed it, replied, or put you through a screening.",
  HR_INTERVIEW: "An interview or HR screen you have actually secured.",
  WIN: "Anything you would tell the cohort about.",
};

export function SprintLogPanel({ entries }: { entries: SprintLogRow[] }) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [kind, setKind] = useState<string>("HR_CONNECTION");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const today = new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);

  const submit = async (fd: FormData) => {
    setBusy(true);
    setError(null);
    const res = await logSprintEntry({
      kind: String(fd.get("kind") ?? ""),
      quantity: String(fd.get("quantity") ?? "1"),
      occurredOn: String(fd.get("occurredOn") ?? ""),
      company: String(fd.get("company") ?? ""),
      note: String(fd.get("note") ?? ""),
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    toast("Logged - your place on the board has moved.", "success");
    setAdding(false);
    router.refresh();
  };

  const withdraw = async (row: SprintLogRow) => {
    const ok = await askConfirm({
      title: "Withdraw this entry?",
      body: `It is worth ${row.pointsEach * row.quantity} points. Your coach will still see that you withdrew it.`,
      confirmLabel: "Withdraw",
    });
    if (!ok) return;
    const res = await withdrawSprintEntry({ entryId: row.id });
    if (!res.ok) {
      toast(res.error, "error");
      return;
    }
    toast("Withdrawn.", "success");
    router.refresh();
  };

  return (
    <Card
      title="Your sprint log"
      subtitle="The things the app can't see for itself. Your attendance, coursework and applications are already counted."
      actions={
        !adding && (
          <Btn size="sm" variant="primary" icon={<Plus size={14} />} onClick={() => setAdding(true)}>
            Log something
          </Btn>
        )
      }
    >
      {adding && (
        <form action={submit} className="mb-5 space-y-4 rounded-field border border-line bg-surface-2 p-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="What happened?" hint={KIND_HINT[kind]}>
              <Select
                name="kind"
                value={kind}
                onChange={(e) => setKind(e.target.value)}
                options={KIND_OPTIONS.map((k) => ({ value: k.value, label: k.label }))}
              />
            </Field>
            <Field
              label="When?"
              hint="The day it actually happened - not today, if you are catching up."
            >
              {/* Bounded in the UI as well as the action: a future date would bank points
                  against a week that has not happened, and the weekly cap is per elapsed week. */}
              <DatePicker name="occurredOn" defaultValue={today} max={today} required />
            </Field>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Company (optional)">
              <TextInput kind="text" name="company" maxLength={160} placeholder="Siemens" />
            </Field>
            <Field
              label="How many?"
              hint="Only put more than 1 if you are logging a batch of the same thing at once."
            >
              <TextInput kind="text" name="quantity" defaultValue="1" maxLength={3} />
            </Field>
          </div>
          <Field label="Note (optional)">
            <TextInput kind="text" name="note" maxLength={300} placeholder="Replied to my InMail about the process engineer role" />
          </Field>
          <FormError message={error} />
          <div className="flex justify-end gap-2">
            <Btn variant="ghost" onClick={() => { setAdding(false); setError(null); }}>
              Cancel
            </Btn>
            <Btn type="submit" variant="primary" busy={busy}>
              Log it
            </Btn>
          </div>
        </form>
      )}

      {entries.length === 0 ? (
        <p className="text-sm text-muted">
          Nothing logged yet. Connections accepted, applications somebody actually read, interviews
          secured - they all count towards your place on the board.
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {entries.map((e) => (
            <li key={e.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-ink">
                  {e.kindLabel}
                  {e.quantity > 1 && <span className="ml-1 text-muted">× {e.quantity}</span>}
                </span>
                <span className="block text-caption text-muted">
                  {formatDate(e.occurredOnYmd)}
                  {e.company ? ` · ${e.company}` : ""}
                  {e.note ? ` · ${e.note}` : ""}
                </span>
              </span>
              {e.source === "COACH" && (
                <Pill tone="info" title="Entered by your coach">
                  From your coach
                </Pill>
              )}
              <Chip>+{(e.pointsEach * e.quantity).toLocaleString("en-IN")}</Chip>
              {e.canWithdraw && (
                <Btn
                  size="sm"
                  variant="ghost"
                  icon={<Trash2 size={13} />}
                  onClick={() => withdraw(e)}
                  title="Withdraw this entry"
                >
                  Withdraw
                </Btn>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

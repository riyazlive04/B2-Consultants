"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowRight, Pencil, Plus, Trash2, TrendingUp, Users } from "lucide-react";
import {
  createWorkshop,
  deleteWorkshop,
  updateWorkshop,
} from "@/server/german-note-workshop-actions";
import type { GnWorkshopSummary } from "@/server/german-note-workshops";
import { formatMonth } from "@/lib/format";
import { askConfirm, toast } from "@/components/ui/feedback";
import { Btn, IconButton } from "@/components/ui/controls";
import { Field, FormError, Select, SubmitButton, TextArea, TextInput } from "@/components/ui/form";
import { Modal } from "@/components/ui/Modal";
import { inr } from "./workshopFormat";

function WorkshopFields({ workshop }: { workshop?: GnWorkshopSummary }) {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Workshop name">
          <TextInput name="name" required maxLength={120} placeholder="May 2026" defaultValue={workshop?.name} />
        </Field>
        <Field label="Intake month">
          <TextInput type="month" name="month" required defaultValue={workshop?.month.slice(0, 7)} />
        </Field>
      </div>
      {workshop && (
        <Field label="Status" hint="Archived workshops stay readable but drop out of the active list.">
          <Select
            name="status"
            options={[
              { value: "ACTIVE", label: "Active" },
              { value: "ARCHIVED", label: "Archived" },
            ]}
            defaultValue={workshop.status}
          />
        </Field>
      )}
      <Field label="Notes (optional)">
        <TextArea name="notes" maxLength={2000} defaultValue={workshop?.notes ?? undefined} placeholder="Ad campaign, offer, anything worth remembering…" />
      </Field>
    </div>
  );
}

function SeatMini({ seats }: { seats: GnWorkshopSummary["seats"] }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {seats.map((s) => (
        <span
          key={s.level}
          className="rounded-full bg-lvl-gn/10 px-2 py-0.5 text-caption font-semibold text-ink"
          title={`${s.seats} seat${s.seats === 1 ? "" : "s"} in ${s.level}`}
        >
          {s.level} {s.seats}
        </span>
      ))}
    </span>
  );
}

export function WorkshopsPanel({ workshops }: { workshops: GnWorkshopSummary[] }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<GnWorkshopSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => startTransition(() => router.refresh());

  return (
    <section className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="font-display text-h2 font-semibold">Workshops</h3>
          <p className="text-xs text-muted">
            Each workshop is a paid-ad taster intake. Open one to track who converted, into which German level,
            and the P&amp;L.
          </p>
        </div>
        <Btn variant="soft" icon={<Plus size={15} />} onClick={() => { setCreating((v) => !v); setError(null); }}>
          {creating ? "Close" : "New workshop"}
        </Btn>
      </div>

      {creating && (
        <form
          className="rounded-card border border-line bg-surface p-4 shadow-card"
          action={async (form) => {
            setError(null);
            const res = await createWorkshop(form);
            if (!res.ok) return setError(res.error);
            setCreating(false);
            toast("Workshop created");
            refresh();
          }}
        >
          <WorkshopFields />
          <div className="mt-4 flex items-center justify-between gap-3">
            <FormError message={error} />
            <span className="ml-auto"><SubmitButton>Create workshop</SubmitButton></span>
          </div>
        </form>
      )}

      {workshops.length === 0 && !creating && (
        <p className="rounded-card border border-dashed border-line bg-surface-2 px-4 py-8 text-center text-sm text-muted">
          No workshops yet — create the first intake above.
        </p>
      )}

      <div className="space-y-3">
        {workshops.map((w) => (
          <div key={w.id} className="rounded-card border border-line bg-surface p-4 shadow-card">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Link href={`/german-note/workshops/${w.id}`} className="font-display text-[15px] font-semibold text-accent hover:underline">
                    {w.name}
                  </Link>
                  <span className="text-xs text-muted">{formatMonth(w.month)}</span>
                  {w.status === "ARCHIVED" && (
                    <span className="rounded-full bg-ink/10 px-2 py-0.5 text-caption font-semibold text-muted">Archived</span>
                  )}
                </div>
                <p className="mt-1.5"><SeatMini seats={w.seats} /></p>
              </div>
              <div className="flex items-center gap-1.5">
                <IconButton label={`Edit ${w.name}`} size="sm" onClick={() => { setEditing(w); setError(null); }}>
                  <Pencil size={15} />
                </IconButton>
                <IconButton
                  label={`Delete ${w.name}`}
                  size="sm"
                  tone="danger"
                  onClick={async () => {
                    const ok = await askConfirm({
                      title: `Delete “${w.name}”?`,
                      body: "Its conversions and ad-sets are removed permanently. Prefer Archive (edit → status) to close a finished workshop.",
                      confirmLabel: "Delete forever",
                      danger: true,
                    });
                    if (!ok) return;
                    const res = await deleteWorkshop(w.id);
                    if (!res.ok) return toast(res.error, "error");
                    toast("Workshop deleted");
                    refresh();
                  }}
                >
                  <Trash2 size={15} />
                </IconButton>
              </div>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Conversions" value={String(w.rollup.conversions)} sub={w.rollup.freeSeats ? `${w.rollup.paying} paid · ${w.rollup.freeSeats} free` : undefined} icon={<Users size={13} />} />
              <Stat label="Revenue" value={inr(w.rollup.revenue, true)} sub={`${inr(w.rollup.cashCollected, true)} collected`} />
              <Stat label="Net profit" value={inr(w.rollup.netProfit, true)} sub={w.rollup.roas !== null ? `ROAS ${w.rollup.roas.toFixed(1)}×` : undefined} icon={<TrendingUp size={13} />} />
              <div className="flex items-end">
                <Link href={`/german-note/workshops/${w.id}`} className="inline-flex items-center gap-1 text-sm font-semibold text-accent hover:underline">
                  Open <ArrowRight size={14} />
                </Link>
              </div>
            </div>
          </div>
        ))}
      </div>

      <Modal open={editing !== null} onClose={() => setEditing(null)} title="Edit workshop" size="md">
        {editing && (
          <form
            action={async (form) => {
              setError(null);
              const res = await updateWorkshop(editing.id, form);
              if (!res.ok) return setError(res.error);
              setEditing(null);
              toast("Workshop updated");
              refresh();
            }}
          >
            <WorkshopFields workshop={editing} />
            <div className="mt-4 flex items-center justify-between gap-3">
              <FormError message={error} />
              <span className="ml-auto"><SubmitButton>Save changes</SubmitButton></span>
            </div>
          </form>
        )}
      </Modal>
    </section>
  );
}

function Stat({ label, value, sub, icon }: { label: string; value: string; sub?: string; icon?: React.ReactNode }) {
  return (
    <div>
      <p className="flex items-center gap-1 text-caption text-muted">{icon}{label}</p>
      <p className="mt-0.5 font-display text-[15px] font-semibold tnum">{value}</p>
      {sub && <p className="text-caption text-muted">{sub}</p>}
    </div>
  );
}

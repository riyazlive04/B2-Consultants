"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus, Trash2 } from "lucide-react";
import {
  createAdSet,
  deleteAdSet,
  updateAdSet,
} from "@/server/german-note-workshop-actions";
import type { GnAdSetRow, GnAdTotals } from "@/server/german-note-workshops";
import { minorToMajorString } from "@/lib/format";
import { askConfirm, toast } from "@/components/ui/feedback";
import { Btn, IconButton } from "@/components/ui/controls";
import { Field, FormError, SubmitButton, TextInput } from "@/components/ui/form";
import { Modal } from "@/components/ui/Modal";
import { inr, pct } from "./workshopFormat";

const num = (n: number) => n.toLocaleString("en-IN");
const moneyInput = (minor: number) => minorToMajorString(BigInt(Math.round(minor)));

function AdSetFields({ set }: { set?: GnAdSetRow }) {
  return (
    <div className="space-y-4">
      <Field label="Label (optional)">
        <TextInput name="label" maxLength={60} defaultValue={set?.label ?? undefined} placeholder="Set A / Reel campaign…" />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Ad spend (₹)">
          <TextInput kind="money" name="adSpend" placeholder="0.00" defaultValue={set ? moneyInput(set.adSpend) : undefined} />
        </Field>
        <Field label="Reach">
          <TextInput kind="int" name="reach" placeholder="0" defaultValue={set ? String(set.reach) : undefined} />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Link clicks">
          <TextInput kind="int" name="linkClicks" placeholder="0" defaultValue={set ? String(set.linkClicks) : undefined} />
        </Field>
        <Field label="Attended">
          <TextInput kind="int" name="attended" placeholder="0" defaultValue={set ? String(set.attended) : undefined} />
        </Field>
        <Field label="Conversions">
          <TextInput kind="int" name="conversions" placeholder="0" defaultValue={set ? String(set.conversions) : undefined} />
        </Field>
      </div>
    </div>
  );
}

export function AdSetsPanel({ workshopId, adSets, adTotals }: { workshopId: string; adSets: GnAdSetRow[]; adTotals: GnAdTotals }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<GnAdSetRow | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => startTransition(() => router.refresh());

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-semibold">Ad performance</h2>
          <p className="text-xs text-muted">Meta ad-sets that drove the taster. Conversion % = deals ÷ attendees.</p>
        </div>
        <Btn variant="soft" icon={<Plus size={15} />} onClick={() => { setCreating(true); setError(null); }}>
          Add ad-set
        </Btn>
      </div>

      {adSets.length === 0 ? (
        <p className="rounded-card border border-dashed border-line bg-surface-2 px-4 py-8 text-center text-sm text-muted">
          No ad-sets yet — add spend &amp; reach to see CTR, CPC and conversion rate.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-card border border-line bg-surface shadow-card">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-caption uppercase tracking-wide text-muted">
                <th className="px-3 py-2.5 font-semibold">Ad-set</th>
                <th className="px-3 py-2.5 text-right font-semibold">Spend</th>
                <th className="px-3 py-2.5 text-right font-semibold">Reach</th>
                <th className="px-3 py-2.5 text-right font-semibold">Clicks</th>
                <th className="px-3 py-2.5 text-right font-semibold">CTR</th>
                <th className="px-3 py-2.5 text-right font-semibold">CPC</th>
                <th className="px-3 py-2.5 text-right font-semibold">Attended</th>
                <th className="px-3 py-2.5 text-right font-semibold">Conv · %</th>
                <th className="px-3 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {adSets.map((s, i) => (
                <tr key={s.id} className="border-b border-line last:border-0 hover:bg-surface-2">
                  <td className="px-3 py-2.5 font-medium text-ink">{s.label ?? `Ad-set ${i + 1}`}</td>
                  <td className="px-3 py-2.5 text-right tnum">{inr(s.adSpend)}</td>
                  <td className="px-3 py-2.5 text-right tnum">{num(s.reach)}</td>
                  <td className="px-3 py-2.5 text-right tnum">{num(s.linkClicks)}</td>
                  <td className="px-3 py-2.5 text-right tnum">{pct(s.ctr)}</td>
                  <td className="px-3 py-2.5 text-right tnum">{s.cpc === null ? "—" : inr(s.cpc)}</td>
                  <td className="px-3 py-2.5 text-right tnum">{num(s.attended)}</td>
                  <td className="px-3 py-2.5 text-right">
                    <span className="tnum">{num(s.conversions)}</span>
                    <span className="text-caption text-muted"> · {pct(s.convRate)}</span>
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center justify-end gap-1">
                      <IconButton label={`Edit ${s.label ?? "ad-set"}`} size="sm" onClick={() => { setEditing(s); setError(null); }}>
                        <Pencil size={14} />
                      </IconButton>
                      <IconButton
                        label={`Delete ${s.label ?? "ad-set"}`}
                        size="sm"
                        tone="danger"
                        onClick={async () => {
                          const ok = await askConfirm({ title: "Delete this ad-set?", confirmLabel: "Delete", danger: true });
                          if (!ok) return;
                          const res = await deleteAdSet(s.id);
                          if (!res.ok) return toast(res.error, "error");
                          toast("Ad-set deleted");
                          refresh();
                        }}
                      >
                        <Trash2 size={14} />
                      </IconButton>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
            {adSets.length > 1 && (
              <tfoot>
                <tr className="border-t border-line-strong font-semibold">
                  <td className="px-3 py-2.5">Total</td>
                  <td className="px-3 py-2.5 text-right tnum">{inr(adTotals.adSpend)}</td>
                  <td className="px-3 py-2.5 text-right tnum">{num(adTotals.reach)}</td>
                  <td className="px-3 py-2.5 text-right tnum">{num(adTotals.linkClicks)}</td>
                  <td className="px-3 py-2.5 text-right tnum">{pct(adTotals.ctr)}</td>
                  <td className="px-3 py-2.5 text-right tnum">{adTotals.cpc === null ? "—" : inr(adTotals.cpc)}</td>
                  <td className="px-3 py-2.5 text-right tnum">{num(adTotals.attended)}</td>
                  <td className="px-3 py-2.5 text-right">
                    <span className="tnum">{num(adTotals.conversions)}</span>
                    <span className="text-caption text-muted"> · {pct(adTotals.convRate)}</span>
                  </td>
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}

      <Modal open={creating} onClose={() => setCreating(false)} title="Add ad-set" size="md">
        <form
          action={async (form) => {
            setError(null);
            const res = await createAdSet(workshopId, form);
            if (!res.ok) return setError(res.error);
            setCreating(false);
            toast("Ad-set added");
            refresh();
          }}
        >
          <AdSetFields />
          <div className="mt-4 flex items-center justify-between gap-3">
            <FormError message={error} />
            <span className="ml-auto"><SubmitButton>Add ad-set</SubmitButton></span>
          </div>
        </form>
      </Modal>

      <Modal open={editing !== null} onClose={() => setEditing(null)} title="Edit ad-set" size="md">
        {editing && (
          <form
            action={async (form) => {
              setError(null);
              const res = await updateAdSet(editing.id, form);
              if (!res.ok) return setError(res.error);
              setEditing(null);
              toast("Ad-set updated");
              refresh();
            }}
          >
            <AdSetFields set={editing} />
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

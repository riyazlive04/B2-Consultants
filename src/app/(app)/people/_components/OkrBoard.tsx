"use client";

import { useState } from "react";
import { deleteOkr, saveOkr } from "@/server/people-actions";
import type { MemberRow } from "@/server/people-metrics";
import { askConfirm, toast } from "@/components/ui/feedback";
import { Field, FormError, Select, SubmitButton, TextArea, TextInput } from "@/components/ui/form";
import { SignalDot } from "@/components/ui/SignalBadge";
import { signalForPercent } from "@/lib/signals";
import { formatPct } from "@/lib/format";

type Okr = MemberRow["okrs"][number];

/** OKR dashboard (PRD2 §3.2): one row per member, 3 signal circles; Admin CRUD; max 3/month. */
export function OkrBoard({ members, month }: { members: MemberRow[]; month: string }) {
  const [editing, setEditing] = useState<{ member: MemberRow; okr: Okr | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const withOkrs = members.filter((m) => m.dashboardRole !== "ADMIN" || m.okrs.length > 0);

  const submit = async (form: FormData) => {
    setError(null);
    const res = await saveOkr(editing?.okr?.id ?? null, form);
    if (!res.ok) return setError(res.error);
    toast(editing?.okr ? "OKR updated" : "OKR created");
    setEditing(null);
  };

  const remove = async (okr: Okr) => {
    const ok = await askConfirm({ title: `Delete OKR “${okr.title}”?`, confirmLabel: "Delete", danger: true });
    if (!ok) return;
    await deleteOkr(okr.id);
    toast("OKR deleted");
  };

  const exportCsv = async () => {
    // Lazy-load papaparse so the People route's initial bundle stays lean —
    // same pattern as DataTable's export.
    const Papa = (await import("papaparse")).default;
    const rows = withOkrs.flatMap((m) =>
      m.okrs.map((o) => ({
        Member: m.fullName,
        Month: month,
        "OKR title": o.title,
        Target: o.targetValue,
        "Current progress": o.currentProgress ?? "",
        "Completion %": Math.round(o.completionPct),
        Status: o.completionPct >= 80 ? "Green" : o.completionPct >= 50 ? "Amber" : "Red",
        Notes: o.notes ?? "",
      })),
    );
    const blob = new Blob(["﻿" + Papa.unparse(rows)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `okr-summary-${month}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-display text-lg font-semibold">OKRs - {month}</h3>
        <button
          type="button"
          onClick={exportCsv}
          className="rounded-field border border-line bg-surface px-3 py-1.5 text-sm font-medium hover:bg-surface-2"
        >
          Export CSV
        </button>
      </div>

      {/* Leaderboard - avg OKR completion this month; friendly competition, visual only */}
      {(() => {
        const ranked = withOkrs
          .filter((m) => m.okrs.length > 0)
          .map((m) => ({
            name: m.fullName,
            avg: m.okrs.reduce((a, o) => a + Math.min(o.completionPct, 100), 0) / m.okrs.length,
          }))
          .sort((a, b) => b.avg - a.avg);
        if (ranked.length < 2) return null;
        const medals = ["🥇", "🥈", "🥉"];
        return (
          <div className="flex flex-wrap gap-3">
            {ranked.map((r, i) => (
              <div
                key={r.name}
                className={`flex items-center gap-2 rounded-card border px-4 py-2.5 shadow-card ${
                  i === 0 ? "border-primary bg-surface" : "border-line bg-surface"
                }`}
              >
                <span className="text-lg" aria-hidden>{medals[i] ?? "·"}</span>
                <span className="text-sm font-semibold">{r.name}</span>
                <span className="tnum text-xs text-muted">{formatPct(r.avg)} avg</span>
              </div>
            ))}
          </div>
        );
      })()}

      <div className="overflow-hidden rounded-card border border-line bg-surface shadow-card">
        {withOkrs.map((m) => (
          <div key={m.id} className="flex flex-wrap items-center gap-4 border-b border-line px-5 py-4 last:border-b-0">
            <div className="w-40">
              <p className="font-semibold">{m.fullName}</p>
              <p className="text-xs text-muted">{m.roleTitle}</p>
            </div>
            {/* the 3 circles - health at a glance */}
            <div className="flex items-center gap-2">
              {m.okrs.map((o) => (
                <SignalDot
                  key={o.id}
                  level={signalForPercent(o.completionPct)}
                  title={`${o.title} - ${formatPct(o.completionPct)}`}
                />
              ))}
              {m.okrs.length === 0 && <span className="text-xs text-muted">No OKRs set</span>}
            </div>
            <div className="min-w-64 flex-1 space-y-1">
              {m.okrs.map((o) => (
                <div key={o.id} className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="truncate">{o.title}</span>
                  <span className="tnum text-xs text-muted">
                    {o.currentProgress ?? "-"} / {o.targetValue} · {formatPct(o.completionPct)}
                  </span>
                  <button type="button" className="py-1 text-sm text-accent hover:underline" onClick={() => setEditing({ member: m, okr: o })}>
                    Edit
                  </button>
                  <button type="button" className="py-1 text-sm text-risk hover:underline" onClick={() => remove(o)}>
                    Delete
                  </button>
                </div>
              ))}
            </div>
            {m.okrs.length < 3 && (
              <button
                type="button"
                className="rounded-field border border-line px-3 py-1.5 text-sm text-accent hover:bg-surface-2"
                onClick={() => setEditing({ member: m, okr: null })}
              >
                + OKR
              </button>
            )}
          </div>
        ))}
        {withOkrs.length === 0 && (
          <p className="px-5 py-8 text-center text-sm text-muted">Add team members first.</p>
        )}
      </div>

      {editing && (
        <form action={submit} key={editing.okr?.id ?? `new-${editing.member.id}`} className="rounded-card border border-line bg-surface p-5 shadow-card">
          <div className="mb-4 flex items-center justify-between">
            <h4 className="font-display text-lg font-semibold">
              {editing.okr ? "Edit OKR" : "New OKR"} - {editing.member.fullName}
            </h4>
            <button type="button" className="text-sm text-muted hover:underline" onClick={() => setEditing(null)}>
              Close
            </button>
          </div>
          <input type="hidden" name="teamProfileId" value={editing.member.id} />
          <input type="hidden" name="month" value={month} />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="OKR title" hint="e.g. Increase show-up rate to 80%">
              <TextInput name="title" required defaultValue={editing.okr?.title ?? ""} />
            </Field>
            <Field label="Target value" hint="e.g. 80%, 50 calls, 3 students">
              <TextInput name="targetValue" required defaultValue={editing.okr?.targetValue ?? ""} />
            </Field>
            <Field label="Current progress" hint="Member updates weekly from their daily-log page">
              <TextInput name="currentProgress" defaultValue={editing.okr?.currentProgress ?? ""} />
            </Field>
            <Field label="Manual completion % (0-100)" hint="Only when target is text - otherwise auto">
              <TextInput name="manualCompletionPct" inputMode="numeric" defaultValue={editing.okr?.manualCompletionPct?.toString() ?? ""} />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Notes" hint="Blockers, context, updates">
                <TextArea name="notes" defaultValue={editing.okr?.notes ?? ""} />
              </Field>
            </div>
          </div>
          <div className="mt-4 flex items-center gap-3">
            <SubmitButton>{editing.okr ? "Save OKR" : "Create OKR"}</SubmitButton>
            <FormError message={error} />
          </div>
        </form>
      )}
    </section>
  );
}

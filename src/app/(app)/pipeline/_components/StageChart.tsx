"use client";

import { useState } from "react";
import { Workflow } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Card, CardTitle, Pill } from "@/components/ui/kit";
import { formatDate, formatDuration } from "@/lib/format";
import { LEAD_SOURCE_LABELS, LEAD_STAGE_LABELS, PROGRAM_LEVEL_LABELS } from "@/lib/labels";
import type { LeadRow } from "@/server/pipeline-metrics";

// Live stage distribution: where every lead sits right now (Section B stages).
const STAGE_ORDER = [
  "NEW_LEAD", "DISCO_BOOKED", "DISCO_NOT_BOOKED", "DISCO_COMPLETED",
  "SSS_BOOKED", "SSS_COMPLETED", "PROPOSAL_SENT",
  "SENT_TO_WORKSHOP", "WORKSHOP_FOLLOWUP", "OFFER_FOLLOWUP", "DEPOSIT_FOLLOWUP", "DEPOSIT_PAID",
  "WON", "LOST", "NO_SHOW",
] as const;

const stageColor = (s: string) =>
  s === "WON" || s === "DEPOSIT_PAID" ? "var(--ok)"
  : s === "LOST" || s === "NO_SHOW" ? "var(--risk)"
  : s === "DISCO_NOT_BOOKED" || s === "OFFER_FOLLOWUP" || s === "DEPOSIT_FOLLOWUP" ? "var(--watch)"
  : "var(--accent)";

export function StageChart({ leads }: { leads: LeadRow[] }) {
  const [openStage, setOpenStage] = useState<string | null>(null);

  const stageCounts = STAGE_ORDER.map((s) => ({
    key: s,
    label: LEAD_STAGE_LABELS[s] ?? s,
    count: leads.filter((l) => l.stage === s).length,
  }));
  const maxStage = Math.max(1, ...stageCounts.map((s) => s.count));

  const open = stageCounts.find((s) => s.key === openStage);
  const openLeads = open ? leads.filter((l) => l.stage === open.key) : [];

  return (
    <Card
      title={<CardTitle icon={<Workflow size={18} />}>Pipeline by stage</CardTitle>}
      subtitle="Every lead by its current stage - spot where deals pile up or leak. Click a stage to see its leads."
    >
      <div className="space-y-2">
        {stageCounts.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => s.count > 0 && setOpenStage(s.key)}
            disabled={s.count === 0}
            aria-label={`${s.label}: ${s.count} lead${s.count === 1 ? "" : "s"}`}
            className={`flex w-full items-center gap-3 rounded-field px-1 py-0.5 text-left transition-colors ${
              s.count > 0 ? "cursor-pointer hover:bg-ink/5" : "cursor-default"
            }`}
          >
            <span className="w-28 flex-none truncate text-xs font-medium text-muted sm:w-44 sm:text-sm">
              {s.label}
            </span>
            <div className="h-6 flex-1 overflow-hidden rounded-full bg-surface-2">
              <div
                className="flex h-full items-center justify-end rounded-full px-2 transition-all"
                style={{ width: `${Math.max(s.count ? 8 : 0, (s.count / maxStage) * 100)}%`, background: stageColor(s.key) }}
              >
                {s.count > 0 && <span className="text-caption font-bold text-on-accent">{s.count}</span>}
              </div>
            </div>
            <span className="w-6 flex-none text-right text-sm font-semibold tnum">{s.count}</span>
          </button>
        ))}
      </div>

      <Modal
        open={openStage !== null}
        onClose={() => setOpenStage(null)}
        title={open ? `${open.label} - ${open.count} lead${open.count === 1 ? "" : "s"}` : ""}
        subtitle="Every lead currently sitting at this stage."
        size="lg"
      >
        <ul className="space-y-2">
          {openLeads.map((l) => (
            <li key={l.id} className="rounded-field border border-line bg-surface-2 px-3 py-2.5 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{l.name}</span>
                <span className="tnum text-xs text-muted">{l.phone}</span>
                {l.wonLevel && <Pill tone="good">{PROGRAM_LEVEL_LABELS[l.wonLevel]}</Pill>}
                <span className="ml-auto text-xs text-muted">{formatDate(l.dateIn)}</span>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
                <span>Source: {LEAD_SOURCE_LABELS[l.leadSource] ?? l.leadSource}</span>
                <span>Assigned: {l.assignedTo ?? "Unassigned"}</span>
                <span>Entered by: {l.enteredBy}</span>
                {l.speedMs !== null && <span>Speed to lead: {formatDuration(l.speedMs)}</span>}
              </div>
              {l.notes && <p className="mt-1.5 text-xs text-muted">{l.notes}</p>}
            </li>
          ))}
        </ul>
      </Modal>
    </Card>
  );
}

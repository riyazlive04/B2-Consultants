"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { GripVertical } from "lucide-react";
import { LEAD_STAGE_LABELS } from "@/lib/labels";
import { moveLeadStage } from "@/server/pipeline-actions";
import { toast } from "@/components/ui/feedback";

/**
 * The drag-and-drop pipeline (spec Part 2 §9, offered as an alternative to rules-driven).
 *
 * Native HTML5 drag-and-drop rather than a library: this is one board with one interaction,
 * and a drag-drop dependency is a lot of bundle for that.
 *
 * Optimistic, with a real rollback. A card that snaps back on failure is the entire honesty
 * of the feature — the server enforces ownership and the Won-needs-a-level rule, so a move
 * genuinely can be refused, and a board that kept the card in the new column would be showing
 * a stage the database doesn't have.
 *
 * Keyboard users get a select on each card. Drag-and-drop is unusable without a pointer, and
 * a pipeline nobody can operate from a keyboard isn't an alternative mode, it's a downgrade.
 */

export type KanbanLead = {
  id: string;
  name: string;
  stage: string;
  ownerName: string | null;
  valueLabel: string | null;
  canMove: boolean;
};

export function KanbanBoard({ leads, stages }: { leads: KanbanLead[]; stages: string[] }) {
  const router = useRouter();
  const [rows, setRows] = useState(leads);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overStage, setOverStage] = useState<string | null>(null);

  async function move(id: string, toStage: string) {
    const card = rows.find((r) => r.id === id);
    if (!card || card.stage === toStage) return;
    if (!card.canMove) {
      toast("You can only move leads you entered", "error");
      return;
    }
    const before = rows;
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, stage: toStage } : r)));
    const res = await moveLeadStage(id, toStage);
    if (!res.ok) {
      setRows(before); // put it back where it really is
      toast(res.error, "error");
      return;
    }
    router.refresh();
  }

  return (
    <div className="overflow-x-auto pb-2">
      <div className="flex gap-3" style={{ minWidth: `${stages.length * 15}rem` }}>
        {stages.map((stage) => {
          const inStage = rows.filter((r) => r.stage === stage);
          return (
            <section
              key={stage}
              onDragOver={(e) => {
                e.preventDefault(); // required, or the drop never fires
                setOverStage(stage);
              }}
              onDragLeave={() => setOverStage((s) => (s === stage ? null : s))}
              onDrop={(e) => {
                e.preventDefault();
                setOverStage(null);
                if (dragId) void move(dragId, stage);
                setDragId(null);
              }}
              className={`flex w-60 flex-none flex-col rounded-card border bg-surface-2 p-2 transition-colors ${
                overStage === stage ? "border-accent bg-accent-soft" : "border-line"
              }`}
            >
              <header className="flex items-center justify-between px-1 py-1.5">
                <h3 className="text-caption font-semibold uppercase text-ink-3">
                  {LEAD_STAGE_LABELS[stage] ?? stage}
                </h3>
                <span className="tnum text-xs text-muted">{inStage.length}</span>
              </header>

              <div className="flex flex-col gap-2">
                {inStage.map((lead) => (
                  <article
                    key={lead.id}
                    draggable={lead.canMove}
                    onDragStart={() => setDragId(lead.id)}
                    onDragEnd={() => {
                      setDragId(null);
                      setOverStage(null);
                    }}
                    className={`rounded-field border border-line bg-surface p-2.5 shadow-card ${
                      lead.canMove ? "cursor-grab active:cursor-grabbing" : "opacity-70"
                    } ${dragId === lead.id ? "opacity-40" : ""}`}
                  >
                    <div className="flex items-start gap-1.5">
                      {lead.canMove && <GripVertical size={13} className="mt-0.5 flex-none text-ink-3" />}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-ink">{lead.name}</p>
                        {lead.ownerName && <p className="truncate text-xs text-muted">{lead.ownerName}</p>}
                        {lead.valueLabel && <p className="tnum mt-0.5 text-xs text-ink-2">{lead.valueLabel}</p>}
                      </div>
                    </div>

                    {/* The keyboard path to the same action. */}
                    {lead.canMove && (
                      <select
                        aria-label={`Move ${lead.name} to another stage`}
                        value={lead.stage}
                        onChange={(e) => void move(lead.id, e.target.value)}
                        className="mt-2 w-full rounded-btn border border-line bg-surface-2 px-1.5 py-1 text-xs text-ink-2"
                      >
                        {stages.map((s) => (
                          <option key={s} value={s}>
                            {LEAD_STAGE_LABELS[s] ?? s}
                          </option>
                        ))}
                      </select>
                    )}
                  </article>
                ))}
                {inStage.length === 0 && (
                  <p className="px-1 py-4 text-center text-xs text-muted">Drop here</p>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

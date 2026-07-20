"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Plus, Settings2, GripVertical, Trash2, ChevronUp, ChevronDown, Pin } from "lucide-react";
import type { BoardData } from "@/server/opportunities-metrics";
import { Btn, IconButton } from "@/components/ui/controls";
import { Modal } from "@/components/ui/Modal";
import { Field, TextInput, Select, TextArea, SubmitButton, FormError } from "@/components/ui/form";
import { toast, askConfirm } from "@/components/ui/feedback";
import { Avatar, EmptyState, Pill } from "@/components/ui/kit";
import { Tabs } from "@/components/ui/Tabs";
import { DateText } from "@/components/ui/DateText";
import {
  moveOpportunity, createOpportunity, updateOpportunity, deleteOpportunity,
  createPipeline, deletePipeline, addStage, renameStage, deleteStage, reorderStages,
  setStageLegacyStage,
  getOpportunityNotes, createOpportunityNote, toggleOpportunityNotePin, deleteOpportunityNote,
  type OpportunityNote,
} from "@/server/opportunities-actions";
import { LEAD_STAGE_LABELS } from "@/lib/labels";

// Options for mapping a custom pipeline's stage back to a lead-lifecycle stage (the bridge that
// syncs a card move to Lead.stage). "" = no sync; the board stays a standalone process.
const LIFECYCLE_OPTS = [
  { value: "", label: "— No lead-stage sync —" },
  ...Object.entries(LEAD_STAGE_LABELS).map(([value, label]) => ({ value, label })),
];

const SOURCE_OPTS = [
  { value: "", label: "— source —" },
  { value: "INSTAGRAM", label: "Instagram" }, { value: "YOUTUBE", label: "YouTube" },
  { value: "LINKEDIN", label: "LinkedIn" }, { value: "WHATSAPP", label: "WhatsApp" },
  { value: "REFERRAL", label: "Referral" }, { value: "SUMMIT", label: "Summit" },
  { value: "WORKSHOP", label: "Workshop" }, { value: "META_ADS", label: "Meta Ads" },
  { value: "LANDING_PAGE", label: "Landing Page" }, { value: "GHOSTED_BLUEPRINT", label: "Ghosted Blueprint" },
  { value: "OTHER", label: "Other" },
];

type Stage = BoardData["stages"][number];
type Card = Stage["cards"][number];

export default function Board({
  board,
  contacts,
  canConfigure,
}: {
  board: BoardData;
  contacts: { id: string; name: string; phone: string | null }[];
  canConfigure: boolean;
}) {
  const router = useRouter();

  // Local, optimistic copy of the board's stages/cards. Drag-and-drop and the modal's "Move to
  // stage" select both update this instantly; a failed server call rolls it back. Re-synced
  // whenever the server sends a fresh `board` (after any revalidation). BUILD_CHECKLIST.md §4.
  const [stages, setStages] = useState<Stage[]>(board.stages);
  useEffect(() => setStages(board.stages), [board]);

  const [dragId, setDragId] = useState<string | null>(null);
  const [dropStage, setDropStage] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [addMode, setAddMode] = useState<"existing" | "new">(contacts.length ? "existing" : "new");
  const [editCard, setEditCard] = useState<Card | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [manageOpen, setManageOpen] = useState(false);
  const [createFirstOpen, setCreateFirstOpen] = useState(false);
  const [mobileStageId, setMobileStageId] = useState<string>(board.stages[0]?.id ?? "");

  useEffect(() => {
    if (!stages.find((s) => s.id === mobileStageId)) setMobileStageId(stages[0]?.id ?? "");
  }, [stages, mobileStageId]);

  // Auto-scroll while dragging a card. Native HTML5 drag doesn't scroll the board's overflow
  // container (or the page), so a card can't be dropped onto a stage that's scrolled off-screen —
  // you'd drag to the edge and get stuck. While a card is in flight we watch the pointer: near the
  // board's left/right edge we scroll the board horizontally (to reach an off-screen stage); near
  // the viewport's top/bottom we scroll the window (to reach cards low in a tall column). A rAF
  // loop keeps scrolling using the last-seen speed, so it continues even while the cursor is held
  // still at an edge (dragover stops firing when stationary). Listeners are wired only while
  // dragId is set and torn down (with the loop) the moment the drag ends.
  const boardRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);
  const speedRef = useRef({ x: 0, y: 0 });

  useEffect(() => {
    if (!dragId) return;
    const EDGE = 90; // px from an edge where auto-scroll starts ramping up
    const MAX = 22; // max px scrolled per frame at the very edge

    const tick = () => {
      const el = boardRef.current;
      const { x, y } = speedRef.current;
      if (el && x !== 0) el.scrollLeft += x;
      if (y !== 0) window.scrollBy(0, y);
      rafRef.current = x !== 0 || y !== 0 ? requestAnimationFrame(tick) : null;
    };
    const ensureLoop = () => {
      if (rafRef.current == null) rafRef.current = requestAnimationFrame(tick);
    };
    const stop = () => {
      speedRef.current = { x: 0, y: 0 };
      if (rafRef.current != null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    };
    const ramp = (over: number) => MAX * Math.min(1, over / EDGE);

    const onDragOver = (e: DragEvent) => {
      const el = boardRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      let x = 0;
      // Only scroll the board horizontally when the pointer is roughly within its vertical band,
      // so dragging over unrelated content below the board doesn't yank it sideways.
      if (e.clientY >= r.top - EDGE && e.clientY <= r.bottom + EDGE) {
        if (e.clientX < r.left + EDGE) x = -ramp(r.left + EDGE - e.clientX);
        else if (e.clientX > r.right - EDGE) x = ramp(e.clientX - (r.right - EDGE));
      }
      let y = 0;
      const vh = window.innerHeight;
      if (e.clientY < EDGE) y = -ramp(EDGE - e.clientY);
      else if (e.clientY > vh - EDGE) y = ramp(e.clientY - (vh - EDGE));
      speedRef.current = { x, y };
      if (x !== 0 || y !== 0) ensureLoop();
    };

    window.addEventListener("dragover", onDragOver);
    window.addEventListener("drop", stop);
    window.addEventListener("dragend", stop);
    return () => {
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("drop", stop);
      window.removeEventListener("dragend", stop);
      stop();
    };
  }, [dragId]);

  function moveCardLocally(id: string, toStageId: string, toIndex: number): Stage[] | null {
    let card: Card | undefined;
    let fromIdx = -1;
    for (let i = 0; i < stages.length; i++) {
      const found = stages[i].cards.find((c) => c.id === id);
      if (found) { card = found; fromIdx = i; break; }
    }
    const toIdx = stages.findIndex((s) => s.id === toStageId);
    if (!card || fromIdx === -1 || toIdx === -1) return null;

    const next = stages.map((s) => ({ ...s, cards: [...s.cards] }));
    next[fromIdx].cards = next[fromIdx].cards.filter((c) => c.id !== id);
    const clamped = Math.max(0, Math.min(toIndex, next[toIdx].cards.length));
    next[toIdx].cards.splice(clamped, 0, { ...card, stageId: toStageId });
    next[fromIdx].count = next[fromIdx].cards.length;
    next[toIdx].count = next[toIdx].cards.length;
    return next;
  }

  async function onDrop(toStageId: string, toIndex: number) {
    setDropStage(null);
    const id = dragId;
    setDragId(null);
    if (!id) return;

    // Dropping a card straight onto the Won column records it as a won deal (and, on the sales
    // pipeline, marks the underlying contact Won). That's easy to trigger with a stray drag, so a
    // direct-to-Won drop must be explicitly verified first. Only when the card is actually MOVING
    // into Won — reordering a card already in Won doesn't nag.
    const target = stages.find((s) => s.id === toStageId);
    const card = stages.flatMap((s) => s.cards).find((c) => c.id === id);
    const movingIntoWon = target?.legacyStage === "WON" && card?.stageId !== toStageId;
    if (movingIntoWon) {
      const ok = await askConfirm({
        title: `Mark "${card?.name ?? "this deal"}" as Won?`,
        body: "You dropped this card directly into Won. That records it as a won deal and moves the contact to the Won stage. Move the card back to undo.",
        confirmLabel: "Mark as Won",
      });
      if (!ok) return; // declined — leave the board exactly as it was, no move
    }

    const prev = stages;
    const optimistic = moveCardLocally(id, toStageId, toIndex);
    if (optimistic) setStages(optimistic);
    const res = await moveOpportunity(id, toStageId, toIndex);
    if (!res.ok) {
      setStages(prev);
      toast(res.error, "error");
    }
  }

  async function moveToStageFromModal(id: string, toStageId: string) {
    const prev = stages;
    const optimistic = moveCardLocally(id, toStageId, Number.MAX_SAFE_INTEGER);
    if (optimistic) setStages(optimistic);
    return prev;
  }

  async function addOpp(fd: FormData) {
    setAddError(null);
    if (board.activePipelineId) fd.set("pipelineId", board.activePipelineId);
    if (addMode === "existing") { fd.delete("newName"); fd.delete("newPhone"); }
    else fd.delete("leadId");
    const res = await createOpportunity(fd);
    if (!res.ok) return setAddError(res.error);
    toast("Opportunity created");
    setAddOpen(false);
  }

  async function saveOpp(fd: FormData) {
    if (!editCard) return;
    setEditError(null);
    const newStageId = String(fd.get("stageId") ?? editCard.stageId);
    let rollback: Stage[] | null = null;
    if (newStageId !== editCard.stageId) {
      rollback = await moveToStageFromModal(editCard.id, newStageId);
    } else {
      fd.delete("stageId");
    }
    const res = await updateOpportunity(editCard.id, fd);
    if (!res.ok) {
      if (rollback) setStages(rollback);
      return setEditError(res.error);
    }
    toast("Opportunity updated");
    setEditCard(null);
  }

  async function removeOpp() {
    if (!editCard) return;
    if (!(await askConfirm({ title: `Delete "${editCard.name}"?`, danger: true }))) return;
    const res = await deleteOpportunity(editCard.id);
    if (res.ok) { toast("Opportunity deleted"); setEditCard(null); }
    else toast(res.error, "error");
  }

  if (board.pipelines.length === 0) {
    return (
      <>
        <EmptyState
          title="No pipelines yet"
          body="Create a pipeline to start tracking deals through stages."
          action={
            canConfigure ? (
              <Btn icon={<Plus size={16} />} onClick={() => setCreateFirstOpen(true)}>
                Create pipeline
              </Btn>
            ) : undefined
          }
        />
        {canConfigure && (
          <Modal open={createFirstOpen} onClose={() => setCreateFirstOpen(false)} title="Create pipeline" size="sm">
            <form
              action={async (fd) => {
                const r = await createPipeline(fd);
                if (r.ok) { toast("Pipeline created"); setCreateFirstOpen(false); router.refresh(); }
                else toast(r.error, "error");
              }}
              className="space-y-4"
            >
              <Field label="Pipeline name"><TextInput kind="text" name="name" required placeholder="e.g. Sales" /></Field>
              <div className="flex justify-end gap-2 pt-1">
                <Btn variant="ghost" type="button" onClick={() => setCreateFirstOpen(false)}>Cancel</Btn>
                <SubmitButton>Create</SubmitButton>
              </div>
            </form>
          </Modal>
        )}
      </>
    );
  }

  const stageOpts = stages.map((s) => ({ value: s.id, label: s.name }));
  const ownerOpts = [{ value: "", label: "— unassigned —" }, ...board.owners.map((o) => ({ value: o.id, label: o.name }))];
  const mobileStage = stages.find((s) => s.id === mobileStageId) ?? stages[0];

  return (
    <div className="space-y-4">
      {/* Pipeline switcher + actions */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {board.pipelines.map((p) => (
            <button
              key={p.id}
              onClick={() => router.push(`/opportunities?pipeline=${p.id}`)}
              className={`rounded-full px-3 py-1.5 text-sm font-semibold ${p.id === board.activePipelineId ? "bg-primary text-on-accent" : "bg-surface-2 text-ink-2 hover:bg-sky"}`}
            >
              {p.name}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          {board.weightedTotalValueInr && (
            <span className="text-caption text-ink-3" title="Sum of each stage's value × its configured probability">
              Weighted: <span className="font-semibold text-ink-2">{board.weightedTotalValueInr}</span>
            </span>
          )}
          {canConfigure && (
            <Btn variant="ghost" icon={<Settings2 size={16} />} onClick={() => setManageOpen(true)}>
              Manage board
            </Btn>
          )}
          <Btn icon={<Plus size={16} />} onClick={() => { setAddError(null); setAddOpen(true); }}>
            Add opportunity
          </Btn>
        </div>
      </div>

      {/* Mobile: single-column, stage picker instead of a horizontal-scrolling board. Also the
          non-drag path for touch devices — cards move via the edit modal's Stage field. */}
      <div className="md:hidden">
        <Select
          aria-label="Stage"
          value={mobileStageId}
          onChange={(e) => setMobileStageId(e.target.value)}
          options={stages.map((s) => ({ value: s.id, label: `${s.name} (${s.count})` }))}
        />
        {mobileStage && (
          <div className="mt-3 space-y-2">
            <StageTotals stage={mobileStage} />
            {mobileStage.cards.map((card) => (
              <OppCard
                key={card.id}
                card={card}
                draggable={false}
                dragActive={false}
                onOpen={() => { setEditError(null); setEditCard(card); }}
              />
            ))}
            {mobileStage.cards.length === 0 && (
              <p className="rounded-field border border-dashed border-line py-6 text-center text-caption text-ink-3">No cards in this stage</p>
            )}
          </div>
        )}
      </div>

      {/* Desktop / tablet: full drag-and-drop board */}
      <div ref={boardRef} className="hidden gap-3 overflow-x-auto pb-3 md:flex">
        {stages.map((stage) => (
          <div
            key={stage.id}
            onDragOver={(e) => { e.preventDefault(); setDropStage(stage.id); }}
            onDrop={() => onDrop(stage.id, stage.cards.length)}
            className={`flex w-72 flex-none flex-col rounded-card border bg-surface-2 ${dropStage === stage.id ? "border-primary" : "border-line"}`}
          >
            <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2.5">
              <span className="truncate text-sm font-semibold text-ink">{stage.name}</span>
              <span className="flex-none rounded-full bg-surface px-2 py-0.5 text-caption font-semibold text-ink-2">{stage.count}</span>
            </div>
            <StageTotals stage={stage} />
            <div className="flex-1 space-y-2 p-2">
              {stage.cards.map((card, i) => (
                <OppCard
                  key={card.id}
                  card={card}
                  draggable
                  dragActive={dragId === card.id}
                  onDragStart={() => setDragId(card.id)}
                  onDragEnd={() => setDragId(null)}
                  onDropOn={(e) => { e.stopPropagation(); onDrop(stage.id, i); }}
                  onOpen={() => { setEditError(null); setEditCard(card); }}
                />
              ))}
              {stage.cards.length === 0 && (
                <p className="rounded-field border border-dashed border-line py-6 text-center text-caption text-ink-3">Drop here</p>
              )}
              {stage.hasMore && (
                <p className="text-center text-caption text-ink-3">More cards exist in this stage than are shown — filter or split this pipeline.</p>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Add opportunity */}
      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Add opportunity" size="md">
        <form action={addOpp} className="space-y-4">
          <div className="flex gap-2">
            <button type="button" onClick={() => setAddMode("existing")} className={`flex-1 rounded-field border px-3 py-2 text-sm font-semibold ${addMode === "existing" ? "border-primary bg-primary-soft text-primary-strong" : "border-line text-ink-2"}`}>
              Existing contact
            </button>
            <button type="button" onClick={() => setAddMode("new")} className={`flex-1 rounded-field border px-3 py-2 text-sm font-semibold ${addMode === "new" ? "border-primary bg-primary-soft text-primary-strong" : "border-line text-ink-2"}`}>
              New contact
            </button>
          </div>
          {addMode === "existing" ? (
            <Field label="Contact">
              <Select name="leadId" options={[{ value: "", label: "— pick a contact —" }, ...contacts.map((c) => ({ value: c.id, label: `${c.name} · ${c.phone ?? "no phone"}` }))]} defaultValue="" />
            </Field>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Name"><TextInput kind="name" name="newName" placeholder="Full name" /></Field>
              <Field label="Phone"><TextInput kind="phone" name="newPhone" placeholder="+91…" /></Field>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Stage"><Select name="stageId" options={stageOpts} defaultValue={stageOpts[0]?.value} /></Field>
            <Field label="Value (₹)"><TextInput kind="money" name="valueInr" placeholder="150000" /></Field>
            {/* Deal name is free text, not kind="name": "Level 2 — Q3 renewal" is a real deal. */}
            <Field label="Deal name"><TextInput kind="text" name="name" placeholder="Defaults to contact name" /></Field>
            <Field label="Source"><Select name="source" options={SOURCE_OPTS} defaultValue="" /></Field>
            <Field label="Owner"><Select name="assignedToId" options={ownerOpts} defaultValue="" /></Field>
          </div>
          <FormError message={addError} />
          <div className="flex justify-end gap-2 pt-1">
            <Btn variant="ghost" type="button" onClick={() => setAddOpen(false)}>Cancel</Btn>
            <SubmitButton>Add opportunity</SubmitButton>
          </div>
        </form>
      </Modal>

      {/* Edit opportunity — Details (the existing form, untouched) + Notes (BUILD_CHECKLIST.md
          §3: Opportunity gets its own notes via ContactNote.opportunityId, not just the parent
          Lead's). Two tabs rather than one long scroll, and the note form has to be a sibling of
          the Details form (not nested inside it) since HTML forms can't nest — Tabs only ever
          mounts one panel at a time, so that's naturally satisfied here. */}
      <Modal open={!!editCard} onClose={() => setEditCard(null)} title="Edit opportunity" size="md">
        {editCard && (
          <Tabs
            tabs={[
              {
                label: "Details",
                content: (
                  <form action={saveOpp} key={editCard.id} className="space-y-4">
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="Deal name"><TextInput kind="text" name="name" required defaultValue={editCard.name} /></Field>
                      <Field label="Value (₹)"><TextInput kind="money" name="valueInr" defaultValue={editCard.valueInr.replace(/[^\d.]/g, "")} /></Field>
                      <Field label="Stage">
                        <Select name="stageId" options={stageOpts} defaultValue={editCard.stageId} />
                      </Field>
                      <Field label="Source"><Select name="source" options={SOURCE_OPTS} defaultValue={editCard.source ?? ""} /></Field>
                      <Field label="Status"><Select name="status" options={[{ value: "OPEN", label: "Open" }, { value: "WON", label: "Won" }, { value: "LOST", label: "Lost" }, { value: "ABANDONED", label: "Abandoned" }]} defaultValue={editCard.status} /></Field>
                      <Field label="Owner"><Select name="assignedToId" options={ownerOpts} defaultValue={editCard.ownerId ?? ""} /></Field>
                    </div>
                    <FormError message={editError} />
                    <div className="flex items-center justify-between pt-1">
                      <Btn variant="danger" type="button" icon={<Trash2 size={15} />} onClick={removeOpp}>Delete</Btn>
                      <div className="flex gap-2">
                        <Btn variant="ghost" type="button" onClick={() => setEditCard(null)}>Cancel</Btn>
                        <SubmitButton>Save</SubmitButton>
                      </div>
                    </div>
                  </form>
                ),
              },
              {
                label: "Notes",
                content: <OpportunityNotesPanel key={editCard.id} opportunityId={editCard.id} />,
              },
            ]}
          />
        )}
      </Modal>

      {/* Manage board */}
      {canConfigure && <ManageBoard board={board} open={manageOpen} onClose={() => setManageOpen(false)} />}
    </div>
  );
}

function StageTotals({ stage }: { stage: Stage }) {
  return (
    <div className="flex items-baseline gap-2 px-3 py-1.5 text-caption font-semibold text-ink-3">
      <span>{stage.totalInr}</span>
      {stage.weightedTotalInr && (
        <span title={`Weighted at ${stage.probability}% probability`}>· weighted {stage.weightedTotalInr}</span>
      )}
    </div>
  );
}

function OppCard({
  card,
  draggable,
  dragActive,
  onDragStart,
  onDragEnd,
  onDropOn,
  onOpen,
}: {
  card: Card;
  draggable: boolean;
  dragActive: boolean;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  onDropOn?: (e: React.DragEvent) => void;
  onOpen: () => void;
}) {
  return (
    <div
      draggable={draggable}
      onDragStart={draggable ? onDragStart : undefined}
      onDragEnd={draggable ? onDragEnd : undefined}
      onDrop={draggable ? onDropOn : undefined}
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); }
      }}
      className={`cursor-pointer rounded-field border border-line bg-surface p-3 shadow-card transition-shadow hover:shadow-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2 ${dragActive ? "opacity-40" : ""}`}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 truncate text-sm font-semibold text-ink">{card.name}</p>
        {draggable && <GripVertical size={14} className="flex-none text-ink-3" />}
      </div>
      <Link
        href={`/contacts/${card.contactId}`}
        onClick={(e) => e.stopPropagation()}
        className="mt-0.5 block truncate text-caption text-ink-3 hover:text-primary"
      >
        {card.contactName}
      </Link>
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="text-sm font-semibold text-ink">{card.valueInr}</span>
        {card.source && <Pill tone="neutral">{card.source.replaceAll("_", " ").toLowerCase()}</Pill>}
      </div>
      {card.ownerName && (
        <div className="mt-2 flex items-center gap-1.5 text-caption text-ink-3">
          <Avatar name={card.ownerName} size={18} /> {card.ownerName}
        </div>
      )}
    </div>
  );
}

function ManageBoard({ board, open, onClose }: { board: BoardData; open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [newStage, setNewStage] = useState("");
  const [newPipeline, setNewPipeline] = useState("");
  const [names, setNames] = useState<Record<string, string>>(Object.fromEntries(board.stages.map((s) => [s.id, s.name])));
  const [order, setOrder] = useState<string[]>(board.stages.map((s) => s.id));

  useEffect(() => {
    setNames(Object.fromEntries(board.stages.map((s) => [s.id, s.name])));
    setOrder(board.stages.map((s) => s.id));
  }, [board]);

  const byId = Object.fromEntries(board.stages.map((s) => [s.id, s]));
  // The default Sales pipeline's stage→lifecycle mapping is seed-managed (load-bearing for the
  // whole lead lifecycle), so the picker is offered only on custom pipelines.
  const activeIsDefault = !!board.pipelines.find((p) => p.id === board.activePipelineId)?.isDefault;

  async function moveStage(id: string, dir: -1 | 1) {
    const idx = order.indexOf(id);
    const swapWith = idx + dir;
    if (swapWith < 0 || swapWith >= order.length) return;
    const prev = order;
    const next = [...order];
    [next[idx], next[swapWith]] = [next[swapWith], next[idx]];
    setOrder(next);
    const r = await reorderStages(board.activePipelineId!, next);
    if (!r.ok) { setOrder(prev); toast(r.error, "error"); }
    else router.refresh();
  }

  return (
    <Modal open={open} onClose={onClose} title="Manage board" subtitle={board.activePipelineName ?? ""} size="md">
      <div className="space-y-5">
        <section>
          <h3 className="mb-2 text-caption font-semibold uppercase text-ink-3">Stages</h3>
          <div className="space-y-2">
            {order.map((id, i) => {
              const s = byId[id];
              if (!s) return null;
              return (
                <div key={id} className="space-y-1.5">
                  <div className="flex items-center gap-1.5">
                    <div className="flex flex-col">
                      <IconButton label="Move stage up" size="sm" onClick={() => moveStage(id, -1)} disabled={i === 0}>
                        <ChevronUp size={13} />
                      </IconButton>
                      <IconButton label="Move stage down" size="sm" onClick={() => moveStage(id, 1)} disabled={i === order.length - 1}>
                        <ChevronDown size={13} />
                      </IconButton>
                    </div>
                    <input
                      value={names[id] ?? ""}
                      onChange={(e) => setNames((v) => ({ ...v, [id]: e.target.value }))}
                      className="h-9 flex-1 rounded-field border border-line bg-surface px-3 text-sm outline-none focus:border-primary"
                    />
                    <Btn size="sm" variant="soft" onClick={async () => { const r = await renameStage(id, names[id] ?? ""); if (r.ok) toast("Stage renamed"); else toast(r.error, "error"); }}>Save</Btn>
                    <IconButton label="Delete stage" onClick={async () => { if (await askConfirm({ title: `Delete "${s.name}"?`, danger: true })) { const r = await deleteStage(id); if (r.ok) toast("Stage deleted"); else toast(r.error, "error"); } }}>
                      <Trash2 size={15} />
                    </IconButton>
                  </div>
                  {/* Custom pipelines opt into the Lead.stage bridge per stage — moving a card here
                      then syncs the contact's lifecycle stage (funnel/reminders stay correct). */}
                  {!activeIsDefault && (
                    <div className="flex items-center gap-2 pl-10">
                      <span className="whitespace-nowrap text-caption text-ink-3">Syncs lead stage →</span>
                      <Select
                        key={`${id}-${s.legacyStage ?? "none"}`}
                        size="sm"
                        defaultValue={s.legacyStage ?? ""}
                        aria-label={`Lead lifecycle stage for ${s.name}`}
                        options={LIFECYCLE_OPTS}
                        onChange={async (e) => {
                          const r = await setStageLegacyStage(id, e.target.value);
                          if (r.ok) {
                            toast(e.target.value ? `Mapped to "${LEAD_STAGE_LABELS[e.target.value] ?? e.target.value}"` : "Sync cleared");
                            router.refresh();
                          } else toast(r.error, "error");
                        }}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {board.activePipelineId && (
            <div className="mt-3 flex gap-2">
              <input value={newStage} onChange={(e) => setNewStage(e.target.value)} placeholder="New stage name" className="h-9 flex-1 rounded-field border border-line bg-surface px-3 text-sm outline-none focus:border-primary" />
              <Btn size="sm" icon={<Plus size={15} />} onClick={async () => { if (!newStage.trim()) return; const r = await addStage(board.activePipelineId!, newStage); if (r.ok) { toast("Stage added"); setNewStage(""); } else toast(r.error, "error"); }}>Add</Btn>
            </div>
          )}
        </section>

        <section className="border-t border-line pt-4">
          <h3 className="mb-2 text-caption font-semibold uppercase text-ink-3">Pipelines</h3>
          <form
            action={async (fd) => { const r = await createPipeline(fd); if (r.ok) { toast("Pipeline created"); setNewPipeline(""); } else toast(r.error, "error"); }}
            className="flex gap-2"
          >
            <input name="name" value={newPipeline} onChange={(e) => setNewPipeline(e.target.value)} placeholder="New pipeline name" className="h-9 flex-1 rounded-field border border-line bg-surface px-3 text-sm outline-none focus:border-primary" />
            <SubmitButton>Create</SubmitButton>
          </form>
          {board.activePipelineId && !board.pipelines.find((p) => p.id === board.activePipelineId)?.isDefault && (
            <Btn
              variant="danger"
              className="mt-3"
              icon={<Trash2 size={15} />}
              onClick={async () => { if (await askConfirm({ title: `Delete "${board.activePipelineName}" and all its opportunities?`, danger: true })) { const r = await deletePipeline(board.activePipelineId!); if (r.ok) toast("Pipeline deleted"); else toast(r.error, "error"); } }}
            >
              Delete this pipeline
            </Btn>
          )}
        </section>
      </div>
    </Modal>
  );
}

/**
 * Notes tab of the opportunity edit modal (BUILD_CHECKLIST.md §3). Mirrors ContactRecord.tsx's
 * `Notes()` component almost exactly, but fetches on demand via a server action instead of
 * reading server-supplied props — the board only ever loads BoardCard data (no notes) for every
 * card up front, so pulling a deal's notes into this component would mean fetching notes for
 * every open/won/lost card on every board load. Fetching per-opportunity, only when its edit
 * modal actually opens, keeps the board query exactly as bounded as §4 already made it.
 */
function OpportunityNotesPanel({ opportunityId }: { opportunityId: string }) {
  const [notes, setNotes] = useState<OpportunityNote[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [addError, setAddError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    let cancelled = false;
    setNotes(null);
    setLoadError(null);
    getOpportunityNotes(opportunityId)
      .then((rows) => { if (!cancelled) setNotes(rows); })
      .catch(() => { if (!cancelled) setLoadError("Couldn't load notes."); });
    return () => {
      cancelled = true;
    };
  }, [opportunityId]);

  async function add(fd: FormData) {
    setAddError(null);
    const res = await createOpportunityNote(opportunityId, fd);
    if (!res.ok) return setAddError(res.error);
    toast(res.mentionedCount ? `Note added — mentioned ${res.mentionedCount}` : "Note added");
    formRef.current?.reset();
    setNotes(await getOpportunityNotes(opportunityId));
  }

  async function togglePin(note: OpportunityNote) {
    const res = await toggleOpportunityNotePin(note.id);
    if (!res.ok) return toast(res.error, "error");
    toast(note.pinned ? "Unpinned" : "Pinned");
    setNotes((prev) => prev?.map((n) => (n.id === note.id ? { ...n, pinned: !n.pinned } : n)) ?? prev);
  }

  async function remove(id: string) {
    if (!(await askConfirm({ title: "Delete note?", danger: true }))) return;
    const res = await deleteOpportunityNote(id);
    if (!res.ok) return toast(res.error, "error");
    toast("Note deleted");
    setNotes((prev) => prev?.filter((n) => n.id !== id) ?? prev);
  }

  return (
    <div className="space-y-4">
      <form action={add} ref={formRef} className="space-y-2">
        <TextArea kind="text" name="body" rows={3} placeholder="Write a note about this deal…" />
        <FormError message={addError} />
        <div className="flex justify-end"><SubmitButton>Add note</SubmitButton></div>
      </form>
      <div className="space-y-3">
        {loadError && <p className="text-sm text-risk">{loadError}</p>}
        {notes === null && !loadError && <p className="text-sm text-ink-3">Loading notes…</p>}
        {notes !== null && notes.length === 0 && <p className="text-sm text-ink-3">No notes yet.</p>}
        {notes?.map((n) => (
          <div key={n.id} className="rounded-field border border-line bg-surface-2 p-3">
            <p className="whitespace-pre-wrap text-sm text-ink">{n.body}</p>
            <div className="mt-2 flex items-center justify-between">
              <span className="text-caption text-ink-3">
                {n.authorName ?? "—"} · <DateText date={n.createdAt} />
              </span>
              <div className="flex items-center gap-1">
                {n.pinned && <Pill tone="warn">Pinned</Pill>}
                <IconButton label="Pin note" onClick={() => togglePin(n)}>
                  <Pin size={14} />
                </IconButton>
                <IconButton label="Delete note" onClick={() => remove(n.id)}>
                  <Trash2 size={14} />
                </IconButton>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

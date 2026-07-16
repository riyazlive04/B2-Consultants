"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, Plus, Trash2, ArrowUp, ArrowDown, Link2, Globe, ExternalLink, GripVertical,
} from "lucide-react";
import type { FunnelDetail, EditorStep } from "@/server/funnels-metrics";
import type { Block, BlockType } from "@/lib/sites-types";
import { blockLabel } from "@/lib/sites-types";
import { Btn, IconButton } from "@/components/ui/controls";
import { Select } from "@/components/ui/form";
import { Card } from "@/components/ui/kit";
import { toast, askConfirm } from "@/components/ui/feedback";
import {
  renameFunnel, togglePublishFunnel, addStep, deleteStep, reorderSteps, saveStepBlocks,
} from "@/server/funnels-actions";

const BLOCK_TYPES: BlockType[] = ["heading", "subheading", "text", "image", "button", "bullets", "video", "form", "row", "divider", "spacer"];
const inputCls = "h-9 w-full rounded-field border border-line bg-surface px-3 text-sm outline-none focus:border-primary";
const areaCls = "w-full rounded-field border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-primary";

let seq = 0;
const newId = () => `b${Date.now().toString(36)}${seq++}`;

type Draft = { blocks: Block[]; name: string; seoTitle: string; seoDescription: string };
function toDraft(step: EditorStep | undefined): Draft {
  return {
    blocks: step?.blocks ?? [],
    name: step?.name ?? "",
    seoTitle: step?.seoTitle ?? "",
    seoDescription: step?.seoDescription ?? "",
  };
}

export default function FunnelBuilder({ funnel, forms }: { funnel: FunnelDetail; forms: { id: string; name: string }[] }) {
  const router = useRouter();
  const [name, setName] = useState(funnel.name);
  const [published, setPublished] = useState(funnel.published);
  const [activeId, setActiveId] = useState(funnel.steps[0]?.id ?? "");
  const [draft, setDraft] = useState<Draft>(() => toDraft(funnel.steps[0]));
  const [newStepName, setNewStepName] = useState("");

  const active = funnel.steps.find((s) => s.id === activeId);

  // Keep selection valid when steps change server-side.
  useEffect(() => {
    if (!funnel.steps.find((s) => s.id === activeId)) {
      const first = funnel.steps[0];
      setActiveId(first?.id ?? "");
      setDraft(toDraft(first));
    }
  }, [funnel.steps, activeId]);

  function selectStep(id: string) {
    setActiveId(id);
    setDraft(toDraft(funnel.steps.find((s) => s.id === id)));
  }

  // ── persistence ──
  async function saveStep() {
    if (!activeId) return;
    const res = await saveStepBlocks(activeId, { blocks: draft.blocks, name: draft.name, seoTitle: draft.seoTitle, seoDescription: draft.seoDescription });
    if (!res.ok) return toast(res.error, "error");
    toast("Step saved");
    router.refresh();
  }
  async function publish() {
    const res = await togglePublishFunnel(funnel.id);
    if (!res.ok) return toast(res.error, "error");
    setPublished((p) => !p);
    toast(published ? "Unpublished" : "Published");
    router.refresh();
  }
  async function saveName() {
    if (name.trim() === funnel.name) return;
    const res = await renameFunnel(funnel.id, name);
    if (res.ok) { toast("Renamed"); router.refresh(); } else toast(res.error, "error");
  }
  async function doAddStep() {
    if (!newStepName.trim()) return;
    const res = await addStep(funnel.id, newStepName);
    if (res.ok) { toast("Step added"); setNewStepName(""); router.refresh(); } else toast(res.error, "error");
  }
  async function doDeleteStep(id: string) {
    if (!(await askConfirm({ title: "Delete this step?", danger: true }))) return;
    const res = await deleteStep(id);
    if (res.ok) { toast("Step deleted"); router.refresh(); } else toast(res.error, "error");
  }
  async function moveStep(i: number, dir: -1 | 1) {
    const ids = funnel.steps.map((s) => s.id);
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    const res = await reorderSteps(funnel.id, ids);
    if (res.ok) router.refresh();
  }

  async function copyLink() {
    await navigator.clipboard.writeText(`${window.location.origin}/p/${funnel.slug}`).catch(() => {});
    toast("Public link copied");
  }

  return (
    <div className="space-y-5">
      <Link href="/funnels" className="inline-flex items-center gap-1.5 text-sm text-ink-2 hover:text-primary"><ArrowLeft size={16} /> Funnels</Link>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <input value={name} onChange={(e) => setName(e.target.value)} onBlur={saveName} className="min-w-0 flex-1 border-0 bg-transparent font-display text-display-l font-bold text-ink outline-none" />
        <div className="flex items-center gap-2">
          {active && <a href={`/p/${funnel.slug}/${active.slug}`} target="_blank" rel="noreferrer"><Btn variant="ghost" icon={<ExternalLink size={16} />}>Preview</Btn></a>}
          {published && <Btn variant="ghost" icon={<Link2 size={16} />} onClick={copyLink}>Copy link</Btn>}
          <Btn variant={published ? "soft" : "primary"} icon={<Globe size={16} />} onClick={publish}>{published ? "Unpublish" : "Publish"}</Btn>
          <Btn onClick={saveStep}>Save step</Btn>
        </div>
      </div>
      <p className="text-sm text-ink-3">Public URL: <span className="font-mono">/p/{funnel.slug}</span> · {published ? "live" : "draft"}</p>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[240px_1fr]">
        {/* Steps */}
        <Card title="Steps">
          <div className="space-y-1.5">
            {funnel.steps.map((s, i) => (
              <div key={s.id} className={`flex items-center gap-1 rounded-field px-2 py-1.5 ${s.id === activeId ? "bg-primary-soft" : "hover:bg-surface-2"}`}>
                <button onClick={() => selectStep(s.id)} className={`min-w-0 flex-1 truncate text-left text-sm font-medium ${s.id === activeId ? "text-primary-strong" : "text-ink-2"}`}>
                  {s.name}
                </button>
                <IconButton label="Move up" onClick={() => moveStep(i, -1)}><ArrowUp size={13} /></IconButton>
                <IconButton label="Move down" onClick={() => moveStep(i, 1)}><ArrowDown size={13} /></IconButton>
                <IconButton label="Delete step" onClick={() => doDeleteStep(s.id)}><Trash2 size={13} /></IconButton>
              </div>
            ))}
          </div>
          <div className="mt-3 flex gap-1.5">
            <input value={newStepName} onChange={(e) => setNewStepName(e.target.value)} placeholder="New step" className={inputCls} onKeyDown={(e) => e.key === "Enter" && doAddStep()} />
            <Btn size="sm" icon={<Plus size={14} />} onClick={doAddStep}>Add</Btn>
          </div>
        </Card>

        {/* Block editor */}
        <div className="space-y-4">
          {active ? (
            <>
              <Card title="Page">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className="text-caption font-semibold uppercase text-ink-3">Step name
                    <input className={inputCls} value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} />
                  </label>
                  <label className="text-caption font-semibold uppercase text-ink-3">SEO title
                    <input className={inputCls} value={draft.seoTitle} onChange={(e) => setDraft((d) => ({ ...d, seoTitle: e.target.value }))} />
                  </label>
                  <label className="text-caption font-semibold uppercase text-ink-3 sm:col-span-2">SEO description
                    <input className={inputCls} value={draft.seoDescription} onChange={(e) => setDraft((d) => ({ ...d, seoDescription: e.target.value }))} />
                  </label>
                </div>
              </Card>

              <Card title="Blocks">
                <BlockListEditor
                  blocks={draft.blocks}
                  onChange={(blocks) => setDraft((d) => ({ ...d, blocks }))}
                  forms={forms}
                />
              </Card>
            </>
          ) : (
            <Card><p className="text-sm text-ink-3">Add a step to start building.</p></Card>
          )}
        </div>
      </div>
    </div>
  );
}

/** Renders an editable block list — add/reorder/remove + per-type fields. Used for the
 * top-level step blocks and, recursively, for each column of a "row" block. */
function BlockListEditor({
  blocks,
  onChange,
  forms,
}: {
  blocks: Block[];
  onChange: (blocks: Block[]) => void;
  forms: { id: string; name: string }[];
}) {
  function update(i: number, patch: Partial<Block>) {
    onChange(blocks.map((b, idx) => (idx === i ? { ...b, ...patch } : b)));
  }
  function remove(i: number) {
    onChange(blocks.filter((_, idx) => idx !== i));
  }
  function move(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= blocks.length) return;
    const next = [...blocks];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  }
  function addBlock(type: BlockType) {
    const base: Block = { id: newId(), type };
    if (type === "row") base.columns = [[], []];
    onChange([...blocks, base]);
  }

  return (
    <div className="space-y-3">
      {blocks.map((b, i) => (
        <div key={b.id} className="rounded-field border border-line bg-surface-2 p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-caption font-semibold uppercase text-ink-3">
              <GripVertical size={13} className="text-ink-3" /> {blockLabel(b.type)}
            </span>
            <div className="flex items-center gap-1">
              <IconButton label="Move up" onClick={() => move(i, -1)}><ArrowUp size={13} /></IconButton>
              <IconButton label="Move down" onClick={() => move(i, 1)}><ArrowDown size={13} /></IconButton>
              <IconButton label="Delete block" onClick={() => remove(i)}><Trash2 size={13} /></IconButton>
            </div>
          </div>
          {b.type === "row" ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {(b.columns ?? [[], []]).map((col, ci) => (
                <div key={ci} className="rounded-field border border-dashed border-line p-2">
                  <p className="mb-2 text-caption font-semibold uppercase text-ink-3">Column {ci + 1}</p>
                  <BlockListEditor
                    blocks={col}
                    forms={forms}
                    onChange={(nextCol) => {
                      const cols = b.columns ?? [[], []];
                      update(i, { columns: cols.map((c, idx) => (idx === ci ? nextCol : c)) });
                    }}
                  />
                </div>
              ))}
            </div>
          ) : (
            <BlockFields b={b} i={i} update={update} forms={forms} />
          )}
        </div>
      ))}
      <div className="flex flex-wrap gap-1.5">
        {BLOCK_TYPES.map((t) => (
          <Btn key={t} size="sm" variant="ghost" icon={<Plus size={13} />} onClick={() => addBlock(t)}>
            {blockLabel(t)}
          </Btn>
        ))}
      </div>
    </div>
  );
}

function AlignSelect({ b, i, update }: { b: Block; i: number; update: (i: number, p: Partial<Block>) => void }) {
  return (
    <Select size="sm" value={b.align ?? "center"} onChange={(e) => update(i, { align: e.target.value as Block["align"] })} options={[{ value: "left", label: "Left" }, { value: "center", label: "Center" }, { value: "right", label: "Right" }]} />
  );
}

function BlockFields({ b, i, update, forms }: { b: Block; i: number; update: (i: number, p: Partial<Block>) => void; forms: { id: string; name: string }[] }) {
  switch (b.type) {
    case "heading":
    case "subheading":
    case "text":
      return (
        <div className="space-y-2">
          <textarea className={areaCls} rows={b.type === "text" ? 3 : 1} value={b.text ?? ""} onChange={(e) => update(i, { text: e.target.value })} />
          <AlignSelect b={b} i={i} update={update} />
        </div>
      );
    case "image":
      return (
        <div className="space-y-2">
          <input className={inputCls} placeholder="Image URL (https://…)" value={b.url ?? ""} onChange={(e) => update(i, { url: e.target.value })} />
          <input className={inputCls} placeholder="Alt text" value={b.alt ?? ""} onChange={(e) => update(i, { alt: e.target.value })} />
        </div>
      );
    case "video":
      return <input className={inputCls} placeholder="Embed URL (YouTube/Vimeo embed src)" value={b.url ?? ""} onChange={(e) => update(i, { url: e.target.value })} />;
    case "button":
      return (
        <div className="grid grid-cols-2 gap-2">
          <input className={inputCls} placeholder="Label" value={b.label ?? ""} onChange={(e) => update(i, { label: e.target.value })} />
          <input className={inputCls} placeholder="Link (URL or /p/…)" value={b.href ?? ""} onChange={(e) => update(i, { href: e.target.value })} />
          <Select size="sm" value={b.variant ?? "primary"} onChange={(e) => update(i, { variant: e.target.value as Block["variant"] })} options={[{ value: "primary", label: "Primary" }, { value: "soft", label: "Soft" }, { value: "outline", label: "Outline" }]} />
          <AlignSelect b={b} i={i} update={update} />
        </div>
      );
    case "bullets":
      return <textarea className={areaCls} rows={3} placeholder="One item per line" value={(b.items ?? []).join("\n")} onChange={(e) => update(i, { items: e.target.value.split("\n").map((s) => s.trim()).filter(Boolean) })} />;
    case "spacer":
      return <input type="number" className={inputCls} placeholder="Height (px)" value={b.size ?? 24} onChange={(e) => update(i, { size: Number(e.target.value) || 0 })} />;
    case "form":
      return (
        <Select placeholder="— pick a published form —" value={b.formId ?? ""} onChange={(e) => update(i, { formId: e.target.value })} options={forms.map((f) => ({ value: f.id, label: f.name }))} />
      );
    case "divider":
      return <p className="text-caption text-ink-3">A horizontal divider.</p>;
    default:
      return null;
  }
}

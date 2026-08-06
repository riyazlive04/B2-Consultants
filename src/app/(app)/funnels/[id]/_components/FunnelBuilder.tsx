"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, Plus, Trash2, ArrowUp, ArrowDown, Link2, Globe, ExternalLink, GripVertical,
  FlaskConical, LayoutTemplate, Library, PanelTop, PanelBottom, RotateCcw, Eye,
} from "lucide-react";
import type { FunnelDetail, EditorStep } from "@/server/funnels-metrics";
import type { SnippetRow } from "@/server/snippets-metrics";
import type { Block, BlockType } from "@/lib/sites-types";
import { blockLabel, isContainer, normalizeRow } from "@/lib/sites-types";
import { weightShares } from "@/lib/ab";
import { Btn, IconButton } from "@/components/ui/controls";
import { Select } from "@/components/ui/form";
import { fieldKindProps } from "@/components/ui/field-base";
import { Card } from "@/components/ui/kit";
import PageEditor from "./PageEditor";
import { SaveSnippetDialog, SnippetPicker } from "./Snippets";
import { toast, askConfirm } from "@/components/ui/feedback";
import {
  renameFunnel, togglePublishFunnel, addStep, deleteStep, reorderSteps, saveStepBlocks,
  saveFunnelChrome, createVariant, setStepWeight, resetVariantViews,
} from "@/server/funnels-actions";

// Grouped the way the builder offers them: bands and layout first (a page is built out of
// containers), then content, then the escape hatch.
const BLOCK_TYPES: BlockType[] = [
  "section", "row", "card",
  "heading", "subheading", "eyebrow", "text", "bullets", "stat",
  "image", "video", "button", "form",
  "divider", "spacer", "html",
];
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

/** What the editor is pointed at. The header and footer are pages too — they just wrap the others. */
type Slot = "pages" | "header" | "footer";

export default function FunnelBuilder({
  funnel,
  forms,
  snippets,
  snippetCategories,
}: {
  funnel: FunnelDetail;
  forms: { id: string; name: string }[];
  snippets: SnippetRow[];
  snippetCategories: string[];
}) {
  const router = useRouter();
  const [name, setName] = useState(funnel.name);
  const [published, setPublished] = useState(funnel.published);
  const [slot, setSlot] = useState<Slot>("pages");
  const [activeId, setActiveId] = useState(funnel.steps[0]?.id ?? "");
  const [draft, setDraft] = useState<Draft>(() => toDraft(funnel.steps[0]));
  const [newStepName, setNewStepName] = useState("");
  const [saveState, setSaveState] = useState<"saved" | "dirty" | "saving" | "error">("saved");
  const [showTemplates, setShowTemplates] = useState(false);
  const [savingTemplate, setSavingTemplate] = useState<Block[] | null>(null);

  /**
   * The global header and footer.
   *
   * `null` is a real value here, not "not loaded" — it means the funnel has no such band, which
   * is what the empty-state button offers to change. An empty array is a header someone has
   * started and not yet filled, and the two must stay tellable apart or clearing a header would
   * be indistinguishable from never having had one.
   */
  const [chrome, setChrome] = useState<{ header: Block[] | null; footer: Block[] | null }>({
    header: funnel.headerBlocks,
    footer: funnel.footerBlocks,
  });

  // Controls and their variants, flat — selection works the same for both, because a variant IS
  // a page and editing it is the entire point of having one.
  const allSteps: EditorStep[] = funnel.steps.flatMap((s) => [s, ...s.variants]);
  const active = allSteps.find((s) => s.id === activeId);
  /** The control a variant belongs to — the public URL is always the control's. */
  const controlOf = (id: string): EditorStep | undefined =>
    funnel.steps.find((s) => s.id === id || s.variants.some((v) => v.id === id));
  const activeControl = active ? controlOf(active.id) : undefined;
  const isVariant = Boolean(active && activeControl && activeControl.id !== active.id);

  // Keep selection valid when steps change server-side.
  useEffect(() => {
    if (!allSteps.find((s) => s.id === activeId)) {
      const first = funnel.steps[0];
      setActiveId(first?.id ?? "");
      setDraft(toDraft(first));
    }
    // `allSteps` is derived fresh each render; `funnel.steps` is the prop that actually changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [funnel.steps, activeId]);

  /**
   * Adopt chrome edited elsewhere (another tab, another person, or our own save coming back).
   *
   * Keyed on the SERIALISED value, not on the arrays. `funnel.headerBlocks` is parsed fresh from
   * JSON on every server render, so its identity changes on every `router.refresh()` even when
   * not one character differs — depending on the array itself would reset the editor's state,
   * which then looks like an edit to the autosave below and writes the header back on every
   * publish, rename or step add.
   */
  const serverChrome = JSON.stringify([funnel.headerBlocks, funnel.footerBlocks]);
  useEffect(() => {
    setChrome({ header: funnel.headerBlocks, footer: funnel.footerBlocks });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverChrome]);

  function selectStep(id: string) {
    setSlot("pages");
    setActiveId(id);
    setDraft(toDraft(allSteps.find((s) => s.id === id)));
  }

  // ── persistence ──
  async function saveStep() {
    if (!activeId) return;
    const res = await saveStepBlocks(activeId, { blocks: draft.blocks, name: draft.name, seoTitle: draft.seoTitle, seoDescription: draft.seoDescription });
    if (!res.ok) return toast(res.error, "error");
    toast("Step saved");
    router.refresh();
  }

  /**
   * Autosave.
   *
   * A canvas invites experimenting — drag a section, try a colour, undo it — and a builder that
   * loses that to a stray refresh is one people stop trusting. Undo/redo lives in memory, so
   * "unsaved" and "unrecoverable" are the same state.
   *
   * Debounced 1.5s after the last change, and it does NOT `router.refresh()`: refreshing would
   * push new server props into `funnel`, re-run `toDraft`, and yank the draft out from under
   * whoever is still typing. The manual Save button keeps the refresh, because that is the
   * moment someone has explicitly stopped.
   *
   * Skips the LOAD of each step: mounting the editor, or switching steps, replaces the draft
   * wholesale and is not an edit — saving then would stamp `updatedAt` on every page anyone
   * merely opened.
   *
   * That skip is armed per step id, in one effect. It was briefly two effects — this one plus a
   * separate `useEffect(..., [activeId])` that reset a boolean — and effects run in declaration
   * order, so on mount the reset ran AFTER the guard had disarmed it and re-armed it. The result
   * was that the FIRST edit of a session was silently swallowed while the indicator still read
   * "All changes saved": the worst possible failure, since it looks exactly like success. Caught
   * by `npm run e2e:builder`, which edits a heading, reloads, and reads it back.
   */
  const armedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!activeId || slot !== "pages") return;
    if (armedFor.current !== activeId) { armedFor.current = activeId; return; }
    setSaveState("dirty");
    const t = setTimeout(async () => {
      setSaveState("saving");
      const res = await saveStepBlocks(activeId, {
        blocks: draft.blocks, name: draft.name, seoTitle: draft.seoTitle, seoDescription: draft.seoDescription,
      });
      // A failed autosave must be loud: it is the one case where the screen still shows work that
      // no longer exists anywhere else.
      if (res.ok) setSaveState("saved");
      else { setSaveState("error"); toast(res.error, "error"); }
    }, 1500);
    return () => clearTimeout(t);
  }, [draft, activeId, slot]);

  /**
   * The same autosave for the header and footer, armed per slot.
   *
   * A separate effect rather than a branch inside the one above, because the two write different
   * things and the arming guard has to reset when you SWITCH between them — folding them together
   * meant one shared `armedFor` and the first edit after a tab change being swallowed, which is
   * the exact bug the comment above this file's step autosave was written about.
   */
  const armedChrome = useRef<Slot | null>(null);
  useEffect(() => {
    if (slot === "pages") return;
    if (armedChrome.current !== slot) { armedChrome.current = slot; return; }
    const blocks = chrome[slot];
    if (blocks === null) return;
    // Already what the server holds — a refresh that re-seeded this state is not an edit.
    if (JSON.stringify(blocks) === JSON.stringify(slot === "header" ? funnel.headerBlocks : funnel.footerBlocks)) return;
    setSaveState("dirty");
    const t = setTimeout(async () => {
      setSaveState("saving");
      const res = await saveFunnelChrome(funnel.id, slot, blocks);
      if (res.ok) setSaveState("saved");
      else { setSaveState("error"); toast(res.error, "error"); }
    }, 1500);
    return () => clearTimeout(t);
  }, [chrome, slot, funnel.id, funnel.headerBlocks, funnel.footerBlocks]);

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
  async function doAddStep(templateId?: string, templateName?: string) {
    const stepName = newStepName.trim() || templateName || "";
    if (!stepName) return toast("Give the step a name first", "error");
    const res = await addStep(funnel.id, stepName, templateId);
    if (res.ok) { toast(templateId ? "Step added from template" : "Step added"); setNewStepName(""); router.refresh(); } else toast(res.error, "error");
  }
  async function doDeleteStep(step: EditorStep) {
    const ok = await askConfirm({
      title: step.variants.length ? `Delete "${step.name}" and its ${step.variants.length} A/B ${step.variants.length === 1 ? "variant" : "variants"}?` : "Delete this step?",
      // Said out loud, because the cascade is in the schema and invisible from here: someone
      // tidying up a step should not discover afterwards that a running test went with it.
      body: step.variants.length ? "The variants are versions of this page and cannot outlive it." : undefined,
      danger: true,
    });
    if (!ok) return;
    const res = await deleteStep(step.id);
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

  // ── A/B ──
  async function doAddVariant(stepId: string) {
    const res = await createVariant(stepId);
    if (res.ok) { toast("Variant created — edit it, then set the split"); router.refresh(); } else toast(res.error, "error");
  }
  async function doSetWeight(stepId: string, weight: number) {
    const res = await setStepWeight(stepId, weight);
    if (res.ok) router.refresh(); else toast(res.error, "error");
  }
  async function doResetViews(stepId: string) {
    if (!(await askConfirm({ title: "Reset the view counts?", body: "Both arms go back to zero, so the comparison starts fresh." }))) return;
    const res = await resetVariantViews(stepId);
    if (res.ok) { toast("View counts reset"); router.refresh(); } else toast(res.error, "error");
  }

  // ── chrome ──
  function setSlotBlocks(which: "header" | "footer", blocks: Block[]) {
    setChrome((c) => ({ ...c, [which]: blocks }));
  }
  async function removeChrome(which: "header" | "footer") {
    if (!(await askConfirm({ title: `Remove the global ${which}?`, body: "Every step loses it at once.", danger: true }))) return;
    const res = await saveFunnelChrome(funnel.id, which, null);
    if (!res.ok) return toast(res.error, "error");
    setChrome((c) => ({ ...c, [which]: null }));
    setSaveState("saved");
    toast(`Global ${which} removed`);
    router.refresh();
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
          {/* Always the CONTROL's URL. A variant has a slug but no address — it is reached only by
              being assigned — so linking to `active.slug` would open a 404 on the one page whose
              author most wants to see it live. Which arm you get is the split's decision. */}
          {activeControl && (
            <a href={`/p/${funnel.slug}/${activeControl.slug}`} target="_blank" rel="noreferrer">
              <Btn variant="ghost" icon={<ExternalLink size={16} />}>Preview</Btn>
            </a>
          )}
          {published && <Btn variant="ghost" icon={<Link2 size={16} />} onClick={copyLink}>Copy link</Btn>}
          <Btn variant={published ? "soft" : "primary"} icon={<Globe size={16} />} onClick={publish}>{published ? "Unpublish" : "Publish"}</Btn>
          {slot === "pages" && <Btn onClick={saveStep}>Save step</Btn>}
        </div>
      </div>
      <p className="text-sm text-ink-3">
        Public URL: <span className="font-mono">/p/{funnel.slug}</span> · {published ? "live" : "draft"}
        {" · "}
        <span className={saveState === "error" ? "font-semibold text-risk" : undefined}>
          {saveState === "saved" ? "All changes saved" : saveState === "saving" ? "Saving…" : saveState === "dirty" ? "Unsaved changes" : "Could not save — use Save step"}
        </span>
      </p>

      {/*
        Pages / Header / Footer.
        The chrome gets its own tab rather than a panel under the steps because it is edited with
        the SAME tool as a page — it is a block tree, it wants the canvas, the inspector and the
        library. Anything less than the full editor here would be a second, worse builder for the
        one part of the funnel that appears on every single screen a visitor sees.
      */}
      <div role="tablist" aria-label="What to edit" className="flex w-fit gap-1 rounded-field bg-surface-2 p-1">
        {([
          { key: "pages", label: "Pages", icon: <LayoutTemplate size={14} /> },
          { key: "header", label: "Global header", icon: <PanelTop size={14} /> },
          { key: "footer", label: "Global footer", icon: <PanelBottom size={14} /> },
        ] as const).map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={slot === t.key}
            onClick={() => setSlot(t.key)}
            className={`flex items-center gap-1.5 rounded-field px-3 py-1.5 text-sm font-semibold transition-colors ${
              slot === t.key ? "bg-surface text-primary-strong shadow-soft" : "text-ink-3 hover:text-ink-2"
            }`}
          >
            {t.icon}
            {t.label}
            {t.key !== "pages" && chrome[t.key] !== null && (
              <span className="rounded-full bg-primary-soft px-1.5 text-[11px] font-bold text-primary-strong">
                {chrome[t.key]?.length ?? 0}
              </span>
            )}
          </button>
        ))}
      </div>

      {slot !== "pages" ? (
        <ChromeEditor
          which={slot}
          blocks={chrome[slot]}
          onChange={(b) => setSlotBlocks(slot, b)}
          onRemove={() => removeChrome(slot)}
          forms={forms}
          snippets={snippets}
          snippetCategories={snippetCategories}
        />
      ) : (
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[260px_1fr]">
        {/* Steps */}
        <Card title="Steps">
          <div className="space-y-1.5">
            {funnel.steps.map((s, i) => (
              <StepRow
                key={s.id}
                step={s}
                index={i}
                activeId={activeId}
                onSelect={selectStep}
                onMove={moveStep}
                onDelete={doDeleteStep}
                onAddVariant={doAddVariant}
                onSetWeight={doSetWeight}
                onResetViews={doResetViews}
                lastIndex={funnel.steps.length - 1}
              />
            ))}
          </div>
          <div className="mt-3 space-y-1.5">
            <div className="flex gap-1.5">
              <input value={newStepName} onChange={(e) => setNewStepName(e.target.value)} placeholder="New step" className={inputCls} onKeyDown={(e) => e.key === "Enter" && doAddStep()} />
              <Btn size="sm" icon={<Plus size={14} />} onClick={() => doAddStep()}>Add</Btn>
            </div>
            <Btn size="sm" variant="ghost" className="w-full" icon={<LayoutTemplate size={13} />} onClick={() => setShowTemplates(true)}>
              Start from a template
            </Btn>
          </div>
        </Card>

        {/* Block editor */}
        <div className="space-y-4">
          {active ? (
            <>
              <Card
                title={isVariant ? "Variant page" : "Page"}
                actions={
                  <Btn size="sm" variant="ghost" icon={<Library size={13} />} onClick={() => setSavingTemplate(draft.blocks)}>
                    Save as template
                  </Btn>
                }
              >
                {isVariant && (
                  <p className="mb-3 flex items-center gap-2 rounded-field bg-primary-soft px-3 py-2 text-sm text-primary-strong">
                    <FlaskConical size={15} className="flex-none" />
                    An A/B variant of <strong>{activeControl?.name}</strong>. It is served at{" "}
                    <span className="font-mono">/p/{funnel.slug}/{activeControl?.slug}</span> to the share of visitors the split sends here.
                  </p>
                )}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className="text-caption font-semibold uppercase text-ink-3">{isVariant ? "Variant name" : "Step name"}
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

              <PageEditor
                blocks={draft.blocks}
                onChange={(blocks) => setDraft((d) => ({ ...d, blocks }))}
                forms={forms}
                snippets={snippets}
                snippetCategories={snippetCategories}
                // The page is composed against the chrome it will ship inside — see Canvas.
                chromeBefore={chrome.header ?? undefined}
                chromeAfter={chrome.footer ?? undefined}
              />

              {/*
                The old list editor, kept and collapsed.
                Not nostalgia: clicking a rendered page is a POINTING interaction, so it is not
                reachable by keyboard alone. This tree is — every field is a real focusable
                control in document order. It is also the way out when a node ends up somewhere
                the canvas cannot easily reach (a zero-height container, a block hidden on the
                current device). Both views edit the same draft, so they can never disagree.
              */}
              <details className="rounded-card border border-line bg-surface">
                <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-ink-2">
                  Outline view — edit as a list (keyboard accessible)
                </summary>
                <div className="border-t border-line p-4">
                  <BlockListEditor
                    blocks={draft.blocks}
                    onChange={(blocks) => setDraft((d) => ({ ...d, blocks }))}
                    forms={forms}
                  />
                </div>
              </details>
            </>
          ) : (
            <Card><p className="text-sm text-ink-3">Add a step to start building.</p></Card>
          )}
        </div>
      </div>
      )}

      <SnippetPicker
        open={showTemplates}
        onClose={() => setShowTemplates(false)}
        snippets={snippets}
        scope="PAGE"
        // The template's own name seeds the step name, so "Use" is one click when the box is empty.
        onInsert={(_blocks, s) => doAddStep(s.id, s.name)}
      />
      <SaveSnippetDialog
        open={savingTemplate !== null}
        onClose={() => setSavingTemplate(null)}
        blocks={savingTemplate ?? []}
        scope="PAGE"
        defaultName={draft.name || funnel.name}
        categories={snippetCategories}
      />
    </div>
  );
}

/**
 * One step in the rail, with its A/B variants underneath it.
 *
 * The variants are indented and visually subordinate because that is what they are: not the next
 * stage of the funnel, but a second version of THIS one. A flat list would say the visitor walks
 * through them.
 */
function StepRow({
  step, index, lastIndex, activeId, onSelect, onMove, onDelete, onAddVariant, onSetWeight, onResetViews,
}: {
  step: EditorStep;
  index: number;
  lastIndex: number;
  activeId: string;
  onSelect: (id: string) => void;
  onMove: (i: number, dir: -1 | 1) => void;
  onDelete: (step: EditorStep) => void;
  onAddVariant: (id: string) => void;
  onSetWeight: (id: string, weight: number) => void;
  onResetViews: (id: string) => void;
}) {
  const arms = [step, ...step.variants];
  const shares = weightShares(arms);
  const testing = step.variants.length > 0;
  const totalViews = arms.reduce((a, s) => a + s.views, 0);
  const selectedHere = arms.some((s) => s.id === activeId);

  return (
    <div className={testing ? "rounded-field border border-line" : undefined}>
      <div className={`flex items-center gap-1 rounded-field px-2 py-1.5 ${step.id === activeId ? "bg-primary-soft" : "hover:bg-surface-2"}`}>
        <button onClick={() => onSelect(step.id)} className={`min-w-0 flex-1 truncate text-left text-sm font-medium ${step.id === activeId ? "text-primary-strong" : "text-ink-2"}`}>
          {step.name}
        </button>
        {index > 0 && <IconButton label="Move up" onClick={() => onMove(index, -1)}><ArrowUp size={13} /></IconButton>}
        {index < lastIndex && <IconButton label="Move down" onClick={() => onMove(index, 1)}><ArrowDown size={13} /></IconButton>}
        <IconButton label="Delete step" onClick={() => onDelete(step)}><Trash2 size={13} /></IconButton>
      </div>

      {testing && (
        <div className="space-y-1 border-t border-line bg-surface-2/60 px-2 py-1.5">
          <p className="flex items-center justify-between text-caption font-semibold uppercase text-ink-3">
            <span className="flex items-center gap-1"><FlaskConical size={12} /> Split test</span>
            <button className="normal-case hover:text-primary" onClick={() => onResetViews(step.id)} title="Reset both view counts">
              <RotateCcw size={12} />
            </button>
          </p>
          {arms.map((arm, i) => (
            <div key={arm.id} className={`flex items-center gap-1 rounded-field px-1.5 py-1 ${arm.id === activeId ? "bg-primary-soft" : "hover:bg-surface"}`}>
              <button onClick={() => onSelect(arm.id)} className={`min-w-0 flex-1 truncate text-left text-[13px] ${arm.id === activeId ? "font-semibold text-primary-strong" : "text-ink-2"}`}>
                {i === 0 ? "A · original" : arm.name.replace(`${step.name} — `, `${String.fromCharCode(65 + i)} · `)}
              </button>
              {/* Weight commits on blur, not per keystroke: typing "100" over "50" would
                  otherwise write 1, then 10, then 100, re-bucketing live traffic twice on the
                  way to a number nobody meant. */}
              <input
                type="number"
                min={0}
                max={1000}
                defaultValue={arm.abWeight}
                key={`${arm.id}-${arm.abWeight}`}
                onBlur={(e) => onSetWeight(arm.id, Number(e.target.value))}
                onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                aria-label={`Traffic weight for ${arm.name}`}
                className="h-6 w-12 rounded-field border border-line bg-surface px-1 text-center text-[12px] tabular-nums outline-none focus:border-primary"
              />
              <span className="w-8 text-right text-[11px] tabular-nums text-ink-3" title="Share of traffic">{shares[i]}%</span>
              <span className="flex w-12 items-center justify-end gap-0.5 text-[11px] tabular-nums text-ink-3" title={`${arm.views} views`}>
                <Eye size={11} />{arm.views}
              </span>
            </div>
          ))}
          <p className="px-1.5 text-[11px] text-ink-3">
            {totalViews === 0
              ? "No views yet — publish and send traffic."
              : `${totalViews} views across ${arms.length} versions. Views only: what a visitor did next isn't attributed here.`}
          </p>
        </div>
      )}

      {(selectedHere || testing) && step.variants.length < 5 && (
        <button
          onClick={() => onAddVariant(step.id)}
          className="flex w-full items-center gap-1 px-2 py-1 text-caption font-semibold text-ink-3 hover:text-primary"
        >
          <Plus size={12} /> A/B variant
        </button>
      )}
    </div>
  );
}

/**
 * The global header/footer editor.
 *
 * Deliberately the same `PageEditor` the steps use, with the canvas showing only the band itself
 * — a header edited inside a preview of one arbitrary step would suggest it belongs to that step.
 */
function ChromeEditor({
  which, blocks, onChange, onRemove, forms, snippets, snippetCategories,
}: {
  which: "header" | "footer";
  blocks: Block[] | null;
  onChange: (b: Block[]) => void;
  onRemove: () => void;
  forms: { id: string; name: string }[];
  snippets: SnippetRow[];
  snippetCategories: string[];
}) {
  if (blocks === null) {
    return (
      <Card title={`Global ${which}`}>
        <div className="py-8 text-center">
          <p className="mx-auto max-w-md text-sm text-ink-3">
            This funnel has no {which}. Add one and it appears on <strong>every step</strong> — build the logo bar
            or the legal strip once instead of copying it onto each page and missing one.
          </p>
          <div className="mt-4">
            <Btn icon={<Plus size={15} />} onClick={() => onChange([])}>Add a global {which}</Btn>
          </div>
          <p className="mt-3 text-caption text-ink-3">
            The section library has a ready-made one under “Header &amp; footer”.
          </p>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card
        title={`Global ${which}`}
        subtitle={`Rendered ${which === "header" ? "above" : "below"} every step of this funnel.`}
        actions={<Btn size="sm" variant="ghost" icon={<Trash2 size={13} />} onClick={onRemove}>Remove</Btn>}
      >
        {blocks.length === 0 && (
          <p className="text-sm text-ink-3">
            Empty for now — nothing renders on the live pages until you add a block. Try
            <strong> Library → Header &amp; footer</strong>.
          </p>
        )}
      </Card>
      <PageEditor
        blocks={blocks}
        onChange={onChange}
        forms={forms}
        snippets={snippets}
        snippetCategories={snippetCategories}
      />
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
    // A container is useless empty, and a row with no columns has nowhere to drop anything — so
    // new containers arrive with the children the type implies.
    if (type === "row") base.children = [{ id: newId(), type: "column", children: [] }, { id: newId(), type: "column", children: [] }];
    else if (isContainer(type)) base.children = [];
    if (type === "section") base.background = "plain";
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
          {/* A container is edited by editing its children, recursively. Rows lay their columns
              out side by side (that IS the row); every other container is a plain nested list.
              `normalizeRow` means a row saved in the old `columns` shape edits identically. */}
          {b.type === "row" ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {normalizeRow(b).map((colNode, ci) => (
                <div key={colNode.id} className="rounded-field border border-dashed border-line p-2">
                  <p className="mb-2 text-caption font-semibold uppercase text-ink-3">Column {ci + 1}</p>
                  <BlockListEditor
                    blocks={colNode.children ?? []}
                    forms={forms}
                    onChange={(nextCol) => {
                      const cols = normalizeRow(b).map((c, idx) => (idx === ci ? { ...c, children: nextCol } : c));
                      // Writing `children` and clearing `columns` migrates a legacy row the first
                      // time anyone edits it, so the old shape drains away instead of lingering.
                      update(i, { children: cols, columns: undefined });
                    }}
                  />
                </div>
              ))}
              <div className="sm:col-span-2">
                <Btn
                  size="sm"
                  variant="ghost"
                  icon={<Plus size={13} />}
                  onClick={() => update(i, { children: [...normalizeRow(b), { id: newId(), type: "column", children: [] }], columns: undefined })}
                >
                  Add column
                </Btn>
              </div>
            </div>
          ) : isContainer(b.type) ? (
            <div className="space-y-2">
              <BlockFields b={b} i={i} update={update} forms={forms} />
              <div className="rounded-field border border-dashed border-line p-2">
                <BlockListEditor
                  blocks={b.children ?? []}
                  forms={forms}
                  onChange={(next) => update(i, { children: next })}
                />
              </div>
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

/** The outline view's equivalent of the inspector's "On click" control. Same model, same rules. */
function OnClickRow({
  b, i, update, forms,
}: {
  b: Block;
  i: number;
  update: (i: number, p: Partial<Block>) => void;
  forms: { id: string; name: string }[];
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <Select
        size="sm"
        value={b.opensFormId ? "popup" : "link"}
        onChange={(e) => update(i, e.target.value === "popup" ? { opensFormId: forms[0]?.id ?? "" } : { opensFormId: undefined })}
        options={[
          { value: "link", label: b.type === "button" ? "On click: go to link" : "On click: do nothing" },
          { value: "popup", label: "On click: open form popup" },
        ]}
      />
      {b.opensFormId !== undefined && (
        <>
          <Select
            size="sm"
            placeholder="— pick a published form —"
            value={b.opensFormId}
            onChange={(e) => update(i, { opensFormId: e.target.value })}
            options={forms.map((f) => ({ value: f.id, label: f.name }))}
          />
          <input className={inputCls} placeholder="Popup headline" value={b.modalTitle ?? ""} onChange={(e) => update(i, { modalTitle: e.target.value })} />
          <input className={inputCls} placeholder="Popup subline" value={b.modalSubtitle ?? ""} onChange={(e) => update(i, { modalSubtitle: e.target.value })} />
        </>
      )}
    </div>
  );
}

function AlignSelect({ b, i, update }: { b: Block; i: number; update: (i: number, p: Partial<Block>) => void }) {
  return (
    <Select size="sm" value={b.align ?? "center"} onChange={(e) => update(i, { align: e.target.value as Block["align"] })} options={[{ value: "left", label: "Left" }, { value: "center", label: "Centre" }, { value: "right", label: "Right" }]} />
  );
}

function BlockFields({ b, i, update, forms }: { b: Block; i: number; update: (i: number, p: Partial<Block>) => void; forms: { id: string; name: string }[] }) {
  // `src` on the image/video blocks is an absolute external address, so whitespace can only be a
  // paste artefact. Not applied to the button block's `href`, which legitimately takes an internal
  // path ("/p/thank-you") as well as a full URL — filtering both under one rule would be a lie.
  const srcProps = fieldKindProps<HTMLInputElement>("url", (e) => update(i, { url: e.target.value }));

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
          <input {...srcProps.attrs} className={inputCls} placeholder="Image URL (https://…)" value={b.url ?? ""} onChange={srcProps.onChange} />
          <input className={inputCls} placeholder="Alt text" value={b.alt ?? ""} onChange={(e) => update(i, { alt: e.target.value })} />
          <OnClickRow b={b} i={i} update={update} forms={forms} />
        </div>
      );
    case "video":
      return <input {...srcProps.attrs} className={inputCls} placeholder="Embed URL (YouTube/Vimeo embed src)" value={b.url ?? ""} onChange={srcProps.onChange} />;
    case "button":
      return (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <input className={inputCls} placeholder="Label" value={b.label ?? ""} onChange={(e) => update(i, { label: e.target.value })} />
            {!b.opensFormId && (
              <input className={inputCls} placeholder="Link (URL or /p/…)" value={b.href ?? ""} onChange={(e) => update(i, { href: e.target.value })} />
            )}
            <Select size="sm" value={b.variant ?? "primary"} onChange={(e) => update(i, { variant: e.target.value as Block["variant"] })} options={[{ value: "primary", label: "Primary" }, { value: "soft", label: "Soft" }, { value: "outline", label: "Outline" }]} />
            <AlignSelect b={b} i={i} update={update} />
          </div>
          <OnClickRow b={b} i={i} update={update} forms={forms} />
        </div>
      );
    case "bullets":
      return (
        <div className="space-y-2">
          <textarea className={areaCls} rows={3} placeholder="One item per line" value={(b.items ?? []).join("\n")} onChange={(e) => update(i, { items: e.target.value.split("\n").map((s) => s.trim()).filter(Boolean) })} />
          <Select size="sm" value={b.variant === "check" ? "check" : "dot"} onChange={(e) => update(i, { variant: e.target.value === "check" ? "check" : undefined })} options={[{ value: "dot", label: "• Bullets" }, { value: "check", label: "✔ Checklist" }]} />
        </div>
      );
    case "eyebrow":
      return (
        <div className="space-y-2">
          <input className={inputCls} placeholder="Small label above a heading" value={b.text ?? ""} onChange={(e) => update(i, { text: e.target.value })} />
          <AlignSelect b={b} i={i} update={update} />
        </div>
      );
    case "stat":
      return (
        <div className="grid grid-cols-2 gap-2">
          <input className={inputCls} placeholder="Figure (e.g. 200+)" value={b.text ?? ""} onChange={(e) => update(i, { text: e.target.value })} />
          <input className={inputCls} placeholder="Caption (e.g. Students coached)" value={b.label ?? ""} onChange={(e) => update(i, { label: e.target.value })} />
        </div>
      );
    case "section":
      return (
        <Select
          size="sm"
          value={b.background ?? "plain"}
          onChange={(e) => update(i, { background: e.target.value as Block["background"] })}
          options={[
            { value: "plain", label: "Plain background" },
            { value: "muted", label: "Muted / grey band" },
            { value: "dark", label: "Dark band (inverted text)" },
            { value: "brand", label: "Brand colour band" },
          ]}
        />
      );
    case "column":
    case "card":
      return <p className="text-caption text-ink-3">Add the blocks that go inside.</p>;
    /**
     * Raw markup on a PUBLIC page — an XSS sink by definition, which is why the boundary is here
     * at authoring time rather than at render. The warning is not decoration: someone pasting a
     * third-party widget needs to know this is not sandboxed.
     */
    case "html":
      return (
        <div className="space-y-2">
          <textarea className={areaCls} rows={6} placeholder="<div>…</div>" value={b.html ?? ""} onChange={(e) => update(i, { html: e.target.value })} />
          <p className="text-caption text-ink-3">
            Rendered exactly as written, scripts included. Only paste markup you trust — it runs on the live page with no sandbox.
          </p>
        </div>
      );
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

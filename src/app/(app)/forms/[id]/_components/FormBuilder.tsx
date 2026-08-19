"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft, Plus, Link2, Globe, Monitor, Smartphone, PanelLeft, ExternalLink,
  Trash2, Copy, ArrowUp, ArrowDown, MousePointerClick,
} from "lucide-react";
import type { FormDetail } from "@/server/forms-metrics";
import {
  isStaticItem,
  newItem,
  pagesOf,
  FIELD_TYPE_GROUPS,
  type FormItem,
  type FormFieldType,
  type FormSettings,
  type PaletteItem,
} from "@/lib/sites-types";
import { Btn, Switch } from "@/components/ui/controls";
import { Select } from "@/components/ui/form";
import { fieldKindProps } from "@/components/ui/field-base";
import { Card } from "@/components/ui/kit";
import { Tabs } from "@/components/ui/Tabs";
import { toast } from "@/components/ui/feedback";
import PublicForm from "@/components/sites/PublicForm";
import { saveForm, togglePublishForm } from "@/server/forms-actions";
import { ItemEditor } from "./ItemEditor";
import { ResponsesPanel } from "./ResponsesPanel";
import ElementDrawer from "./ElementDrawer";
import FormCanvas from "./FormCanvas";

type Pickers = {
  pipelines: { id: string; name: string; stages: { id: string; name: string }[] }[];
  tags: string[];
  forms: { id: string; name: string }[];
};

const LEAD_SOURCES = ["LANDING_PAGE", "INSTAGRAM", "YOUTUBE", "LINKEDIN", "WHATSAPP", "REFERRAL", "SUMMIT", "WORKSHOP", "META_ADS", "OTHER"];

const inputCls = "h-9 w-full rounded-field border border-line bg-surface px-3 text-sm outline-none focus:border-primary";
const labelCls = "block text-caption font-semibold uppercase tracking-wide text-ink-3";

/** Ids only have to be unique within one form, and only until the next save. */
let idSeq = 0;
const nextId = () => `n${Date.now().toString(36)}${idSeq++}`;

export default function FormBuilder({ form, pickers }: { form: FormDetail; pickers: Pickers }) {
  const [name, setName] = useState(form.name);
  const [items, setItems] = useState<FormItem[]>(form.fields);
  const [settings, setSettings] = useState<FormSettings>(form.settings);
  const [published, setPublished] = useState(form.published);
  const [saving, setSaving] = useState(false);
  const [openId, setOpenId] = useState<string | null>(form.fields[0]?.id ?? null);
  /** The field the canvas has selected - what the right-hand inspector is editing. */
  const [selectedId, setSelectedId] = useState<string | null>(form.fields[0]?.id ?? null);
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [drawerOpen, setDrawerOpen] = useState(true);
  const [tab, setTab] = useState<"edit" | "settings" | "submissions">("edit");

  function update(index: number, patch: Partial<FormItem>) {
    setItems((fs) => fs.map((f, i) => (i === index ? { ...f, ...patch } : f)));
  }
  function move(index: number, dir: -1 | 1) {
    setItems((fs) => {
      const next = [...fs];
      const j = index + dir;
      if (j < 0 || j >= next.length) return fs;
      [next[index], next[j]] = [next[j], next[index]];
      return next;
    });
  }
  function duplicate(index: number) {
    // The id is minted OUTSIDE the updater: React may invoke a state updater twice in development,
    // and a function with a side effect in it would then mint two ids and open the wrong card.
    const id = nextId();
    setOpenId(id);
    setItems((fs) => {
      const src = fs[index];
      // A duplicated question cannot keep the key - two questions writing the same key would have
      // the second silently overwrite the first in every response.
      const copy: FormItem = {
        ...src,
        id,
        key: src.key ? `${src.key}_copy` : "",
        options: src.options?.map((o) => ({ ...o })),
      };
      return [...fs.slice(0, index + 1), copy, ...fs.slice(index + 1)];
    });
  }
  function remove(index: number) {
    setItems((fs) => {
      const gone = fs[index];
      const rest = fs.filter((_, i) => i !== index);
      // Deleting a section must take its inbound branches with it, or `saveForm` rejects the whole
      // form for pointing at a section that no longer exists - with no clue which question did it.
      return gone.type === "section"
        ? rest.map((f) => ({
            ...f,
            goTo: f.goTo === gone.id ? undefined : f.goTo,
            options: f.options?.map((o) => (o.goTo === gone.id ? { ...o, goTo: undefined } : o)),
          }))
        : rest;
    });
  }
  function add(type: FormFieldType) {
    const id = nextId();
    setOpenId(id);
    setSelectedId(id);
    setItems((fs) => [...fs, newItem(type, id, fs.filter((f) => !isStaticItem(f.type)).length + 1)]);
  }

  /**
   * Add from the element palette.
   *
   * A tile is a TYPE plus the fields that make it that tile - "First Name" is a `text` question
   * whose key is `firstName`. The preset is layered over `newItem` so a palette entry only has to
   * state what differs, and a type gaining a better default picks it up everywhere.
   *
   * Lands AFTER the current selection rather than at the end: an author who selected the third
   * field and reached for the palette means "another one here", and appending to the bottom of a
   * long form is how you end up scrolling to find what you just added.
   */
  function addFromPalette(p: PaletteItem) {
    if (p.soon) return;
    const id = nextId();
    setSelectedId(id);
    setOpenId(id);
    setItems((fs) => {
      const seed = fs.filter((f) => !isStaticItem(f.type)).length + 1;
      const created: FormItem = { ...newItem(p.type, id, seed), ...p.preset, id, type: p.type };
      // A contact key can only be claimed once - two questions writing `email` means the second
      // silently overwrites the first on the contact record.
      if (created.key && fs.some((f) => f.key === created.key)) created.key = `${created.key}_${seed}`;
      const at = fs.findIndex((f) => f.id === selectedId);
      return at < 0 ? [...fs, created] : [...fs.slice(0, at + 1), created, ...fs.slice(at + 1)];
    });
  }
  function setS<K extends keyof FormSettings>(k: K, v: FormSettings[K]) {
    setSettings((s) => ({ ...s, [k]: v }));
  }

  async function save() {
    setSaving(true);
    const res = await saveForm(form.id, { name, fields: items, settings });
    setSaving(false);
    toast(res.ok ? "Form saved" : res.error, res.ok ? "success" : "error");
  }
  async function publish() {
    const res = await togglePublishForm(form.id);
    if (!res.ok) return toast(res.error, "error");
    setPublished((p) => !p);
    toast(published ? "Unpublished" : "Published");
  }
  async function copyLink() {
    await navigator.clipboard.writeText(`${window.location.origin}/f/${form.slug}`).catch(() => {});
    toast("Public link copied");
  }

  const activePipeline = pickers.pipelines.find((p) => p.id === settings.pipelineId);
  const pages = useMemo(() => pagesOf(items), [items]);
  const questionCount = items.filter((f) => !isStaticItem(f.type)).length;

  const selectedIndex = items.findIndex((f) => f.id === selectedId);
  const selected = selectedIndex >= 0 ? items[selectedIndex] : null;
  /** Per-option points only mean something once the form actually has a Score element. */
  const scoring = items.some((f) => f.type === "score");

  // The only two Settings fields that carry a VALUE rather than builder copy: a link the public
  // page will navigate to, and a rupee amount. Everything else on this screen (labels, keys,
  // placeholders, button/success text) is free text by design and stays unfiltered.
  const redirectProps = fieldKindProps<HTMLInputElement>("url", (e) => setS("redirectUrl", e.target.value));
  const dealValueProps = fieldKindProps<HTMLInputElement>("money", (e) => setS("opportunityValueInr", e.target.value));

  /**
   * Legal branch targets for the item at `index`: sections that come after it.
   *
   * Computed per item rather than once for the form, because "later" is relative - and forward-only
   * targets are what make a loop unconstructable rather than merely discouraged.
   */
  function laterSections(index: number) {
    return items
      .slice(index + 1)
      .filter((f) => f.type === "section")
      .map((f) => ({ id: f.id, label: f.label || "Untitled section" }));
  }

  /**
   * The stacked list of fields - the keyboard-accessible way to edit the same draft the canvas
   * edits by pointing. Lives under the canvas in a collapsed panel rather than being replaced by
   * it: a pointer-only builder is not a builder for everyone.
   */
  const outlineList = (
    <>
      <div className="space-y-3">
        {items.map((item, i) => (
          <ItemEditor
            key={item.id}
            scoring={scoring}
            item={item}
            index={i}
            total={items.length}
            open={openId === item.id}
            laterSections={laterSections(i)}
            onOpen={() => setOpenId(openId === item.id ? null : item.id)}
            onChange={(patch) => update(i, patch)}
            onMove={(dir) => move(i, dir)}
            onDuplicate={() => duplicate(i)}
            onDelete={() => remove(i)}
          />
        ))}

        {items.length === 0 && (
          <Card>
            <p className="text-sm text-ink-3">No questions yet - add one below.</p>
          </Card>
        )}

        {/* The add row is a palette, not a dropdown: seeing that "Multiple choice" and
            "Checkboxes" are different things is most of the fix for what was reported. */}
        <Card title="Add">
          <div className="space-y-2.5">
            {FIELD_TYPE_GROUPS.map((g) => (
              <div key={g.group} className="flex flex-wrap items-center gap-1.5">
                <span className="w-full text-caption font-semibold uppercase tracking-wide text-ink-3 sm:w-36">
                  {g.group}
                </span>
                {g.types.map((t) => (
                  <Btn key={t.value} size="sm" variant="ghost" icon={<Plus size={13} />} onClick={() => add(t.value)}>
                    {t.label}
                  </Btn>
                ))}
              </div>
            ))}
          </div>
          <p className="mt-3 text-caption text-ink-3">
            Keys <b>name</b> + <b>phone</b> are required to publish; <b>name, email, phone, city, industry</b> map
            onto the contact. Other keys are saved as custom answers.
          </p>
        </Card>
      </div>
    </>
  );

  const settingsPanel = (
    <div className="space-y-4">
        <Card title="Settings">
          <div className="space-y-3">
            <label className={labelCls}>
              Submit button
              <input className={inputCls} value={settings.submitText} onChange={(e) => setS("submitText", e.target.value)} />
            </label>
            <label className={labelCls}>
              Success message
              <input className={inputCls} value={settings.successMessage} onChange={(e) => setS("successMessage", e.target.value)} />
            </label>
            <label className={labelCls}>
              Redirect URL (optional)
              <input {...redirectProps.attrs} className={inputCls} value={settings.redirectUrl ?? ""} onChange={redirectProps.onChange} placeholder="https://… or /p/vsl-funnel/vsl" />
            </label>
            <label className={labelCls}>
              Tag on submit
              <input className={inputCls} list="tag-list" value={settings.tag ?? ""} onChange={(e) => setS("tag", e.target.value)} placeholder="e.g. webinar-lead" />
              <datalist id="tag-list">{pickers.tags.map((t) => <option key={t} value={t} />)}</datalist>
            </label>
            <label className={labelCls}>
              Lead source
              <Select value={settings.leadSource} onChange={(e) => setS("leadSource", e.target.value)} options={LEAD_SOURCES.map((s) => ({ value: s, label: s.replaceAll("_", " ").toLowerCase() }))} />
            </label>
            <div className="rounded-field border border-line p-3">
              <label className="flex items-center justify-between text-sm font-medium text-ink">
                Create opportunity
                <Switch checked={!!settings.createOpportunity} onChange={(v) => setS("createOpportunity", v)} />
              </label>
              {settings.createOpportunity && (
                <div className="mt-2 space-y-2">
                  <Select placeholder="- pipeline -" value={settings.pipelineId ?? ""} onChange={(e) => setS("pipelineId", e.target.value)} options={pickers.pipelines.map((p) => ({ value: p.id, label: p.name }))} />
                  <Select placeholder="- stage -" value={settings.stageId ?? ""} onChange={(e) => setS("stageId", e.target.value)} options={(activePipeline?.stages ?? []).map((s) => ({ value: s.id, label: s.name }))} />
                  <input {...dealValueProps.attrs} className={inputCls} value={settings.opportunityValueInr ?? ""} onChange={dealValueProps.onChange} placeholder="Deal value ₹ (optional)" />
                </div>
              )}
            </div>
          </div>
        </Card>

        <Card title="Presentation">
          <div className="space-y-3">
            <label className="flex items-center justify-between gap-3 text-sm font-medium text-ink">
              <span>
                Progress bar
                <span className="block text-caption font-normal text-ink-3">
                  {pages.length > 1 ? `${pages.length} pages` : "Only shown once the form has sections"}
                </span>
              </span>
              <Switch checked={settings.progressBar !== false} onChange={(v) => setS("progressBar", v)} />
            </label>
            <label className="flex items-center justify-between gap-3 text-sm font-medium text-ink">
              Shuffle question order
              <Switch checked={!!settings.shuffleQuestions} onChange={(v) => setS("shuffleQuestions", v)} />
            </label>
            <label className="flex items-center justify-between gap-3 text-sm font-medium text-ink">
              <span>
                Limit to one response
                {/* Said plainly: Google enforces this with a sign-in and we cannot. Promising
                    more than a cookie can deliver is how a "verified" number turns out not to be. */}
                <span className="block text-caption font-normal text-ink-3">
                  A cookie on their browser - stops a double-tap, not a determined person
                </span>
              </span>
              <Switch checked={!!settings.limitOneResponse} onChange={(v) => setS("limitOneResponse", v)} />
            </label>
            <label className="flex items-center justify-between gap-3 text-sm font-medium text-ink">
              Offer “Submit another response”
              <Switch checked={!!settings.showSubmitAnother} onChange={(v) => setS("showSubmitAnother", v)} />
            </label>
          </div>
        </Card>
    </div>
  );

  return (
    /**
     * The builder shell.
     *
     * Three columns - element palette, the form itself, the inspector - under one toolbar, which
     * is the arrangement the team already knows from Synamate. The point of copying it is not
     * imitation: it is that everything here is edited by POINTING at it on the form, and that only
     * works if the form is the biggest thing on screen with its tools either side.
     *
     * `h-[calc(100vh-8rem)]` rather than page flow: the canvas and both rails scroll
     * independently, so choosing an element from a long palette does not scroll the form away.
     */
    <div className="flex h-[calc(100vh-8rem)] flex-col overflow-hidden rounded-card border border-line bg-surface">
      {/* ── Toolbar ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-none items-center gap-3 border-b border-line px-3 py-2">
        <Link href="/forms" className="inline-flex items-center gap-1.5 text-sm text-ink-2 hover:text-primary">
          <ArrowLeft size={15} /> Back
        </Link>

        <span className="mx-1 h-5 w-px bg-line" />

        <button
          type="button"
          onClick={() => setDrawerOpen((v) => !v)}
          aria-label={drawerOpen ? "Hide the element panel" : "Show the element panel"}
          aria-pressed={drawerOpen}
          className={`rounded-field p-1.5 ${drawerOpen ? "bg-primary-soft text-primary-strong" : "text-ink-3 hover:text-ink-2"}`}
        >
          <PanelLeft size={15} />
        </button>
        <button
          type="button"
          onClick={() => setDevice("desktop")}
          aria-label="Desktop width"
          aria-pressed={device === "desktop"}
          className={`rounded-field p-1.5 ${device === "desktop" ? "bg-primary-soft text-primary-strong" : "text-ink-3 hover:text-ink-2"}`}
        >
          <Monitor size={15} />
        </button>
        <button
          type="button"
          onClick={() => setDevice("mobile")}
          aria-label="Phone width"
          aria-pressed={device === "mobile"}
          className={`rounded-field p-1.5 ${device === "mobile" ? "bg-primary-soft text-primary-strong" : "text-ink-3 hover:text-ink-2"}`}
        >
          <Smartphone size={15} />
        </button>

        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-label="Form name"
          className="mx-auto w-[280px] rounded-field border-0 bg-transparent px-2 py-1 text-center text-sm font-semibold text-ink outline-none hover:bg-surface-2 focus:bg-surface-2"
        />

        <div className="flex flex-none items-center gap-1.5">
          <a href={`/f/${form.slug}`} target="_blank" rel="noreferrer">
            <Btn size="sm" variant="ghost" icon={<ExternalLink size={14} />}>Preview</Btn>
          </a>
          {published && <Btn size="sm" variant="ghost" icon={<Link2 size={14} />} onClick={copyLink}>Copy link</Btn>}
          <Btn size="sm" variant={published ? "soft" : "primary"} icon={<Globe size={14} />} onClick={publish}>
            {published ? "Unpublish" : "Publish"}
          </Btn>
          <Btn size="sm" onClick={save} busy={saving}>Save</Btn>
        </div>
      </div>

      {/* ── Section tabs ────────────────────────────────────────────────────── */}
      <div role="tablist" aria-label="Form section" className="flex flex-none items-center gap-1 border-b border-line px-3">
        {([
          { key: "edit", label: "Edit" },
          { key: "settings", label: "Settings" },
          { key: "submissions", label: `Submissions (${form.submissionCount})` },
        ] as const).map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={`px-3 py-2 text-sm font-semibold ${
              tab === t.key ? "border-b-2 border-primary text-primary-strong" : "text-ink-3 hover:text-ink-2"
            }`}
          >
            {t.label}
          </button>
        ))}
        <span className="ml-auto py-2 text-caption text-ink-3">
          <span className="font-mono">/f/{form.slug}</span> · {published ? "live" : "draft"} · {questionCount} question
          {questionCount === 1 ? "" : "s"}
          {pages.length > 1 && ` · ${pages.length} pages`}
        </span>
      </div>

      {/* ── Body ────────────────────────────────────────────────────────────── */}
      {tab === "edit" ? (
        <div className="flex min-h-0 flex-1">
          <ElementDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} onAdd={addFromPalette} />

          <div className="min-w-0 flex-1 overflow-y-auto">
            <FormCanvas
              items={items}
              settings={settings}
              name={name}
              slug={form.slug}
              selectedId={selectedId}
              onSelect={setSelectedId}
              device={device}
            />

            {/*
              The stacked list, kept and collapsed.
              Not nostalgia: clicking a rendered form is a POINTING interaction and is not
              reachable by keyboard alone. This tree is - every field is a real focusable control
              in document order. Both views edit the same draft, so they cannot disagree.
            */}
            <details className="mx-6 mb-6 rounded-card border border-line bg-surface">
              <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-ink-2">
                Outline view - edit as a list (keyboard accessible)
              </summary>
              <div className="space-y-3 border-t border-line p-4">{outlineList}</div>
            </details>
          </div>

          {/* Inspector */}
          <aside className="w-[320px] flex-none overflow-y-auto border-l border-line bg-surface">
            {selected ? (
              <>
                <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
                  <p className="truncate text-sm font-semibold text-ink">{selected.label || "Untitled"}</p>
                  <div className="flex flex-none items-center gap-0.5">
                    <IconBtn label="Move up" disabled={selectedIndex === 0} onClick={() => move(selectedIndex, -1)}>
                      <ArrowUp size={14} />
                    </IconBtn>
                    <IconBtn label="Move down" disabled={selectedIndex === items.length - 1} onClick={() => move(selectedIndex, 1)}>
                      <ArrowDown size={14} />
                    </IconBtn>
                    <IconBtn label="Duplicate" onClick={() => duplicate(selectedIndex)}>
                      <Copy size={14} />
                    </IconBtn>
                    <IconBtn
                      label="Delete"
                      onClick={() => { remove(selectedIndex); setSelectedId(null); }}
                    >
                      <Trash2 size={14} />
                    </IconBtn>
                  </div>
                </div>
                <div className="p-3">
                  {/* The real field editor, not a second copy of it - see ItemEditor's `variant`. */}
                  <ItemEditor
                    variant="panel"
                    scoring={scoring}
                    item={selected}
                    index={selectedIndex}
                    total={items.length}
                    open
                    laterSections={laterSections(selectedIndex)}
                    onOpen={() => {}}
                    onChange={(patch) => update(selectedIndex, patch)}
                    onMove={(dir) => move(selectedIndex, dir)}
                    onDuplicate={() => duplicate(selectedIndex)}
                    onDelete={() => { remove(selectedIndex); setSelectedId(null); }}
                  />
                </div>
              </>
            ) : (
              <div className="p-6 text-center">
                <MousePointerClick size={18} className="mx-auto mb-2 text-ink-3" />
                <p className="text-sm text-ink-3">
                  Click any field on the form to edit it, or pick something from the panel on the left.
                </p>
              </div>
            )}
          </aside>
        </div>
      ) : tab === "settings" ? (
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <div className="mx-auto max-w-3xl">{settingsPanel}</div>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <ResponsesPanel form={form} />
        </div>
      )}
    </div>
  );
}

/** Toolbar-sized icon button. The shared `IconButton` is sized for data tables. */
function IconBtn({
  label, onClick, disabled, children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="rounded-field p-1.5 text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
}

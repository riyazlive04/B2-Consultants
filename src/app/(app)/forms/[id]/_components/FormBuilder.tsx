"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Plus, Link2, Globe } from "lucide-react";
import type { FormDetail } from "@/server/forms-metrics";
import {
  isStaticItem,
  newItem,
  pagesOf,
  FIELD_TYPE_GROUPS,
  type FormItem,
  type FormFieldType,
  type FormSettings,
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
      // A duplicated question cannot keep the key — two questions writing the same key would have
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
      // form for pointing at a section that no longer exists — with no clue which question did it.
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
    setItems((fs) => [...fs, newItem(type, id, fs.filter((f) => !isStaticItem(f.type)).length + 1)]);
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

  // The only two Settings fields that carry a VALUE rather than builder copy: a link the public
  // page will navigate to, and a rupee amount. Everything else on this screen (labels, keys,
  // placeholders, button/success text) is free text by design and stays unfiltered.
  const redirectProps = fieldKindProps<HTMLInputElement>("url", (e) => setS("redirectUrl", e.target.value));
  const dealValueProps = fieldKindProps<HTMLInputElement>("money", (e) => setS("opportunityValueInr", e.target.value));

  /**
   * Legal branch targets for the item at `index`: sections that come after it.
   *
   * Computed per item rather than once for the form, because "later" is relative — and forward-only
   * targets are what make a loop unconstructable rather than merely discouraged.
   */
  function laterSections(index: number) {
    return items
      .slice(index + 1)
      .filter((f) => f.type === "section")
      .map((f) => ({ id: f.id, label: f.label || "Untitled section" }));
  }

  const buildTab = (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_340px]">
      <div className="space-y-3">
        {items.map((item, i) => (
          <ItemEditor
            key={item.id}
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
            <p className="text-sm text-ink-3">No questions yet — add one below.</p>
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
              <input {...redirectProps.attrs} className={inputCls} value={settings.redirectUrl ?? ""} onChange={redirectProps.onChange} placeholder="https://…" />
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
                  <Select placeholder="— pipeline —" value={settings.pipelineId ?? ""} onChange={(e) => setS("pipelineId", e.target.value)} options={pickers.pipelines.map((p) => ({ value: p.id, label: p.name }))} />
                  <Select placeholder="— stage —" value={settings.stageId ?? ""} onChange={(e) => setS("stageId", e.target.value)} options={(activePipeline?.stages ?? []).map((s) => ({ value: s.id, label: s.name }))} />
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
                  A cookie on their browser — stops a double-tap, not a determined person
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
    </div>
  );

  const previewTab = (
    <div className="mx-auto max-w-2xl space-y-3">
      <p className="rounded-field border border-dashed border-line bg-surface-2 px-3 py-2 text-caption text-ink-3">
        This is the live renderer running against your unsaved draft — same questions, same
        validation, same branching. Submitting here records nothing.
      </p>
      <PublicForm
        preview
        form={{ id: form.id, name, slug: form.slug, fields: items, settings }}
      />
    </div>
  );

  return (
    <div className="space-y-5">
      <Link href="/forms" className="inline-flex items-center gap-1.5 text-sm text-ink-2 hover:text-primary">
        <ArrowLeft size={16} /> Forms
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-label="Form name"
          className="min-w-0 flex-1 border-0 bg-transparent font-display text-display-l font-bold text-ink outline-none"
        />
        <div className="flex items-center gap-2">
          {published && <Btn variant="ghost" icon={<Link2 size={16} />} onClick={copyLink}>Copy link</Btn>}
          <Btn variant={published ? "soft" : "primary"} icon={<Globe size={16} />} onClick={publish}>
            {published ? "Unpublish" : "Publish"}
          </Btn>
          <Btn onClick={save} busy={saving}>Save</Btn>
        </div>
      </div>
      <p className="text-sm text-ink-3">
        Public URL: <span className="font-mono">/f/{form.slug}</span> · {published ? "live" : "draft"} ·{" "}
        {questionCount} question{questionCount === 1 ? "" : "s"}
        {pages.length > 1 && ` across ${pages.length} pages`}
      </p>

      <Tabs
        tabs={[
          { label: "Build", content: buildTab },
          { label: "Preview", content: previewTab },
          { label: `Responses (${form.submissionCount})`, content: <ResponsesPanel form={form} /> },
        ]}
      />
    </div>
  );
}

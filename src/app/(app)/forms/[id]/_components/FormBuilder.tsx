"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Plus, Trash2, ArrowUp, ArrowDown, Link2, Globe } from "lucide-react";
import type { FormDetail } from "@/server/forms-metrics";
import type { FormField, FormFieldType, FormSettings } from "@/lib/sites-types";
import { Btn, IconButton, Switch } from "@/components/ui/controls";
import { Select } from "@/components/ui/form";
import { fieldKindProps } from "@/components/ui/field-base";
import { Card } from "@/components/ui/kit";
import { Tabs } from "@/components/ui/Tabs";
import { toast } from "@/components/ui/feedback";
import { DateText } from "@/components/ui/DateText";
import { saveForm, togglePublishForm } from "@/server/forms-actions";

type Pickers = {
  pipelines: { id: string; name: string; stages: { id: string; name: string }[] }[];
  tags: string[];
  forms: { id: string; name: string }[];
};

const FIELD_TYPES: { value: FormFieldType; label: string }[] = [
  { value: "text", label: "Text" }, { value: "email", label: "Email" }, { value: "phone", label: "Phone" },
  { value: "textarea", label: "Long text" }, { value: "select", label: "Dropdown" },
  { value: "checkbox", label: "Checkbox" }, { value: "number", label: "Number" },
];

const LEAD_SOURCES = ["LANDING_PAGE", "INSTAGRAM", "YOUTUBE", "LINKEDIN", "WHATSAPP", "REFERRAL", "SUMMIT", "WORKSHOP", "META_ADS", "OTHER"];

const inputCls = "h-9 w-full rounded-field border border-line bg-surface px-3 text-sm outline-none focus:border-primary";

export default function FormBuilder({ form, pickers }: { form: FormDetail; pickers: Pickers }) {
  const [name, setName] = useState(form.name);
  const [fields, setFields] = useState<FormField[]>(form.fields);
  const [settings, setSettings] = useState<FormSettings>(form.settings);
  const [published, setPublished] = useState(form.published);
  const [saving, setSaving] = useState(false);

  function updateField(i: number, patch: Partial<FormField>) {
    setFields((fs) => fs.map((f, idx) => (idx === i ? { ...f, ...patch } : f)));
  }
  function move(i: number, dir: -1 | 1) {
    setFields((fs) => {
      const next = [...fs];
      const j = i + dir;
      if (j < 0 || j >= next.length) return fs;
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }
  function addField() {
    setFields((fs) => [...fs, { key: `field_${fs.length + 1}`, label: "New field", type: "text" }]);
  }
  function setS<K extends keyof FormSettings>(k: K, v: FormSettings[K]) {
    setSettings((s) => ({ ...s, [k]: v }));
  }

  async function save() {
    setSaving(true);
    const res = await saveForm(form.id, { name, fields, settings });
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

  // The only two Settings fields that carry a VALUE rather than builder copy: a link the public
  // page will navigate to, and a rupee amount. Everything else on this screen (labels, keys,
  // placeholders, button/success text) is free text by design and stays unfiltered.
  const redirectProps = fieldKindProps<HTMLInputElement>("url", (e) => setS("redirectUrl", e.target.value));
  const dealValueProps = fieldKindProps<HTMLInputElement>("money", (e) => setS("opportunityValueInr", e.target.value));

  const buildTab = (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_360px]">
      {/* Fields */}
      <Card title="Fields" actions={<Btn size="sm" icon={<Plus size={15} />} onClick={addField}>Add field</Btn>}>
        <div className="space-y-3">
          {fields.map((f, i) => (
            <div key={i} className="rounded-field border border-line p-3">
              <div className="grid grid-cols-2 gap-2">
                <label className="text-caption font-semibold uppercase text-ink-3">Label
                  <input className={inputCls} value={f.label} onChange={(e) => updateField(i, { label: e.target.value })} />
                </label>
                <label className="text-caption font-semibold uppercase text-ink-3">Key
                  <input className={inputCls} value={f.key} onChange={(e) => updateField(i, { key: e.target.value })} />
                </label>
                <label className="text-caption font-semibold uppercase text-ink-3">Type
                  <Select value={f.type} onChange={(e) => updateField(i, { type: e.target.value as FormFieldType })} options={FIELD_TYPES} />
                </label>
                <label className="text-caption font-semibold uppercase text-ink-3">Placeholder
                  <input className={inputCls} value={f.placeholder ?? ""} onChange={(e) => updateField(i, { placeholder: e.target.value })} />
                </label>
              </div>
              {f.type === "select" && (
                <label className="mt-2 block text-caption font-semibold uppercase text-ink-3">Options (comma-separated)
                  <input className={inputCls} value={(f.options ?? []).join(", ")} onChange={(e) => updateField(i, { options: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} />
                </label>
              )}
              <div className="mt-2 flex items-center justify-between">
                <label className="flex items-center gap-2 text-sm text-ink-2">
                  <input type="checkbox" checked={!!f.required} onChange={(e) => updateField(i, { required: e.target.checked })} className="h-4 w-4 accent-[var(--primary)]" /> Required
                </label>
                <div className="flex items-center gap-1">
                  <IconButton label="Move up" onClick={() => move(i, -1)}><ArrowUp size={15} /></IconButton>
                  <IconButton label="Move down" onClick={() => move(i, 1)}><ArrowDown size={15} /></IconButton>
                  <IconButton label="Delete field" onClick={() => setFields((fs) => fs.filter((_, idx) => idx !== i))}><Trash2 size={15} /></IconButton>
                </div>
              </div>
            </div>
          ))}
          {fields.length === 0 && <p className="text-sm text-ink-3">No fields yet — add one.</p>}
          <p className="text-caption text-ink-3">Keys <b>name</b> + <b>phone</b> are required to publish; <b>name, email, phone, city, industry</b> map onto the contact. Other keys are saved as custom answers.</p>
        </div>
      </Card>

      {/* Settings */}
      <Card title="Settings">
        <div className="space-y-3">
          <label className="block text-caption font-semibold uppercase text-ink-3">Submit button
            <input className={inputCls} value={settings.submitText} onChange={(e) => setS("submitText", e.target.value)} />
          </label>
          <label className="block text-caption font-semibold uppercase text-ink-3">Success message
            <input className={inputCls} value={settings.successMessage} onChange={(e) => setS("successMessage", e.target.value)} />
          </label>
          <label className="block text-caption font-semibold uppercase text-ink-3">Redirect URL (optional)
            <input {...redirectProps.attrs} className={inputCls} value={settings.redirectUrl ?? ""} onChange={redirectProps.onChange} placeholder="https://…" />
          </label>
          <label className="block text-caption font-semibold uppercase text-ink-3">Tag on submit
            <input className={inputCls} list="tag-list" value={settings.tag ?? ""} onChange={(e) => setS("tag", e.target.value)} placeholder="e.g. webinar-lead" />
            <datalist id="tag-list">{pickers.tags.map((t) => <option key={t} value={t} />)}</datalist>
          </label>
          <label className="block text-caption font-semibold uppercase text-ink-3">Lead source
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
    </div>
  );

  const submissionsTab = (
    <Card flush>
      {form.submissions.length === 0 ? (
        <p className="p-6 text-sm text-ink-3">No submissions yet.</p>
      ) : (
        <div className="divide-y divide-line">
          {form.submissions.map((s) => (
            <div key={s.id} className="flex items-start justify-between gap-4 p-4">
              <div className="min-w-0">
                {s.leadId ? (
                  <Link href={`/contacts/${s.leadId}`} className="text-sm font-semibold text-ink hover:text-primary">{s.leadName}</Link>
                ) : (
                  <span className="text-sm font-semibold text-ink">{s.data["name"] ?? "Anonymous"}</span>
                )}
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-caption text-ink-3">
                  {Object.entries(s.data).slice(0, 6).map(([k, v]) => <span key={k}><b>{k}:</b> {v}</span>)}
                </div>
              </div>
              <span className="flex-none text-caption text-ink-3"><DateText date={s.createdAt} /></span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );

  return (
    <div className="space-y-5">
      <Link href="/forms" className="inline-flex items-center gap-1.5 text-sm text-ink-2 hover:text-primary"><ArrowLeft size={16} /> Forms</Link>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <input value={name} onChange={(e) => setName(e.target.value)} className="min-w-0 flex-1 border-0 bg-transparent font-display text-display-l font-bold text-ink outline-none" />
        <div className="flex items-center gap-2">
          {published && <Btn variant="ghost" icon={<Link2 size={16} />} onClick={copyLink}>Copy link</Btn>}
          <Btn variant={published ? "soft" : "primary"} icon={<Globe size={16} />} onClick={publish}>{published ? "Unpublish" : "Publish"}</Btn>
          <Btn onClick={save} busy={saving}>Save</Btn>
        </div>
      </div>
      <p className="text-sm text-ink-3">Public URL: <span className="font-mono">/f/{form.slug}</span> · {published ? "live" : "draft"}</p>

      <Tabs tabs={[{ label: "Build", content: buildTab }, { label: `Submissions (${form.submissionCount})`, content: submissionsTab }]} />
    </div>
  );
}

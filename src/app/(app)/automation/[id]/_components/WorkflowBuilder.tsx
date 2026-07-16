"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Plus, Trash2, ArrowUp, ArrowDown, Globe, Zap, ArrowDownToLine, RotateCcw } from "lucide-react";
import type { WorkflowDetail } from "@/server/automation-metrics";
import {
  ACTION_LABELS, TRIGGER_LABELS, LEAD_STAGE_OPTIONS,
  type WorkflowAction, type WorkflowActionType, type TriggerType, type TriggerConfig,
} from "@/lib/automation-types";
import { Btn, IconButton } from "@/components/ui/controls";
import { Select } from "@/components/ui/form";
import { Card, Pill } from "@/components/ui/kit";
import { toast } from "@/components/ui/feedback";
import { DateText } from "@/components/ui/DateText";
import { saveWorkflow, togglePublishWorkflow, restoreWorkflow } from "@/server/automation-actions";

type Pickers = {
  forms: { id: string; name: string }[];
  tags: string[];
  templates: { id: string; name: string; channel: "EMAIL" | "SMS" }[];
  users: { id: string; name: string }[];
  folders: { id: string; name: string }[];
};

const ACTION_TYPES: WorkflowActionType[] = ["SEND_EMAIL", "SEND_SMS", "ADD_TAG", "REMOVE_TAG", "MOVE_STAGE", "CREATE_TASK", "WAIT", "IF_TAG"];
const TRIGGER_OPTS = (Object.keys(TRIGGER_LABELS) as TriggerType[]).map((k) => ({ value: k, label: TRIGGER_LABELS[k] }));
const inputCls = "h-9 w-full rounded-field border border-line bg-surface px-3 text-sm outline-none focus:border-primary";

let seq = 0;
const newId = () => `a${Date.now().toString(36)}${seq++}`;

export default function WorkflowBuilder({ workflow, pickers }: { workflow: WorkflowDetail; pickers: Pickers }) {
  const router = useRouter();
  const [name, setName] = useState(workflow.name);
  const [triggerType, setTriggerType] = useState<TriggerType>(workflow.triggerType);
  const [triggerConfig, setTriggerConfig] = useState<TriggerConfig>(workflow.triggerConfig);
  const [actions, setActions] = useState<WorkflowAction[]>(workflow.actions);
  const [published, setPublished] = useState(workflow.status === "PUBLISHED");
  const [folderId, setFolderId] = useState<string>(workflow.folderId ?? "");
  const [addType, setAddType] = useState<WorkflowActionType>("SEND_EMAIL");
  const [saving, setSaving] = useState(false);
  const isDeleted = workflow.deletedAt !== null;

  function updateAction(i: number, patch: Partial<WorkflowAction>) {
    setActions((as) => as.map((a, idx) => (idx === i ? { ...a, ...patch } : a)));
  }
  function move(i: number, dir: -1 | 1) {
    setActions((as) => {
      const next = [...as];
      const j = i + dir;
      if (j < 0 || j >= next.length) return as;
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }
  function addAction() {
    const a: WorkflowAction = { id: newId(), type: addType };
    if (addType === "WAIT") a.waitMinutes = 1440;
    // Default both branches to "just continue to the next step" — the safest default, since a
    // branch pointing at itself (or an earlier step) can cycle (guarded server-side, but still
    // worth not defaulting into).
    if (addType === "IF_TAG") { a.thenStep = actions.length + 1; a.elseStep = actions.length + 1; }
    setActions((as) => [...as, a]);
  }

  async function save() {
    setSaving(true);
    const res = await saveWorkflow(workflow.id, { name, triggerType, triggerConfig, actions, folderId: folderId || null });
    setSaving(false);
    toast(res.ok ? "Workflow saved" : res.error, res.ok ? "success" : "error");
    if (res.ok) router.refresh();
  }
  async function publish() {
    const res = await togglePublishWorkflow(workflow.id);
    if (!res.ok) return toast(res.error, "error");
    setPublished((p) => !p);
    toast(published ? "Unpublished" : "Published — now live");
    router.refresh();
  }
  async function restore() {
    const res = await restoreWorkflow(workflow.id);
    toast(res.ok ? "Workflow restored" : res.error, res.ok ? "success" : "error");
    if (res.ok) router.refresh();
  }

  return (
    <div className="space-y-5">
      <Link href="/automation" className="inline-flex items-center gap-1.5 text-sm text-ink-2 hover:text-primary"><ArrowLeft size={16} /> Automation</Link>

      {/* A deleted workflow stays viewable but is inert — the server rejects save/publish on
          it, so the UI says why and offers the one action that does work. */}
      {isDeleted && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-field border border-risk bg-risk-soft px-4 py-3">
          <p className="text-sm font-medium text-risk">
            This workflow is deleted. It isn’t triggering, and its in-flight enrollments are paused.
          </p>
          <Btn size="sm" icon={<RotateCcw size={15} />} onClick={restore}>Restore</Btn>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={isDeleted}
            aria-label="Workflow name"
            className="min-w-0 border-0 bg-transparent font-display text-display-l font-bold text-ink outline-none disabled:text-ink-3"
          />
          <Pill tone={isDeleted ? "bad" : published ? "good" : "neutral"}>{isDeleted ? "Deleted" : published ? "Live" : "Draft"}</Pill>
        </div>
        <div className="flex items-center gap-2">
          <label className="sr-only" htmlFor="wf-folder">Folder</label>
          <Select
            id="wf-folder"
            className="w-44"
            value={folderId}
            disabled={isDeleted}
            onChange={(e) => setFolderId(e.target.value)}
            options={[
              { value: "", label: "Home (no folder)" },
              ...pickers.folders.map((f) => ({ value: f.id, label: f.name })),
            ]}
          />
          <Btn variant={published ? "soft" : "primary"} icon={<Globe size={16} />} onClick={publish} disabled={isDeleted}>{published ? "Unpublish" : "Publish"}</Btn>
          <Btn onClick={save} busy={saving} disabled={isDeleted}>Save</Btn>
        </div>
      </div>

      {/* Trigger */}
      <Card title={<span className="flex items-center gap-2"><Zap size={16} className="text-primary" /> Trigger</span>}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="text-caption font-semibold uppercase text-ink-3">Run when
            <Select value={triggerType} onChange={(e) => { setTriggerType(e.target.value as TriggerType); setTriggerConfig({}); }} options={TRIGGER_OPTS} />
          </label>
          {triggerType === "FORM_SUBMITTED" && (
            <label className="text-caption font-semibold uppercase text-ink-3">Which form
              <Select value={triggerConfig.formId ?? ""} onChange={(e) => setTriggerConfig({ formId: e.target.value })} options={[{ value: "", label: "Any form" }, ...pickers.forms.map((f) => ({ value: f.id, label: f.name }))]} />
            </label>
          )}
          {triggerType === "TAG_ADDED" && (
            <label className="text-caption font-semibold uppercase text-ink-3">Which tag
              <input className={inputCls} list="wf-tags" value={triggerConfig.tag ?? ""} onChange={(e) => setTriggerConfig({ tag: e.target.value })} placeholder="Any tag" />
              <datalist id="wf-tags">{pickers.tags.map((t) => <option key={t} value={t} />)}</datalist>
            </label>
          )}
          {triggerType === "STAGE_CHANGED" && (
            <label className="text-caption font-semibold uppercase text-ink-3">Which stage
              <Select value={triggerConfig.stage ?? ""} onChange={(e) => setTriggerConfig({ stage: e.target.value })} options={[{ value: "", label: "Any stage" }, ...LEAD_STAGE_OPTIONS.map((s) => ({ value: s.value, label: s.label }))]} />
            </label>
          )}
        </div>
      </Card>

      {/* Actions */}
      <Card title="Then, in order…" actions={
        <div className="flex items-center gap-1.5">
          <Select size="sm" value={addType} onChange={(e) => setAddType(e.target.value as WorkflowActionType)} options={ACTION_TYPES.map((t) => ({ value: t, label: ACTION_LABELS[t] }))} />
          <Btn size="sm" icon={<Plus size={14} />} onClick={addAction}>Add</Btn>
        </div>
      }>
        <div className="space-y-3">
          {actions.length === 0 && <p className="text-sm text-ink-3">No actions yet — add the first step.</p>}
          {actions.map((a, i) => (
            <div key={a.id} className="rounded-field border border-line p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="flex items-center gap-2 text-sm font-semibold text-ink"><span className="grid h-6 w-6 place-items-center rounded-full bg-primary-soft text-caption text-primary-strong">{i + 1}</span> {ACTION_LABELS[a.type]}</span>
                <div className="flex items-center gap-1">
                  <IconButton label="Move up" onClick={() => move(i, -1)}><ArrowUp size={14} /></IconButton>
                  <IconButton label="Move down" onClick={() => move(i, 1)}><ArrowDown size={14} /></IconButton>
                  <IconButton label="Delete action" onClick={() => setActions((as) => as.filter((_, idx) => idx !== i))}><Trash2 size={14} /></IconButton>
                </div>
              </div>
              <ActionFields a={a} i={i} stepCount={actions.length} update={updateAction} pickers={pickers} />
              {i < actions.length - 1 && <div className="mt-2 flex justify-center text-ink-3"><ArrowDownToLine size={14} /></div>}
            </div>
          ))}
        </div>
      </Card>

      {/* Enrollments */}
      {workflow.enrollments.length > 0 && (
        <Card title={`Recent enrollments (${workflow.totalEnrolled} total)`} flush>
          <div className="divide-y divide-line">
            {workflow.enrollments.map((e) => (
              <div key={e.id} className="flex items-center justify-between px-6 py-3 text-sm">
                <Link href={`/contacts/${e.leadId}`} className="font-medium text-ink hover:text-primary">{e.leadName}</Link>
                <div className="flex items-center gap-3">
                  <span className="text-caption text-ink-3">step {e.step + 1}{e.nextRunAt ? <> · waking <DateText date={e.nextRunAt} /></> : ""}</span>
                  <Pill tone={e.status === "COMPLETED" ? "good" : e.status === "FAILED" ? "bad" : "warn"}>{e.status}</Pill>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

/** Numbered dropdown of existing workflow steps (1-based labels, 0-based values) + "End workflow". */
function StepTargetSelect({ value, stepCount, onChange }: { value: number | undefined; stepCount: number; onChange: (v: number) => void }) {
  return (
    <Select
      value={String(value ?? stepCount)}
      onChange={(e) => onChange(Number(e.target.value))}
      options={[
        ...Array.from({ length: stepCount }, (_, idx) => ({ value: String(idx), label: `Step ${idx + 1}` })),
        { value: String(stepCount), label: "End workflow" },
      ]}
    />
  );
}

function ActionFields({ a, i, stepCount, update, pickers }: { a: WorkflowAction; i: number; stepCount: number; update: (i: number, p: Partial<WorkflowAction>) => void; pickers: Pickers }) {
  switch (a.type) {
    case "SEND_EMAIL":
      return (
        <div className="space-y-2">
          <Select value={a.templateId ?? ""} onChange={(e) => update(i, { templateId: e.target.value })} options={[{ value: "", label: "Custom (write below)" }, ...pickers.templates.filter((t) => t.channel === "EMAIL").map((t) => ({ value: t.id, label: `Template: ${t.name}` }))]} />
          {!a.templateId && <>
            <input className={inputCls} placeholder="Subject" value={a.subject ?? ""} onChange={(e) => update(i, { subject: e.target.value })} />
            <textarea className="w-full rounded-field border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-primary" rows={2} placeholder="Email body (use {{first_name}})" value={a.body ?? ""} onChange={(e) => update(i, { body: e.target.value })} />
          </>}
        </div>
      );
    case "SEND_SMS":
      return (
        <div className="space-y-2">
          <Select value={a.templateId ?? ""} onChange={(e) => update(i, { templateId: e.target.value })} options={[{ value: "", label: "Custom (write below)" }, ...pickers.templates.filter((t) => t.channel === "SMS").map((t) => ({ value: t.id, label: `Template: ${t.name}` }))]} />
          {!a.templateId && <textarea className="w-full rounded-field border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-primary" rows={2} placeholder="SMS body (use {{first_name}})" value={a.body ?? ""} onChange={(e) => update(i, { body: e.target.value })} />}
        </div>
      );
    case "ADD_TAG":
    case "REMOVE_TAG":
      return (
        <>
          <input className={inputCls} list="wf-tags2" placeholder="Tag name" value={a.tag ?? ""} onChange={(e) => update(i, { tag: e.target.value })} />
          <datalist id="wf-tags2">{pickers.tags.map((t) => <option key={t} value={t} />)}</datalist>
        </>
      );
    case "MOVE_STAGE":
      return (
        <Select placeholder="— pick a stage —" value={a.stage ?? ""} onChange={(e) => update(i, { stage: e.target.value })} options={LEAD_STAGE_OPTIONS.map((s) => ({ value: s.value, label: s.label }))} />
      );
    case "CREATE_TASK":
      return (
        <div className="grid grid-cols-2 gap-2">
          <input className={inputCls} placeholder="Task title" value={a.taskTitle ?? ""} onChange={(e) => update(i, { taskTitle: e.target.value })} />
          <Select value={a.taskAssigneeId ?? ""} onChange={(e) => update(i, { taskAssigneeId: e.target.value })} options={[{ value: "", label: "Unassigned" }, ...pickers.users.map((u) => ({ value: u.id, label: u.name }))]} />
        </div>
      );
    case "IF_TAG":
      return (
        <div className="space-y-2">
          <label className="text-caption font-semibold uppercase text-ink-3">Contact has tag
            <input className={inputCls} list="wf-tags3" placeholder="Tag name" value={a.tag ?? ""} onChange={(e) => update(i, { tag: e.target.value })} />
            <datalist id="wf-tags3">{pickers.tags.map((t) => <option key={t} value={t} />)}</datalist>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-caption font-semibold uppercase text-ink-3">If yes, go to
              <StepTargetSelect value={a.thenStep} stepCount={stepCount} onChange={(v) => update(i, { thenStep: v })} />
            </label>
            <label className="text-caption font-semibold uppercase text-ink-3">If no, go to
              <StepTargetSelect value={a.elseStep} stepCount={stepCount} onChange={(v) => update(i, { elseStep: v })} />
            </label>
          </div>
        </div>
      );
    case "WAIT": {
      const mins = a.waitMinutes ?? 60;
      const unit = mins % 1440 === 0 ? "days" : mins % 60 === 0 ? "hours" : "minutes";
      const amount = unit === "days" ? mins / 1440 : unit === "hours" ? mins / 60 : mins;
      const setWait = (amt: number, u: string) => update(i, { waitMinutes: Math.max(1, Math.round(amt * (u === "days" ? 1440 : u === "hours" ? 60 : 1))) });
      return (
        <div className="flex items-center gap-2">
          <input className={`${inputCls} w-24`} type="number" min={1} value={amount} onChange={(e) => setWait(Number(e.target.value) || 1, unit)} />
          <Select className="w-32" value={unit} onChange={(e) => setWait(amount, e.target.value)} options={[{ value: "minutes", label: "minutes" }, { value: "hours", label: "hours" }, { value: "days", label: "days" }]} />
        </div>
      );
    }
    default:
      return null;
  }
}

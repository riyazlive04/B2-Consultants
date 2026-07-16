"use client";

import { useEffect, useRef, useState, useTransition, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Mail, MessageSquare, Send, MessageCircle } from "lucide-react";
import type { InboxThread, ThreadView } from "@/server/messaging-metrics";
import { Avatar, EmptyState, Pill } from "@/components/ui/kit";
import { Btn } from "@/components/ui/controls";
import { toast } from "@/components/ui/feedback";
import { Select } from "@/components/ui/form";
import {
  sendEmailAction,
  sendSmsAction,
  sendWhatsAppFreeTextAction,
  sendWhatsAppTemplateAction,
  markThreadRead,
  assignThread,
} from "@/server/messaging-actions";

type Template = { id: string; channel: "EMAIL" | "SMS"; name: string; subject: string | null; body: string };
type WhatsAppTemplate = { kind: string; label: string; name: string; params: string[] };
type Settings = {
  email: { enabled: boolean };
  sms: { enabled: boolean };
  whatsapp: { enabled: boolean; configured: boolean; templates: WhatsAppTemplate[] };
};
type AssignableUser = { id: string; name: string };

const CHANNEL_ICON = { EMAIL: Mail, SMS: MessageSquare, WHATSAPP: MessageCircle } as const;

function tabCls(active: boolean): string {
  return `rounded-[10px] px-3 py-1 text-caption font-semibold ${active ? "bg-surface text-primary-strong shadow-card" : "text-ink-2"}`;
}

export default function Inbox({
  threads,
  activeThread,
  templates,
  settings,
  users,
}: {
  threads: InboxThread[];
  activeThread: ThreadView | null;
  templates: Template[];
  settings: Settings;
  users: AssignableUser[];
}) {
  const router = useRouter();
  const lastPollRef = useRef<{ latestAt: string | null; unread: number } | null>(null);

  // Live: poll a scoped "did anything change" signal (api/conversations/poll), not the whole
  // force-dynamic page — router.refresh() on a dumb timer would re-run getInboxThreads' two
  // 400-row fetches every tick, per open tab (the same problem the top-bar NotificationBell already
  // hit and fixed the same way). Only refresh the page when the signal actually moved. Pauses while
  // the tab is hidden.
  useEffect(() => {
    let cancelled = false;
    let seeded = false;
    const poll = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const res = await fetch("/api/conversations/poll", { cache: "no-store" });
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { latestAt: string | null; unread: number };
        const prev = lastPollRef.current;
        lastPollRef.current = data;
        if (!seeded) {
          seeded = true; // first tick just establishes the baseline, never forces a refresh
          return;
        }
        if (!prev || prev.latestAt !== data.latestAt || prev.unread !== data.unread) router.refresh();
      } catch {
        /* transient network error - try again next tick */
      }
    };
    const t = setInterval(poll, 18_000);
    document.addEventListener("visibilitychange", poll);
    return () => {
      cancelled = true;
      clearInterval(t);
      document.removeEventListener("visibilitychange", poll);
    };
  }, [router]);

  // Mark the open thread read the moment it's opened (a link click or a direct ?contact= load).
  useEffect(() => {
    if (!activeThread) return;
    markThreadRead(activeThread.lead.id).then(() => router.refresh());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeThread?.lead.id]);

  if (threads.length === 0 && !activeThread) {
    return <EmptyState icon={<Mail size={20} />} title="No conversations yet" body="Send an email or SMS from a contact, or connect a channel in Settings. WhatsApp threads show here too." />;
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[300px_1fr]">
      {/* Thread list */}
      <div className="max-h-[600px] space-y-1 overflow-y-auto rounded-card border border-line bg-surface p-2">
        {threads.map((t) => {
          const Icon = CHANNEL_ICON[t.lastChannel];
          const active = activeThread?.lead.id === t.leadId;
          return (
            <div key={t.leadId} className={`rounded-field p-2.5 ${active ? "bg-primary-soft" : "hover:bg-surface-2"}`}>
              <Link href={`/conversations?contact=${t.leadId}`} className="flex items-center gap-2.5">
                <Avatar name={t.name} size={34} />
                <div className="min-w-0 flex-1">
                  <p className={`flex items-center gap-1.5 text-sm font-semibold ${active ? "text-primary-strong" : "text-ink"}`}>
                    {t.unread && <span aria-label="Unread" title="Unread" className="h-2 w-2 flex-none rounded-full bg-accent" />}
                    <span className="truncate">{t.name}</span>
                  </p>
                  <p className="flex items-center gap-1 truncate text-caption text-ink-3">
                    <Icon size={11} /> {t.lastSnippet}
                  </p>
                </div>
              </Link>
              <div className="mt-1.5 pl-[42px]">
                <AssignSelect leadId={t.leadId} users={users} assignedToId={t.assignedToId} />
              </div>
            </div>
          );
        })}
      </div>

      {/* Thread + composer */}
      {activeThread ? (
        <div className="flex max-h-[600px] flex-col rounded-card border border-line bg-surface">
          <div className="flex items-center gap-3 border-b border-line px-4 py-3">
            <Avatar name={activeThread.lead.name} size={36} />
            <div className="min-w-0">
              <Link href={`/contacts/${activeThread.lead.id}`} className="text-sm font-semibold text-ink hover:text-primary">{activeThread.lead.name}</Link>
              <p className="truncate text-caption text-ink-3">{activeThread.lead.phone ?? "No phone"}{activeThread.lead.email ? ` · ${activeThread.lead.email}` : ""}</p>
            </div>
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto p-4">
            {activeThread.messages.length === 0 && <p className="text-center text-sm text-ink-3">No messages yet — start the conversation below.</p>}
            {activeThread.messages.map((m) => {
              const out = m.direction === "OUTBOUND";
              const Icon = CHANNEL_ICON[m.channel];
              return (
                <div key={m.id} className={`flex ${out ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[75%] rounded-lg px-3 py-2 ${out ? "bg-primary-soft" : "bg-surface-2"}`}>
                    <p className="mb-0.5 flex items-center gap-1 text-caption font-semibold text-ink-3"><Icon size={11} /> {m.channel}{m.status === "SKIPPED" ? " · logged" : m.status === "FAILED" ? " · failed" : ""}</p>
                    {m.subject && <p className="text-sm font-semibold text-ink">{m.subject}</p>}
                    <p className="whitespace-pre-wrap text-sm text-ink">{m.body}</p>
                  </div>
                </div>
              );
            })}
          </div>

          <Composer leadId={activeThread.lead.id} templates={templates} settings={settings} />
        </div>
      ) : (
        <div className="grid place-items-center rounded-card border border-line bg-surface p-10 text-sm text-ink-3">Pick a conversation.</div>
      )}
    </div>
  );
}

/** Compact per-thread "Assign to" control — writes assignedToId onto every Message row for the
 *  lead (assignThread), so it stays uniform regardless of which row a future read looks at. */
function AssignSelect({ leadId, users, assignedToId }: { leadId: string; users: AssignableUser[]; assignedToId: string | null }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [value, setValue] = useState(assignedToId ?? "");

  useEffect(() => setValue(assignedToId ?? ""), [assignedToId]);

  async function onChange(e: ChangeEvent<HTMLSelectElement>) {
    const next = e.target.value;
    const prev = value;
    setValue(next);
    const fd = new FormData();
    fd.set("userId", next);
    const res = await assignThread(leadId, fd);
    if (!res.ok) {
      toast(res.error, "error");
      setValue(prev);
      return;
    }
    startTransition(() => router.refresh());
  }

  return (
    <Select
      value={value}
      disabled={pending}
      onChange={onChange}
      aria-label={`Assign ${leadId} to`}
      size="sm"
      className="w-full"
      options={[
        { value: "", label: "Unassigned" },
        ...users.map((u) => ({ value: u.id, label: u.name })),
      ]}
    />
  );
}

function Composer({ leadId, templates, settings }: { leadId: string; templates: Template[]; settings: Settings }) {
  const [channel, setChannel] = useState<"EMAIL" | "SMS" | "WHATSAPP">("EMAIL");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [waMode, setWaMode] = useState<"FREE" | "TEMPLATE">("FREE");
  const [waKind, setWaKind] = useState("");
  const [waParams, setWaParams] = useState<Record<number, string>>({});

  const chTemplates = templates.filter((t) => t.channel === channel);
  const waTemplates = settings.whatsapp.templates;
  const selectedWaTemplate = waTemplates.find((t) => t.kind === waKind) ?? null;

  function applyTemplate(id: string) {
    const t = templates.find((x) => x.id === id);
    if (!t) return;
    if (t.subject) setSubject(t.subject);
    setBody(t.body);
  }

  function pickWaTemplate(kind: string) {
    setWaKind(kind);
    setWaParams({});
  }

  async function send() {
    let res: { ok: boolean; message: string };
    if (channel === "EMAIL") {
      if (!body.trim()) return;
      setBusy(true);
      const fd = new FormData();
      fd.set("subject", subject);
      fd.set("body", body);
      res = await sendEmailAction(leadId, fd);
    } else if (channel === "SMS") {
      if (!body.trim()) return;
      setBusy(true);
      const fd = new FormData();
      fd.set("body", body);
      res = await sendSmsAction(leadId, fd);
    } else if (waMode === "FREE") {
      if (!body.trim()) return;
      setBusy(true);
      const fd = new FormData();
      fd.set("body", body);
      res = await sendWhatsAppFreeTextAction(leadId, fd);
    } else {
      if (!selectedWaTemplate) {
        toast("Pick a template", "error");
        return;
      }
      setBusy(true);
      const fd = new FormData();
      fd.set("kind", waKind);
      selectedWaTemplate.params.forEach((_, i) => fd.set(`param_${i}`, waParams[i] ?? ""));
      res = await sendWhatsAppTemplateAction(leadId, fd);
    }
    setBusy(false);
    toast(res.message, res.ok ? "success" : "error");
    if (res.ok) {
      setBody("");
      setSubject("");
      setWaParams({});
    }
  }

  return (
    <div className="space-y-2 border-t border-line p-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-field bg-surface-2 p-0.5">
          <button onClick={() => setChannel("EMAIL")} className={tabCls(channel === "EMAIL")}>Email</button>
          <button onClick={() => setChannel("SMS")} className={tabCls(channel === "SMS")}>SMS</button>
          <button onClick={() => setChannel("WHATSAPP")} className={tabCls(channel === "WHATSAPP")}>WhatsApp</button>
        </div>
        {channel !== "WHATSAPP" && chTemplates.length > 0 && (
          <Select
            onChange={(e) => e.target.value && applyTemplate(e.target.value)}
            value=""
            placeholder="Template…"
            size="sm"
            options={chTemplates.map((t) => ({ value: t.id, label: t.name }))}
          />
        )}
        {channel === "EMAIL" && !settings.email.enabled && <Pill tone="warn">Email off — logged only</Pill>}
        {channel === "SMS" && !settings.sms.enabled && <Pill tone="warn">SMS off — logged only</Pill>}
        {channel === "WHATSAPP" && !settings.whatsapp.configured && <Pill tone="warn">WATI not configured</Pill>}
      </div>

      {channel === "EMAIL" && (
        <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject" className="h-9 w-full rounded-field border border-line bg-surface px-3 text-sm outline-none focus:border-primary" />
      )}

      {channel === "WHATSAPP" && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-field bg-surface-2 p-0.5">
            <button onClick={() => setWaMode("FREE")} className={tabCls(waMode === "FREE")}>Free text</button>
            <button
              onClick={() => waTemplates.length > 0 && setWaMode("TEMPLATE")}
              disabled={waTemplates.length === 0}
              title={waTemplates.length === 0 ? "No WATI templates configured — see WhatsApp → Settings" : undefined}
              className={`${tabCls(waMode === "TEMPLATE")} disabled:cursor-not-allowed disabled:opacity-40`}
            >
              Template
            </button>
          </div>
          {waMode === "TEMPLATE" && (
            <div className="min-w-0 flex-1">
              <Select
                value={waKind}
                onChange={(e) => pickWaTemplate(e.target.value)}
                placeholder="Pick a template…"
                size="sm"
                options={waTemplates.map((t) => ({ value: t.kind, label: `${t.label} (${t.name})` }))}
              />
            </div>
          )}
        </div>
      )}

      {channel === "WHATSAPP" && waMode === "TEMPLATE" ? (
        <div className="space-y-2">
          {selectedWaTemplate && selectedWaTemplate.params.length > 0 && (
            <div className="grid grid-cols-2 gap-2">
              {selectedWaTemplate.params.map((p, i) => (
                <input
                  key={`${waKind}-${p}-${i}`}
                  value={waParams[i] ?? ""}
                  onChange={(e) => setWaParams((prev) => ({ ...prev, [i]: e.target.value }))}
                  placeholder={`{{${p}}}`}
                  className="h-9 rounded-field border border-line bg-surface px-3 text-sm outline-none focus:border-primary"
                />
              ))}
            </div>
          )}
          <div className="flex justify-end">
            <Btn icon={<Send size={15} />} onClick={send} busy={busy} disabled={!selectedWaTemplate}>Send template</Btn>
          </div>
        </div>
      ) : (
        <div className="space-y-1">
          {channel === "WHATSAPP" && (
            <p className="text-caption text-ink-3">Free text only lands inside the 24h window opened by the contact&apos;s last WhatsApp message. Outside that window, switch to Template.</p>
          )}
          <div className="flex items-end gap-2">
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={2}
              placeholder={channel === "WHATSAPP" ? "Write a WhatsApp reply…" : `Write a ${channel.toLowerCase()}… (use {{name}}, {{first_name}})`}
              className="flex-1 rounded-field border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
            />
            <Btn icon={<Send size={15} />} onClick={send} busy={busy}>Send</Btn>
          </div>
        </div>
      )}
    </div>
  );
}

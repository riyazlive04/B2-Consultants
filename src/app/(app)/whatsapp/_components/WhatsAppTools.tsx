"use client";

import { useState } from "react";
import { Trash2, Send } from "lucide-react";
import { toast, askConfirm } from "@/components/ui/feedback";
import { Select } from "@/components/ui/form";
import { sendTestWhatsApp, setWhatsAppOptOut, sendFreeFormWhatsApp } from "@/server/whatsapp-actions";
import { WHATSAPP_KINDS, WHATSAPP_KIND_LABELS, type WatiTemplateMap } from "@/lib/whatsapp";
import { formatDate } from "@/lib/format";

const inputCls =
  "w-full rounded-field border border-line bg-surface-2 px-3 py-1.5 text-sm outline-none transition-colors focus:border-accent focus:bg-surface";

// DD/MM/YYYY in IST, per DESIGN_SYSTEM §3.
const fmt = (iso: string) => formatDate(iso);

export function WhatsAppTools({
  optOuts,
  templates = {},
}: {
  optOuts: { phone: string; reason: string | null; createdAt: string }[];
  templates?: WatiTemplateMap;
}) {
  const mapped = WHATSAPP_KINDS.filter((k) => templates[k]?.name);
  const [testing, setTesting] = useState(false);
  const [optPhone, setOptPhone] = useState("");
  const [busy, setBusy] = useState(false);

  const [freeSending, setFreeSending] = useState(false);

  const sendTest = async (fd: FormData) => {
    setTesting(true);
    const res = await sendTestWhatsApp(fd);
    setTesting(false);
    toast(res.message, res.ok ? "success" : "error");
  };

  const sendFree = async (fd: FormData) => {
    setFreeSending(true);
    const res = await sendFreeFormWhatsApp(fd);
    setFreeSending(false);
    toast(res.message, res.ok ? "success" : "error");
  };

  const addOptOut = async () => {
    if (!optPhone.trim() || busy) return;
    setBusy(true);
    const res = await setWhatsAppOptOut(optPhone.trim(), true);
    setBusy(false);
    toast(res.message, res.ok ? "success" : "error");
    if (res.ok) setOptPhone("");
  };

  const removeOptOut = async (phone: string) => {
    const ok = await askConfirm({
      title: `Remove opt-out for +${phone}?`,
      body: "This number will be eligible to receive WhatsApp messages again.",
      confirmLabel: "Remove opt-out",
    });
    if (!ok) return;
    const res = await setWhatsAppOptOut(phone, false);
    toast(res.message, res.ok ? "success" : "error");
  };

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      {/* Send test */}
      <section className="rounded-card border border-line bg-surface p-5 shadow-card">
        <h3 className="font-display text-base font-semibold">Send a test</h3>
        <p className="mt-1 text-xs text-muted">
          Sends the real template mapped to a touchpoint, to one number, with sample values. Use it to verify the WATI
          connection and that media-header templates render. Requires WhatsApp to be switched on.
        </p>
        <form action={sendTest} className="mt-4 space-y-3">
          <label className="block">
            <span className="text-xs font-medium text-muted">Touchpoint (which template to send)</span>
            <Select
              name="kind"
              defaultValue={mapped[0] ?? "MANUAL"}
              className="mt-1"
              options={WHATSAPP_KINDS.map((k) => {
                const t = templates[k];
                return {
                  value: k,
                  label: `${WHATSAPP_KIND_LABELS[k]}${t?.name ? ` → ${t.name}` : " → not mapped"}`,
                  disabled: !t?.name, // unmapped touchpoints can't be sent — keep them unselectable
                };
              })}
            />
          </label>
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex-1">
              <span className="text-xs font-medium text-muted">Number (with country code)</span>
              <input name="to" className={`mt-1 ${inputCls}`} placeholder="+91 98765 43210" />
            </label>
            <button
              type="submit"
              disabled={testing || mapped.length === 0}
              className="inline-flex items-center gap-1.5 rounded-btn bg-accent px-4 py-2 text-sm font-semibold text-on-accent hover:opacity-90 disabled:opacity-50"
            >
              <Send size={14} />
              {testing ? "Sending…" : "Send test"}
            </button>
          </div>
          {mapped.length === 0 && (
            <p className="text-caption" style={{ color: "var(--bad)" }}>
              No touchpoint has a template mapped yet — set one in the Settings tab first.
            </p>
          )}
        </form>

        <div className="mt-6 border-t border-line pt-4">
          <h4 className="text-sm font-semibold">Free-form message (24-hour window)</h4>
          <p className="mt-1 text-xs text-muted">
            Plain text, no template. Only delivers if the contact messaged your WhatsApp number in the last 24 hours —
            but unlike a marketing template it is <strong>not</strong> subject to Meta&apos;s per-user frequency caps,
            so it&apos;s the reliable way to prove delivery.
          </p>
          <form action={sendFree} className="mt-3 space-y-2">
            <input name="to" className={inputCls} placeholder="+91 98765 43210" />
            <textarea name="text" rows={2} className={inputCls} placeholder="Hi! This is a test from the B2 dashboard." />
            <button
              type="submit"
              disabled={freeSending}
              className="inline-flex items-center gap-1.5 rounded-btn border border-line bg-surface px-4 py-2 text-sm font-medium hover:bg-surface-2 disabled:opacity-50"
            >
              <Send size={14} />
              {freeSending ? "Sending…" : "Send free-form"}
            </button>
          </form>
        </div>
      </section>

      {/* Opt-outs */}
      <section className="rounded-card border border-line bg-surface p-5 shadow-card">
        <h3 className="font-display text-base font-semibold">Opt-outs</h3>
        <p className="mt-1 text-xs text-muted">
          Numbers here never receive WhatsApp. Added automatically when someone replies STOP, or manually below.
        </p>
        <div className="mt-4 flex flex-wrap items-end gap-2">
          <label className="flex-1">
            <span className="text-xs font-medium text-muted">Add a number</span>
            <input value={optPhone} onChange={(e) => setOptPhone(e.target.value)} className={`mt-1 ${inputCls}`} placeholder="+91 98765 43210" />
          </label>
          <button
            type="button"
            onClick={addOptOut}
            disabled={busy}
            className="rounded-btn border border-line bg-surface px-4 py-2 text-sm font-medium hover:bg-surface-2 disabled:opacity-50"
          >
            Opt out
          </button>
        </div>

        <ul className="mt-4 divide-y divide-line">
          {optOuts.length === 0 ? (
            <li className="py-6 text-center text-sm text-muted">No opt-outs.</li>
          ) : (
            optOuts.map((o) => (
              <li key={o.phone} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm font-medium">+{o.phone}</p>
                  <p className="truncate text-caption text-muted">{o.reason ?? "Opted out"} · {fmt(o.createdAt)}</p>
                </div>
                <button
                  type="button"
                  onClick={() => removeOptOut(o.phone)}
                  className="inline-flex items-center gap-1 text-xs text-risk hover:underline"
                >
                  <Trash2 size={13} /> Remove
                </button>
              </li>
            ))
          )}
        </ul>
      </section>
    </div>
  );
}

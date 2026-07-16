"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { toast } from "@/components/ui/feedback";
import { Select } from "@/components/ui/form";
import { saveWatiSettings, refreshWatiTemplates } from "@/server/whatsapp-actions";
import {
  WHATSAPP_KINDS,
  WHATSAPP_KIND_LABELS,
  WHATSAPP_KIND_HINTS,
  WHATSAPP_AVAILABLE_VARS,
  COUNTRY_OPTIONS,
  type WatiSettings,
  type WatiTemplateSummary,
} from "@/lib/whatsapp";

const inputCls =
  "w-full rounded-field border border-line bg-surface-2 px-3 py-1.5 text-sm outline-none transition-colors focus:border-accent focus:bg-surface";

function NumField({ name, label, defaultValue, hint }: { name: string; label: string; defaultValue: number; hint?: string }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-muted">{label}</span>
      <input name={name} type="number" min={0} step="any" defaultValue={defaultValue} className={`mt-1 ${inputCls}`} />
      {hint && <span className="mt-0.5 block text-caption text-muted">{hint}</span>}
    </label>
  );
}

export function WhatsAppSettingsForm({
  settings,
  catalog = [],
}: {
  settings: WatiSettings;
  catalog?: WatiTemplateSummary[];
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [, startNav] = useTransition();
  const c = settings.cadence;

  // Only APPROVED templates can actually be sent; show those first, then the rest (labelled).
  const sorted = [...catalog].sort((a, b) => Number(b.status === "APPROVED") - Number(a.status === "APPROVED"));
  const byName = new Map(catalog.map((t) => [t.name, t]));

  // Selecting a template auto-fills its variable list, so the two can never drift apart.
  const [params, setParams] = useState<Record<string, string>>(() =>
    Object.fromEntries(WHATSAPP_KINDS.map((k) => [k, (settings.templates[k]?.params ?? []).join(", ")])),
  );
  const onPick = (kind: string, name: string) => {
    const t = byName.get(name);
    if (t) setParams((p) => ({ ...p, [kind]: t.params.join(", ") }));
    else if (!name) setParams((p) => ({ ...p, [kind]: "" }));
  };

  const submit = async (fd: FormData) => {
    setSaving(true);
    const res = await saveWatiSettings(fd);
    setSaving(false);
    toast(res.message, res.ok ? "success" : "error");
  };

  const refresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    const res = await refreshWatiTemplates();
    setRefreshing(false);
    toast(res.message, res.ok ? "success" : "error");
    if (res.ok) startNav(() => router.refresh());
  };

  return (
    <form action={submit} className="space-y-8">
      {/* General */}
      <section className="rounded-card border border-line bg-surface p-5 shadow-card">
        <h3 className="font-display text-base font-semibold">General</h3>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <label className="block sm:col-span-2">
            <span className="text-xs font-medium text-muted">Default country</span>
            <Select
              name="defaultCountry"
              defaultValue={settings.defaultCountry}
              className="mt-1"
              options={COUNTRY_OPTIONS.map((c) => ({ value: c.value, label: c.label }))}
            />
            <span className="mt-0.5 block text-caption text-muted">
              Only used for numbers saved <em>without</em> a country code. Contacts abroad (German students)
              must be saved as <code className="rounded bg-surface-2 px-1">+49…</code> — an ambiguous number is
              skipped, never guessed.
            </span>
          </label>
          <label className="flex items-center gap-2 pt-6">
            <input name="paused" type="checkbox" defaultChecked={settings.paused} className="h-4 w-4 rounded border-line" />
            <span className="text-sm">Pause all sending</span>
          </label>
        </div>
      </section>

      {/* Cadence */}
      <section className="rounded-card border border-line bg-surface p-5 shadow-card">
        <h3 className="font-display text-base font-semibold">Automatic cadence</h3>
        <p className="mt-1 text-xs text-muted">Controls the scheduled reminder run (hit by the cron endpoint / “Run reminders now”).</p>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <NumField name="discoFirstDelayHours" label="Disco: first delay (hrs)" defaultValue={c.discoFirstDelayHours} hint="Wait after a lead arrives before the 1st nudge." />
          <NumField name="discoRepeatHours" label="Disco: repeat gap (hrs)" defaultValue={c.discoRepeatHours} />
          <NumField name="discoMaxReminders" label="Disco: max reminders" defaultValue={c.discoMaxReminders} />
          <label className="block sm:col-span-3">
            <span className="text-xs font-medium text-muted">Pre-call reminders (hours before slot, comma-separated)</span>
            <input name="bookingReminderLeadHours" defaultValue={c.bookingReminderLeadHours.join(", ")} className={`mt-1 ${inputCls}`} placeholder="24, 2" />
          </label>
          <NumField name="noShowDelayHours" label="No-show: delay (hrs)" defaultValue={c.noShowDelayHours} />
          <NumField name="paymentRepeatHours" label="Payment: repeat gap (hrs)" defaultValue={c.paymentRepeatHours} />
          <NumField name="studentRepeatHours" label="Student nudge: repeat gap (hrs)" defaultValue={c.studentRepeatHours} />
          <NumField name="maxPerRun" label="Max messages per run" defaultValue={c.maxPerRun} hint="Safety cap for a single reminder run." />
        </div>

        {/* EMI pre-due — separated out because this is the one touchpoint that fans out to
            every paying student at once, and the one with a live/rehearse switch. */}
        <div className="mt-5 rounded-field border border-line bg-surface-2 p-4">
          <h4 className="text-sm font-semibold">EMI reminder (before the due date)</h4>
          <p className="mt-1 text-xs text-muted">
            Reminds a student their instalment is coming up. Separate from “Payment reminder”, which chases money
            that is already overdue.
          </p>
          <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="text-xs font-medium text-muted">Days before due (comma-separated, 0 = on the day)</span>
              <input
                name="emiPreDueLeadDays"
                defaultValue={c.emiPreDueLeadDays.join(", ")}
                className={`mt-1 ${inputCls}`}
                placeholder="3, 0"
              />
              <span className="mt-1 block text-xs text-muted">Leave empty to switch this reminder off.</span>
            </label>
            <label className="flex flex-col justify-center gap-1.5">
              <span className="flex items-center gap-2">
                <input
                  name="emiPreDueLive"
                  type="checkbox"
                  defaultChecked={!c.emiPreDueDryRun}
                  className="h-4 w-4 rounded border-line"
                />
                <span className="text-sm font-medium">Send for real</span>
              </span>
              <span className="text-xs text-muted">
                Unticked (default) = <strong>rehearsal</strong>: every reminder is logged to WhatsApp history as
                “DRY RUN”, naming the recipient and template, but nothing is sent. Tick this only once the dry-run
                list looks right — it sends to real students.
              </span>
            </label>
          </div>
        </div>
      </section>

      {/* Templates */}
      <section className="rounded-card border border-line bg-surface p-5 shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-display text-base font-semibold">WATI templates</h3>
          <button
            type="button"
            onClick={refresh}
            disabled={refreshing}
            className="inline-flex items-center gap-1.5 rounded-field border border-line bg-surface px-3 py-1.5 text-xs font-medium hover:bg-surface-2 disabled:opacity-50"
          >
            <RefreshCw size={13} className={refreshing ? "animate-spin" : ""} />
            {refreshing ? "Fetching…" : "Refresh templates from WATI"}
          </button>
        </div>
        <p className="mt-1 text-xs text-muted">
          A WhatsApp template only accepts the variables it was approved with, so picking a template fills its variable
          list automatically. A touchpoint with no template is never sent.
          {catalog.length === 0 && " No templates loaded yet — hit Refresh, or type the name manually."}
        </p>

        <div className="mt-4 space-y-4">
          {WHATSAPP_KINDS.map((kind) => {
            const t = settings.templates[kind];
            const current = params[kind] ?? "";
            const declared = current.split(",").map((p) => p.trim()).filter(Boolean);
            const available = WHATSAPP_AVAILABLE_VARS[kind] as readonly string[];
            const unsupported = declared.filter((p) => !available.includes(p));
            const picked = t?.name ? byName.get(t.name) : undefined;

            return (
              <div key={kind} className="rounded-field border border-line p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-sm font-semibold">{WHATSAPP_KIND_LABELS[kind]}</p>
                  <p className="text-caption text-muted">
                    can supply: {available.map((v) => `{{${v}}}`).join(" ") || "—"}
                  </p>
                </div>
                <p className="mt-0.5 text-caption text-muted">{WHATSAPP_KIND_HINTS[kind]}</p>

                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                  {catalog.length > 0 ? (
                    <Select
                      name={`tpl_${kind}_name`}
                      defaultValue={t?.name ?? ""}
                      onChange={(e) => onPick(kind, e.target.value)}
                      options={[
                        { value: "", label: "— not mapped (never sends) —" },
                        ...sorted.map((tpl) => ({
                          value: tpl.name,
                          label: `${tpl.name}${tpl.status !== "APPROVED" ? ` (${tpl.status})` : ""} · ${tpl.category}${tpl.params.length ? ` · {{${tpl.params.join("}} {{")}}}` : " · no vars"}`,
                        })),
                      ]}
                    />
                  ) : (
                    <input name={`tpl_${kind}_name`} defaultValue={t?.name ?? ""} className={inputCls} placeholder="Template name (e.g. calendly_qualification)" />
                  )}
                  <input
                    name={`tpl_${kind}_params`}
                    value={current}
                    onChange={(e) => setParams((p) => ({ ...p, [kind]: e.target.value }))}
                    className={inputCls}
                    placeholder="Variables in order (blank = none)"
                  />
                  <input name={`tpl_${kind}_broadcast`} defaultValue={t?.broadcastName ?? ""} className={inputCls} placeholder="Broadcast name (optional)" />
                </div>

                {picked && picked.status !== "APPROVED" && (
                  <p className="mt-2 text-caption" style={{ color: "var(--bad)" }}>
                    {picked.name} is {picked.status} in WATI — WhatsApp will reject sends until it is approved.
                  </p>
                )}
                {picked && picked.category === "MARKETING" && (
                  <p className="mt-2 text-caption text-muted">
                    MARKETING category: subject to marketing opt-in and per-user frequency caps. A UTILITY template
                    delivers reminders more reliably.
                  </p>
                )}
                {unsupported.length > 0 && (
                  <p className="mt-2 text-caption" style={{ color: "var(--bad)" }}>
                    This template asks for {unsupported.map((p) => `{{${p}}}`).join(", ")}, which this touchpoint
                    cannot supply — sends will be skipped.
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={saving}
          className="rounded-btn bg-accent px-5 py-2 text-sm font-semibold text-on-accent transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save settings"}
        </button>
      </div>
    </form>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Globe, Plus, Trash2 } from "lucide-react";
import { Btn } from "@/components/ui/controls";
import { Field, TextInput } from "@/components/ui/form";
import { toast, askConfirm } from "@/components/ui/feedback";
import { normalizeDomain } from "@/lib/whatsapp";
import { saveWhatsAppDomainGate } from "@/server/whatsapp-actions";

/**
 * Which domains WATI is allowed to serve.
 *
 * ── The thing this screen must not let someone do by accident ──────────────────
 * Switching the gate on narrows who can be messaged. The panel therefore states, in the room,
 * what the rule actually is - including the part people get wrong: a contact whose origin was
 * never recorded is NOT blocked. Most of the database is in that state and always will be, so a
 * founder who reads "only these domains" as "only these contacts" would expect a silence that
 * never comes, and would go looking for a bug instead of a setting.
 *
 * Suggestions are offered rather than seeded. The list belongs to Ameen; pre-writing entries
 * into the stored config would make his first job deleting ours.
 */
export function WhatsAppDomainGate({
  enabled,
  domains,
  suggestions,
}: {
  enabled: boolean;
  domains: string[];
  /** Hosts this app already knows about - one click to add, never added on our own initiative. */
  suggestions: string[];
}) {
  const router = useRouter();
  const [on, setOn] = useState(enabled);
  const [list, setList] = useState<string[]>(domains);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  const dirty = on !== enabled || JSON.stringify(list) !== JSON.stringify(domains);
  const unused = suggestions.filter((s) => !list.includes(s));

  function add(raw: string) {
    const d = normalizeDomain(raw);
    if (!d) return toast(`"${raw.trim()}" is not a domain`, "error");
    if (list.includes(d)) return toast(`${d} is already on the list`);
    setList((p) => [...p, d].sort());
    setDraft("");
  }

  async function save() {
    // Only the ON direction asks. Turning the gate off widens who can be reached, which is the
    // recoverable direction; turning it on starts silencing people, which is not.
    if (on && !enabled) {
      const ok = await askConfirm({
        title: "Restrict WhatsApp to these domains?",
        body:
          `Contacts recorded as arriving from anywhere else will stop receiving WhatsApp - confirmations, ` +
          `reminders, everything. Contacts with no recorded domain are not affected.`,
        confirmLabel: "Restrict",
      });
      if (!ok) return;
    }
    setBusy(true);
    const res = await saveWhatsAppDomainGate({ enabled: on, domains: list });
    setBusy(false);
    toast(res.message, res.ok ? "success" : "error");
    if (res.ok) router.refresh();
  }

  return (
    <div className="rounded-card border border-line bg-surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 grid h-9 w-9 flex-none place-items-center rounded-full bg-primary-soft text-primary-strong">
            <Globe size={17} />
          </span>
          <div>
            <h3 className="font-display text-h3 font-semibold text-ink">Domains WhatsApp may serve</h3>
            <p className="mt-0.5 max-w-2xl text-sm text-ink-2">
              {on
                ? "Only contacts recorded as arriving from these domains are messaged."
                : "Off - every contact can be messaged, wherever they came from."}
            </p>
          </div>
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-ink">
          <input
            type="checkbox"
            checked={on}
            onChange={(e) => setOn(e.target.checked)}
            className="h-4 w-4 accent-[var(--primary)]"
          />
          Restrict by domain
        </label>
      </div>

      <div className="mt-4 flex flex-wrap items-end gap-2">
        <div className="min-w-[18rem] flex-1">
          <Field label="Add a domain" hint="Paste a URL or type a hostname - b2app.sirahagents.com">
            <TextInput
              kind="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  add(draft);
                }
              }}
              placeholder="https://b2app.sirahagents.com/"
            />
          </Field>
        </div>
        <Btn size="sm" variant="ghost" icon={<Plus size={14} />} onClick={() => add(draft)} disabled={!draft.trim()}>
          Add
        </Btn>
      </div>

      {unused.length > 0 && (
        <p className="mt-2 flex flex-wrap items-center gap-2 text-caption text-ink-3">
          Known hosts:
          {unused.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => add(s)}
              className="press rounded-full border border-line-strong px-2.5 py-1 font-medium text-ink-2 transition-colors hover:border-primary-tint hover:text-ink"
            >
              + {s}
            </button>
          ))}
        </p>
      )}

      <ul className="mt-4 flex flex-col gap-2">
        {list.length === 0 && (
          <li className="rounded-field border border-dashed border-line px-4 py-3 text-sm text-ink-3">
            No domains yet. The gate cannot be switched on until there is at least one.
          </li>
        )}
        {list.map((d) => (
          <li key={d} className="flex items-center justify-between rounded-field border border-line bg-surface-2 px-3 py-2">
            <span className="truncate text-sm font-medium text-ink">{d}</span>
            <button
              type="button"
              onClick={() => setList((p) => p.filter((x) => x !== d))}
              aria-label={`Remove ${d}`}
              className="press grid h-8 w-8 place-items-center rounded-field text-ink-3 transition-colors hover:text-risk"
            >
              <Trash2 size={15} />
            </button>
          </li>
        ))}
      </ul>

      {/* The rule people get wrong, stated where the decision is made rather than in a doc. */}
      <p className="mt-4 rounded-field border border-line bg-surface-2 px-4 py-3 text-caption text-ink-2">
        A contact whose origin was never recorded is <strong>not</strong> blocked. Origins are only
        observed from the funnel and booking pages, so every contact imported from Synamate has none
        and always will - reading those as &ldquo;not on the list&rdquo; would silence almost the whole
        database the moment this is switched on.
      </p>

      <div className="mt-4 flex items-center gap-3">
        <Btn size="sm" onClick={save} disabled={!dirty || busy}>
          {busy ? "Saving…" : "Save"}
        </Btn>
        {dirty && (
          <button
            type="button"
            onClick={() => { setOn(enabled); setList(domains); setDraft(""); }}
            className="text-sm text-ink-3 underline"
          >
            Discard changes
          </button>
        )}
      </div>
    </div>
  );
}

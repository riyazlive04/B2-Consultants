"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, RefreshCw } from "lucide-react";
import { SwitchRow } from "@/components/ui/controls";
import { askConfirm, toast } from "@/components/ui/feedback";
import { regenerateLeadWebhookKey, setLeadWebhookEnabled } from "@/server/lead-webhook-actions";
import { Btn, Card, Hint } from "./kit";

/**
 * Founder Console → Sales ops → Lead Webhook.
 *
 * One switch deciding whether pages hosted OUTSIDE this app may send leads in. Off, leads come
 * only from our own pages; on, the URL below accepts opt-ins from any page given it.
 */
export function LeadWebhookPanel({
  enabled,
  webhookKey,
  path,
  lastDelivery,
}: {
  enabled: boolean;
  webhookKey: string;
  path: string;
  lastDelivery: { at: string | null; ok: boolean; note: string | null } | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  // The origin is read in the browser so the URL matches whichever host the founder is on,
  // and after mount so the server render and the first client render agree.
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);

  const url = webhookKey ? `${origin}${path}?key=${webhookKey}` : "";

  async function toggle(next: boolean) {
    if (next) {
      const ok = await askConfirm({
        title: "Accept leads from the webhook?",
        body: "Opt-ins sent to this URL will be created as leads, assigned to a caller and started on the outreach sequence, including the instant WhatsApp intro if outreach is armed.",
        confirmLabel: "Turn on",
      });
      if (!ok) return;
    }
    setBusy(true);
    const res = await setLeadWebhookEnabled(next);
    setBusy(false);
    if (!res.ok) return toast(res.error, "error");
    toast(next ? "Lead webhook is on" : "Lead webhook is off");
    router.refresh();
  }

  async function regenerate() {
    const ok = await askConfirm({
      title: "Regenerate the webhook key?",
      body: "The current URL stops working immediately. Every outside page must be updated with the new URL, or its leads will be refused.",
      confirmLabel: "Regenerate",
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    const res = await regenerateLeadWebhookKey();
    setBusy(false);
    if (!res.ok) return toast(res.error, "error");
    toast("New key generated - update your outside pages");
    router.refresh();
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      toast("Webhook URL copied");
    } catch {
      toast("Could not copy - select the URL and copy it manually", "error");
    }
  }

  return (
    <div className="space-y-5">
      <Hint>
        Decides where leads come from. <strong>Off:</strong> only our own pages bring in leads, and the
        webhook refuses everything. <strong>On:</strong> pages built and hosted elsewhere (for example a
        FlexiFunnels page on your own domain) can send their opt-ins to the URL below. Our own pages keep
        working either way.
      </Hint>

      <Card>
        <SwitchRow
          title="Accept leads from the B2 Consultants webhook"
          description={enabled ? "On - outside pages can send leads in." : "Off - leads come only from our own pages."}
          checked={enabled}
          onChange={toggle}
          disabled={busy}
        />

        {webhookKey ? (
          <div className="mt-5 space-y-3">
            <p className="text-sm font-medium text-ink">Webhook URL</p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                readOnly
                aria-label="Webhook URL"
                value={url}
                onFocus={(e) => e.currentTarget.select()}
                className="h-10 w-full min-w-0 rounded-field border border-line-strong bg-surface-2 px-3 font-mono text-xs text-ink outline-none focus:border-primary focus:ring-2 focus:ring-primary-soft"
              />
              <div className="flex flex-none gap-2">
                <Btn onClick={copy} icon={<Copy size={14} />} disabled={!origin}>
                  Copy
                </Btn>
                <Btn onClick={regenerate} icon={<RefreshCw size={14} />} busy={busy} variant="ghost">
                  New key
                </Btn>
              </div>
            </div>
            <Hint>
              In FlexiFunnels: open the page, click the form&apos;s settings (gear icon), add a webhook, give it
              a name and paste this URL. The form must collect a <strong>name</strong> and a{" "}
              <strong>phone number</strong>. Treat the URL like a password: anyone who has it can add leads.
            </Hint>
          </div>
        ) : (
          <p className="mt-4 text-xs text-muted">The webhook URL is created the first time you switch this on.</p>
        )}

        <div className="mt-5 border-t border-line pt-4 text-xs">
          {lastDelivery?.at ? (
            <p className={lastDelivery.ok ? "text-muted" : "font-medium text-bad"}>
              Last delivery: {new Date(lastDelivery.at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST -{" "}
              {lastDelivery.ok ? "lead captured" : `failed${lastDelivery.note ? ` (${lastDelivery.note})` : ""}`}
            </p>
          ) : (
            <p className="text-muted">No lead has been delivered to this webhook yet.</p>
          )}
        </div>
      </Card>
    </div>
  );
}

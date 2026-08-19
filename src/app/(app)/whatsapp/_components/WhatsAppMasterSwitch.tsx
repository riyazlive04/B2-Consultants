"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Power, PowerOff } from "lucide-react";
import { Btn } from "@/components/ui/controls";
import { toast, askConfirm } from "@/components/ui/feedback";
import { setWhatsAppPaused } from "@/server/whatsapp-actions";

/**
 * Admin master switch for outbound WhatsApp.
 *
 * Turning it OFF is deliberately one click with no confirmation - this is the control someone
 * reaches for when messages are going out that shouldn't be, and a dialog in the way of stopping
 * them is a dialog in the wrong place. Turning it ON asks first, because that is the direction
 * that reaches real phones.
 *
 * `envLive` is `WATI_ENABLED` and `configured` is endpoint+token. Neither can be changed from a
 * web request, so when either is missing the switch says so instead of offering a control that
 * would appear to work and then send nothing.
 */
export function WhatsAppMasterSwitch({
  paused,
  envLive,
  configured,
  testRecipient,
}: {
  paused: boolean;
  envLive: boolean;
  configured: boolean;
  /** When set, every send is redirected here instead of the real recipient. */
  testRecipient: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const sending = !paused && envLive && configured;

  async function toggle() {
    const turningOn = paused;

    if (turningOn) {
      const ok = await askConfirm({
        title: "Turn WhatsApp sending on?",
        body: testRecipient
          ? `Reminders that are already due will go out as soon as this is on. Every message is currently redirected to the test number ${testRecipient}, so no lead will be contacted until that is cleared in Settings.`
          : "Reminders that are already due will go out as soon as this is on, to REAL recipients - there is no test number set. Anything overdue is sent in one batch, not spread out.",
        confirmLabel: "Turn on",
      });
      if (!ok) return;
    }

    setBusy(true);
    const res = await setWhatsAppPaused(!paused);
    setBusy(false);
    toast(res.message, res.ok ? "success" : "error");
    if (res.ok) router.refresh();
  }

  // Nothing to switch: the environment gate is the blocker, and it lives outside the app.
  if (!configured || !envLive) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-surface-2 px-2.5 py-1 text-xs font-medium text-muted">
          {!configured ? "Not configured" : "Off at the server"}
        </span>
        <p className="text-caption text-ink-3">
          {!configured
            ? "Add the WATI endpoint and token to the server environment to enable this."
            : "Set WATI_ENABLED=true in the server environment, then restart, before this switch can arm sending."}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Btn
        variant={sending ? "danger" : "primary"}
        icon={sending ? <PowerOff size={16} /> : <Power size={16} />}
        onClick={toggle}
        busy={busy}
      >
        {sending ? "Turn sending off" : "Turn sending on"}
      </Btn>
      {sending && testRecipient && (
        <span className="rounded-full bg-warn-soft px-2.5 py-1 text-caption font-semibold text-warn">
          Test mode → {testRecipient}
        </span>
      )}
      <p className="text-caption text-ink-3">
        {sending
          ? "Outbound messages are leaving the system."
          : "Nothing is sent. Due reminders queue up and go out when this is switched back on."}
      </p>
    </div>
  );
}

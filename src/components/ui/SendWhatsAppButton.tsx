"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MessageCircle } from "lucide-react";
import { toast, askConfirm } from "./feedback";
import type { WhatsAppActionResult } from "@/server/whatsapp-actions";

/**
 * One reusable "Send WhatsApp" control, used across Pipeline, Bookings, Finance and Students.
 * `action` is a bound server action (e.g. sendLeadReminder.bind(null, id)) or a client thunk —
 * either way it returns a WhatsAppActionResult. `ok` → green toast; a skip/failure → red toast
 * with the reason (so "WhatsApp is off / no template / opted out" is honest, not a false success).
 * Refreshes the route on completion so the row's status badge updates.
 */
export function SendWhatsAppButton({
  action,
  label = "WhatsApp",
  busyLabel = "Sending…",
  confirmTitle,
  confirmBody,
  variant = "link",
  className,
}: {
  action: () => Promise<WhatsAppActionResult>;
  label?: string;
  busyLabel?: string;
  confirmTitle?: string;
  confirmBody?: string;
  variant?: "link" | "button" | "icon";
  className?: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [, startNav] = useTransition();

  const run = async () => {
    if (pending) return;
    if (confirmTitle) {
      const ok = await askConfirm({ title: confirmTitle, body: confirmBody, confirmLabel: "Send WhatsApp" });
      if (!ok) return;
    }
    setPending(true);
    try {
      const res = await action();
      toast(res.message, res.ok ? "success" : "error");
      startNav(() => router.refresh());
    } catch {
      toast("Could not send the message", "error");
    } finally {
      setPending(false);
    }
  };

  const text = pending ? busyLabel : label;

  if (variant === "button") {
    return (
      <button
        type="button"
        onClick={run}
        disabled={pending}
        className={
          className ??
          "inline-flex items-center gap-1.5 rounded-field border border-line bg-surface px-3 py-1.5 text-sm font-medium text-ink hover:bg-surface-2 disabled:opacity-50"
        }
      >
        <MessageCircle size={14} />
        {text}
      </button>
    );
  }

  if (variant === "icon") {
    return (
      <button
        type="button"
        onClick={run}
        disabled={pending}
        title={label}
        aria-label={label}
        className={className ?? "inline-flex items-center text-muted hover:text-accent disabled:opacity-50"}
      >
        <MessageCircle size={15} />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={run}
      disabled={pending}
      className={className ?? "inline-flex items-center gap-1 whitespace-nowrap py-1 text-xs text-accent hover:underline disabled:opacity-50"}
    >
      <MessageCircle size={13} />
      {text}
    </button>
  );
}

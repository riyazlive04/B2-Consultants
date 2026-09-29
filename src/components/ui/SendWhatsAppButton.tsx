"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MessageCircle } from "lucide-react";
import { toast, askConfirm } from "./feedback";
import type { WhatsAppActionResult } from "@/server/whatsapp-actions";

/**
 * One reusable "Send WhatsApp" control, used across Pipeline, Bookings, Finance and Students.
 * `action` is a bound server action (e.g. sendLeadReminder.bind(null, id)) or a client thunk -
 * either way it returns a WhatsAppActionResult. `ok` → green toast; a skip/failure → red toast
 * with the reason (so "WhatsApp is off / no template / opted out" is honest, not a false success).
 * Refreshes the route on completion so the row's status badge updates.
 */
/** How long after a send the control stays in its "already done" state (Error Log L6). */
const RESEND_GUARD_MS = 24 * 60 * 60 * 1000;

function sentAgo(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  return hours < 24 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`;
}

export function SendWhatsAppButton({
  action,
  label = "WhatsApp",
  busyLabel = "Sending…",
  confirmTitle,
  confirmBody,
  variant = "link",
  className,
  lastSentAt,
}: {
  action: () => Promise<WhatsAppActionResult>;
  label?: string;
  busyLabel?: string;
  confirmTitle?: string;
  confirmBody?: string;
  variant?: "link" | "button" | "icon";
  className?: string;
  /**
   * When this recipient was last messaged, ISO. Within 24h the control flips to "Sent · 2h ago"
   * and a resend must be confirmed (Error Log L6 - the option stayed live after use, so the same
   * person could be chased twice).
   *
   * Deliberately NOT hidden outright: a genuine "the first one didn't arrive" resend is a real
   * need the spec calls an emergency override. Making it deliberate is enough; making it
   * impossible would send people to WhatsApp directly, where nothing is logged at all.
   */
  lastSentAt?: string | null;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [, startNav] = useTransition();

  // Optimistic: the row's own `lastSentAt` only updates after the route revalidates, and the
  // window between click and refresh is exactly when a double-send happens.
  const [justSent, setJustSent] = useState<string | null>(null);
  const sentAt = justSent ?? lastSentAt ?? null;
  const recentlySent = !!sentAt && Date.now() - new Date(sentAt).getTime() < RESEND_GUARD_MS;

  const run = async () => {
    if (pending) return;
    if (recentlySent) {
      const ok = await askConfirm({
        title: "Send another reminder?",
        body: `The last one went out ${sentAgo(sentAt!)}. Only resend if you know it did not arrive - a duplicate chase reads as careless to someone who has already paid attention.`,
        confirmLabel: "Send again",
      });
      if (!ok) return;
    } else if (confirmTitle) {
      const ok = await askConfirm({ title: confirmTitle, body: confirmBody, confirmLabel: "Send WhatsApp" });
      if (!ok) return;
    }
    setPending(true);
    try {
      const res = await action();
      toast(res.message, res.ok ? "success" : "error");
      // Only a real send arms the guard. A skip ("WhatsApp is off", "no template", "opted out")
      // never reached the person, so the button must stay ready rather than claim it did.
      if (res.ok) setJustSent(new Date().toISOString());
      startNav(() => router.refresh());
    } catch {
      toast("Could not send the message", "error");
    } finally {
      setPending(false);
    }
  };

  const text = pending ? busyLabel : recentlySent ? `Sent · ${sentAgo(sentAt!)}` : label;

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
        title={recentlySent ? `${label} - last sent ${sentAgo(sentAt!)}` : label}
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
      // Subdued once sent: it must not read as the next thing to click.
      className={
        className ??
        `inline-flex items-center gap-1 whitespace-nowrap py-1 text-xs disabled:opacity-50 ${
          recentlySent ? "text-muted hover:text-ink-2" : "text-accent hover:underline"
        }`
      }
    >
      <MessageCircle size={13} />
      {text}
    </button>
  );
}

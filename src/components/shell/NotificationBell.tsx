"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Bell } from "lucide-react";
import type { Notification } from "@/server/notifications";

const SEVERITY_STYLE: Record<Notification["severity"], { dot: string; label: string }> = {
  risk: { dot: "var(--risk)", label: "Act now" },
  watch: { dot: "var(--watch)", label: "Watch" },
  win: { dot: "var(--brass)", label: "Win" },
  info: { dot: "var(--accent)", label: "FYI" },
};

/** In-app notification centre - visual-only per the PRDs (no email/WhatsApp ever). */
export function NotificationBell({ items: initialItems }: { items: Notification[] }) {
  const [items, setItems] = useState<Notification[]>(initialItems);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const hasRisk = items.some((i) => i.severity === "risk");

  // Keep in sync when the server re-renders the shell (e.g. after a navigation).
  useEffect(() => setItems(initialItems), [initialItems]);

  // Live: poll ONLY the scoped notifications endpoint (not the whole route tree).
  // Pause while the tab is hidden so background tabs stop hitting the DB.
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const res = await fetch("/api/notifications", { cache: "no-store" });
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { items: Notification[] };
        if (!cancelled && Array.isArray(data.items)) setItems(data.items);
      } catch {
        /* transient network error - keep the last known list */
      }
    };
    const t = setInterval(poll, 120_000);
    document.addEventListener("visibilitychange", poll);
    return () => {
      cancelled = true;
      clearInterval(t);
      document.removeEventListener("visibilitychange", poll);
    };
  }, []);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        aria-label={`Notifications (${items.length})`}
        onClick={() => setOpen((v) => !v)}
        className="relative grid h-9 w-9 place-items-center rounded-field border border-line bg-surface text-muted hover:bg-surface-2 hover:text-ink"
      >
        <Bell size={17} />
        {items.length > 0 && (
          <span
            className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11px] font-bold text-white"
            style={{ background: hasRisk ? "var(--risk)" : "var(--accent)" }}
          >
            {items.length}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-[min(20rem,calc(100vw-2rem))] overflow-hidden rounded-card border border-line bg-surface shadow-pop">
          <div className="border-b border-line px-4 py-2.5 text-sm font-semibold">
            Notifications
            <span className="ml-2 text-xs font-normal text-muted">live · in-app only</span>
          </div>
          {items.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted">All clear. Nothing needs you. 🌿</p>
          ) : (
            <ul className="max-h-96 overflow-y-auto">
              {items.map((n) => (
                <li key={n.id} className="border-b border-line last:border-b-0">
                  <Link
                    href={n.href}
                    onClick={() => setOpen(false)}
                    className="flex gap-3 px-4 py-3 hover:bg-surface-2"
                  >
                    <span
                      aria-hidden
                      className="mt-1.5 h-2.5 w-2.5 flex-none rounded-full"
                      style={{ background: SEVERITY_STYLE[n.severity].dot }}
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">{n.title}</span>
                      <span className="block text-xs text-muted">{n.body}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

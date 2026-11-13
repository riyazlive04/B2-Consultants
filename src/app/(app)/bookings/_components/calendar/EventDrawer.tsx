"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowRight, CalendarClock, Mail, Phone, User } from "lucide-react";
import { BrandIcon } from "@/components/ui/BrandIcon";
import { Modal } from "@/components/ui/Modal";
import { Btn } from "@/components/ui/controls";
import { Field, Select } from "@/components/ui/form";
import { toast } from "@/components/ui/feedback";
import { CALENDAR_STATUS_LABELS } from "@/lib/labels";
import { istDateLabel, istRangeLabel } from "@/lib/calendar-grid";
import { eventLook, type CalEvent, type CalStatus } from "@/lib/calendar-event";
import { applyStatusChange, unblockEntry, type StatusResult } from "./event-status";

/**
 * Synamate's "View details" drawer: one entry on the calendar, in full, with the few things you
 * would open it to change.
 *
 * It writes through the actions the Bookings table already uses - a cancel here still releases the
 * slot, promotes the next call and messages exactly as it does there, because it is the same code.
 */

/** Everything a Discovery call can be set to from here. */
const DISCO_STATUSES: CalStatus[] = ["CONFIRMED", "UNCONFIRMED", "SHOWED", "NO_SHOW", "CANCELLED"];

function Row({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-start gap-2.5 text-sm text-ink">
      <span className="mt-0.5 flex-none text-muted" aria-hidden>{icon}</span>
      <span className="min-w-0">{children}</span>
    </div>
  );
}

export function EventDrawer({ ev, canSetSss, onClose }: { ev: CalEvent; canSetSss: boolean; onClose: () => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const look = eventLook(ev);
  const blocked = ev.kind === "BLOCKED";
  /* A cancelled call is drawn from its SlotRelease, which has no booking to set a status on. */
  const ghost = ev.source.table === "release";

  const run = async (fn: () => Promise<StatusResult | null>) => {
    if (busy) return;
    setBusy(true);
    const res = await fn();
    setBusy(false);
    if (!res) return; // asked, and told no
    toast(res.message, res.ok ? "success" : "error");
    if (!res.ok) return;
    router.refresh();
    onClose();
  };

  return (
    <Modal
      open
      side
      onClose={onClose}
      title={blocked ? "Blocked time" : ev.contact?.name ?? "Appointment"}
      subtitle={ev.calendar.name}
    >
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className="rounded-full border px-2.5 py-0.5 text-caption font-semibold"
            style={{ background: look.bg, color: look.text, borderColor: look.border }}
          >
            {blocked ? "Blocked" : CALENDAR_STATUS_LABELS[ev.status]}
          </span>
          <span className="text-caption text-muted">{ev.calendar.type === "SSS" ? "Strategy session" : "Discovery call"}</span>
        </div>

        {!blocked && <p className="text-sm font-semibold text-ink">{ev.title}</p>}

        <div className="space-y-2.5 rounded-card border border-line bg-surface-2 p-4">
          <Row icon={<CalendarClock size={15} />}>
            {istDateLabel(ev.startsAt)}
            <span className="block text-caption text-muted">{istRangeLabel(ev)}</span>
          </Row>
          <Row icon={<User size={15} />}>{ev.ownerName ?? "Nobody assigned yet"}</Row>
          {ev.contact?.phone && (
            <Row icon={<Phone size={15} />}>
              <a href={`tel:${ev.contact.phone}`} className="tnum hover:underline">{ev.contact.phone}</a>
            </Row>
          )}
          {ev.contact?.email && (
            <Row icon={<Mail size={15} />}>
              <a href={`mailto:${ev.contact.email}`} className="break-all hover:underline">{ev.contact.email}</a>
            </Row>
          )}
          {!blocked && (
            <Row icon={<BrandIcon brand="zoom" size={15} />}>
              {ev.meetingUrl ? (
                <a href={ev.meetingUrl} target="_blank" rel="noopener noreferrer" className="font-semibold text-primary hover:underline">
                  Join meeting
                </a>
              ) : (
                <span className="text-muted">No meeting link yet</span>
              )}
            </Row>
          )}
        </div>

        {/* ── What you can change from here ─────────────────────────────────────────────
            Discovery writes through the same two actions as the Bookings table; a cancelled
            call has no booking left to set, and SSS confirmation belongs to Outreach. */}
        <section className="space-y-3 border-t border-line pt-4">
          {blocked ? (
            <Btn variant="outline" onClick={() => run(() => unblockEntry(ev))} busy={busy} className="w-full sm:w-auto">
              Unblock this time
            </Btn>
          ) : ghost ? (
            <p className="text-caption text-muted">
              This call let its slot go, so there is nothing left to set here. Re-book it from the
              Booking requests tab below.
            </p>
          ) : ev.calendar.type === "SSS" ? (
            canSetSss ? (
              <Field label="Status" hint="Unconfirmed also red-flags the journey for the outreach specialist to chase.">
                <Select
                  value={ev.status}
                  aria-label="Status"
                  disabled={busy}
                  onChange={(e) => run(() => applyStatusChange(ev, e.target.value as CalStatus))}
                  options={[
                    { value: "CONFIRMED", label: CALENDAR_STATUS_LABELS.CONFIRMED },
                    { value: "UNCONFIRMED", label: CALENDAR_STATUS_LABELS.UNCONFIRMED },
                  ]}
                />
              </Field>
            ) : (
              <p className="text-caption text-muted">A strategy session is confirmed from Outreach, which you do not have.</p>
            )
          ) : (
            <Field label="Status" hint="No show and Cancelled hand the slot back to the calendar.">
              <Select
                value={ev.status}
                aria-label="Status"
                disabled={busy}
                onChange={(e) => run(() => applyStatusChange(ev, e.target.value as CalStatus))}
                options={DISCO_STATUSES.map((s) => ({ value: s, label: CALENDAR_STATUS_LABELS[s] }))}
              />
            </Field>
          )}

          {ev.contact?.leadId && (
            <Link
              href="/pipeline"
              className="inline-flex h-10 items-center gap-1.5 rounded-btn px-3 text-sm font-semibold text-primary hover:bg-primary-soft"
            >
              Open in pipeline <ArrowRight size={15} aria-hidden />
            </Link>
          )}
        </section>
      </div>
    </Modal>
  );
}

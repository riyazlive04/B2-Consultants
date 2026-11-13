"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowRight, CalendarClock, Mail, Phone, User } from "lucide-react";
import { BrandIcon } from "@/components/ui/BrandIcon";
import { Modal } from "@/components/ui/Modal";
import { Btn } from "@/components/ui/controls";
import { Field, Select } from "@/components/ui/form";
import { askConfirm, toast } from "@/components/ui/feedback";
import { CALENDAR_STATUS_LABELS } from "@/lib/labels";
import { istDateLabel, istRangeLabel } from "@/lib/calendar-grid";
import {
  discoStatusWrite, eventLook, FREES_THE_SLOT, type CalEvent, type CalStatus,
} from "@/lib/calendar-event";
import { safeAction } from "@/lib/action-guard";
import { setBookingConfirmed, setBookingStatus, setSlotBlocked } from "@/server/booking-actions";
import { setSalesCallConfirmed } from "@/server/outreach-actions";
import { unblockSssSlotAction } from "@/server/sss-actions";

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

  const run = async (fn: () => Promise<{ ok: boolean; error?: string }>, done: string) => {
    if (busy) return;
    setBusy(true);
    const res = await safeAction(fn);
    setBusy(false);
    if (!res.ok) return toast(res.error ?? "That did not save", "error");
    toast(done);
    router.refresh();
    onClose();
  };

  const changeDisco = async (next: CalStatus) => {
    if (next === ev.status || !ev.source.bookingId) return;
    if (FREES_THE_SLOT.includes(next)) {
      const label = CALENDAR_STATUS_LABELS[next].toLowerCase();
      const ok = await askConfirm({
        title: `Mark this call ${label}?`,
        body:
          `${ev.contact?.name ?? "This call"}'s slot goes back to the calendar and the booking keeps only a record of the time it held. ` +
          "Nothing is deleted, and nobody is messaged.",
        confirmLabel: `Mark ${label}`,
        danger: true,
      });
      if (!ok) return;
    }
    const write = discoStatusWrite(next);
    const id = ev.source.bookingId;
    await run(
      () => ("confirmed" in write ? setBookingConfirmed(id, write.confirmed) : setBookingStatus(id, write.bookingStatus)),
      `Marked ${CALENDAR_STATUS_LABELS[next].toLowerCase()}`,
    );
  };

  const changeSss = async (next: CalStatus) => {
    const journeyId = ev.source.journeyId;
    if (next === ev.status || !journeyId) return;
    const form = new FormData();
    form.set("journeyId", journeyId);
    form.set("confirmed", next === "CONFIRMED" ? "YES" : "NO");
    await run(() => setSalesCallConfirmed(form), next === "CONFIRMED" ? "Session confirmed" : "Confirmation cleared");
  };

  const unblock = () =>
    run(
      () => (ev.source.table === "sss" ? unblockSssSlotAction(ev.source.id) : setSlotBlocked(ev.source.id, false)),
      "Time freed up",
    );

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
            <Btn variant="outline" onClick={unblock} busy={busy} className="w-full sm:w-auto">
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
                  onChange={(e) => changeSss(e.target.value as CalStatus)}
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
                onChange={(e) => changeDisco(e.target.value as CalStatus)}
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

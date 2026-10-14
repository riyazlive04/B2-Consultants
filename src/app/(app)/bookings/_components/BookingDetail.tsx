"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, CalendarClock, Check, CircleCheck, Mail, Phone, Video } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Btn } from "@/components/ui/controls";
import { Field, Select } from "@/components/ui/form";
import { SendWhatsAppButton } from "@/components/ui/SendWhatsAppButton";
import { WhatsAppStatusBadge } from "@/components/ui/WhatsAppStatusBadge";
import { BantChip, BantDimensions } from "@/components/ui/BantChip";
import { askConfirm, toast } from "@/components/ui/feedback";
import { setBookingConfirmed, setBookingStatus } from "@/server/booking-actions";
import { sendBookingConfirmationMsg, sendBookingReminderMsg } from "@/server/whatsapp-actions";
import type { WhatsAppStatusCell } from "@/server/whatsapp";
import type { BookingRow } from "@/server/booking-metrics";
import { BANT_ORIGIN_LABELS } from "@/lib/bant-view";
import { BOOKING_STATUS_LABELS } from "@/lib/labels";
import { formatDate } from "@/lib/format";
import { safeAction } from "@/lib/action-guard";
import { CallTime, ConfirmPill, Fact, HistoryChip, historyLines, StatusPill, VerdictPill } from "./booking-view";

/**
 * One booking, in full - the record behind a row.
 *
 * It exists because the table could not hold what a caller needs. Fourteen columns do not fit a
 * laptop, let alone a phone: the intake answers, the WhatsApp state and every action were on the
 * far side of a horizontal scroll, and the "we have met them before" history was locked inside a
 * `title` attribute that no phone and no screen reader ever shows. Everything the table drops now
 * lives here, in reading order, with the actions beneath it - and because the dialog is titled
 * with the prospect's name, each control can be labelled plainly ("Outcome", "Remind") without
 * twenty copies of the same accessible name fighting each other down a column.
 */

const STATUS_OPTIONS = ["BOOKED", "COMPLETED", "NO_SHOW", "CANCELLED"] as const;

/** Changing to one of these hands the slot back and, for a no-show, moves the lead's card. */
const FREES_THE_SLOT = new Set<string>(["CANCELLED", "NO_SHOW"]);

/**
 * The shared send button sets no height of its own, so its default renders at ~34px. These two are
 * primary actions in a dialog, not a dense strip: 40px (§7), and `--border-strong`, which is the
 * token held to 3:1 for a control boundary.
 */
const WA_BTN =
  "inline-flex h-10 items-center gap-1.5 rounded-btn border border-line-strong bg-surface px-3 text-sm font-semibold text-ink transition-colors hover:bg-surface-2 disabled:opacity-50";

export function BookingDetail({
  booking,
  whatsapp,
  onReschedule,
  onClose,
}: {
  booking: BookingRow;
  whatsapp?: WhatsAppStatusCell;
  /** Hands over to the reschedule dialog - this one closes, so two dialogs never stack. */
  onReschedule: () => void;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState<"status" | "confirm" | null>(null);
  const history = booking.history ? historyLines(booking.history) : [];

  /**
   * A status this list cannot SET still has to appear in it. RESCHEDULED is written by the
   * reschedule action and never chosen by hand, and without its own option the control would
   * fall back to showing the first one - telling the reader a rescheduled call was "Booked".
   */
  const statusOptions = [
    ...STATUS_OPTIONS.map((s) => ({ value: s as string, label: BOOKING_STATUS_LABELS[s] })),
    ...(STATUS_OPTIONS.includes(booking.status as (typeof STATUS_OPTIONS)[number])
      ? []
      : [{ value: booking.status, label: BOOKING_STATUS_LABELS[booking.status] ?? booking.status }]),
  ];

  const changeStatus = async (status: string) => {
    if (status === booking.status || busy) return;
    if (FREES_THE_SLOT.has(status)) {
      const ok = await askConfirm({
        title: `Mark this call ${(BOOKING_STATUS_LABELS[status] ?? status).toLowerCase()}?`,
        body:
          `${booking.name}'s slot goes back to the calendar, and this booking keeps only a record of the time it held. ` +
          "Nobody is messaged. To move the call instead, close this and use Reschedule.",
        confirmLabel: `Mark ${(BOOKING_STATUS_LABELS[status] ?? status).toLowerCase()}`,
        danger: true,
      });
      if (!ok) return;
    }
    setBusy("status");
    const res = await safeAction(() => setBookingStatus(booking.id, status));
    setBusy(null);
    if (!res.ok) return toast(res.error, "error");
    toast(`Marked ${BOOKING_STATUS_LABELS[status] ?? status}`);
    onClose();
  };

  const toggleConfirm = async () => {
    if (busy) return;
    setBusy("confirm");
    const res = await safeAction(() => setBookingConfirmed(booking.id, !booking.confirmed));
    setBusy(null);
    if (!res.ok) return toast(res.error, "error");
    toast(booking.confirmed ? "Confirmation cleared" : "Call confirmed");
  };

  return (
    <Modal open onClose={onClose} title={booking.name} subtitle={booking.jobTitle || undefined} size="lg">
      <div className="space-y-6">
        {/* ── The state of this call, first: outcome, confirmation, when. ── */}
        <div className="space-y-3 rounded-card border border-line bg-surface-2 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill status={booking.status} />
            <ConfirmPill row={booking} />
            {booking.history && <HistoryChip history={booking.history} />}
          </div>
          <CallTime row={booking} size="md" />
          <p className="text-caption text-muted">
            {booking.assignedToName ? `With ${booking.assignedToName}` : "Nobody assigned yet"} · booked{" "}
            {formatDate(booking.createdAt)}
          </p>
        </div>

        {/* ── Reach them. Tappable on a phone, which a table cell never was. ── */}
        <section className="space-y-2">
          <h4 className="text-label uppercase text-ink-2">Contact</h4>
          <div className="flex flex-wrap gap-2">
            <a
              href={`tel:${booking.phone}`}
              className="inline-flex h-10 items-center gap-2 rounded-btn border border-line-strong bg-surface px-3 text-sm font-medium text-ink transition-colors hover:bg-surface-2"
            >
              <Phone size={15} aria-hidden /> <span className="tnum">{booking.phone}</span>
            </a>
            {booking.email && (
              <a
                href={`mailto:${booking.email}`}
                className="inline-flex h-10 min-w-0 items-center gap-2 rounded-btn border border-line-strong bg-surface px-3 text-sm font-medium text-ink transition-colors hover:bg-surface-2"
              >
                <Mail size={15} aria-hidden className="flex-none" />
                <span className="truncate">{booking.email}</span>
              </a>
            )}
          </div>
        </section>

        {/* ── The call itself. Only drawn once Zoom has actually made the room. ── */}
        {booking.zoomJoinUrl && (
          <section className="space-y-2">
            <h4 className="text-label uppercase text-ink-2">Zoom</h4>
            <div className="flex flex-wrap gap-2">
              {/*
                * Two deliberately different links. The host link signs whoever opens it in AS the
                * host, so it is labelled as such and never sits next to the prospect's name
                * unlabelled - handing it to the wrong person gives them control of the call.
                */}
              {booking.zoomStartUrl && (
                <a
                  href={booking.zoomStartUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex h-10 items-center gap-2 rounded-btn border border-line-strong bg-surface px-3 text-sm font-medium text-ink transition-colors hover:bg-surface-2"
                >
                  <Video size={15} aria-hidden /> Start as host
                </a>
              )}
              <a
                href={booking.zoomJoinUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-10 min-w-0 items-center gap-2 rounded-btn border border-line-strong bg-surface px-3 text-sm font-medium text-ink transition-colors hover:bg-surface-2"
              >
                <Video size={15} aria-hidden className="flex-none" />
                <span className="truncate">Prospect&apos;s join link</span>
              </a>
            </div>
          </section>
        )}

        {/* ── What they told us. The columns the table had to drop. ── */}
        <section className="space-y-2">
          <h4 className="text-label uppercase text-ink-2">Qualification</h4>
          <div className="flex flex-wrap items-center gap-2">
            <BantChip bant={booking.bant} size="md" />
            <BantDimensions bant={booking.bant} />
            <VerdictPill row={booking} />
            {booking.bant && (
              <span className="text-caption text-muted">{BANT_ORIGIN_LABELS[booking.bant.origin]}</span>
            )}
          </div>
          <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
            <Fact label="Current role">{booking.jobTitle}</Fact>
            <Fact label="Industry">{booking.industry}</Fact>
            <Fact label="Wants to start">{booking.whenStart}</Fact>
            <Fact label="Budget">{booking.readyToInvest}</Fact>
            <Fact label="Commitment">{booking.commitment}</Fact>
            <Fact label="City">{booking.city}</Fact>
          </dl>
        </section>

        {/* ── We have met them before. Was hover-only text; now it is on the page. ── */}
        {history.length > 0 && (
          <section className="space-y-2">
            <h4 className="text-label uppercase text-ink-2">We have met them before</h4>
            <ul className="space-y-1 rounded-field border border-watch bg-watch-soft px-3 py-2 text-sm text-ink">
              {history.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </section>
        )}

        {/* ── Messaging ── */}
        <section className="space-y-2">
          <h4 className="text-label uppercase text-ink-2">WhatsApp</h4>
          <div className="flex flex-wrap items-center gap-3">
            {whatsapp ? (
              <WhatsAppStatusBadge status={whatsapp.status} kind={whatsapp.kind} at={whatsapp.at} size="md" />
            ) : (
              <span className="text-sm text-muted">Nothing sent yet</span>
            )}
            <SendWhatsAppButton
              action={() => sendBookingReminderMsg(booking.id)}
              label="Remind"
              variant="button"
              className={WA_BTN}
            />
            <SendWhatsAppButton
              action={() => sendBookingConfirmationMsg(booking.id)}
              label="Send confirmation"
              variant="button"
              className={WA_BTN}
            />
          </div>
        </section>

        {/* ── Actions. Full-width and stacked on a phone, so every target clears 40px. ── */}
        <section className="space-y-3 border-t border-line pt-4">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Btn
              variant="primary"
              icon={<CalendarClock size={15} />}
              onClick={onReschedule}
              className="w-full sm:w-auto"
            >
              {booking.status === "BOOKED" ? "Reschedule" : "Re-book"}
            </Btn>
            {booking.status === "BOOKED" && (
              <Btn
                variant="outline"
                icon={booking.confirmed ? <CircleCheck size={15} /> : <Check size={15} />}
                onClick={toggleConfirm}
                busy={busy === "confirm"}
                pressed={booking.confirmed}
                className="w-full sm:w-auto"
              >
                {booking.confirmed ? "Clear confirmation" : "Mark confirmed"}
              </Btn>
            )}
            {booking.leadId && (
              <Link
                href="/pipeline"
                className="inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-btn px-3 text-sm font-semibold text-primary hover:bg-primary-soft sm:w-auto"
              >
                Open in pipeline <ArrowRight size={15} aria-hidden />
              </Link>
            )}
          </div>

          <Field
            label="Outcome"
            hint={
              FREES_THE_SLOT.has(booking.status)
                ? "This call let its slot go. Use Re-book to put it back on the calendar."
                : "Cancelled and No show hand the slot back to the calendar."
            }
          >
            <Select
              value={booking.status}
              aria-label="Outcome"
              disabled={busy === "status"}
              onChange={(e) => changeStatus(e.target.value)}
              options={statusOptions}
            />
          </Field>
        </section>
      </div>
    </Modal>
  );
}

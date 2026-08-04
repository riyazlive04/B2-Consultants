"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CalendarClock, CloudOff, CloudUpload, PhoneCall, Target, Timer } from "lucide-react";
import type { L1Desk as L1DeskData, L1QueueLead } from "@/server/l1-desk-metrics";
import { syncLagLabel } from "@/lib/offline-calls";
import {
  L1_TARGETS,
  QUEUE_BUCKETS,
  QUEUE_BUCKET_META,
  signalForTarget,
  type QueueBucket,
} from "@/lib/outreach-sla";
import { Card, CardTitle, EmptyState, Pill, SectionHeading } from "@/components/ui/kit";
import { BantChip } from "@/components/ui/BantChip";
import { MetricCard } from "@/components/ui/MetricCard";
import { Btn } from "@/components/ui/controls";
import { Field, FormError, Select, SubmitButton, TextInput } from "@/components/ui/form";
import { Modal } from "@/components/ui/Modal";
import { toast } from "@/components/ui/feedback";
import { LEAD_SOURCE_LABELS, LEAD_STAGE_LABELS } from "@/lib/labels";
import { NewLeadWatcher } from "./NewLeadWatcher";
import { TargetAttainment } from "./TargetAttainment";
import { useOfflineCalls } from "./useOfflineCalls";
// Shared with L2Desk — see LogOutcomeModal.tsx for why it moved out of this file.
import { LogOutcomeModal } from "./LogOutcomeModal";

/**
 * Level 1 — Outreach Specialist desk (rebuild spec §6).
 *
 * Opens to one question: *who do I need to call right now?* The queue is the page; the
 * target cards sit below it, because the JD's numbers are how the day is judged but not
 * how it is worked.
 */

const OUTCOME_OPTIONS = [
  { value: "SPOKE", label: "Spoke to them" },
  { value: "NO_ANSWER", label: "No answer" },
  { value: "BUSY", label: "Busy" },
  { value: "CALLBACK", label: "Asked to call back" },
  { value: "WRONG_NUMBER", label: "Wrong number" },
  { value: "NOT_INTERESTED", label: "Not interested" },
];

/**
 * Live countdown on the 5-minute clock.
 *
 * Counts down from a server-stamped instant rather than a duration, so a laptop with a
 * wrong clock cannot invent time — and re-anchors whenever the server sends a fresh
 * `deadline`. Once elapsed it shows how far past, in red: a breached lead is more urgent
 * than a running one, so the display must not simply stop at zero.
 *
 * FIRST PAINT MUST NOT READ THE CLOCK. This is a client component, so Next.js still renders
 * it on the server; seeding state with `Date.now()` meant the server produced "3:47" and the
 * browser hydrated a second later with "3:46". React treats that as corrupt markup — it logs
 * a text-content mismatch and throws away the whole Suspense boundary to re-render on the
 * client. Seeding from `initialMsLeft`, which the SERVER computed and serialised, makes both
 * passes render the same string; the effect below then takes over with the live clock.
 */
function FiveMinuteCountdown({
  deadline,
  initialMsLeft,
}: {
  deadline: string;
  initialMsLeft: number;
}) {
  const target = new Date(deadline).getTime();
  const [msLeft, setMsLeft] = useState(initialMsLeft);

  useEffect(() => {
    setMsLeft(target - Date.now());
    const id = setInterval(() => setMsLeft(target - Date.now()), 1000);
    return () => clearInterval(id);
  }, [target]);

  const over = msLeft <= 0;
  const secs = Math.floor(Math.abs(msLeft) / 1000);
  const label = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;

  return (
    <span
      className="tnum inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-caption font-semibold"
      style={{
        background: over ? "var(--bad-bg)" : "var(--warn-bg)",
        color: over ? "var(--bad)" : "var(--warn)",
      }}
    >
      <Timer size={12} aria-hidden />
      {/* Spoken separately so the meaning never rides on colour alone. */}
      <span className="sr-only">{over ? "over by" : "time remaining"} </span>
      {over ? `+${label} over` : label}
    </span>
  );
}

/** Click-to-dial. On a phone this opens the dialler pre-filled; on a desktop softphone, the same. */
function DialLink({ phone, name }: { phone: string; name: string }) {
  return (
    <a
      href={`tel:${phone.replace(/[^\d+]/g, "")}`}
      aria-label={`Call ${name} on ${phone}`}
      className="inline-flex items-center gap-1.5 rounded-btn bg-primary px-3 py-1.5 text-sm font-semibold text-on-accent hover:bg-primary-strong"
    >
      <PhoneCall size={14} /> Call
    </a>
  );
}

function QueueRow({
  lead,
  bucket,
  onLog,
}: {
  lead: L1QueueLead;
  bucket: QueueBucket;
  onLog: (l: L1QueueLead) => void;
}) {
  return (
    <li className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3 last:border-0">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Link href={`/pipeline?lead=${lead.id}`} className="truncate font-medium text-ink hover:underline">
            {lead.name}
          </Link>
          {bucket === "FIVE_MINUTE" && (
            <FiveMinuteCountdown deadline={lead.fiveMinuteBy} initialMsLeft={lead.msToFiveMinute} />
          )}
          {/* Only when there IS a score. A "Not scored" chip on every row of a 25-row queue is
              noise — most leads have never been asked, and that is the normal case, not a
              finding. The chip earns its place by being rare. */}
          {lead.bant && <BantChip bant={lead.bant} />}
          {lead.state === "OVERDUE" && (
            <Pill tone="bad">Past deadline</Pill>
          )}
          {/* This connection's time came from a device, not from us. Shown on the row rather
              than buried in the audit log, because it is the number the 5-minute rate uses. */}
          {lead.connectedSyncLagMs !== null && syncLagLabel(lead.connectedSyncLagMs) && (
            <Pill tone="neutral">{syncLagLabel(lead.connectedSyncLagMs)}</Pill>
          )}
          <span className="text-caption text-muted">{LEAD_STAGE_LABELS[lead.stage] ?? lead.stage}</span>
        </div>
        <p className="mt-0.5 truncate text-caption text-muted">
          {lead.phone ?? "no number"}
          {lead.city ? ` · ${lead.city}` : ""} · {LEAD_SOURCE_LABELS[lead.leadSource] ?? lead.leadSource}
          {lead.callCount > 0 ? ` · ${lead.callCount} call${lead.callCount === 1 ? "" : "s"} logged` : " · never called"}
        </p>
      </div>
      {/* Two clearly distinct actions (Error Log L3): "Call" dials, "Log outcome" records. */}
      <div className="flex flex-none items-center gap-2">
        {lead.phone && <DialLink phone={lead.phone} name={lead.name} />}
        <Btn variant="soft" size="sm" onClick={() => onLog(lead)}>Log outcome</Btn>
      </div>
    </li>
  );
}

export function L1Desk({ desk }: { desk: L1DeskData }) {
  const router = useRouter();
  const [logging, setLogging] = useState<L1QueueLead | null>(null);
  const offline = useOfflineCalls(() => router.refresh());

  // `desk.total`, not the array lengths: the server trims each bucket to what is rendered, so
  // the arrays no longer answer "how many are waiting".
  const totalDue = QUEUE_BUCKETS.reduce((n, b) => n + desk.total[b], 0);

  return (
    <div className="space-y-8">
      <NewLeadWatcher onSeen={() => router.refresh()} />

      {/* Connection state. Rendered only when there is something to say — a permanent
          "you are online" badge is noise, and noise is what stops people reading banners. */}
      {(!offline.online || offline.pending > 0) && (
        <div
          className="flex flex-wrap items-center gap-2 rounded-card px-4 py-3 text-sm"
          style={{
            background: offline.online ? "var(--warn-bg)" : "var(--bad-bg)",
            color: offline.online ? "var(--warn)" : "var(--bad)",
          }}
          role="status"
        >
          {offline.online ? <CloudUpload size={16} /> : <CloudOff size={16} />}
          <span className="font-semibold">
            {offline.online ? "Syncing your saved calls" : "You are offline"}
          </span>
          <span>
            {offline.pending > 0
              ? `${offline.pending} call${offline.pending === 1 ? "" : "s"} saved on this device${
                  offline.online ? "" : " — they will sync when the connection returns"
                }.`
              : "Calls you log will be saved on this device and sent when the connection returns."}
          </span>
          {offline.stuck > 0 && (
            <span className="font-semibold">
              {offline.stuck} could not be sent — tell Ameen rather than re-logging them.
            </span>
          )}
        </div>
      )}

      {/* ── The queue. Worked top-down; bucket order IS the JD's priority order. ── */}
      <section className="space-y-4">
        <SectionHeading
          icon={<PhoneCall size={18} />}
          title="Who to call now"
          description={
            totalDue === 0
              ? desk.ownedCallable === 0
                ? "You haven't been given any leads yet."
                : "Nothing is owed a call right now."
              : `${totalDue} lead${totalDue === 1 ? "" : "s"} waiting, most urgent first`
          }
        />

        {totalDue === 0 ? (
          /**
           * Two very different empty queues, and saying the wrong one is worse than saying
           * nothing. "Your queue is clear" to someone who owns nothing reads as "this screen is
           * broken" — or worse, as permission to stop. Only claim the work is done when there
           * was work.
           */
          desk.ownedCallable === 0 ? (
            <EmptyState
              title="No leads have been assigned to you"
              body="This desk shows the leads you own, and you don't own any yet. Ask Ameen to hand you a batch from Pipeline → Leads → Hand out leads. Nothing is broken — there's just nothing here to call."
            />
          ) : (
            <EmptyState
              title="Your queue is clear"
              body={`All ${desk.ownedCallable} lead${desk.ownedCallable === 1 ? "" : "s"} you own ${desk.ownedCallable === 1 ? "has" : "have"} been connected within its window. New leads appear here the moment they arrive.`}
            />
          )
        ) : (
          <div className="space-y-4">
            {QUEUE_BUCKETS.map((bucket) => {
              const leads = desk.queue[bucket];
              const count = desk.total[bucket];
              if (count === 0) return null;
              const meta = QUEUE_BUCKET_META[bucket];
              return (
                <Card
                  key={bucket}
                  title={
                    <CardTitle icon={bucket === "FIVE_MINUTE" ? <Timer size={18} /> : <PhoneCall size={18} />}>
                      {meta.title}
                      <span className="ml-2 text-caption font-normal text-muted">
                        {count}
                      </span>
                    </CardTitle>
                  }
                  subtitle={`${meta.why} · ${meta.target}`}
                >
                  <ul className="-mx-4 -mb-2">
                    {leads.map((l) => (
                      <QueueRow key={l.id} lead={l} bucket={bucket} onLog={setLogging} />
                    ))}
                  </ul>
                  {count > leads.length && (
                    <p className="mt-3 text-caption text-muted">
                      Showing the {leads.length} most urgent of {count}. Work these first — the rest move up as you clear them.
                    </p>
                  )}
                </Card>
              );
            })}
          </div>
        )}
      </section>

      {/* ── Tomorrow's calls: the unconfirmed list IS the action queue (spec §6). ── */}
      <section className="space-y-4">
        <SectionHeading
          icon={<CalendarClock size={18} />}
          title="Tomorrow's discovery calls"
          description="Confirm these today — bookings inside 8 hours are blocked, so an unconfirmed call must be cancelled early to free the slot."
        />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <MetricCard
            label="Booked"
            value={String(desk.tomorrow.booked)}
            icon={<CalendarClock size={18} />}
            href="/bookings"
            detail={{
              rows: [
                { label: "Confirmed", value: desk.tomorrow.confirmed },
                { label: "Unconfirmed", value: desk.tomorrow.unconfirmed.length },
              ],
            }}
          />
          <MetricCard
            label="Confirmed"
            value={String(desk.tomorrow.confirmed)}
            signal={
              desk.tomorrow.booked === 0
                ? undefined
                : desk.tomorrow.confirmed === desk.tomorrow.booked
                  ? "ok"
                  : "watch"
            }
            icon={<CalendarClock size={18} />}
            href="/bookings"
            detail={{
              rows: [
                { label: "Booked (total)", value: desk.tomorrow.booked },
                { label: "Still to confirm", value: desk.tomorrow.unconfirmed.length },
              ],
            }}
          />
          <MetricCard
            label="Unconfirmed"
            value={String(desk.tomorrow.unconfirmed.length)}
            signal={desk.tomorrow.unconfirmed.length > 0 ? "risk" : "ok"}
            secondary={desk.tomorrow.unconfirmed.length > 0 ? "Chase these today" : "All confirmed"}
            icon={<CalendarClock size={18} />}
            href="/bookings"
            detail={{
              rows: desk.tomorrow.unconfirmed.slice(0, 6).map((b) => ({
                label: b.name,
                value: new Date(b.startsAt).toLocaleString("en-IN", {
                  timeZone: "Asia/Kolkata",
                  weekday: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                }),
              })),
              note:
                desk.tomorrow.unconfirmed.length > 6
                  ? `Showing 6 of ${desk.tomorrow.unconfirmed.length} — full chase list below.`
                  : undefined,
            }}
          />
        </div>

        {desk.tomorrow.unconfirmed.length > 0 && (
          <Card title={<CardTitle icon={<PhoneCall size={18} />}>Unconfirmed — chase list</CardTitle>}>
            <ul className="-mx-4 -mb-2">
              {desk.tomorrow.unconfirmed.map((b) => (
                <li key={b.id} className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3 last:border-0">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-ink">{b.name}</p>
                    <p className="text-caption text-muted">
                      {new Date(b.startsAt).toLocaleString("en-IN", {
                        timeZone: "Asia/Kolkata",
                        weekday: "short", hour: "2-digit", minute: "2-digit",
                      })} IST · {b.phone}
                    </p>
                  </div>
                  <DialLink phone={b.phone} name={b.name} />
                </li>
              ))}
            </ul>
          </Card>
        )}
      </section>

      {/* ── JD targets. Every row maps to a target in the Level 1 JD (principle §4). ──
          Was an 8-card grid, each card's progress bar scaled to its own target — so 83%-of-target
          and 25%-of-target drew identical bars and the screen could not say which to fix first.
          See TargetAttainment for the full rationale; the cards' figures, targets, signal colours
          and definitions all survive the move. */}
      <section className="space-y-4">
        <SectionHeading
          icon={<Target size={18} />}
          title="Your targets"
          description="This month against the Level 1 job description — furthest behind first"
        />
        <Card>
          <TargetAttainment
            specs={L1_TARGETS}
            values={desk.targets}
            signalFor={signalForTarget}
          />
        </Card>
      </section>

      {logging && (
        <LogOutcomeModal
          lead={logging}
          onClose={() => setLogging(null)}
          queueCall={offline.queueCall}
          online={offline.online}
        />
      )}
    </div>
  );
}

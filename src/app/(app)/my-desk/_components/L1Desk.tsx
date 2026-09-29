"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CalendarClock, CloudOff, CloudUpload, PhoneCall, PhoneOutgoing, Target, Timer } from "lucide-react";
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
// Shared with L2Desk - see LogOutcomeModal.tsx for why it moved out of this file.
import { LogOutcomeModal } from "@/components/calls/LogOutcomeModal";
import { DialButton } from "@/components/calls/DialButton";

/**
 * Level 1 - Outreach Specialist desk (rebuild spec §6).
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
 * wrong clock cannot invent time - and re-anchors whenever the server sends a fresh
 * `deadline`. Once elapsed it shows how far past, in red: a breached lead is more urgent
 * than a running one, so the display must not simply stop at zero.
 *
 * FIRST PAINT MUST NOT READ THE CLOCK. This is a client component, so Next.js still renders
 * it on the server; seeding state with `Date.now()` meant the server produced "3:47" and the
 * browser hydrated a second later with "3:46". React treats that as corrupt markup - it logs
 * a text-content mismatch and throws away the whole Suspense boundary to re-render on the
 * client. Seeding from `initialMsLeft`, which the SERVER computed and serialised, makes both
 * passes render the same string; the effect below then takes over with the live clock.
 */
/**
 * How long this lead has been waiting, counting UP from opt-in as hh:mm:ss.
 *
 * SEPARATE from `FiveMinuteCountdown` on purpose. That one is an SLA clock with a deadline and a
 * red breach state; this one has no deadline at all - it answers "how long has this person been
 * sitting here", which is what the telecaller needs when the ladder hands them a lead three hours
 * after opt-in. Merging them would have meant one component with two meanings and a countdown
 * whose behaviour changed depending on a prop.
 *
 * Seeds from the SERVER-computed `initialMs` for the hydration reason documented on the countdown
 * below, then re-anchors on the absolute `optInAt` so a tab left open stays honest.
 */
function SinceOptIn({ optInAt, initialMs }: { optInAt: string; initialMs: number }) {
  const start = new Date(optInAt).getTime();
  const [ms, setMs] = useState(initialMs);

  useEffect(() => {
    setMs(Date.now() - start);
    const id = setInterval(() => setMs(Date.now() - start), 1000);
    return () => clearInterval(id);
  }, [start]);

  const total = Math.max(0, Math.floor(ms / 1000));
  const hh = Math.floor(total / 3600);
  const mm = Math.floor((total % 3600) / 60);
  const ss = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");

  return (
    <span className="tnum text-caption text-muted" title={`Opted in ${new Date(optInAt).toLocaleString()}`}>
      {pad(hh)}:{pad(mm)}:{pad(ss)} since opt-in
    </span>
  );
}

/**
 * "Call-back 2 of 3" - where this prospect stands in the chase.
 *
 * Shown only on the call-back bucket, and it is the whole reason that bucket was rebuilt: the
 * list used to say who had not booked and nothing about who had already been asked three times.
 * A caller working top-down needs to know whether they are making a first approach or spending
 * someone's last chance, because those are different conversations.
 *
 * The FINAL call-back is coloured as a breach rather than a warning. It is not "running late",
 * it is the last one - after this the file closes on its own - and that is worth a caller's
 * attention in the way an amber chip among twenty amber chips is not.
 */
function CallbackChip({ round, maxCallbacks }: { round: number; maxCallbacks: number }) {
  const last = round >= maxCallbacks;
  return (
    <span
      className="tnum inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-caption font-semibold"
      style={{
        background: last ? "var(--bad-bg)" : "var(--warn-bg)",
        color: last ? "var(--bad)" : "var(--warn)",
      }}
      title={
        last
          ? `Last call-back. If they still don't book, the card moves to Cancelled/Unqualified on its own.`
          : `You have called back ${round - 1} time${round - 1 === 1 ? "" : "s"} already.`
      }
    >
      <PhoneOutgoing size={12} aria-hidden />
      Call-back {round} of {maxCallbacks}
      {last && <span className="sr-only"> - the last one</span>}
    </span>
  );
}

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

function QueueRow({
  lead,
  bucket,
  onLog,
}: {
  lead: L1QueueLead;
  bucket: QueueBucket;
  /** `calledAt` is set when the row's Call button was the trigger - the dial instant. */
  onLog: (l: L1QueueLead, calledAt?: Date) => void;
}) {
  return (
    <li className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3 last:border-0">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          {/* The contact record, not the pipeline board. This used to link to
              `/pipeline?lead=<id>`, a parameter that page has never read - so every name on the
              desk opened the same unfiltered board. `/contacts/<id>` is the card that actually
              holds this prospect's history: every call, every message, every stage move. */}
          <Link href={`/contacts/${lead.id}`} className="truncate font-medium text-ink hover:underline" title={lead.name}>
            {lead.name}
          </Link>
          {bucket === "FIVE_MINUTE" && (
            <FiveMinuteCountdown deadline={lead.fiveMinuteBy} initialMsLeft={lead.msToFiveMinute} />
          )}
          {/* ONLY on the bucket the SOP raises a call into - the leads that reached Step 8 with no
              booking. Everywhere else this counter is noise: a telecaller working the 5-minute
              queue already has a countdown, and putting a second clock beside it competes with
              the one that has a deadline. Here there IS no deadline, and "how long has this
              person been waiting" is exactly the question the caller needs answered. */}
          {bucket === "NOT_BOOKED_AFTER_MESSAGE" && (
            <SinceOptIn optInAt={lead.optInAt} initialMs={lead.msSinceOptIn} />
          )}
          {lead.callback && (
            <CallbackChip round={lead.callback.round} maxCallbacks={lead.callback.maxCallbacks} />
          )}
          {/* Only when there IS a score. A "Not scored" chip on every row of a 25-row queue is
              noise - most leads have never been asked, and that is the normal case, not a
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
          {/* On a call-back row the useful fact is WHEN, not how many: the caller is deciding
              whether enough time has passed to ring again, and "3 calls logged" does not answer
              that. Everywhere else the count stays, because there the question really is
              "has anyone tried this person at all". */}
          {lead.callback
            ? ` · last called ${lead.callback.hoursSinceLastCall}h ago`
            : lead.callCount > 0
              ? ` · ${lead.callCount} call${lead.callCount === 1 ? "" : "s"} logged`
              : " · never called"}
        </p>
      </div>
      {/* Two clearly distinct actions (Error Log L3): "Call" dials, "Log outcome" records. The
          Call button ALSO opens the outcome form a moment later, stamped with the dial time, so
          the usual path is one tap; "Log outcome" stays for a call made outside the app. */}
      <div className="flex flex-none items-center gap-2">
        {lead.phone && (
          <DialButton phone={lead.phone} name={lead.name} onDial={(at) => onLog(lead, at)}>
            <PhoneCall size={14} /> Call
          </DialButton>
        )}
        <Btn variant="soft" size="sm" onClick={() => onLog(lead)}>Log outcome</Btn>
      </div>
    </li>
  );
}

export function L1Desk({ desk }: { desk: L1DeskData }) {
  const router = useRouter();
  const [logging, setLogging] = useState<{ lead: L1QueueLead; calledAt?: Date } | null>(null);
  const offline = useOfflineCalls(() => router.refresh());

  // `desk.total`, not the array lengths: the server trims each bucket to what is rendered, so
  // the arrays no longer answer "how many are waiting".
  const totalDue = QUEUE_BUCKETS.reduce((n, b) => n + desk.total[b], 0);

  return (
    <div className="space-y-8">
      <NewLeadWatcher onSeen={() => router.refresh()} />

      {/* Connection state. Rendered only when there is something to say - a permanent
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
                  offline.online ? "" : " - they will sync when the connection returns"
                }.`
              : "Calls you log will be saved on this device and sent when the connection returns."}
          </span>
          {offline.stuck > 0 && (
            <span className="font-semibold">
              {offline.stuck} could not be sent - tell Ameen rather than re-logging them.
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
           * broken" - or worse, as permission to stop. Only claim the work is done when there
           * was work.
           */
          desk.ownedCallable === 0 ? (
            <EmptyState
              title="No leads have been assigned to you"
              body="This desk shows the leads you own, and you don't own any yet. Ask Ameen to hand you a batch from Pipeline → Leads → Hand out leads. Nothing is broken - there's just nothing here to call."
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
                  subtitle={
                    /* The call-back bucket states the RULE it is applying, because the rule is the
                       only thing that explains why a lead you rang this morning is not on the
                       screen. Without it a caller reads the absence as the desk having lost them. */
                    bucket === "OPTED_NOT_BOOKED"
                      ? `${meta.why} Each reappears ${desk.callbackRule.gapHours}h after your last call, up to ${desk.callbackRule.maxCallbacks} time${desk.callbackRule.maxCallbacks === 1 ? "" : "s"}.`
                      : `${meta.why} · ${meta.target}`
                  }
                >
                  <ul className="-mx-4 -mb-2">
                    {leads.map((l) => (
                      <QueueRow key={l.id} lead={l} bucket={bucket} onLog={(lead, calledAt) => setLogging({ lead, calledAt })} />
                    ))}
                  </ul>
                  {count > leads.length && (
                    <p className="mt-3 text-caption text-muted">
                      Showing the {leads.length} most urgent of {count}. Work these first - the rest move up as you clear them.
                    </p>
                  )}
                  {/* Where the ones that vanished went.

                      A bucket that quietly shrinks overnight is how people conclude the desk has
                      lost their leads, and "we gave up on four of your prospects" is not something
                      a screen should leave unsaid. Only rendered while there ARE any, which on a
                      healthy install is the short window between a chase running out and the cron
                      filing it - so a number that sits here for days means the sweep is not
                      ticking, which is itself worth seeing. */}
                  {bucket === "OPTED_NOT_BOOKED" && desk.callbackExhausted > 0 && (
                    <p className="mt-3 text-caption text-muted">
                      {desk.callbackExhausted} more had all {desk.callbackRule.maxCallbacks} call-back
                      {desk.callbackRule.maxCallbacks === 1 ? "" : "s"} and still didn&apos;t book.
                      {desk.callbackRule.closesWhenExhausted
                        ? " They're being closed to Cancelled/Unqualified, so they aren't yours to chase any more."
                        : " The chase has stopped, so they won't come back here - their cards stay where they are on the board."}
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
          description="Confirm these today - bookings inside 8 hours are blocked, so an unconfirmed call must be cancelled early to free the slot."
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
                  ? `Showing 6 of ${desk.tomorrow.unconfirmed.length} - full chase list below.`
                  : undefined,
            }}
          />
        </div>

        {desk.tomorrow.unconfirmed.length > 0 && (
          <Card title={<CardTitle icon={<PhoneCall size={18} />}>Unconfirmed - chase list</CardTitle>}>
            <ul className="-mx-4 -mb-2">
              {desk.tomorrow.unconfirmed.map((b) => (
                <li key={b.id} className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3 last:border-0">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-ink" title={b.name}>{b.name}</p>
                    <p className="text-caption text-muted">
                      {new Date(b.startsAt).toLocaleString("en-IN", {
                        timeZone: "Asia/Kolkata",
                        weekday: "short", hour: "2-digit", minute: "2-digit",
                      })} IST · {b.phone}
                    </p>
                  </div>
                  {/* A booked call's outcome is recorded by the specialist who runs it, so
                      this dial stamps nothing - it only opens the dialler. */}
                  <DialButton phone={b.phone} name={b.name} onDial={() => undefined}>
                    <PhoneCall size={14} /> Call
                  </DialButton>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </section>

      {/* ── JD targets. Every row maps to a target in the Level 1 JD (principle §4). ──
          Was an 8-card grid, each card's progress bar scaled to its own target - so 83%-of-target
          and 25%-of-target drew identical bars and the screen could not say which to fix first.
          See TargetAttainment for the full rationale; the cards' figures, targets, signal colours
          and definitions all survive the move. */}
      <section className="space-y-4">
        <SectionHeading
          icon={<Target size={18} />}
          title="Your targets"
          description="This month against the Level 1 job description - furthest behind first"
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
          lead={logging.lead}
          calledAt={logging.calledAt}
          onClose={() => setLogging(null)}
          queueCall={offline.queueCall}
          online={offline.online}
        />
      )}
    </div>
  );
}

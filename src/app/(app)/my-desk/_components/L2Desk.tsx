"use client";

import { useState } from "react";
import Link from "next/link";
import { CalendarClock, PhoneCall, Target, Video } from "lucide-react";
import { routeDiscoveryCall } from "@/server/discovery-routing";
import type { L2Call, L2Desk as L2DeskData } from "@/server/l2-desk-metrics";
import {
  DISCOVERY_ROUTES,
  L2_TARGETS,
  signalForSpec,
  type L2TargetKey,
} from "@/lib/outreach-sla";
import { Card, CardTitle, EmptyState, Pill, SectionHeading } from "@/components/ui/kit";
import { Btn } from "@/components/ui/controls";
import { CheckboxField, Field, FormError, SubmitButton, TextInput } from "@/components/ui/form";
import { Modal } from "@/components/ui/Modal";
import { toast } from "@/components/ui/feedback";
import { TargetAttainment } from "./TargetAttainment";

/**
 * Level 2 — Discovery Specialist desk (rebuild spec §7).
 *
 * Opens to today's calendar. The routing panel is the only way a call leaves this list, so
 * the outcome, the stage and the booking status can never drift apart.
 */

function timeIst(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
  });
}

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

/**
 * The routing panel. Three destinations, each stating its own follow-up, plus the two
 * outcomes that are not routes at all (follow-up, no-show).
 *
 * BANT sits on the same form because the specialist has just finished the conversation —
 * asking them to reopen the lead afterwards is how it ends up never being filled in.
 */
function RouteModal({ call, onClose }: { call: L2Call; onClose: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<string>("QUALIFIED_FOR_SSS");

  return (
    <Modal open onClose={onClose} title={`Record outcome — ${call.name}`} subtitle={`${timeIst(call.startsAt)} IST`}>
      <form
        action={async (form) => {
          setError(null);
          const res = await routeDiscoveryCall(form);
          if (!res.ok) return setError(res.error);
          toast("Outcome recorded");
          onClose();
        }}
        className="space-y-4"
      >
        <input type="hidden" name="leadId" value={call.leadId ?? ""} />
        <input type="hidden" name="bookingId" value={call.bookingId ?? ""} />
        <input type="hidden" name="outcome" value={outcome} />

        <fieldset className="space-y-2">
          <legend className="mb-1 text-sm font-medium text-ink">Where does this prospect go?</legend>
          {DISCOVERY_ROUTES.map((r) => (
            <label
              key={r.outcome}
              className={`flex cursor-pointer items-start gap-3 rounded-card border p-3 ${
                outcome === r.outcome ? "border-primary bg-primary-soft" : "border-line"
              }`}
            >
              <input
                type="radio"
                name="routeChoice"
                className="mt-1 accent-primary"
                checked={outcome === r.outcome}
                onChange={() => setOutcome(r.outcome)}
              />
              <span className="min-w-0">
                <span className="block text-sm font-medium text-ink">{r.label}</span>
                <span className="block text-caption text-muted">{r.detail}</span>
              </span>
            </label>
          ))}
        </fieldset>

        {/* Not routes — the call didn't reach a decision. Kept visually apart so they can't
            be picked by accident while scanning the three real destinations. */}
        <div className="flex flex-wrap gap-2 border-t border-line pt-3">
          <Btn
            type="button"
            variant={outcome === "FOLLOW_UP_NEEDED" ? "primary" : "ghost"}
            size="sm"
            onClick={() => setOutcome("FOLLOW_UP_NEEDED")}
          >
            Follow-up needed
          </Btn>
          <Btn
            type="button"
            variant={outcome === "NO_SHOW" ? "primary" : "ghost"}
            size="sm"
            onClick={() => setOutcome("NO_SHOW")}
          >
            No show
          </Btn>
        </div>

        {outcome === "NO_SHOW" && (
          <p className="rounded-card bg-warn-soft p-3 text-caption text-warn">
            Only mark a no-show once you have rung them directly. Per the JD a missed call is not
            a no-show until you have tried to reach the prospect yourself.
          </p>
        )}

        <fieldset className="grid grid-cols-2 gap-2 border-t border-line pt-3">
          <legend className="mb-1 text-sm font-medium text-ink">BANT</legend>
          <CheckboxField name="bantBudget" label="Budget" />
          <CheckboxField name="bantAuthority" label="Authority" />
          <CheckboxField name="bantNeed" label="Need" />
          <CheckboxField name="bantTimeline" label="Timeline" />
        </fieldset>

        <CheckboxField name="highlyQualified" label="Highly qualified" />

        <Field label="Key notes for the closer">
          <TextInput kind="text" name="notes" maxLength={1000} placeholder="What should Level 3 know?" />
        </Field>

        <div className="flex items-center justify-between gap-3">
          <FormError message={error} />
          <span className="ml-auto"><SubmitButton>Record outcome</SubmitButton></span>
        </div>
      </form>
    </Modal>
  );
}

function CallRow({ call, onRoute }: { call: L2Call; onRoute: (c: L2Call) => void }) {
  return (
    <li className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3 last:border-0">
      <span className="tnum w-16 flex-none text-sm font-semibold text-ink">{timeIst(call.startsAt)}</span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          {call.leadId ? (
            <Link href={`/pipeline?lead=${call.leadId}`} className="truncate font-medium text-ink hover:underline">
              {call.name}
            </Link>
          ) : (
            <span className="truncate font-medium text-ink">{call.name}</span>
          )}
          {call.recorded ? (
            <Pill tone="good">Recorded</Pill>
          ) : call.needsChase ? (
            <Pill tone="bad">Chase — no outcome yet</Pill>
          ) : call.confirmed ? (
            <Pill tone="good">Confirmed</Pill>
          ) : (
            <Pill tone="warn">Unconfirmed</Pill>
          )}
        </div>
        <p className="mt-0.5 truncate text-caption text-muted">{call.phone}</p>
      </div>
      <div className="flex flex-none items-center gap-2">
        {call.zoomLink && (
          <a
            href={call.zoomLink}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-btn border border-line px-3 py-1.5 text-sm font-semibold text-ink-2 hover:bg-surface-2"
          >
            <Video size={14} /> Join
          </a>
        )}
        {/* The JD's rule made literal: chase before judging. */}
        {call.needsChase && <DialLink phone={call.phone} name={call.name} />}
        {!call.recorded && call.leadId && (
          <Btn variant="soft" size="sm" onClick={() => onRoute(call)}>Record outcome</Btn>
        )}
      </div>
    </li>
  );
}

export function L2Desk({ desk }: { desk: L2DeskData }) {
  const [routing, setRouting] = useState<L2Call | null>(null);

  const chase = desk.today.filter((c) => c.needsChase);
  const upcoming = desk.today.filter((c) => !c.recorded && !c.needsChase);

  return (
    <div className="space-y-8">
      <section className="space-y-4">
        <SectionHeading
          icon={<CalendarClock size={18} />}
          title="Today's calls"
          description={
            desk.today.length === 0
              ? "Nothing booked today."
              : `${desk.today.length} booked · ${upcoming.length} still to run · ${chase.length} to chase`
          }
        />

        {desk.today.length === 0 ? (
          <EmptyState
            title="No discovery calls today"
            body="Calls booked into your slots appear here in time order, with their confirmation status."
          />
        ) : (
          <Card>
            <ul className="-mx-4 -mb-2">
              {desk.today.map((c) => (
                <CallRow key={c.slotId} call={c} onRoute={setRouting} />
              ))}
            </ul>
          </Card>
        )}

        {chase.length > 0 && (
          <p className="rounded-card bg-warn-soft p-3 text-caption text-warn">
            {chase.length} call{chase.length === 1 ? " has" : "s have"} passed without an outcome. Ring the
            prospect directly before recording a no-show — a missed call is not a no-show until you have tried.
          </p>
        )}
      </section>

      <section className="space-y-4">
        <SectionHeading
          icon={<Target size={18} />}
          title="Your targets"
          description="This month against the Level 2 job description — furthest behind first"
        />
        <Card>
          <TargetAttainment
            specs={L2_TARGETS}
            values={desk.targets}
            signalFor={(k: L2TargetKey, v: number | null) => signalForSpec(L2_TARGETS[k], v)}
          />
        </Card>
      </section>

      {routing && <RouteModal call={routing} onClose={() => setRouting(null)} />}
    </div>
  );
}

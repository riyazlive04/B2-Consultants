"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarCheck, CheckCircle2 } from "lucide-react";
import { submitBooking } from "@/server/booking-actions";
import { Field, FormError, Select, SubmitButton, TextArea, TextInput } from "@/components/ui/form";
import { INTAKE_OPTIONS } from "@/lib/booking-intake";
import { slotTypeLabel } from "@/lib/labels";

const IST_ZONE = "Asia/Kolkata";

export type SlotOption = {
  id: string;
  day: string;
  time: string;
  cet: string;
  durationMins: number;
  /** UTC instant, ISO - the raw value the static IST/CET strings above were formatted from.
   *  Needed client-side to convert to the visitor's own detected timezone. */
  startsAtIso: string;
};

const withPlaceholder = (opts: readonly { value: string; label: string }[], placeholder: string) => [
  { value: "", label: placeholder },
  ...opts,
];

export function BookingForm({ slots }: { slots: SlotOption[] }) {
  const [slotId, setSlotId] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<SlotOption | null>(null);
  const utmRef = useRef<HTMLInputElement>(null);

  // Capture UTM / attribution params from the landing URL so the lead carries its source.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const utm: Record<string, string> = {};
    for (const k of ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "gclid", "fbclid"]) {
      const v = p.get(k);
      if (v) utm[k] = v;
    }
    if (utmRef.current) utmRef.current.value = Object.keys(utm).length ? JSON.stringify(utm) : "";
  }, []);

  // Visitor timezone, detected client-side only (browser API - unavailable during SSR).
  // Shown ALONGSIDE the static IST/CET times, never replacing them.
  const [visitorTz, setVisitorTz] = useState<string | null>(null);
  useEffect(() => {
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (tz) setVisitorTz(tz);
    } catch {
      // Intl unavailable/blocked - fall back to the static IST/CET display only.
    }
  }, []);
  const showLocalTz = !!visitorTz && visitorTz !== IST_ZONE;

  const localTimeFmt = useMemo(() => {
    if (!visitorTz) return null;
    try {
      return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", hour12: true, timeZone: visitorTz });
    } catch {
      return null;
    }
  }, [visitorTz]);
  const localFullFmt = useMemo(() => {
    if (!visitorTz) return null;
    try {
      return new Intl.DateTimeFormat(undefined, {
        weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: true,
        timeZone: visitorTz,
      });
    } catch {
      return null;
    }
  }, [visitorTz]);
  const localTime = (s: SlotOption) => (localTimeFmt ? localTimeFmt.format(new Date(s.startsAtIso)) : null);
  const localFull = (s: SlotOption) => (localFullFmt ? localFullFmt.format(new Date(s.startsAtIso)) : null);

  const byDay = useMemo(() => {
    const map = new Map<string, SlotOption[]>();
    for (const s of slots) {
      const arr = map.get(s.day) ?? [];
      arr.push(s);
      map.set(s.day, arr);
    }
    return [...map.entries()];
  }, [slots]);

  const chosen = slots.find((s) => s.id === slotId) ?? null;

  const submit = async (form: FormData) => {
    setError(null);
    if (!slotId) return setError("Please choose an available time for your call.");
    const res = await submitBooking(form);
    if (!res.ok) return setError(res.error);
    setDone(chosen);
  };

  if (done) {
    return (
      <div className="rounded-card border border-line bg-surface p-8 text-center shadow-card">
        <CheckCircle2 className="mx-auto text-ok" size={40} />
        <h2 className="mt-3 font-display text-xl font-semibold">You're booked in 🎉</h2>
        <p className="mx-auto mt-2 max-w-sm text-sm text-muted">
          Your {slotTypeLabel(done.durationMins).toLowerCase()} is confirmed for{" "}
          <strong className="text-ink">{done.day}</strong> at{" "}
          <strong className="text-ink">{done.time} IST</strong> ({done.cet} CET)
          {showLocalTz && localTime(done) && (
            <> · <strong className="text-ink">{localTime(done)}</strong> ({visitorTz})</>
          )}
          . Our team will be in touch with the joining details.
        </p>
      </div>
    );
  }

  if (slots.length === 0) {
    return (
      <div className="rounded-card border border-line bg-surface p-8 text-center shadow-card">
        <CalendarCheck className="mx-auto text-muted" size={36} />
        <p className="mt-3 text-sm text-muted">
          No call times are open right now. Please check back shortly - we release new slots
          regularly.
        </p>
      </div>
    );
  }

  return (
    <form action={submit} className="space-y-6">
      {/* ── Slot picker ── */}
      <section className="rounded-card border border-line bg-surface p-5 shadow-card">
        <h2 className="font-display text-h2 font-semibold">1. Pick a time</h2>
        <p className="mt-0.5 text-xs text-muted">
          Times shown in IST.
          {showLocalTz && ` Also shown in your detected timezone (${visitorTz}).`}
        </p>
        <div className="mt-4 space-y-4">
          {byDay.map(([day, daySlots]) => (
            <div key={day}>
              <p className="text-sm font-semibold text-ink">{day}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {daySlots.map((s) => (
                  <button
                    type="button"
                    key={s.id}
                    onClick={() => setSlotId(s.id)}
                    title={localFull(s) ? `${slotTypeLabel(s.durationMins)} · ${localFull(s)} your time` : slotTypeLabel(s.durationMins)}
                    className={`rounded-field border px-3 py-1.5 text-sm transition-colors ${
                      slotId === s.id
                        ? "border-accent bg-accent text-on-accent"
                        : "border-line bg-surface-2 text-ink hover:border-accent"
                    }`}
                    aria-pressed={slotId === s.id}
                  >
                    <span className="block">{s.time}</span>
                    {showLocalTz && localTime(s) && (
                      <span className="mt-0.5 block text-[10px] font-normal opacity-75">{localTime(s)} your time</span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
        <input type="hidden" name="slotId" value={slotId} />
        {chosen && (
          <p className="mt-3 text-xs text-muted">
            Selected: <strong className="text-ink">{chosen.day}, {chosen.time} IST</strong> · {chosen.cet} CET
            {showLocalTz && localTime(chosen) && (
              <> · <strong className="text-ink">{localTime(chosen)}</strong> ({visitorTz})</>
            )}
            {" · "}{slotTypeLabel(chosen.durationMins)}
          </p>
        )}
      </section>

      {/* ── Contact ── */}
      <section className="rounded-card border border-line bg-surface p-5 shadow-card">
        <h2 className="font-display text-h2 font-semibold">2. Your details</h2>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Full name"><TextInput name="name" required placeholder="Your name" /></Field>
          <Field label="Email"><TextInput type="email" name="email" required placeholder="you@email.com" /></Field>
          <Field label="Phone / WhatsApp" hint="Always include the country code — +91 (India), +49 (Germany)">
            <TextInput name="phone" required placeholder="+91… / +49…" />
          </Field>
          <Field label="WhatsApp (if different)"><TextInput name="whatsapp" placeholder="Optional" /></Field>
          <Field label="City"><TextInput name="city" placeholder="Your city" /></Field>
          <Field label="How did you hear about us?">
            <Select name="howKnowUs" options={withPlaceholder(INTAKE_OPTIONS.howKnowUs, "Select…")} defaultValue="" />
          </Field>
        </div>
        <p className="mt-3 text-xs text-muted">
          By sharing your number you agree to receive your booking confirmation and call reminders on WhatsApp.
          Reply <strong>STOP</strong> anytime to opt out.
        </p>
      </section>

      {/* ── Qualification (drives BANT) ── */}
      <section className="rounded-card border border-line bg-surface p-5 shadow-card">
        <h2 className="font-display text-h2 font-semibold">3. About your goal</h2>
        <p className="mt-0.5 text-xs text-muted">This helps us tailor the call to you.</p>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Current job title"><TextInput name="currentJobTitle" placeholder="e.g. Mechanical Engineer" /></Field>
          <Field label="Industry"><TextInput name="prospectIndustry" placeholder="e.g. Automotive" /></Field>
          <Field label="LinkedIn profile"><TextInput name="linkedInProfile" placeholder="Optional URL" /></Field>
          <Field label="Highest education">
            <Select name="highestEducation" options={withPlaceholder(INTAKE_OPTIONS.highestEducation, "Select…")} defaultValue="" />
          </Field>
          <Field label="Years of experience">
            <Select name="yearsExperience" options={withPlaceholder(INTAKE_OPTIONS.yearsExperience, "Select…")} defaultValue="" />
          </Field>
          <Field label="When do you want to start working in Germany?">
            <Select name="whenStartGermany" options={withPlaceholder(INTAKE_OPTIONS.whenStartGermany, "Select…")} defaultValue="" />
          </Field>
          <Field label="Have you already applied to jobs in Germany?">
            <Select name="alreadyApplied" options={withPlaceholder(INTAKE_OPTIONS.alreadyApplied, "Select…")} defaultValue="" />
          </Field>
          <Field label="Do you hold a German visa?">
            <Select name="germanVisa" options={withPlaceholder(INTAKE_OPTIONS.germanVisa, "Select…")} defaultValue="" />
          </Field>
          <Field label="Your German language level">
            <Select name="germanLevel" options={withPlaceholder(INTAKE_OPTIONS.germanLevel, "Select…")} defaultValue="" />
          </Field>
          <Field label="Willing to learn German?">
            <Select name="willingnessLearnGerman" options={withPlaceholder(INTAKE_OPTIONS.willingnessLearnGerman, "Select…")} defaultValue="" />
          </Field>
          <Field label="Current annual income">
            <Select name="currentIncome" options={withPlaceholder(INTAKE_OPTIONS.currentIncome, "Prefer not to say")} defaultValue="" />
          </Field>
          <Field label="Ready to invest in the right program?">
            <Select name="readyToInvest" options={withPlaceholder(INTAKE_OPTIONS.readyToInvest, "Select…")} defaultValue="" />
          </Field>
          <Field label="Who makes the decision?">
            <Select name="decisionMaking" options={withPlaceholder(INTAKE_OPTIONS.decisionMaking, "Select…")} defaultValue="" />
          </Field>
          <Field label="How committed are you?">
            <Select name="commitment" options={withPlaceholder(INTAKE_OPTIONS.commitment, "Select…")} defaultValue="" />
          </Field>
        </div>
        <div className="mt-4 grid grid-cols-1 gap-4">
          <Field label="Why Germany?" hint="A sentence or two on what you're hoping for.">
            <TextArea name="whyGermany" />
          </Field>
          <Field label="Anything you'd like to focus on in the call?">
            <TextArea name="reasonForCall" />
          </Field>
        </div>
      </section>

      {/* honeypot - hidden from real users; bots fill it and get silently dropped */}
      <input
        type="text"
        name="company_website"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        className="absolute left-[-9999px] h-0 w-0 opacity-0"
      />
      <input type="hidden" name="utm" ref={utmRef} defaultValue="" />

      <div className="flex flex-col items-center gap-3">
        <SubmitButton>Confirm my call</SubmitButton>
        <FormError message={error} />
      </div>
    </form>
  );
}

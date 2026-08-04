"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, CalendarCheck, CalendarDays, CheckCircle2, Clock } from "lucide-react";
import { submitBooking } from "@/server/booking-actions";
import { Field, FormError, Select, SubmitButton, TextArea, TextInput } from "@/components/ui/form";
import { PhoneField } from "@/components/ui/PhoneField";
import { INTAKE_OPTIONS } from "@/lib/booking-intake";
import { CONSENT_LABEL, CONSENT_VALUE } from "@/lib/consent";
import { slotTypeLabel } from "@/lib/labels";
import { SlotCalendar } from "./SlotCalendar";

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

/** The wizard, in order. Titles are the only copy the step header needs. */
const STEPS = [
  { title: "Select date & time", hint: "" },
  { title: "Your details", hint: "So we know who we're speaking to." },
  { title: "Your background", hint: "A quick picture of where you are today." },
  { title: "Your Germany plan", hint: "Where you're trying to get to." },
  { title: "Fit & commitment", hint: "The last few — then you're booked." },
] as const;

/**
 * The public booking flow: pick a time, then four short pages of questions.
 *
 * ── Why it is paginated ─────────────────────────────────────────────────────────
 * This was one scroll: ninety slot chips, then contact details, then fourteen qualification
 * questions and two free-text boxes, all visible at once. Everything being on screen together
 * reads as a form — and a long one — rather than as booking a call, and the length is the thing
 * a prospect judges before they start. Four pages of four-to-six fields ask for exactly the same
 * information and never look like more than a minute's work.
 *
 * ── Why every step stays mounted ────────────────────────────────────────────────
 * Steps are hidden with `display:none`, never unmounted. A hidden input still posts its value;
 * an unmounted one loses whatever was typed into it, so going Back and forward again would
 * quietly empty the fields behind you. It also means the whole thing is still ONE form and one
 * submit — the server action is untouched.
 *
 * `required` is checked per step on the way forward, so the browser never has to complain about
 * a field it cannot scroll to.
 */
export function BookingForm({ slots, hostName }: { slots: SlotOption[]; hostName?: string | null }) {
  const [slotId, setSlotId] = useState<string>("");
  const [step, setStep] = useState(0);
  const [dir, setDir] = useState<"fwd" | "back">("fwd");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<SlotOption | null>(null);
  const utmRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const paneRef = useRef<HTMLDivElement>(null);

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

  /**
   * Starts as IST and is replaced by the visitor's own zone on mount.
   *
   * Not detected during render: this component is server-rendered first, and seeding state from
   * `Intl` would make the server emit IST while the browser hydrates with something else. React
   * treats that as corrupt markup and throws the whole page away — on the one page where that
   * costs a booking.
   */
  const [tz, setTz] = useState(IST_ZONE);
  useEffect(() => {
    try {
      const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (detected) setTz(detected);
    } catch {
      /* Intl blocked — IST stands, and the picker still lets them change it. */
    }
  }, []);
  const showLocalTz = tz !== IST_ZONE;

  const localTimeFmt = useMemo(() => {
    try {
      return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", hour12: true, timeZone: tz });
    } catch {
      return null;
    }
  }, [tz]);
  const localTime = (s: SlotOption) => (localTimeFmt ? localTimeFmt.format(new Date(s.startsAtIso)) : null);

  const chosen = slots.find((s) => s.id === slotId) ?? null;
  const durationMins = chosen?.durationMins ?? slots[0]?.durationMins ?? 30;

  const longFmt = useMemo(() => {
    try {
      return new Intl.DateTimeFormat("en-GB", {
        weekday: "short", day: "numeric", month: "short", year: "numeric",
        hour: "2-digit", minute: "2-digit", hour12: false, timeZone: tz,
      });
    } catch {
      return null;
    }
  }, [tz]);
  const chosenLabel = chosen && longFmt ? longFmt.format(new Date(chosen.startsAtIso)) : null;

  const isLast = step === STEPS.length - 1;

  /** Validate only what is on screen, then advance. */
  function goNext() {
    setError(null);
    if (step === 0 && !slotId) {
      setError("Please choose an available time for your call.");
      return;
    }
    const panel = formRef.current?.querySelector<HTMLElement>(`[data-step="${step}"]`);
    const controls = panel
      ? [...panel.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("input,select,textarea")]
      : [];
    const invalid = controls.find((c) => !c.checkValidity());
    if (invalid) {
      invalid.reportValidity();
      return;
    }
    setDir("fwd");
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }

  function goBack() {
    setError(null);
    setDir("back");
    setStep((s) => Math.max(s - 1, 0));
  }

  /**
   * Bring the top of the pane back into view when the step changes — on a phone the Next button
   * sits below the fold, so without this you land halfway down the following step.
   *
   * Skipped on the FIRST run: that one is not a step change, it is the page arriving, and
   * scrolling then yanks the visitor past the header they have not read yet.
   */
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    paneRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [step]);

  const submit = async (form: FormData) => {
    setError(null);
    if (!slotId) return setError("Please choose an available time for your call.");
    const res = await submitBooking(form);
    if (!res.ok) return setError(res.error);
    setDone(chosen);
  };

  /** The standing left-hand card: who the call is with, how long, and when — once known. */
  const asideCard = (
    <aside className="border-b border-line bg-surface-2 p-6 sm:p-8 md:w-80 md:flex-none md:border-b-0 md:border-r">
      <span className="grid h-12 w-12 place-items-center rounded-2xl bg-primary font-display text-base font-bold text-on-accent shadow-soft">
        B2
      </span>
      <p className="mt-5 text-caption font-semibold uppercase tracking-wide text-ink-3">Discovery</p>
      <h1 className="mt-1 font-display text-xl font-bold tracking-tight text-ink sm:text-2xl">
        Personalized Discovery Call{hostName ? ` with ${hostName}` : ""}
      </h1>
      <dl className="mt-4 space-y-2 text-sm text-ink-2">
        <div className="flex items-center gap-2">
          <Clock size={16} aria-hidden className="flex-none text-ink-3" />
          <dd>{durationMins} min</dd>
        </div>
        {chosenLabel && (
          <div className="flex items-start gap-2">
            <CalendarDays size={16} aria-hidden className="mt-0.5 flex-none text-ink-3" />
            <dd className="font-semibold text-ink">{chosenLabel}</dd>
          </div>
        )}
      </dl>
      <p className="mt-5 text-sm leading-relaxed text-muted">
        A free {durationMins}-minute call with our team. Please answer the short questionnaire so we
        have the details needed to help you on the call <em>(takes 2–3 minutes)</em>.
      </p>
    </aside>
  );

  const shell = (children: React.ReactNode) => (
    <div className="mx-auto w-full max-w-5xl overflow-hidden rounded-card border border-line bg-surface shadow-card md:flex">
      {asideCard}
      <div ref={paneRef} className="min-w-0 flex-1 p-6 sm:p-8">{children}</div>
    </div>
  );

  if (done) {
    return shell(
      <div className="py-6 text-center">
        <CheckCircle2 className="mx-auto text-ok" size={40} />
        <h2 className="mt-3 font-display text-xl font-semibold">You&apos;re booked in 🎉</h2>
        <p className="mx-auto mt-2 max-w-sm text-sm text-muted">
          Your {slotTypeLabel(done.durationMins).toLowerCase()} is confirmed for{" "}
          <strong className="text-ink">{done.day}</strong> at{" "}
          <strong className="text-ink">{done.time} IST</strong> ({done.cet} CET)
          {showLocalTz && localTime(done) && (
            <> · <strong className="text-ink">{localTime(done)}</strong> ({tz})</>
          )}
          . Our team will be in touch with the joining details.
        </p>
      </div>,
    );
  }

  if (slots.length === 0) {
    return shell(
      <div className="py-10 text-center">
        <CalendarCheck className="mx-auto text-muted" size={36} />
        <p className="mt-3 text-sm text-muted">
          No call times are open right now. Please check back shortly — we release new slots
          regularly.
        </p>
      </div>,
    );
  }

  const anim = dir === "fwd" ? "step-in-fwd" : "step-in-back";
  /** Hidden steps keep their values; only the active one is laid out (and so only it animates). */
  const panel = (i: number) => `${i === step ? anim : "hidden"}`;

  return shell(
    <form
      ref={formRef}
      action={submit}
      onKeyDown={(e) => {
        // Enter on step 3 of 5 must not submit a half-filled booking.
        if (e.key === "Enter" && !isLast && (e.target as HTMLElement).tagName !== "TEXTAREA") {
          e.preventDefault();
          goNext();
        }
      }}
    >
      {/* ── Step header ── */}
      <div className="mb-5">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="font-display text-base font-semibold text-ink">{STEPS[step].title}</h2>
          <span className="flex-none text-caption text-ink-3 tnum">
            Step {step + 1} of {STEPS.length}
          </span>
        </div>
        {STEPS[step].hint && <p className="mt-0.5 text-caption text-muted">{STEPS[step].hint}</p>}
        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-surface-2" role="presentation">
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-300 ease-out"
            style={{ width: `${((step + 1) / STEPS.length) * 100}%` }}
          />
        </div>
      </div>

      {/* ── 1. Time ── */}
      <div data-step={0} className={panel(0)}>
        <SlotCalendar slots={slots} selectedId={slotId} onSelect={setSlotId} tz={tz} onTzChange={setTz} />
      </div>
      <input type="hidden" name="slotId" value={slotId} />

      {/* ── 2. Contact ── */}
      <div data-step={1} className={panel(1)}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Full name"><TextInput kind="name" name="name" required placeholder="Your name" /></Field>
          <Field label="Email"><TextInput kind="email" name="email" required placeholder="you@email.com" /></Field>
          <Field label="Phone / WhatsApp" hint="Pick your country, then type your number">
            <PhoneField name="phone" required />
          </Field>
          <Field label="WhatsApp (if different)"><PhoneField name="whatsapp" /></Field>
          <Field label="City"><TextInput kind="city" name="city" placeholder="Your city" /></Field>
          <Field label="How did you hear about us?">
            <Select name="howKnowUs" options={withPlaceholder(INTAKE_OPTIONS.howKnowUs, "Select…")} defaultValue="" />
          </Field>
        </div>
        <p className="mt-3 text-xs text-muted">
          By sharing your number you agree to receive your booking confirmation and call reminders on WhatsApp.
          Reply <strong>STOP</strong> anytime to opt out.
        </p>
      </div>

      {/* ── 3. Background ── */}
      <div data-step={2} className={panel(2)}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {/* Job title / industry stay unfiltered: "Engineer II", "Industry 4.0" are real answers. */}
          <Field label="Current job title"><TextInput kind="text" maxLength={160} name="currentJobTitle" placeholder="e.g. Mechanical Engineer" /></Field>
          <Field label="Industry"><TextInput kind="text" maxLength={160} name="prospectIndustry" placeholder="e.g. Automotive" /></Field>
          <Field label="LinkedIn profile"><TextInput kind="url" name="linkedInProfile" placeholder="linkedin.com/in/you" /></Field>
          <Field label="Highest education">
            <Select name="highestEducation" options={withPlaceholder(INTAKE_OPTIONS.highestEducation, "Select…")} defaultValue="" />
          </Field>
          <Field label="Years of experience">
            <Select name="yearsExperience" options={withPlaceholder(INTAKE_OPTIONS.yearsExperience, "Select…")} defaultValue="" />
          </Field>
        </div>
      </div>

      {/* ── 4. Germany plan ── */}
      <div data-step={3} className={panel(3)}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
        </div>
      </div>

      {/* ── 5. Fit, commitment and consent ── */}
      <div data-step={4} className={panel(4)}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
            <TextArea kind="text" name="whyGermany" />
          </Field>
          <Field label="Anything you'd like to focus on in the call?">
            <TextArea kind="text" name="reasonForCall" />
          </Field>
        </div>

        {/*
          GDPR consent (spec §15). `required` gives the prospect an instant browser-native
          message instead of a server round-trip, but it is only a courtesy — submitBooking
          refuses unconsented submissions regardless, since a client-side attribute is not a
          compliance control.
        */}
        <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-field border border-line bg-surface-2 p-4 text-sm">
          <input
            type="checkbox"
            name="consent"
            value={CONSENT_VALUE}
            required
            className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--primary)]"
          />
          <span className="text-muted">{CONSENT_LABEL}</span>
        </label>
      </div>

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

      {/* ── Wizard controls ── */}
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5">
        {step > 0 ? (
          <button
            type="button"
            onClick={goBack}
            className="inline-flex h-11 items-center gap-1.5 rounded-btn border border-line px-4 text-sm font-semibold text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
          >
            <ArrowLeft size={16} /> Back
          </button>
        ) : (
          <span />
        )}

        <div className="flex items-center gap-3">
          <FormError message={error} />
          {isLast ? (
            <SubmitButton>Confirm my call</SubmitButton>
          ) : (
            <button
              type="button"
              onClick={goNext}
              disabled={step === 0 && !slotId}
              className="press inline-flex h-11 items-center justify-center rounded-btn bg-primary px-6 text-sm font-semibold text-on-accent transition-colors hover:bg-primary-strong disabled:bg-surface-2 disabled:text-ink-disabled"
            >
              Next
            </button>
          )}
        </div>
      </div>
    </form>,
  );
}

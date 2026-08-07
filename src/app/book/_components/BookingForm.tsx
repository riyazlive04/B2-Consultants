"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, CalendarCheck, CalendarDays, CheckCircle2, Clock, MailCheck } from "lucide-react";
import { submitBooking } from "@/server/booking-actions";
import { BrandLogo } from "@/components/shell/BrandLogo";
import {
  BookingIntakeFields,
  BookingIntakeHiddenFields,
  type IntakeSection,
} from "@/components/booking/BookingIntakeFields";
import { Btn } from "@/components/ui/controls";
import { FormError, SubmitButton } from "@/components/ui/form";
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

/**
 * The wizard, in order.
 *
 * Each question step names a rung of the intake ladder rather than listing fields: the questions
 * themselves live in `BookingIntakeFields`, which is also what the funnel block and the per-person
 * calendar render. That indirection is the point — every `name` here maps to a BANT answer, so a
 * second copy of these inputs would silently score funnel leads differently from /book leads.
 */
const STEPS = [
  { title: "Select date & time", hint: "", section: null },
  { title: "Your details", hint: "So we know who we're speaking to.", section: "identity" },
  { title: "Your background", hint: "A quick picture of where you are today.", section: "credentials" },
  { title: "Your Germany plan", hint: "Where you're trying to get to.", section: "motivation" },
  { title: "Fit & commitment", hint: "The last few — then you're booked.", section: "commercial" },
] as const satisfies readonly { title: string; hint: string; section: IntakeSection | null }[];

/**
 * The public booking flow: pick a time, then four short pages of questions.
 *
 * ── Why it is paginated ─────────────────────────────────────────────────────────
 * This was one scroll: ninety slot chips, then contact details, then nineteen qualification
 * questions and a free-text box, all visible at once. Everything being on screen together
 * reads as a form — and a long one — rather than as booking a call, and the length is the thing
 * a prospect judges before they start. Four pages of four-to-six fields ask for exactly the same
 * information and never look like more than a minute's work.
 *
 * It also enforces the ladder the question order encodes: the commercial questions (salary, who
 * decides) cannot appear until identity and motivation are already answered.
 *
 * ── Why every step stays mounted ────────────────────────────────────────────────
 * Steps are hidden with `display:none`, never unmounted. A hidden input still posts its value;
 * an unmounted one loses whatever was typed into it, so going Back and forward again would
 * quietly empty the fields behind you. It also means the whole thing is still ONE form and one
 * submit — the server action is untouched.
 *
 * `required` is checked per step on the way forward, so the browser never has to complain about
 * a field it cannot scroll to. Every intake field is required, so this is what carries a prospect
 * to a complete answer set instead of a server-side rejection at the end.
 */
export function BookingForm({ slots, hostName }: { slots: SlotOption[]; hostName?: string | null }) {
  const [slotId, setSlotId] = useState<string>("");
  const [step, setStep] = useState(0);
  const [dir, setDir] = useState<"fwd" | "back">("fwd");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ slot: SlotOption | null; declined: boolean } | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const paneRef = useRef<HTMLDivElement>(null);

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
    setDone({ slot: chosen, declined: !!res.declined });
  };

  /** The standing left-hand card: who the call is with, how long, and when — once known. */
  const asideCard = (
    <aside className="border-b border-line bg-surface-2 p-6 sm:p-8 md:w-80 md:flex-none md:border-b-0 md:border-r">
      {/* The real mark plus an HTML wordmark — the lockup every other B2 entry page uses (login,
          reset, change-password), not a blue square with "B2" typed into it. The SVG's own "full"
          variant is not used here: its strapline is 10 units in a 100-unit box, so at this size it
          would render at ~6px, under the §7 text floor. */}
      <div className="flex items-center gap-2.5">
        <BrandLogo className="h-11 w-11 flex-none" />
        <span className="font-display text-[15px] font-bold text-ink">B2 Consultants</span>
      </div>
      <p className="mt-5 text-caption font-semibold uppercase tracking-wide text-ink-3">Discovery</p>
      <h1 className="mt-1 font-display text-h2 tracking-tight text-ink sm:text-h1">
        Personalized Discovery Call{hostName ? ` with ${hostName}` : ""}
      </h1>
      <dl className="mt-4 space-y-2 text-sm text-ink-2">
        <div className="flex items-center gap-2">
          <Clock size={16} aria-hidden className="flex-none text-ink-3" />
          <dd>{durationMins} min</dd>
        </div>
        {/* Dropped once a submission is declined: no slot was claimed, so a time here would be
            the same lie the confirmation panel is careful not to tell. */}
        {chosenLabel && !done?.declined && (
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
    // The auto-disqualify path stores the intake but claims NO slot, so this screen must not
    // read back a time. Saying "you're booked" there sends someone to a call that isn't in
    // anyone's diary — and the slot they think they hold is still open to the next visitor.
    if (done.declined || !done.slot) {
      return shell(
        <div className="py-6 text-center">
          <MailCheck className="mx-auto text-primary" size={40} />
          <h2 className="mt-3 font-display text-h2">Thanks — we have your answers</h2>
          <p className="mx-auto mt-2 max-w-sm text-sm text-muted">
            A call hasn&apos;t been scheduled. Our team will go through what you&apos;ve shared and
            email you about the best next step.
          </p>
        </div>,
      );
    }
    const slot = done.slot;
    return shell(
      <div className="py-6 text-center">
        <CheckCircle2 className="mx-auto text-ok" size={40} />
        <h2 className="mt-3 font-display text-h2">You&apos;re booked in 🎉</h2>
        <p className="mx-auto mt-2 max-w-sm text-sm text-muted">
          Your {slotTypeLabel(slot.durationMins).toLowerCase()} is confirmed for{" "}
          <strong className="text-ink">{slot.day}</strong> at{" "}
          <strong className="text-ink">{slot.time} IST</strong> ({slot.cet} CET)
          {showLocalTz && localTime(slot) && (
            <> · <strong className="text-ink">{localTime(slot)}</strong> ({tz})</>
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
          <h2 className="font-display text-h3 text-ink">{STEPS[step].title}</h2>
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

      {/* ── 2–5. The intake ladder, one rung per step ──
          `headings={false}`: the step header above already names the rung, and the component's own
          "Enter details" h2 would repeat it on every page. */}
      {STEPS.map((s, i) =>
        s.section ? (
          <div key={s.section} data-step={i} className={panel(i)}>
            <BookingIntakeFields section={s.section} headings={false} />
          </div>
        ) : null,
      )}

      {/* Once for the whole form, outside the panels — two `name="utm"` inputs would post twice. */}
      <BookingIntakeHiddenFields />

      {/* ── Wizard controls ── */}
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5">
        {step > 0 ? (
          <Btn variant="ghost" onClick={goBack} icon={<ArrowLeft size={16} />}>
            Back
          </Btn>
        ) : (
          <span />
        )}

        <div className="flex items-center gap-3">
          <FormError message={error} />
          {isLast ? (
            <SubmitButton>Confirm my call</SubmitButton>
          ) : (
            <Btn variant="primary" onClick={goNext} disabled={step === 0 && !slotId} className="px-6">
              Next
            </Btn>
          )}
        </div>
      </div>
    </form>,
  );
}

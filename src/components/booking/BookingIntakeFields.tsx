"use client";

import { useEffect, useRef } from "react";
import { Field, Select, TextArea, TextInput } from "@/components/ui/form";
import { PhoneField } from "@/components/ui/PhoneField";
import { INDUSTRY_SUGGESTIONS, INTAKE_OPTIONS } from "@/lib/booking-intake";
import { CONSENT_LABEL, CONSENT_VALUE } from "@/lib/consent";

/**
 * The discovery-call questionnaire — everything `submitBooking` reads except `slotId`.
 *
 * ── Why this is its own component ───────────────────────────────────────────────
 * Two surfaces now collect it: the standalone `/book` page and the `booking` block embedded in a
 * funnel step. These fields are not decoration — every `Select` name here maps to a BANT answer
 * that `scoreLeadAtOptIn` reads and the SOP routes on. Two copies would drift, and the drift would
 * present as "leads booked from the funnel score differently to leads booked from /book", which is
 * close to impossible to spot from the outside.
 *
 * It renders the fields ONLY — no <form>, no submit button. The caller owns the form element and
 * the action, because the two surfaces frame the submit differently.
 */

const withPlaceholder = (opts: readonly { value: string; label: string }[], placeholder: string) => [
  { value: "", label: placeholder },
  ...opts,
];

export function BookingIntakeFields({ headings = true }: { headings?: boolean }) {
  const utmRef = useRef<HTMLInputElement>(null);

  // Carry the landing URL's attribution onto the lead. Read here rather than passed in, because
  // the funnel step and /book both arrive with their own query string.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const utm: Record<string, string> = {};
    // An explicit whitelist, not a `utm_*` prefix match: this string is stored on the lead, and a
    // prefix rule would let anyone stuff arbitrary keys into it from the query string.
    for (const k of ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "gclid", "fbclid"]) {
      const v = p.get(k);
      if (v) utm[k] = v;
    }
    if (utmRef.current) utmRef.current.value = Object.keys(utm).length ? JSON.stringify(utm) : "";
  }, []);

  return (
    <>
      <section>
        {headings && <h2 className="font-display text-h3 font-semibold text-ink">Enter details</h2>}
        {/*
          ── One column, and this exact order ─────────────────────────────────────────
          Both are load-bearing, not styling preferences. The order is Synamate's, and it is a
          qualification ladder: identity first, then credentials, then motivation, then the
          commercial questions (salary, readiness to invest, who decides) last — asked only
          after the prospect has already invested effort in the form. Re-sorting it into a
          tidy two-column grid, as this form previously was, puts "what do you earn?" beside
          "what is your name?" and measurably costs completions.
        */}
        <div className="mt-3 grid grid-cols-1 gap-4">
          <Field label="Full Name" required>
            <TextInput kind="name" name="name" required placeholder="Enter your full name" />
          </Field>
          <Field label="Email" required>
            <TextInput kind="email" name="email" required placeholder="Enter your email address" />
          </Field>
          {/*
            One number, bound to `phone`. The form asks for WhatsApp because that is the channel
            the confirmation and every reminder actually go out on — and `phone` is the column
            WATI sends to. A second "WhatsApp (if different)" field existed before and was the
            kind of optional duplicate that ends up holding the only reachable number.
          */}
          <Field label="WhatsApp Number" required hint="Pick your country, then type your number">
            <PhoneField name="phone" required placeholder="Enter your WhatsApp number" />
          </Field>
          <Field label="LinkedIn Profile URL" required>
            <TextInput kind="url" name="linkedInProfile" required placeholder="Please paste your LinkedIn URL here" />
          </Field>
          <Field label="Highest educational qualification" required>
            <Select name="highestEducation" required options={withPlaceholder(INTAKE_OPTIONS.highestEducation, "Select…")} defaultValue="" />
          </Field>
          {/* Job title / industry stay unfiltered: "Engineer II", "Industry 4.0" are real answers. */}
          <Field label="Current Job Title" required>
            <TextInput
              kind="text"
              maxLength={160}
              name="currentJobTitle"
              required
              placeholder="(e.g. Java Developer, QA Engineer, Data Analyst, Design Engineer)"
            />
          </Field>
          <Field label="How many years of professional experience do you have?" required>
            <Select name="yearsExperience" required options={withPlaceholder(INTAKE_OPTIONS.yearsExperience, "Select…")} defaultValue="" />
          </Field>
          {/*
            A combobox, not a select: the source form offers two industries and lets a prospect
            type their own ("Press enter to add custom option"). A closed list would force a
            chemical engineer to answer "IT Related", which is worse than free text for the
            person reading it back on the call.
          */}
          <Field label="What industry do you work in?" required hint="Pick one, or type your own">
            <TextInput
              kind="text"
              maxLength={160}
              name="prospectIndustry"
              required
              list="industry-suggestions"
              placeholder="IT Related"
            />
            <datalist id="industry-suggestions">
              {INDUSTRY_SUGGESTIONS.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </Field>
          <Field
            label="Why do you want to work in Germany? What is pushing you to make this move now?"
            required
            hint="(We work only with those who have a clear purpose for moving to Germany. Please write in 2–4 sentences. Be specific about your pain or vision.)"
          >
            <TextArea kind="text" name="whyGermany" required />
          </Field>
          <Field label="Have you already started applying for jobs in Germany?" required>
            <Select name="alreadyApplied" required options={withPlaceholder(INTAKE_OPTIONS.alreadyApplied, "Select…")} defaultValue="" />
          </Field>
          <Field label="When do you ideally want to start working in Germany?" required>
            <Select name="whenStartGermany" required options={withPlaceholder(INTAKE_OPTIONS.whenStartGermany, "Select…")} defaultValue="" />
          </Field>
          <Field label="Do you currently hold an Opportunity Card or any German visa?" required>
            <Select name="germanVisa" required options={withPlaceholder(INTAKE_OPTIONS.germanVisa, "Select…")} defaultValue="" />
          </Field>
          <Field label="What is your current level of German proficiency?" required>
            <Select name="germanLevel" required options={withPlaceholder(INTAKE_OPTIONS.germanLevel, "Select…")} defaultValue="" />
          </Field>
          <Field label="Are you ready to learn German language to enhance your career opportunities in Germany?" required>
            <Select name="willingnessLearnGerman" required options={withPlaceholder(INTAKE_OPTIONS.willingnessLearnGerman, "Select…")} defaultValue="" />
          </Field>
          <Field label="What is your current monthly salary (in INR)?" required>
            <Select name="currentIncome" required options={withPlaceholder(INTAKE_OPTIONS.currentIncome, "Select…")} defaultValue="" />
          </Field>
          <Field label="If the roadmap is right for you, how prepared are you to invest in your professional development?" required>
            <Select name="readyToInvest" required options={withPlaceholder(INTAKE_OPTIONS.readyToInvest, "Select…")} defaultValue="" />
          </Field>
          <Field label="Who makes financial decisions related to your career?" required>
            <Select name="decisionMaking" required options={withPlaceholder(INTAKE_OPTIONS.decisionMaking, "Select…")} defaultValue="" />
          </Field>
          <Field label="Where did you hear about us?" required>
            <Select name="howKnowUs" required options={withPlaceholder(INTAKE_OPTIONS.howKnowUs, "Select…")} defaultValue="" />
          </Field>
        </div>
        <p className="mt-3 text-caption text-muted">
          By sharing your number you agree to receive your booking confirmation and call reminders on
          WhatsApp. Reply <strong>STOP</strong> anytime to opt out.
        </p>
      </section>

      {/* honeypot — hidden from real users; bots fill it and get silently dropped */}
      <input
        type="text"
        name="company_website"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        className="absolute left-[-9999px] h-0 w-0 opacity-0"
      />
      <input type="hidden" name="utm" ref={utmRef} defaultValue="" />

      {/*
        GDPR consent (spec §15). `required` gives the prospect an instant browser-native message
        instead of a server round-trip, but it is only a courtesy — submitBooking refuses
        unconsented submissions regardless, since a client-side attribute is not a compliance control.
      */}
      <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-subtle bg-surface p-4 text-sm">
        <input
          type="checkbox"
          name="consent"
          value={CONSENT_VALUE}
          required
          className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--primary)]"
        />
        <span className="text-muted">{CONSENT_LABEL}</span>
      </label>
    </>
  );
}

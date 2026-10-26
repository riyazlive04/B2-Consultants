"use client";

import { useState } from "react";
import { CalendarCheck, MailCheck } from "lucide-react";
import { Field, FormError, SubmitButton, TextArea, TextInput } from "@/components/ui/form";
import { PhoneField } from "@/components/ui/PhoneField";
import { CONSENT_LABEL_NO_SLOTS, CONSENT_VALUE } from "@/lib/consent";
import { submitNoSlotsInterest } from "@/server/booking-actions";
import { safeAction } from "@/lib/action-guard";

/**
 * WHAT /book SHOWS WHEN THE CALENDAR IS EMPTY  (issue A6)
 *
 * ── The dead end this replaces ──────────────────────────────────────────────────────────
 * The empty state was one honest sentence - "No call times are open right now, please check back
 * shortly" - and nothing else. It is the ONLY dead end in the whole app whose victim cannot be
 * told to ask an admin: a stranger who clicked a paid ad, is ready to talk to us, and leaves
 * with no `Lead` row created at all. `server/not-armed.ts` records exactly this on production
 * ("no availability pattern → 0 slots, 0 bookings, an empty public /book calendar") and calls it
 * the entirety of "the booking section feels broken".
 *
 * Arming availability is the real fix. This is the safety net for every future lapse, and it is
 * deliberately cheap: four fields, one of which is optional, on a screen that has just
 * apologised. A full questionnaire here would convert worse than the dead end it replaces.
 *
 * ── What it deliberately does NOT do ────────────────────────────────────────────────────
 * It claims no slot and promises no time. The copy says we will be in touch when one opens,
 * because that is all the server does - `submitNoSlotsInterest` writes a lead at
 * DISCO_NOT_BOOKED and nothing else. Offering "we'll book you into the next free slot" would be
 * committing a prospect to a time they never saw.
 *
 * The questions are NOT the BANT ladder from `BookingIntakeFields`. That indirection exists so
 * /book, the funnel block and the per-person calendar score identically - and this form scores
 * nothing, because an unscored lead on a chase list is honest while a lead scored from four
 * fields would read as qualified on evidence nobody gathered. Scoring happens when they book.
 */
export function NoSlotsCapture() {
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (done) {
    return (
      <div className="py-8 text-center">
        <MailCheck className="mx-auto text-primary" size={40} />
        <h2 className="mt-3 font-display text-h2">Thanks - you&apos;re on the list</h2>
        <p className="mx-auto mt-2 max-w-sm text-sm text-muted">
          We&apos;ll be in touch as soon as a discovery call time opens up. No call has been
          scheduled yet.
        </p>
      </div>
    );
  }

  const submit = async (form: FormData) => {
    setError(null);
    const res = await safeAction(() => submitNoSlotsInterest(form));
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setDone(true);
  };

  return (
    <div className="py-4">
      <div className="text-center">
        <CalendarCheck className="mx-auto text-muted" size={36} />
        <h2 className="mt-3 font-display text-h2">No call times are open right now</h2>
        <p className="mx-auto mt-2 max-w-sm text-sm text-muted">
          We release new slots regularly. Leave your details and we&apos;ll come to you the moment
          one opens - you won&apos;t need to keep checking.
        </p>
      </div>

      <form action={submit} className="mx-auto mt-6 flex max-w-sm flex-col gap-4">
        <Field label="Full name" required>
          <TextInput name="name" kind="name" required autoComplete="name" placeholder="e.g. Sana Kapoor" />
        </Field>

        {/* Required, and the server agrees: a lead nobody can call is a record that we lost one,
            not a lead we saved. See `noSlotsSchema`. */}
        <Field label="WhatsApp number" required hint="This is how we'll reach you.">
          <PhoneField name="phone" required />
        </Field>

        <Field label="Email" hint="Optional - but it gives us a second way to reach you.">
          <TextInput name="email" kind="email" type="email" autoComplete="email" placeholder="you@email.com" />
        </Field>

        <Field label="Anything we should know?" hint="Optional.">
          <TextArea name="note" kind="text" placeholder="e.g. Evenings IST work best for me" />
        </Field>

        {/* Same shape as the booking form's consent, with its OWN wording - this person is
            agreeing to be contacted when a slot opens, not to a call they just booked. The
            `required` attribute is a courtesy; the server refuses an unconsented submission
            regardless, because a client-side attribute is not a compliance control. */}
        <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-subtle bg-surface p-4 text-sm">
          <input
            type="checkbox"
            name="consent"
            value={CONSENT_VALUE}
            required
            className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--primary)]"
          />
          <span className="text-muted">{CONSENT_LABEL_NO_SLOTS}</span>
        </label>

        <FormError message={error} />

        <SubmitButton tone="action">Tell me when a slot opens</SubmitButton>
      </form>
    </div>
  );
}

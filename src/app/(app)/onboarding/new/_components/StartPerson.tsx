"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Search, UserPlus } from "lucide-react";
import { Btn } from "@/components/ui/controls";
import { Field, FormError, Select, SubmitButton, TextInput } from "@/components/ui/form";
import { PhoneField } from "@/components/ui/PhoneField";
import { Card, CardTitle } from "@/components/ui/kit";
import { toast } from "@/components/ui/feedback";
import { safeAction } from "@/lib/action-guard";
import { createContact } from "@/server/contacts-actions";

/**
 * STEP ONE OF THE WIZARD: WHO IS THIS?
 *
 * ── Why the journey starts with a contact and not a student ─────────────────────────────
 * Because that is the order the money arrives in. A student record is created once somebody has
 * agreed to pay - before that they are a lead, and a `Student` row with no enrolment, no cohort
 * and no payment is the half-built record the "Needs completing" tab exists to find. Six screens
 * could mint one; this is the one door that starts people where they actually start.
 *
 * ── The same source list as the Contacts form, not a new one ────────────────────────────
 * `createContact` validates `leadSource` against a nine-value enum in contacts-actions.ts. A
 * shorter list here would have been a wizard that silently refused "Summit" - so these are the
 * nine, spelled the way the Contacts form spells them.
 */

const SOURCE_OPTS = [
  { value: "INSTAGRAM", label: "Instagram" },
  { value: "YOUTUBE", label: "YouTube" },
  { value: "LINKEDIN", label: "LinkedIn" },
  { value: "WHATSAPP", label: "WhatsApp" },
  { value: "REFERRAL", label: "Referral" },
  { value: "SUMMIT", label: "Summit" },
  { value: "WORKSHOP", label: "Workshop" },
  { value: "GHOSTED_BLUEPRINT", label: "Ghosted Blueprint" },
  { value: "OTHER", label: "Other" },
];

export function StartPerson() {
  const router = useRouter();
  const form = useRef<HTMLFormElement>(null);
  const [error, setError] = useState<string | null>(null);

  async function add(fd: FormData) {
    setError(null);
    const res = await safeAction(() => createContact(fd));
    if (!res.ok) return setError(res.error);
    toast("Added - here is what comes next");
    /*
      Straight on to their own journey. `createContact` returns the new id for exactly this, and
      the id is what makes the wizard resumable: every later step is derived from the record, so
      this URL is the whole of the saved progress. Closing the tab here loses nothing.
    */
    if (res.id) router.push(`/onboarding/new?lead=${res.id}`);
    else router.push("/onboarding");
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
      <Card title={<CardTitle icon={<UserPlus size={17} />}>Who is this?</CardTitle>} subtitle="Name and a phone number are enough to start. Everything else can wait.">
        <form action={add} ref={form} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Name">
              <TextInput kind="name" name="name" required placeholder="Full name" />
            </Field>
            <Field label="Phone / WhatsApp" hint="How we reach them - and how duplicates are spotted.">
              <PhoneField name="phone" required />
            </Field>
            <Field label="Email">
              <TextInput kind="email" name="email" placeholder="name@example.com" />
            </Field>
            <Field label="Where did they come from?">
              <Select name="leadSource" options={SOURCE_OPTS} defaultValue="OTHER" />
            </Field>
            <Field label="City">
              <TextInput kind="city" name="city" placeholder="City" />
            </Field>
            <Field label="Industry">
              <TextInput name="industry" placeholder="Industry" />
            </Field>
          </div>
          <FormError message={error} />
          <div className="flex justify-end">
            <SubmitButton>Add and show me what&apos;s next</SubmitButton>
          </div>
        </form>
      </Card>

      <Card
        title={<CardTitle icon={<Search size={17} />}>Already in the app?</CardTitle>}
        subtitle="Pick up where somebody left off instead of starting again."
      >
        <p className="text-body text-ink-2">
          Everyone part-way through is on the onboarding board, grouped by the step they have
          reached. Open anyone there to carry on from the same journey this wizard shows.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link
            href="/onboarding"
            className="inline-flex h-10 items-center rounded-btn bg-primary px-4 text-sm font-semibold text-on-accent hover:bg-primary-strong"
          >
            Open the onboarding board
          </Link>
          <Link href="/contacts">
            <Btn variant="soft">Search contacts</Btn>
          </Link>
        </div>
        {/*
          The duplicate guard lives in `createContact` and matches on phone or email, so re-typing
          somebody who exists is refused with their name rather than silently forking the person
          into two records. Saying so here means the refusal is expected rather than confusing.
        */}
        <p className="mt-4 text-caption text-muted">
          Typing somebody who already exists is refused, not duplicated - the phone number and
          email are both checked.
        </p>
      </Card>
    </div>
  );
}

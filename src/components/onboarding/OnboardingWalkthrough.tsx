"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/Modal";
import { SECTION_CATALOGUE, type AppRole, type SectionKey } from "@/lib/sections";
import { GUIDES } from "@/lib/guide-content";

/**
 * Post-invite first-touch tour (BUILD_CHECKLIST §1). Shows ONCE, right after a newly
 * accepted invite lands on their landing page (Home for ADMIN/HEAD/USER, or wherever
 * STUDENT/TUTOR get redirected to — see each page's `initialOpen` wiring).
 *
 * "Shown once" marker: localStorage, keyed by user id — NOT User.sectionAccess /
 * User.capabilities. Both of those Json? fields get wholesale-overwritten any time an
 * Admin edits or resets a user's access (see `overridesFor` in
 * src/server/users-actions.ts, which rebuilds the whole object from the access form
 * every save, and `resetUserAccess`, which nulls it outright) — an extra key stashed
 * there would silently vanish the next time access is touched, un-dismissing the tour
 * for someone who already saw it. localStorage has no such write path to collide with.
 */

const ROLE_COPY: Record<AppRole, { title: string; blurb: string }> = {
  ADMIN: {
    title: "Founder / Admin",
    blurb: "You hold every module here — finance, pipeline, people and the founder console.",
  },
  HEAD: {
    title: "Head coach",
    blurb: "You run delivery: student journeys, pipeline visibility, and your own daily log.",
  },
  USER: {
    title: "Telecaller",
    blurb: "You run outreach: the telecaller board, contacts, and your own daily log.",
  },
  STUDENT: {
    title: "Student",
    blurb: "This is your own journey — milestones, class recordings and the community.",
  },
  TUTOR: {
    title: "Tutor",
    blurb: "This is your German Note home — your batches, recordings and the community.",
  },
};

function onboardingKey(userId: string): string {
  return `b2-onboarded-${userId}`;
}

export function OnboardingWalkthrough({
  userId,
  role,
  firstName,
  initialOpen,
}: {
  userId: string;
  role: AppRole;
  firstName: string;
  initialOpen: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (!initialOpen) return;
    try {
      if (window.localStorage.getItem(onboardingKey(userId))) return;
      window.localStorage.setItem(onboardingKey(userId), new Date().toISOString());
    } catch {
      // localStorage unavailable (private mode, disabled storage, etc.) — still show
      // it for this load; there's just no durable "seen it" record to rely on next time.
    }
    setOpen(true);
    // Scrub ?onboarding=1 so a refresh or back-navigation doesn't reopen it.
    router.replace(window.location.pathname, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialOpen, userId]);

  const sections = useMemo(
    () =>
      SECTION_CATALOGUE.filter((s) => {
        // Same idiom sections.ts's own resolveSections() uses: only the `console`
        // entry carries `locked`, so the union type doesn't have the key on the rest.
        const locked = "locked" in s && s.locked === true;
        return !locked && s.key !== "guide" && (s.roles as readonly AppRole[]).includes(role);
      }).slice(0, 4),
    [role],
  );

  const guideFor = (key: SectionKey) => GUIDES.find((g) => g.section === key);
  const copy = ROLE_COPY[role];
  const close = () => setOpen(false);

  const steps = [
    {
      title: `Welcome, ${firstName}`,
      body: (
        <p className="text-sm text-muted">
          You&apos;re in as <b className="text-ink">{copy.title}</b>. {copy.blurb} Here&apos;s a
          sixty-second tour before you dive in.
        </p>
      ),
    },
    {
      title: "What you can do here",
      body:
        sections.length === 0 ? (
          <p className="text-sm text-muted">
            Your admin hasn&apos;t turned on any modules for your role yet — check back soon.
          </p>
        ) : (
          <ul className="space-y-2.5 text-sm">
            {sections.map((s) => {
              const g = guideFor(s.key);
              return (
                <li key={s.key} className="rounded-field border border-line bg-surface-2 p-3">
                  <p className="font-semibold text-ink">{s.label}</p>
                  <p className="mt-0.5 text-caption text-muted">{g?.what ?? `Find it at ${s.href}`}</p>
                </li>
              );
            })}
          </ul>
        ),
    },
    {
      title: "Where to start",
      body: (
        <div className="space-y-3 text-sm">
          <p className="text-muted">
            Every feature you can open has a short how-to in the App Guide — find it any time from
            the sidebar.
          </p>
          {sections[0] && (
            <a
              href={sections[0].href}
              className="inline-flex h-10 items-center rounded-btn bg-primary px-4 text-sm font-semibold text-on-accent hover:bg-primary-strong"
            >
              Take me to {sections[0].label}
            </a>
          )}
        </div>
      ),
    },
  ];

  const last = step === steps.length - 1;

  return (
    <Modal open={open} onClose={close} title={steps[step].title} size="sm">
      {steps[step].body}
      <div className="mt-5 flex items-center justify-between">
        <button type="button" onClick={close} className="text-sm font-medium text-muted hover:text-ink">
          Skip
        </button>
        <div className="flex items-center gap-2">
          {step > 0 && (
            <button
              type="button"
              onClick={() => setStep((s) => s - 1)}
              className="rounded-btn border border-line px-3 py-2 text-sm font-medium hover:bg-surface-2"
            >
              Back
            </button>
          )}
          <button
            type="button"
            onClick={() => (last ? close() : setStep((s) => s + 1))}
            className="rounded-btn bg-primary px-4 py-2 text-sm font-semibold text-on-accent hover:bg-primary-strong"
          >
            {last ? "Get started" : "Next"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

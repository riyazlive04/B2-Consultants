import Link from "next/link";
import { BookOpen, Route } from "lucide-react";
import { GUIDES, GUIDE_JOURNEYS } from "@/lib/guide-content";
import { PageHeader, SectionHeading } from "@/components/ui/kit";
import { requireSection, visibleSections } from "@/lib/rbac";
import { GuidePath } from "./_components/GuidePath";
import { GuideShotFigure } from "./_components/GuideShotFigure";

/** Its own name in the browser tab, rather than sharing one title with every other page
 *  (issue 28). The root layout adds the "· B2 Consultants" suffix. */
export const metadata = { title: "Guide" };

export const dynamic = "force-dynamic";

/**
 * App Guide - short how-tos, filtered to the features this user can actually open.
 *
 * ── Two kinds of guide, because there were two kinds of question ────────────────────────
 * The per-section entries answer "what does this screen do". They were the whole guide, and they
 * could not answer the question people actually arrive with - "how do I onboard a student" -
 * because that job crosses seven screens in five nav groups. So the walkthroughs come FIRST on
 * the page: a reader who does not know the app needs the shape of the job before the detail of
 * any one screen.
 *
 * Walkthroughs are filtered by ROLE rather than by section, because they span sections - a
 * telecaller should read the onboarding journey even though several of its steps happen on
 * screens they cannot open, since knowing where their part ends is the point.
 */
export default async function GuidePage() {
  const session = await requireSection("guide");
  const accessible = new Set((await visibleSections(session.role, session.overrides)).map((s) => s.key));
  const visible = GUIDES.filter((g) => g.section === "general" || accessible.has(g.section));
  const journeys = GUIDE_JOURNEYS.filter((j) => j.forRoles.includes(session.role));

  return (
    <div className="w-full space-y-8">
      <PageHeader
        icon={<BookOpen size={20} />}
        title="App Guide"
        subtitle="How to get things done, step by step. You only see guides for features you have access to."
      />

      {journeys.length > 0 && (
        <section className="space-y-4">
          <SectionHeading
            icon={<Route size={18} />}
            title="Start to finish"
            description="Jobs that cross several screens. Each step says where to go before it says what to do."
          />
          <div className="space-y-6">
            {journeys.map((j) => (
              <article key={j.key} className="rounded-card border border-line bg-surface p-5 shadow-card">
                <h2 className="font-display text-xl font-semibold text-ink">{j.title}</h2>
                <p className="mt-1 max-w-3xl text-sm text-ink-2">{j.summary}</p>
                <ol className="mt-4 space-y-4">
                  {j.steps.map((s) => (
                    <li key={s.n} className="flex gap-3">
                      <span
                        aria-hidden
                        className="mt-0.5 grid size-6 flex-none place-items-center rounded-full bg-primary-soft text-caption font-bold text-primary-strong"
                      >
                        {s.n}
                      </span>
                      <div className="min-w-0 flex-1 space-y-1.5">
                        <p className="font-medium text-ink">
                          <span className="sr-only">Step {s.n}: </span>
                          {s.title}
                        </p>
                        <GuidePath path={s.where} />
                        <p className="text-sm text-ink-2">{s.does}</p>
                        {s.shot && <GuideShotFigure shot={s.shot} />}
                      </div>
                    </li>
                  ))}
                </ol>
              </article>
            ))}
          </div>
        </section>
      )}

      <section className="space-y-4">
        <SectionHeading
          icon={<BookOpen size={18} />}
          title="Screen by screen"
          description="What each part of the app is for, in thirty seconds."
        />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {visible.map((g) => (
            <section key={g.title} className="flex flex-col rounded-card border border-line bg-surface p-5 shadow-card">
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-display text-xl font-semibold">
                  <span aria-hidden className="mr-1.5">{g.icon}</span>
                  {g.title}
                </h3>
                <Link
                  href={g.href}
                  className="whitespace-nowrap rounded-field border border-line px-3 py-1 text-sm font-medium text-accent hover:bg-surface-2"
                >
                  Open →
                </Link>
              </div>
              <p className="mt-1 text-sm text-muted">{g.what}</p>
              {g.path && (
                <div className="mt-2">
                  <GuidePath path={g.path} />
                </div>
              )}
              <ol className="mt-3 flex-1 list-decimal space-y-1.5 pl-5 text-sm">
                {g.steps.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ol>
              {g.shots && g.shots.length > 0 && (
                <div className="mt-3 space-y-3">
                  {g.shots.map((shot) => (
                    <GuideShotFigure key={shot.src} shot={shot} />
                  ))}
                </div>
              )}
              {g.tip && (
                <p className="mt-3 rounded-field bg-accent-soft px-3 py-2 text-xs text-accent">
                  <strong>Tip:</strong> {g.tip}
                </p>
              )}
            </section>
          ))}
        </div>
      </section>
    </div>
  );
}

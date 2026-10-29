import Link from "next/link";
import { BookOpen, Map as MapIcon, Route } from "lucide-react";
import { GUIDES, GUIDE_JOURNEYS } from "@/lib/guide-content";
import { manualFor } from "@/lib/guide/manual";
import { PageHeader, SectionHeading } from "@/components/ui/kit";
import { requireSection, visibleSections } from "@/lib/rbac";
import { GuideDirectory, type DirectoryGroup } from "./_components/GuideDirectory";
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
 *
 * ── The manuals sit ABOVE the walkthroughs now ───────────────────────────────────────────
 * Each section has a full manual at /guide/<section>: every tab, the logic behind it, and where
 * that logic is changed. The thirty-second cards that used to fill the bottom of this page moved
 * onto the top of each manual, so this page is an index - grouped like the sidebar, with one
 * search across every manual - and it is short enough that the walkthroughs below it are still
 * one scroll away. The index comes first because it is what a returning reader came for; a new
 * starter is pointed at the walkthroughs by the line under the search box.
 */
export default async function GuidePage() {
  const session = await requireSection("guide");
  const general = GUIDES.filter((g) => g.section === "general");
  const journeys = GUIDE_JOURNEYS.filter((j) => j.forRoles.includes(session.role));

  // The directory, grouped and ordered exactly as this person's sidebar is. Off-rail sections
  // (Outreach) are included: they are reachable, so they need a manual as much as anything listed.
  const groups: DirectoryGroup[] = [];
  for (const s of await visibleSections(session.role, session.overrides)) {
    if (s.key === "my-journey" && session.role !== "STUDENT") continue;
    const manual = manualFor(s.key);
    if (!manual) continue;
    const quick = GUIDES.find((g) => g.section === s.key);
    let g = groups.find((x) => x.group === s.group);
    if (!g) groups.push((g = { group: s.group, sections: [] }));
    g.sections.push({
      key: s.key,
      label: s.label,
      icon: s.icon,
      what: quick?.what ?? manual.overview,
      features: manual.features.map((f) => ({
        id: f.id,
        name: f.name,
        text: [f.what, ...f.use, ...f.logic, ...(f.controls ?? []).map((c) => c.setting)].join(" "),
      })),
    });
  }

  return (
    <div className="w-full space-y-8">
      <PageHeader
        icon={<BookOpen size={20} />}
        title="App Guide"
        subtitle="Every screen you can open: how to use each part of it, the logic behind it, and where to change that logic. Grouped the same way as your sidebar."
        actions={
          session.role === "ADMIN" ? (
            <Link
              href="/guide/rules"
              className="inline-flex h-10 items-center gap-1.5 rounded-btn border border-line px-3 text-sm font-medium text-ink-2 hover:bg-surface-2"
            >
              <MapIcon size={15} aria-hidden /> Rules map
            </Link>
          ) : undefined
        }
      />

      <GuideDirectory groups={groups} />
      {journeys.length > 0 && (
        <p className="text-sm text-muted">
          New here? Start with the{" "}
          <a href="#start-to-finish" className="font-medium text-accent hover:underline">
            start-to-finish walkthroughs
          </a>{" "}
          below - they show how the screens fit together before you read any one of them.
        </p>
      )}

      {journeys.length > 0 && (
        <section id="start-to-finish" className="scroll-mt-24 space-y-4">
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

      {general.length > 0 && (
        <section className="space-y-4">
          <SectionHeading
            icon={<BookOpen size={18} />}
            title="Everywhere in the app"
            description="Things that are not one screen, so they have no manual of their own."
          />
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {general.map((g) => (
              <section key={g.title} className="flex flex-col rounded-card border border-line bg-surface p-5 shadow-card">
                <h3 className="font-display text-xl font-semibold">
                  <span aria-hidden className="mr-1.5">{g.icon}</span>
                  {g.title}
                </h3>
                <p className="mt-1 text-sm text-muted">{g.what}</p>
                <ol className="mt-3 flex-1 list-decimal space-y-1.5 pl-5 text-sm">
                  {g.steps.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ol>
                {g.tip && (
                  <p className="mt-3 rounded-field bg-accent-soft px-3 py-2 text-xs text-accent">
                    <strong>Tip:</strong> {g.tip}
                  </p>
                )}
              </section>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

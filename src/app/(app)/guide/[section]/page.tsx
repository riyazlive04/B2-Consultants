import Link from "next/link";
import { notFound } from "next/navigation";
import { BookOpen, HelpCircle, Link2, Map as MapIcon, Power } from "lucide-react";
import { GUIDES } from "@/lib/guide-content";
import { manualFor } from "@/lib/guide/manual";
import { consoleHref } from "@/lib/guide/manual-types";
import { SECTION_CATALOGUE, type SectionKey } from "@/lib/sections";
import { requireSection, visibleSections } from "@/lib/rbac";
import { getNotArmedReport } from "@/server/not-armed";
import { Card, PageHeader, Pill } from "@/components/ui/kit";
import { FallbackIcon, SECTION_ICONS } from "@/components/shell/section-icons";
import { GuidePath } from "../_components/GuidePath";
import { ManualFeature } from "../_components/ManualFeature";

export const dynamic = "force-dynamic";

const isSectionKey = (k: string): k is SectionKey => SECTION_CATALOGUE.some((s) => s.key === k);

export async function generateMetadata({ params }: { params: { section: string } }) {
  const entry = SECTION_CATALOGUE.find((s) => s.key === params.section);
  return { title: entry ? `${entry.label} · Guide` : "Guide" };
}

/**
 * ONE SECTION'S MANUAL - every tab of the screen, how to use it, the logic behind it, and where
 * that logic is changed.
 *
 * ── Access is the screen's, not the guide's ─────────────────────────────────────────────
 * You can read the manual for a section only if you can open the section. The manual explains
 * how money is split and leads are routed; that is not a secret from the people who use those
 * screens, but there is no reason to hand the Finance logic to someone who will never see Finance.
 *
 * ── Live switches beside the text ───────────────────────────────────────────────────────
 * The single most common "this is broken" in this app is an engine that ships OFF. So the page
 * reads the same report as Console → System → Not armed and says, next to the manual, which of
 * this section's automations are actually running right now. Students never see this block:
 * there is nothing on it they can act on.
 */
export default async function SectionManualPage({ params }: { params: { section: string } }) {
  const session = await requireSection("guide");
  if (!isSectionKey(params.section)) notFound();
  const key = params.section;

  const accessible = await visibleSections(session.role, session.overrides);
  const section = accessible.find((s) => s.key === key);
  const manual = manualFor(key);
  if (!section || !manual) notFound();

  const hrefs = accessible.map((s) => s.href);
  const canOpen = (href: string) => {
    const path = href.split(/[?#]/)[0];
    return hrefs.some((h) => path === h || path.startsWith(`${h}/`));
  };

  const showEngines = session.role !== "STUDENT" && (manual.engines?.length ?? 0) > 0;
  const engines = showEngines
    ? (await getNotArmedReport()).filter((i) => manual.engines!.includes(i.key))
    : [];

  const quick = GUIDES.find((g) => g.section === key);
  const Icon = SECTION_ICONS[section.icon] ?? FallbackIcon;
  const related = (manual.related ?? []).filter((r) => accessible.some((s) => s.key === r.section));
  const labelOf = (k: SectionKey) => accessible.find((s) => s.key === k)?.label ?? k;

  return (
    <div className="w-full space-y-6">
      <PageHeader
        icon={<Icon size={20} />}
        back={{ href: "/guide", label: "App Guide" }}
        title={section.label}
        subtitle={manual.overview}
        actions={
          <>
            {session.role === "ADMIN" && (
              <Link
                href="/guide/rules"
                className="inline-flex h-10 items-center gap-1.5 rounded-btn border border-line px-3 text-sm font-medium text-ink-2 hover:bg-surface-2"
              >
                <MapIcon size={15} aria-hidden /> Rules map
              </Link>
            )}
            <Link
              href={section.href}
              className="inline-flex h-10 items-center rounded-btn bg-primary px-4 text-sm font-semibold text-on-accent hover:bg-primary-strong"
            >
              Open {section.label} →
            </Link>
          </>
        }
      />
      <GuidePath path={["Sidebar", section.group, section.label]} />

      <div className="grid gap-6 xl:grid-cols-[15rem_minmax(0,1fr)]">
        {/* On this page - sticky beside the manual on a wide screen, a plain list above it otherwise. */}
        <nav aria-label="On this page" className="xl:sticky xl:top-20 xl:self-start">
          <p className="text-label font-semibold uppercase text-ink-3">On this page</p>
          <ol className="mt-2 flex flex-wrap gap-1.5 xl:flex-col xl:gap-0.5">
            {quick && <TocLink href="#in-short" label="In thirty seconds" />}
            {engines.length > 0 && <TocLink href="#automations" label="Automations" />}
            {manual.features.map((f) => (
              <TocLink key={f.id} href={`#${f.id}`} label={f.name} />
            ))}
            {manual.faq && manual.faq.length > 0 && <TocLink href="#faq" label="Questions" />}
            {related.length > 0 && <TocLink href="#related" label="Related" />}
          </ol>
        </nav>

        <div className="min-w-0 space-y-6">
          {quick && (
            <Card title="In thirty seconds">
              <div id="in-short" className="scroll-mt-24">
                <p className="text-sm text-muted">{quick.what}</p>
                <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-sm text-ink-2">
                  {quick.steps.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ol>
                {quick.tip && (
                  <p className="mt-3 rounded-field bg-accent-soft px-3 py-2 text-xs text-accent">
                    <strong>Tip:</strong> {quick.tip}
                  </p>
                )}
              </div>
            </Card>
          )}

          {engines.length > 0 && (
            <Card
              title={
                <h2 id="automations" className="flex scroll-mt-24 items-center gap-2 font-display text-h3 text-ink">
                  <Power size={17} aria-hidden className="text-primary" /> Automations behind this screen
                </h2>
              }
              subtitle="Live right now. An automation that is off is not a bug - it is waiting to be switched on."
              actions={
                session.role === "ADMIN" ? (
                  <Link href={consoleHref("system", "not-armed")} className="text-sm font-medium text-accent hover:underline">
                    Console → Not armed →
                  </Link>
                ) : undefined
              }
            >
              <ul className="space-y-3">
                {engines.map((e) => (
                  <li key={e.key} className="flex flex-wrap items-start gap-3">
                    <Pill tone={e.armed ? "good" : "warn"}>{e.armed ? "On" : "Off"}</Pill>
                    <div className="min-w-0 flex-1 text-sm">
                      <p className="font-medium text-ink">{e.name}</p>
                      {!e.armed && (
                        <>
                          <p className="text-ink-2">While off: {e.consequence}</p>
                          <p className="text-ink-3">Switch it on: {e.where}</p>
                        </>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {manual.features.map((f) => (
            <ManualFeature key={f.id} feature={f} canOpen={canOpen} />
          ))}

          {manual.faq && manual.faq.length > 0 && (
            <Card
              title={
                <h2 id="faq" className="flex scroll-mt-24 items-center gap-2 font-display text-h3 text-ink">
                  <HelpCircle size={17} aria-hidden className="text-primary" /> Questions people ask
                </h2>
              }
            >
              <div className="divide-y divide-line">
                {manual.faq.map((q) => (
                  <details key={q.q} className="group py-3 first:pt-0 last:pb-0">
                    <summary className="cursor-pointer list-none font-medium text-ink marker:hidden">
                      <span className="mr-2 inline-block text-ink-3 transition-transform group-open:rotate-90" aria-hidden>
                        ›
                      </span>
                      {q.q}
                    </summary>
                    <p className="mt-2 pl-5 text-sm text-ink-2">{q.a}</p>
                  </details>
                ))}
              </div>
            </Card>
          )}

          {related.length > 0 && (
            <Card
              title={
                <h2 id="related" className="flex scroll-mt-24 items-center gap-2 font-display text-h3 text-ink">
                  <Link2 size={17} aria-hidden className="text-primary" /> Related sections
                </h2>
              }
            >
              <ul className="grid gap-3 sm:grid-cols-2">
                {related.map((r) => (
                  <li key={r.section}>
                    <Link
                      href={`/guide/${r.section}`}
                      className="block h-full rounded-field border border-line p-3 transition-colors hover:bg-surface-2"
                    >
                      <span className="flex items-center gap-1.5 font-medium text-ink">
                        <BookOpen size={14} aria-hidden className="text-primary" /> {labelOf(r.section)}
                      </span>
                      <span className="mt-1 block text-sm text-ink-2">{r.why}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function TocLink({ href, label }: { href: string; label: string }) {
  return (
    <li>
      <a
        href={href}
        className="block rounded-field px-2 py-1 text-sm text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink max-xl:border max-xl:border-line"
      >
        {label}
      </a>
    </li>
  );
}

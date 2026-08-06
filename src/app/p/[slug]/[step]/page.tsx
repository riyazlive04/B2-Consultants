import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { VISITOR_COOKIE } from "@/lib/ab";
import { getPublicStep, recordStepView } from "@/server/funnels-metrics";
import SiteBlocks from "@/components/sites/SiteBlocks";

export const dynamic = "force-dynamic";

/** The opaque id middleware stamped on this visitor. Absent for a client that refuses cookies. */
function visitorId(): string | null {
  return cookies().get(VISITOR_COOKIE)?.value ?? null;
}

export async function generateMetadata({ params }: { params: { slug: string; step: string } }): Promise<Metadata> {
  // Assignment is pure, so this second call cannot disagree with the one in the body below about
  // which variant is being shown — the title always describes the page that ships.
  const data = await getPublicStep(params.slug, params.step, visitorId());
  if (!data) return { title: "Not found" };
  return {
    title: data.step.seoTitle || `${data.funnelName} — ${data.step.name}`,
    description: data.step.seoDescription ?? undefined,
  };
}

function pickUtm(sp: Record<string, string | string[] | undefined>): Record<string, string> {
  const utm: Record<string, string> = {};
  for (const k of ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"]) {
    const v = sp[k];
    if (typeof v === "string" && v) utm[k] = v;
  }
  return utm;
}

export default async function FunnelStepPage({
  params,
  searchParams,
}: {
  params: { slug: string; step: string };
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const data = await getPublicStep(params.slug, params.step, visitorId());
  if (!data) notFound();
  // `step.id` is the arm that was actually chosen, so a split test counts per variant without
  // anything here knowing a test is running.
  await recordStepView(data.step.id);

  const utm = pickUtm(searchParams);

  return (
    // No width cap here any more: `SiteBlocks` decides. A section band is full-bleed and brings
    // its own inner measure, while a page authored before the node model keeps the old narrow
    // column. Capping here would have made every band a 42rem stripe in the middle of the screen.
    // `overflow-x-clip` is the guard against a wide child (a pasted Custom HTML embed) turning
    // into a horizontal scrollbar across the whole page.
    <main className="min-h-screen overflow-x-clip bg-app">
      {/* The funnel's global chrome. Rendered by the same component as the body, from the same
          block model — a header is a page fragment, not a second kind of thing, so it gets full-
          bleed bands and embedded forms for free. Empty arrays render nothing at all. */}
      {data.header.length > 0 && (
        <header>
          <SiteBlocks blocks={data.header} forms={data.forms} utm={utm} />
        </header>
      )}

      <SiteBlocks blocks={data.step.blocks} forms={data.forms} utm={utm} />

      {data.footer.length > 0 ? (
        <footer>
          <SiteBlocks blocks={data.footer} forms={data.forms} utm={utm} />
        </footer>
      ) : (
        // The default sign-off, shown only when the funnel has not been given a footer of its
        // own. A funnel that authored one does not want ours underneath it.
        <p className="px-4 py-12 text-center text-caption text-ink-3">Powered by B2 Consultants</p>
      )}
    </main>
  );
}

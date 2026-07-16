import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPublicStep, recordStepView } from "@/server/funnels-metrics";
import SiteBlocks from "@/components/sites/SiteBlocks";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: { slug: string; step: string } }): Promise<Metadata> {
  const data = await getPublicStep(params.slug, params.step);
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
  const data = await getPublicStep(params.slug, params.step);
  if (!data) notFound();
  await recordStepView(data.step.id);

  return (
    <main className="min-h-screen bg-app px-4 py-14">
      <div className="mx-auto max-w-2xl">
        <SiteBlocks blocks={data.step.blocks} forms={data.forms} utm={pickUtm(searchParams)} />
        <p className="mt-12 text-center text-caption text-ink-3">Powered by B2 Consultants</p>
      </div>
    </main>
  );
}

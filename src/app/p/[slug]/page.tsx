import { notFound, redirect } from "next/navigation";
import { getPublicFunnelFirstStep } from "@/server/funnels-metrics";

export const dynamic = "force-dynamic";

export default async function FunnelIndex({ params }: { params: { slug: string } }) {
  const firstStep = await getPublicFunnelFirstStep(params.slug);
  if (!firstStep) notFound();
  redirect(`/p/${params.slug}/${firstStep}`);
}

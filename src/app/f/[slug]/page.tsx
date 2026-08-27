import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getPublicFormBySlug } from "@/server/forms-metrics";
import PublicForm from "@/components/sites/PublicForm";
import { publicMetadata } from "@/lib/public-seo";

export const dynamic = "force-dynamic";

/**
 * A hosted form is a capture page, never a search result.
 *
 * `index: false` is explicit rather than inherited: it must not depend on the dashboard layout
 * happening to say noindex, because a form that ranks is a form collecting submissions from people
 * who never saw the offer it belongs to. It still gets a real title and card, because the link is
 * pasted into WhatsApp and email constantly - and without this it shared as "B2 Consultants -
 * Private internal dashboard for B2 Consultants", which is the app's title, not the form's.
 */
export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const form = await getPublicFormBySlug(params.slug);
  if (!form) return { title: "Not found", robots: { index: false, follow: false } };
  return publicMetadata({ title: form.name, siteName: "B2 Consultants", index: false });
}

function pickUtm(sp: Record<string, string | string[] | undefined>): Record<string, string> {
  const utm: Record<string, string> = {};
  for (const k of ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"]) {
    const v = sp[k];
    if (typeof v === "string" && v) utm[k] = v;
  }
  return utm;
}

export default async function PublicFormPage({
  params,
  searchParams,
}: {
  params: { slug: string };
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const form = await getPublicFormBySlug(params.slug);
  if (!form) notFound();

  return (
    <main className="min-h-screen bg-app px-4 py-12">
      <div className="mx-auto max-w-md space-y-6">
        <h1 className="text-center font-display text-h1 font-bold text-ink">{form.name}</h1>
        <PublicForm form={form} utm={pickUtm(searchParams)} />
        <p className="text-center text-caption text-ink-3">Powered by B2 Consultants</p>
      </div>
    </main>
  );
}

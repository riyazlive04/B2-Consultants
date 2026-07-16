import { notFound } from "next/navigation";
import { getPublicFormBySlug } from "@/server/forms-metrics";
import PublicForm from "@/components/sites/PublicForm";

export const dynamic = "force-dynamic";

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

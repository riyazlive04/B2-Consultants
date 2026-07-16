import { notFound } from "next/navigation";
import { requireSection } from "@/lib/rbac";
import { getForm, getSitesPickers } from "@/server/forms-metrics";
import FormBuilder from "./_components/FormBuilder";

export const dynamic = "force-dynamic";

export default async function FormBuilderPage({ params }: { params: { id: string } }) {
  await requireSection("forms");
  const [form, pickers] = await Promise.all([getForm(params.id), getSitesPickers()]);
  if (!form) notFound();

  return (
    <div className="w-full">
      <FormBuilder form={form} pickers={pickers} />
    </div>
  );
}

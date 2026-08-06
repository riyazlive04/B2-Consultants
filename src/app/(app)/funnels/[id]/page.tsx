import { notFound } from "next/navigation";
import { requireSection } from "@/lib/rbac";
import { getFunnel } from "@/server/funnels-metrics";
import { getSnippets, snippetCategories } from "@/server/snippets-metrics";
import { getSitesPickers } from "@/server/forms-metrics";
import FunnelBuilder from "./_components/FunnelBuilder";

export const dynamic = "force-dynamic";

export default async function FunnelBuilderPage({ params }: { params: { id: string } }) {
  await requireSection("funnels");
  const [funnel, pickers, snippets] = await Promise.all([getFunnel(params.id), getSitesPickers(), getSnippets()]);
  if (!funnel) notFound();

  return (
    <div className="w-full">
      <FunnelBuilder
        funnel={funnel}
        forms={pickers.forms}
        // Loaded whole rather than on demand: the library is a few dozen rows of page JSON, and
        // the picker previews each one with the real renderer — fetching it when the modal opens
        // would mean a spinner in front of the thing people are browsing.
        snippets={snippets}
        snippetCategories={snippetCategories(snippets)}
      />
    </div>
  );
}

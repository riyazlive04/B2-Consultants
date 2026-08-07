import { notFound } from "next/navigation";
import { requireSection } from "@/lib/rbac";
import { getFunnel } from "@/server/funnels-metrics";
import { getSnippets, snippetCategories } from "@/server/snippets-metrics";
import { getSitesPickers } from "@/server/forms-metrics";
import { collectBookingOwnerIds, getStepCalendars } from "@/server/booking-calendars";
import FunnelBuilder from "./_components/FunnelBuilder";

export const dynamic = "force-dynamic";

export default async function FunnelBuilderPage({ params }: { params: { id: string } }) {
  await requireSection("funnels");
  const [funnel, pickers, snippets] = await Promise.all([getFunnel(params.id), getSitesPickers(), getSnippets()]);
  if (!funnel) notFound();

  /**
   * Real open slots for every `booking` block in the funnel.
   *
   * The canvas renders the production `SiteBlocks`, but was never handed any availability, so a
   * booking block previewed as "No times are open right now — please check back shortly" on a
   * page whose PUBLISHED version was offering sixteen days of slots. That reads as a broken
   * calendar rather than as missing preview data, and it is the one block whose emptiness is
   * indistinguishable from a real outage.
   *
   * Every step is resolved in ONE query rather than per step: the editor switches between steps
   * client-side with no further server round trip, so fetching per step would either mean a
   * refetch on every click or a preview that goes stale the moment you navigate.
   */
  const owners = collectBookingOwnerIds([
    ...funnel.steps.flatMap((s) => [...s.blocks, ...s.variants.flatMap((v) => v.blocks)]),
    ...(funnel.headerBlocks ?? []),
    ...(funnel.footerBlocks ?? []),
  ]);
  const calendars = await getStepCalendars(owners);

  return (
    <div className="w-full">
      <FunnelBuilder
        funnel={funnel}
        forms={pickers.forms}
        calendars={calendars}
        // Loaded whole rather than on demand: the library is a few dozen rows of page JSON, and
        // the picker previews each one with the real renderer — fetching it when the modal opens
        // would mean a spinner in front of the thing people are browsing.
        snippets={snippets}
        snippetCategories={snippetCategories(snippets)}
      />
    </div>
  );
}

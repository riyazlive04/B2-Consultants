import { notFound } from "next/navigation";
import { requireSection } from "@/lib/rbac";
import { getFunnel } from "@/server/funnels-metrics";
import { getSnippets, snippetCategories } from "@/server/snippets-metrics";
import { getSitesPickers } from "@/server/forms-metrics";
import { collectBookingOwnerIds, getStepCalendars } from "@/server/booking-calendars";
import { getBookableTeamMembers } from "@/server/booking-metrics";
import FunnelBuilder from "./_components/FunnelBuilder";

export const metadata = { title: "Funnel" };

export const dynamic = "force-dynamic";

export default async function FunnelBuilderPage({ params }: { params: { id: string } }) {
  await requireSection("funnels");
  /**
   * `hosts` is the team list the booking block's owner picker offers.
   *
   * `bookingOwnerId` has always been read on the live page and was never writable anywhere: the
   * inspector had no case for a `booking` block at all, so a calendar dropped into a funnel could
   * only ever be the unscoped pool, and "Asma's page offers Asma's slots" was unreachable without
   * editing the database by hand. Same source as the Availability form's "Team member" select, so
   * the person you generated slots for is the person you can point the block at.
   */
  const [funnel, pickers, snippets, hosts] = await Promise.all([
    getFunnel(params.id),
    getSitesPickers(),
    getSnippets(),
    getBookableTeamMembers(),
  ]);
  if (!funnel) notFound();

  /**
   * Real open slots for every `booking` block in the funnel.
   *
   * The canvas renders the production `SiteBlocks`, but was never handed any availability, so a
   * booking block previewed as "No times are open right now - please check back shortly" on a
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
  /**
   * Every bookable team member is loaded, not just the owners already referenced.
   *
   * The owner is now editable in the inspector, and the canvas renders the real calendar from
   * this map. Fetching only the owners the page already mentions would mean that re-pointing a
   * block at someone previewed as "No times are open right now" until the page was reloaded -
   * indistinguishable from the availability bug this is meant to fix. It costs nothing: the
   * unscoped key already pulls every open slot in the window, and the per-owner split is done in
   * memory from those same rows.
   */
  const calendars = await getStepCalendars([...owners, "", ...hosts.map((h) => h.id)]);

  return (
    <div className="w-full">
      <FunnelBuilder
        funnel={funnel}
        forms={pickers.forms}
        hosts={hosts}
        calendars={calendars}
        // Loaded whole rather than on demand: the library is a few dozen rows of page JSON, and
        // the picker previews each one with the real renderer - fetching it when the modal opens
        // would mean a spinner in front of the thing people are browsing.
        snippets={snippets}
        snippetCategories={snippetCategories(snippets)}
      />
    </div>
  );
}

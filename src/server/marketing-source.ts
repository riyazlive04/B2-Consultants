import "server-only";
import { prisma } from "@/lib/prisma";
import type { LeadSource } from "@prisma/client";

/**
 * TAGGING A LEAD WITH THE CAMPAIGN IT CAME FROM.
 *
 * ── The hole this closes ─────────────────────────────────────────────────────────────────────
 * Campaign attribution on /reports reported nothing, for anybody, ever - not because the maths
 * was wrong but because `Lead.marketingSourceId` was never written by anything in the app. The
 * report joined spend to leads to enrolments through a column with no writer, so it could only
 * ever have been empty, and `MarketingSource` itself had no writer either: there was no screen,
 * no action and no intake path that created one.
 *
 * The information was already arriving. Every webhook and the native opt-in route capture UTM
 * parameters into `Lead.utm` (see `extractUtm`), and they go on sitting there unread. This is the
 * join: the channel the capture already resolved, plus the campaign the UTM already carries.
 *
 * ── Why the source is created on the fly ─────────────────────────────────────────────────────
 * `MarketingSource` is `@@unique([channel, campaign])`, so a campaign name IS its identity - and
 * requiring somebody to pre-register every campaign before its leads could be attributed would
 * reproduce the original failure in slower motion: the first lead of a new campaign would land
 * untagged and stay that way. Created on first sight, with `externalRef` carrying the raw UTM
 * value so imported spend can be matched to it.
 *
 * SPEND IS NOT INVENTED. A source made here has no `AdSpend` rows, so the report shows its
 * leads, bookings, enrolments and revenue, and leaves cost per lead and return on spend blank
 * until real spend is recorded. An empty cost column is a missing figure; a guessed one would be
 * a wrong one.
 */

/** The UTM keys that name a campaign, in the order we trust them. */
const CAMPAIGN_KEYS = ["utm_campaign", "utm_content", "utm_term"] as const;

function campaignOf(utm: Record<string, string> | null | undefined): string | null {
  if (!utm) return null;
  for (const key of CAMPAIGN_KEYS) {
    const v = utm[key]?.trim();
    // Capped to the column's practical width and to what a table column can show.
    if (v) return v.slice(0, 120);
  }
  return null;
}

/**
 * The `MarketingSource` id for this capture, or null when there is nothing to attribute to.
 *
 * Null - not a placeholder row - when the capture carries no campaign: "we don't know where this
 * came from" is the truth for a referral or a walk-in, and an "(unknown)" campaign sitting at the
 * top of the attribution table by volume would be worse than its absence.
 *
 * Never throws. An attribution tag must not be able to fail a lead capture: the lead is the thing
 * that matters and the tag can be added later.
 */
export async function resolveMarketingSourceId(input: {
  channel: LeadSource;
  utm?: Record<string, string> | null;
}): Promise<string | null> {
  const campaign = campaignOf(input.utm);
  if (!campaign) return null;
  try {
    const source = await prisma.marketingSource.upsert({
      where: { channel_campaign: { channel: input.channel, campaign } },
      // An existing row is left exactly as it is - the founder may have renamed it, re-pointed
      // its `externalRef` or deactivated it, and a later lead must not undo that.
      update: {},
      create: {
        channel: input.channel,
        campaign,
        // The raw UTM value, which is what an ad platform's export joins on.
        externalRef: campaign,
      },
      select: { id: true },
    });
    return source.id;
  } catch (e) {
    console.error(`[attribution] could not resolve campaign ${JSON.stringify(campaign)}`, e);
    return null;
  }
}

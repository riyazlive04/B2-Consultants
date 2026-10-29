import { hasCapability, type CapabilityOverrides } from "./capabilities";
import type { AppRole } from "./sections";

/**
 * WHO MAY OPEN THE MEDIA ON AN IMPROVEMENT REPORT - one rule, in one place.
 *
 * ── WHY THIS IS ITS OWN MODULE ─────────────────────────────────────────────────────────────
 * Because the same mistake has already been made twice in this codebase, in the same shape: a
 * read-side copy of an access rule that omitted HEAD. `server/batch-access.ts` exists for
 * exactly that reason, after three read paths each re-derived the delivery fence and each left
 * the head coach out of it.
 *
 * This rule now has two callers - the recording route and the attachment download route - and
 * the triage screen has to agree with both of them about what to render. Three places is one
 * more than it takes for them to drift, so none of them re-derives it.
 *
 * ── WHO, AND WHY ───────────────────────────────────────────────────────────────────────────
 *   `improvements.triage`    the founder and the developer. They act on the report.
 *   `improvements.escalate`  the head coach. They decide whether it matters now.
 *   the reporter             their own account of what happened.
 *   whoever uploaded it      normally the reporter, kept separate so it stays answerable.
 *
 * THE HEAD COACH WAS MISSING UNTIL 29 OCT 2026, and it was a real bug rather than a policy: the
 * `improvements` section is ADMIN + HEAD, so a head coach could already read every word of every
 * report - but the media routes admitted only `improvements.triage`. The result was a `<video
 * controls>` and a list of download links that answered 403 to the one person who had just been
 * given the queue. The decision not to narrow the section is recorded in `lib/sections.ts`, and
 * it was taken in the knowledge that a recording of a money screen shows figures that `finance`,
 * `cash` and `pipeline` withhold from HEAD. This function is where that decision actually takes
 * effect; narrowing it would re-break the thing that comment tells you not to quietly fix.
 *
 * NOTE WHAT THIS IS NOT: it is a READ rule only. Attaching and recording stay reporter-only, in
 * the POST handlers, because a report's evidence is the reporter's own account and nothing here
 * wants a second person's screen on somebody else's report.
 */
/**
 * STRUCTURAL, not `AppSession`. Three fields, so this module is pure - it imports no prisma, no
 * headers, no `server-only`, and therefore nothing that drags React's server build into a test.
 * `AppSession` satisfies it, so every real caller passes its session straight in.
 */
export type MediaViewer = {
  role: AppRole;
  /**
   * `null` for "no overrides", which is what a session carries. Not `| undefined`: that is what
   * `hasCapability` accepts, and widening it here only moves the error to the call site.
   */
  capabilities: CapabilityOverrides | null;
  user: { id: string };
};

export function canReadImprovementMedia(
  session: MediaViewer,
  media: { reporterId: string; uploadedById: string },
): boolean {
  return (
    hasCapability(session.role, session.capabilities, "improvements.triage") ||
    hasCapability(session.role, session.capabilities, "improvements.escalate") ||
    media.reporterId === session.user.id ||
    media.uploadedById === session.user.id
  );
}

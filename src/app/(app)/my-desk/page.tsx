import { ClipboardList, Phone } from "lucide-react";
import { requireSection } from "@/lib/rbac";
import { getDeskIdentity, getTelecallerDesk } from "@/server/telecaller-desk-metrics";
import { getL1Desk } from "@/server/l1-desk-metrics";
import { getL2Desk } from "@/server/l2-desk-metrics";
import { getOwnerDesk } from "@/server/owner-desk";
import { getOwnCommission } from "@/server/commission-metrics";
import { PageHeader, EmptyState } from "@/components/ui/kit";
import { DeskClient } from "./_components/DeskClient";
import { L1Desk } from "./_components/L1Desk";
import { L2Desk } from "./_components/L2Desk";
import { OwnerDesk } from "./_components/OwnerDesk";
import { OwnCommission } from "./_components/OwnCommission";

export const dynamic = "force-dynamic";

/**
 * "My Desk" - the specialist's own working screen.
 *
 * WHICH desk depends on `TeamProfile.logVariant`, not on the app Role. Section RBAC can
 * only gate on ROLE, and both specialists are the same USER role - what actually separates
 * Nilofer's job from Asma's is the function recorded on their team profile. That is the same
 * predicate the daily log and the pay board already branch on, so a person's variant is set
 * once and every screen agrees:
 *
 *   APPOINTMENT_SETTER   → Level 1 Outreach Specialist  (rebuild spec §6)
 *   DISCOVERY_SPECIALIST → Level 2 Discovery Specialist (rebuild spec §7)
 *   admin / head coach   → a task list of what is waiting on them (Error Log Q2)
 *   anything else        → the original generic call desk
 *
 * ORDER MATTERS, and the variant is checked FIRST on purpose. An admin who also works a phone
 * keeps their specialist desk - role is only consulted once we know there is no specialist screen
 * to show, so nobody loses a working screen to gain the task list.
 *
 * Q2 asked for "task list for admin/head, call stats for telecallers". What Ameen actually got was
 * the no-profile explainer - the founder being told to ask himself to link his login. A head coach
 * with a profile but no variant got the generic call desk: someone else's numbers, in effect.
 *
 * No profile and no owning role → an explainer, never a crash or an empty shell (Error Log O2:
 * removing access must hide a section completely, not leave a hollow one).
 */
export default async function MyDeskPage() {
  const session = await requireSection("my-desk");
  /**
   * Identity only, not the whole generic desk.
   *
   * This used to be `getTelecallerDesk`, whose entire result was then thrown away for the two
   * specialist variants - the page read three fields off it and rendered a completely different
   * desk. So an L1 caller waited for 500 leads, a month of call logs and every goal to load
   * BEFORE their own desk even started querying, on a pooled connection where those two rounds
   * do not overlap. The generic desk is still built below, for the one branch that renders it.
   */
  const who = await getDeskIdentity(session.user.id);

  const header = (name: string, roleTitle: string, subtitle: string) => (
    <PageHeader icon={<Phone />} title="My Desk" subtitle={`${name} · ${roleTitle} - ${subtitle}`} />
  );

  /**
   * Own commission sits BELOW the working part of each desk, and is fetched alongside it.
   *
   * Rendered here rather than inside the desk components on purpose: both are client
   * components (they own modals, countdowns and the offline queue), and money has no reason to
   * travel to the browser as data when it only needs to arrive as markup. It is also why both
   * desks share one block - the split/both-calls/closer arithmetic does not differ by level.
   */
  if (who?.logVariant === "APPOINTMENT_SETTER") {
    const [l1, commission] = await Promise.all([
      getL1Desk(session.user.id),
      getOwnCommission(session.user.id),
    ]);
    return (
      <div className="space-y-6">
        {header(who.name, who.roleTitle, "who do I need to call right now?")}
        <L1Desk desk={l1} />
        <OwnCommission data={commission} />
      </div>
    );
  }

  if (who?.logVariant === "DISCOVERY_SPECIALIST") {
    const [l2, commission] = await Promise.all([
      getL2Desk(session.user.id),
      getOwnCommission(session.user.id),
    ]);
    return (
      <div className="space-y-6">
        {header(who.name, who.roleTitle, "who is on my calendar today, and who hasn't shown?")}
        <L2Desk desk={l2} />
        <OwnCommission data={commission} />
      </div>
    );
  }

  if (session.role === "ADMIN" || session.role === "HEAD") {
    const owner = await getOwnerDesk(session.role);
    return (
      <div className="space-y-6">
        <PageHeader icon={<ClipboardList />} title="My Desk" subtitle="What's waiting on a decision from you." />
        <OwnerDesk desk={owner} />
      </div>
    );
  }

  if (!who) {
    return (
      <div className="space-y-6">
        <PageHeader icon={<Phone />} title="My Desk" subtitle="Your calls, conversions and today's list." />
        <EmptyState
          title="No team profile linked to your login"
          body="This desk reads your calls from your team profile. Ask Ameen to link your login in Users → Team, and your numbers will appear here."
        />
      </div>
    );
  }

  // The only branch that renders the generic desk, so the only one that pays to build it.
  const desk = await getTelecallerDesk(session.user.id);
  if (!desk) {
    return (
      <div className="space-y-6">
        <PageHeader icon={<Phone />} title="My Desk" subtitle="Your calls, conversions and today's list." />
        <EmptyState
          title="No team profile linked to your login"
          body="This desk reads your calls from your team profile. Ask Ameen to link your login in Users → Team, and your numbers will appear here."
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader icon={<Phone />} title="My Desk" subtitle={`${desk.name} · ${desk.roleTitle}`} />
      <DeskClient desk={desk} />
    </div>
  );
}

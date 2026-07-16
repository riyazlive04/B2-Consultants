import { Phone } from "lucide-react";
import { requireSection } from "@/lib/rbac";
import { getTelecallerDesk } from "@/server/telecaller-desk-metrics";
import { PageHeader, EmptyState } from "@/components/ui/kit";
import { DeskClient } from "./_components/DeskClient";

export const dynamic = "force-dynamic";

/**
 * "My Desk" — the telecaller's own numbers and today's call list.
 *
 * Section RBAC can only gate on ROLE, but "telecaller" is a TeamProfile.logVariant, not a
 * role. So the section lets ADMIN/USER in and the page itself resolves the signed-in
 * person's profile: no profile → an explainer, never a crash or an empty shell.
 */
export default async function MyDeskPage() {
  const session = await requireSection("my-desk");
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
      <PageHeader
        icon={<Phone />}
        title="My Desk"
        subtitle={`${desk.name} · ${desk.roleTitle}`}
      />
      <DeskClient desk={desk} />
    </div>
  );
}

import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, Users } from "lucide-react";
import { requireSection } from "@/lib/rbac";
import { getGnAccess, getGnMembers } from "@/server/german-note-metrics";
import { MembersDirectory } from "../_components/MembersDirectory";
import { PageHeader } from "@/components/ui/kit";

export const dynamic = "force-dynamic";

export default async function GnMembersPage() {
  const session = await requireSection("german-note");
  const access = await getGnAccess(session.role, session.user.id);
  if (!access.isParticipant) redirect("/german-note");
  const members = await getGnMembers();

  return (
    <div className="w-full space-y-6">
      <PageHeader
        back={{ href: "/german-note", label: "German Note" }}
        icon={<Users size={20} />}
        title="Members"
        subtitle={`Everyone in the German Note community - ${members.length} member${members.length === 1 ? "" : "s"}. Tap anyone to see their level and activity.`}
      />
      <MembersDirectory members={members} />
    </div>
  );
}

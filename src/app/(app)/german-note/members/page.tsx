import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, Users } from "lucide-react";
import { requireSection } from "@/lib/rbac";
import { getGnAccess, getGnMembers } from "@/server/german-note-metrics";
import { MembersDirectory } from "../_components/MembersDirectory";

export const dynamic = "force-dynamic";

export default async function GnMembersPage() {
  const session = await requireSection("german-note");
  const access = await getGnAccess(session.role, session.user.id);
  if (!access.isParticipant) redirect("/german-note");
  const members = await getGnMembers();

  return (
    <div className="w-full space-y-6">
      <div>
        <Link href="/german-note" className="inline-flex items-center gap-1 text-xs font-medium text-muted hover:text-ink">
          <ArrowLeft size={13} /> German Note
        </Link>
        <h1 className="mt-2 flex items-center gap-2 font-display text-3xl font-bold tracking-tight sm:text-4xl">
          <Users size={26} className="text-[var(--lvl-gn)]" /> Members
        </h1>
        <p className="mt-1 text-sm text-muted">
          Everyone in the German Note community — {members.length} member{members.length === 1 ? "" : "s"}. Tap anyone to see their level and activity.
        </p>
      </div>
      <MembersDirectory members={members} />
    </div>
  );
}

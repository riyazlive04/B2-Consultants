import { prisma } from "@/lib/prisma";
import type { AppRole } from "@/lib/sections";

/**
 * The founder must never be able to lock themselves - or the last Admin - out.
 *
 * Shared rather than duplicated because a role can now be changed from TWO screens (Users &
 * access, and the team profile form on the org chart). A rail that lives on only one of them is
 * not a rail.
 */
export async function lastAdminError(userId: string, nextRole: AppRole | null): Promise<string | null> {
  if (nextRole === "ADMIN") return null;
  const others = await prisma.user.count({
    where: { role: "ADMIN", status: "ACTIVE", id: { not: userId } },
  });
  return others === 0 ? "At least one active Admin must remain." : null;
}

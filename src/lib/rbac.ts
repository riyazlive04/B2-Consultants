import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "./auth";
import { prisma } from "./prisma";
import {
  SECTIONS,
  roleDefaultKeys,
  type AppRole,
  type SectionKey,
  type SectionOverrides,
} from "./sections";

// Guard layer over the isomorphic catalogue in sections.ts (CONTEXT §2 + PRD tables).
export { SECTIONS, roleDefaultKeys };
export type { AppRole, SectionKey, SectionOverrides };

function hasAccess(role: AppRole, overrides: SectionOverrides | null, key: SectionKey): boolean {
  if (role === "ADMIN") return true; // the founder is never locked out
  const s = SECTIONS.find((x) => x.key === key);
  if (!s) return false;
  const override = overrides?.[key];
  if (override !== undefined) return override;
  return (s.roles as readonly string[]).includes(role);
}

export function sectionsFor(role: AppRole, overrides: SectionOverrides | null) {
  return SECTIONS.filter((s) => hasAccess(role, overrides, s.key));
}

/**
 * Server-side session fetch. Redirects to /login when unauthenticated.
 * Wrapped in React.cache so the layout + page + any actions in a single request
 * share ONE getSession + one user.findUnique instead of repeating both 2-3×.
 */
export const requireSession = cache(async () => {
  const session = await auth.api.getSession({ headers: await Promise.resolve(headers()) });
  if (!session) redirect("/login");
  const role = (session.user as { role?: string }).role as AppRole;
  // overrides live on the user row so Admin changes take effect on next request
  const row = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { sectionAccess: true },
  });
  const overrides = (row?.sectionAccess as SectionOverrides | null) ?? null;
  return { ...session, role, overrides };
});

/** Page/action guard - redirect home if this user has no access. */
export async function requireSection(key: SectionKey) {
  const session = await requireSession();
  if (!hasAccess(session.role, session.overrides, key)) redirect("/");
  return session;
}

export async function requireAdmin() {
  const session = await requireSession();
  if (session.role !== "ADMIN") redirect("/");
  return session;
}

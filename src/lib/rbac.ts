import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "./auth";
import { prisma } from "./prisma";
import {
  resolveSections,
  sectionAllowed,
  type AppRole,
  type ResolvedSection,
  type SectionKey,
  type SectionOverrides,
} from "./sections";
import {
  capabilityDeniedMessage,
  hasCapability,
  type CapabilityKey,
  type CapabilityOverrides,
} from "./capabilities";
import { getSectionsConfig } from "@/server/founder-config";

// Guard layer over the isomorphic catalogue in sections.ts (CONTEXT §2 + PRD tables),
// now reading the founder's live section config rather than the code defaults.
// The access RULE itself lives in sections.ts so the admin UI can render the same answer.
export { resolveSections, roleDefaultKeys, sectionAllowed } from "./sections";
export type { AppRole, ResolvedSection, SectionKey, SectionOverrides };
export { hasCapability } from "./capabilities";
export type { CapabilityKey, CapabilityOverrides };

export function sectionsFor(
  sections: ResolvedSection[],
  role: AppRole,
  overrides: SectionOverrides | null,
): ResolvedSection[] {
  return sections.filter((s) => sectionAllowed(s, role, overrides));
}

/** The nav for this user, in the founder's order. */
export async function visibleSections(role: AppRole, overrides: SectionOverrides | null) {
  return sectionsFor(resolveSections(await getSectionsConfig()), role, overrides);
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
    select: { sectionAccess: true, capabilities: true, status: true, themePreference: true },
  });

  // Suspension takes effect on the very next request. Suspending already deletes the
  // person's sessions; this closes the race where a request is in flight, and covers a
  // row suspended directly in the database.
  if (row?.status === "SUSPENDED") {
    await prisma.session.deleteMany({ where: { userId: session.user.id } });
    redirect("/login?error=suspended");
  }

  const overrides = (row?.sectionAccess as SectionOverrides | null) ?? null;
  const capabilities = (row?.capabilities as CapabilityOverrides | null) ?? null;
  // Part 2 §13: the person's own light/dark choice, so the shell can apply it before paint
  // rather than trusting whatever this particular browser cached.
  const themePreference = row?.themePreference ?? "SYSTEM";
  return { ...session, role, overrides, capabilities, themePreference };
});

/**
 * Page/action guard - redirect home if this user has no access.
 *
 * The reason rides along in the query string. A silent bounce to "/" leaves the
 * person staring at the dashboard wondering whether they mis-clicked or the app
 * broke (Nielsen: visibility of system status). `?denied=` is the same shape the
 * suspension path above already uses.
 */
export async function requireSection(key: SectionKey) {
  const session = await requireSession();
  const section = resolveSections(await getSectionsConfig()).find((s) => s.key === key);
  if (!section || !sectionAllowed(section, session.role, session.overrides)) {
    redirect(`/?denied=${encodeURIComponent(key)}`);
  }
  return session;
}

export async function requireAdmin() {
  const session = await requireSession();
  if (session.role !== "ADMIN") redirect("/?denied=admin");
  return session;
}

export type AppSession = Awaited<ReturnType<typeof requireSession>>;

/**
 * The capability guard for SERVER ACTIONS.
 *
 * It returns rather than redirects, because bouncing someone to the home page when
 * they press "Save" on a screen they were allowed to open is a terrible answer. The
 * caller turns `denied` straight into its ActionResult, so the person sees
 * "You don't have permission to record income & expenses." and stays where they are.
 *
 *   const { allowed, denied, session } = await capabilityCheck("finance.write");
 *   if (!allowed) return denied;
 */
export async function capabilityCheck(key: CapabilityKey): Promise<{
  allowed: boolean;
  denied: { ok: false; error: string };
  session: AppSession;
}> {
  const session = await requireSession();
  const allowed = hasCapability(session.role, session.capabilities, key);
  return { allowed, denied: { ok: false, error: capabilityDeniedMessage(key) }, session };
}

/** The capability guard for PAGES — no page to stay on, so bounce home. */
export async function requireCapability(key: CapabilityKey) {
  const session = await requireSession();
  if (!hasCapability(session.role, session.capabilities, key)) {
    redirect(`/?denied=${encodeURIComponent(key)}`);
  }
  return session;
}

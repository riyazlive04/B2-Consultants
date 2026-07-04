/** Isomorphic section catalogue - importable from client AND server. rbac.ts layers
 *  the auth/guard logic on top; the access-manager UI renders toggles from this. */

export type AppRole = "ADMIN" | "HEAD" | "USER" | "STUDENT";

export const SECTIONS = [
  { key: "finance",  label: "Finance",           href: "/finance",  phase: 1, roles: ["ADMIN"] },
  { key: "pipeline", label: "Pipeline",          href: "/pipeline", phase: 1, roles: ["ADMIN", "USER"] },
  { key: "bookings", label: "Bookings",          href: "/bookings", phase: 1, roles: ["ADMIN"] },
  { key: "people",   label: "Users",             href: "/people",   phase: 2, roles: ["ADMIN"] },
  { key: "daily-log",label: "My Daily Log",      href: "/daily-log",phase: 2, roles: ["HEAD", "USER"] },
  { key: "arena",    label: "Arena",             href: "/arena",    phase: 2, roles: ["ADMIN", "HEAD", "USER"] },
  { key: "students", label: "Students",          href: "/students", phase: 2, roles: ["ADMIN", "HEAD"] },
  // STUDENT portal: their own journey only + the CV diagnostic (stores nothing).
  { key: "my-journey", label: "My Journey",      href: "/my-journey", phase: 2, roles: ["STUDENT"] },
  { key: "cv-check", label: "CV Diagnostic",     href: "/cv-check", phase: 2, roles: ["ADMIN", "HEAD", "STUDENT"] },
  { key: "funnel",   label: "Conversion Funnel", href: "/funnel",   phase: 3, roles: ["ADMIN"] },
  { key: "cash",     label: "Cash Health",       href: "/cash",     phase: 3, roles: ["ADMIN"] },
  { key: "guide",    label: "App Guide",         href: "/guide",    phase: 1, roles: ["ADMIN", "HEAD", "USER", "STUDENT"] },
] as const;

export type SectionKey = (typeof SECTIONS)[number]["key"];
export type SectionOverrides = Partial<Record<SectionKey, boolean>>;

/** Role defaults only - the baseline the per-user toggles start from. */
export function roleDefaultKeys(role: AppRole): SectionKey[] {
  return SECTIONS.filter((s) => (s.roles as readonly string[]).includes(role)).map((s) => s.key);
}

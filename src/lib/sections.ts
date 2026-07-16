/** Isomorphic section catalogue - importable from client AND server. rbac.ts layers
 *  the auth/guard logic on top; the access-manager UI renders toggles from this.
 *
 *  TWO LAYERS, ON PURPOSE:
 *   1. SECTION_CATALOGUE — code truth. A section exists because a route exists.
 *      `key`, `href` and `phase` are structural: the founder can't invent them.
 *   2. SectionsConfig — the founder's layer, persisted as JSON in AppSetting.
 *      Label, icon, sidebar group, order, on/off and the default role list are all
 *      theirs to change from /console. Unknown keys are ignored (a route was
 *      removed); missing keys fall back to the catalogue (a route was added).
 *
 *  The `console` section is `locked`: the founder can rename it, but never hide it
 *  or hand it to a non-admin — otherwise the only way back is a database edit.
 */

export type AppRole = "ADMIN" | "HEAD" | "USER" | "STUDENT" | "TUTOR";

export const APP_ROLES: readonly AppRole[] = ["ADMIN", "HEAD", "USER", "STUDENT", "TUTOR"] as const;

/** Icon names the console offers. `section-icons.tsx` maps each to a lucide component
 *  and is typed against this list, so adding a name here without a component fails the build. */
export const SECTION_ICON_NAMES = [
  "wallet", "landmark", "phone", "git-branch", "calendar-check", "users",
  "graduation-cap", "clipboard-list", "filter", "file-search", "languages",
  "map", "book-open", "message-circle", "trophy", "sliders", "target", "gift",
  "sparkles", "bar-chart", "shield", "layout-grid", "file-signature", "scale",
  "contact", "kanban", "file-text", "layout-template", "receipt", "inbox", "workflow",
] as const;
export type SectionIconName = (typeof SECTION_ICON_NAMES)[number];

/** Sidebar groups the console offers. Free text would let a typo orphan a section. */
export const SECTION_GROUPS = ["Money", "People", "Insights", "Workspace"] as const;
export type SectionGroup = (typeof SECTION_GROUPS)[number];

type SectionCatalogueEntry = {
  readonly key: string;
  readonly href: string;
  readonly phase: number;
  readonly label: string;
  readonly icon: SectionIconName;
  readonly group: SectionGroup;
  readonly roles: readonly AppRole[];
  /** always enabled, always ADMIN-only — the founder can't lock themselves out */
  readonly locked?: boolean;
};

export const SECTION_CATALOGUE = [
  { key: "finance", label: "Finance", href: "/finance", phase: 1, icon: "wallet", group: "Money", roles: ["ADMIN"] },
  { key: "telecaller", label: "Telecaller Pay", href: "/telecaller", phase: 1, icon: "phone", group: "Money", roles: ["ADMIN"] },
  // The telecaller's OWN numbers + today's call list. The counterpart to "Telecaller Pay":
  // that board is Ameen looking at the team, this is Nilofer/Asma looking at themselves, so
  // USER is in the default list. ADMIN is included to inspect it, but the page shows the
  // signed-in person's desk — and renders an explainer for anyone with no telecaller profile,
  // since "telecaller" is a TeamProfile.logVariant, not a role that could gate a section.
  { key: "my-desk", label: "My Desk", href: "/my-desk", phase: 1, icon: "phone", group: "Money", roles: ["ADMIN", "USER"] },
  { key: "cash", label: "Cash Health", href: "/cash", phase: 3, icon: "landmark", group: "Money", roles: ["ADMIN"] },
  // Read-only journal + trial balance (SPEC §10.4, §12). Admin-only: it is the audit
  // surface for every rupee the other Money screens summarise.
  { key: "ledger", label: "Ledger", href: "/ledger", phase: 1, icon: "scale", group: "Money", roles: ["ADMIN"] },
  { key: "pipeline", label: "Pipeline", href: "/pipeline", phase: 1, icon: "git-branch", group: "Money", roles: ["ADMIN", "HEAD", "USER"] },
  // Synamate CRM parity (Phase 1): Contacts (the CRM) + Opportunities (the drag-drop board).
  { key: "opportunities", label: "Opportunities", href: "/opportunities", phase: 1, icon: "kanban", group: "Money", roles: ["ADMIN", "USER"] },
  { key: "bookings", label: "Bookings", href: "/bookings", phase: 1, icon: "calendar-check", group: "Money", roles: ["ADMIN"] },
  // The Outreach Specialist SOP queue (Script_for_Outreach_Specialist.docx, Steps 1–23) + the
  // Key Metrics sheet it feeds. USER is in the default list because the outreach specialist IS a
  // USER — this is their day's work, not an admin report.
  { key: "outreach", label: "Outreach", href: "/outreach", phase: 1, icon: "message-circle", group: "Money", roles: ["ADMIN", "USER"] },
  // Synamate Payments parity (Phase 3): invoices, estimates, products, subscriptions.
  { key: "payments", label: "Payments", href: "/payments", phase: 3, icon: "receipt", group: "Money", roles: ["ADMIN"] },
  { key: "people", label: "Users", href: "/people", phase: 2, icon: "users", group: "People", roles: ["ADMIN"] },
  { key: "contacts", label: "Contacts", href: "/contacts", phase: 1, icon: "contact", group: "People", roles: ["ADMIN", "USER"] },
  { key: "students", label: "Students", href: "/students", phase: 2, icon: "graduation-cap", group: "People", roles: ["ADMIN", "HEAD"] },
  { key: "agreements", label: "Agreements", href: "/agreements", phase: 4, icon: "file-signature", group: "People", roles: ["ADMIN"] },
  { key: "daily-log", label: "My Daily Log", href: "/daily-log", phase: 2, icon: "clipboard-list", group: "People", roles: ["HEAD", "USER"] },
  { key: "arena", label: "Arena", href: "/arena", phase: 2, icon: "trophy", group: "People", roles: ["ADMIN", "HEAD", "USER"] },
  // STUDENT portal: their own journey only + the CV diagnostic (stores nothing).
  { key: "my-journey", label: "My Journey", href: "/my-journey", phase: 2, icon: "map", group: "People", roles: ["STUDENT"] },
  // German Note LMS: batches + class recordings + community (Phase 4).
  { key: "german-note", label: "German Note", href: "/german-note", phase: 4, icon: "languages", group: "People", roles: ["ADMIN", "TUTOR", "STUDENT"] },
  { key: "funnel", label: "Conversion Funnel", href: "/funnel", phase: 3, icon: "filter", group: "Insights", roles: ["ADMIN"] },
  // Synamate Sites parity (Phase 2): native form + funnel/landing-page builders with public hosting.
  { key: "forms", label: "Forms", href: "/forms", phase: 2, icon: "file-text", group: "Insights", roles: ["ADMIN", "USER"] },
  { key: "funnels", label: "Funnels", href: "/funnels", phase: 2, icon: "layout-template", group: "Insights", roles: ["ADMIN", "USER"] },
  { key: "cv-check", label: "CV Studio", href: "/cv-check", phase: 2, icon: "file-search", group: "Insights", roles: ["ADMIN", "HEAD", "STUDENT"] },
  { key: "whatsapp", label: "WhatsApp", href: "/whatsapp", phase: 3, icon: "message-circle", group: "Insights", roles: ["ADMIN"] },
  // Synamate Conversations parity (Phase 4): unified Email + SMS + WhatsApp inbox + templates.
  { key: "conversations", label: "Conversations", href: "/conversations", phase: 4, icon: "inbox", group: "Insights", roles: ["ADMIN"] },
  // Reporting & Analytics Agent (Phase 6, BUILD_CHECKLIST §10): a minimal pivot report — object →
  // group-by → aggregate — closes the "every number lives on a hardcoded page" gap without new
  // schema. Admin-only, like the rest of Insights' cross-cutting views.
  { key: "reports", label: "Reports", href: "/reports", phase: 6, icon: "bar-chart", group: "Insights", roles: ["ADMIN"] },
  { key: "console", label: "Founder Console", href: "/console", phase: 1, icon: "sliders", group: "Workspace", roles: ["ADMIN"], locked: true },
  // Synamate Automation parity (Phase 5): trigger → action workflow engine.
  { key: "automation", label: "Automation", href: "/automation", phase: 5, icon: "workflow", group: "Workspace", roles: ["ADMIN"] },
  { key: "guide", label: "App Guide", href: "/guide", phase: 1, icon: "book-open", group: "Workspace", roles: ["ADMIN", "HEAD", "USER", "STUDENT", "TUTOR"] },
] as const satisfies readonly SectionCatalogueEntry[];

export type SectionKey = (typeof SECTION_CATALOGUE)[number]["key"];
export type SectionOverrides = Partial<Record<SectionKey, boolean>>;

/** The founder-owned half of a section. */
export type SectionSetting = {
  key: SectionKey;
  label: string;
  icon: SectionIconName;
  group: SectionGroup;
  order: number;
  enabled: boolean;
  roles: AppRole[];
};

export type SectionsConfig = { entries: SectionSetting[] };

const ORDER_STEP = 10;

export const DEFAULT_SECTIONS_CONFIG: SectionsConfig = {
  entries: SECTION_CATALOGUE.map((s, i) => ({
    key: s.key,
    label: s.label,
    icon: s.icon,
    group: s.group,
    order: (i + 1) * ORDER_STEP,
    enabled: true,
    roles: [...s.roles],
  })),
};

export type ResolvedSection = SectionSetting & {
  href: string;
  phase: number;
  locked: boolean;
};

/**
 * Merge the founder's settings over the code catalogue, ordered for the sidebar.
 * A `null` config (nothing saved yet) yields exactly the shipped defaults.
 */
export function resolveSections(config: SectionsConfig | null): ResolvedSection[] {
  const saved = new Map((config?.entries ?? []).map((e) => [e.key, e]));
  return SECTION_CATALOGUE.map((base, i): ResolvedSection => {
    const s = saved.get(base.key);
    // Only some catalogue entries carry `locked`, so the union type doesn't have the key.
    const locked = "locked" in base && base.locked === true;
    return {
      key: base.key,
      href: base.href,
      phase: base.phase,
      locked,
      label: s?.label?.trim() || base.label,
      icon: s?.icon ?? base.icon,
      group: s?.group ?? base.group,
      order: s?.order ?? (i + 1) * ORDER_STEP,
      // A locked section is never off and never leaves ADMIN, whatever the JSON says.
      enabled: locked ? true : (s?.enabled ?? true),
      roles: locked ? ["ADMIN"] : (s?.roles ?? [...base.roles]),
    };
  }).sort((a, b) => a.order - b.order || a.key.localeCompare(b.key));
}

/**
 * THE access rule. Three questions, in order:
 *   1. Has the founder switched this section off? Then nobody goes in.
 *   2. Is this user's per-user override set? It wins over the role default.
 *   3. Otherwise, does the section's role list include them?
 *
 * ADMIN skips (2) and (3) but not (1) — except for `locked` sections, which are
 * always on and always admin-only, so the founder can never switch off the screen
 * that would switch everything back on.
 *
 * Lives here, not in rbac.ts, because the access-manager checkbox grid has to show
 * the user exactly what the server will decide. One function, no mirror to drift.
 */
export function sectionAllowed(
  s: ResolvedSection,
  role: AppRole,
  overrides: SectionOverrides | null,
): boolean {
  if (!s.enabled) return false;
  if (role === "ADMIN") return true;
  if (s.locked) return false;
  const override = overrides?.[s.key];
  if (override !== undefined) return override;
  return s.roles.includes(role);
}

/** Which sections this user actually sees, given the founder's layout. */
export function effectiveSectionKeys(
  sections: ResolvedSection[],
  role: AppRole,
  overrides: SectionOverrides | null,
): Set<SectionKey> {
  return new Set(sections.filter((s) => sectionAllowed(s, role, overrides)).map((s) => s.key));
}

/** Role defaults only - the baseline the per-user toggles start from. */
export function roleDefaultKeys(role: AppRole, config: SectionsConfig | null = null): SectionKey[] {
  return resolveSections(config)
    .filter((s) => s.enabled && !s.locked && s.roles.includes(role))
    .map((s) => s.key);
}

/** Role defaults against an already-resolved list (client-side, no config fetch). */
export function roleDefaultKeysFrom(sections: ResolvedSection[], role: AppRole): SectionKey[] {
  return sections.filter((s) => s.enabled && !s.locked && s.roles.includes(role)).map((s) => s.key);
}

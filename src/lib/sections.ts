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
  "globe",
] as const;
export type SectionIconName = (typeof SECTION_ICON_NAMES)[number];

/** Sidebar groups the console offers. Free text would let a typo orphan a section.
 *  "Money" was one 10-item blob fusing accounting with the whole sales CRM; it's split
 *  into "Sales" (the pipeline → contacts → deals flow a rep lives in) and "Finance" (the
 *  founder's accounting screens). "Money" is kept last as a legacy-safe fallback so any
 *  saved founder config that still references it resolves rather than orphaning a section. */
export const SECTION_GROUPS = ["Sales", "Finance", "People", "Insights", "Workspace", "Money"] as const;
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
  /** hidden in code: ships disabled by default (nav + route), but the console can still re-enable it */
  readonly hidden?: boolean;
  /**
   * OFF THE RAIL, STILL OPEN.
   *
   * Distinct from `hidden`, and the distinction matters: `hidden` sets `enabled: false`, which
   * makes `requireSection` REFUSE the route — a screen nobody can reach. This one only drops the
   * item from the sidebar. The page still loads, still checks the same role list, and is still
   * linked from wherever it is surfaced.
   *
   * Used to shrink a nav group whose members are reachable somewhere better: Opportunities and
   * Outreach are tabs on Pipeline, so putting them on the rail as well listed the same job three
   * times. The founder can put either back with one toggle in Console → Sections.
   */
  readonly offRail?: boolean;
};

export const SECTION_CATALOGUE = [
  { key: "finance", label: "Finance", href: "/finance", phase: 1, icon: "wallet", group: "Finance", roles: ["ADMIN"] },
  { key: "cash", label: "Cash Health", href: "/cash", phase: 3, icon: "landmark", group: "Finance", roles: ["ADMIN"] },
  // Read-only journal + trial balance (SPEC §10.4, §12). Admin-only: it is the audit
  // surface for every rupee the other Finance screens summarise.
  // Hidden in code: off in the nav and unreachable by route. The page and its posting engine
  // stay intact, so the console can switch it back on without any code change.
  { key: "ledger", label: "Ledger", href: "/ledger", phase: 1, icon: "scale", group: "Finance", roles: ["ADMIN"], hidden: true },
  /**
   * ROLE DEFAULTS FOLLOW SPEC §3 (`02-dashboard-rebuild-by-role-and-access.md`), by the founder's
   * ruling: grant what the matrix grants, and switch off per person from Console → Sections or
   * a user's Access dialog. Console → Access Matrix reports any remaining drift.
   *
   * ONE DELIBERATE EXCEPTION, and it is the important one. §3's `O` means "own records only".
   * Where the own-records view is a DIFFERENT surface from the team board, the board is NOT
   * granted — a Student with `O` on "Students — all" reads their own journey at /my-journey, and
   * putting them on /students would hand them every other student's record. Same for Tutor and
   * Student on Bookings, and Student on Invoices. `R`/`E`/`F` rows are granted outright; `O` rows
   * are granted only where the section itself is already self-scoped (My Desk, Daily Log).
   */
  /**
   * ── The Sales group is THREE entries, not five ──────────────────────────────────
   * It held Pipeline · Contacts · Opportunities · Bookings · Outreach, two of which are the same
   * board twice: `/pipeline` is a kanban of `Lead.stage` and `/opportunities` is a kanban of
   * `Opportunity.stageId` mirrored back onto `Lead.stage`. A telecaller opening the rail saw
   * five doors into what is, to them, one job.
   *
   * Opportunities and Outreach are now `offRail` — off the sidebar, still fully built and still
   * reachable, because both are surfaced as TABS on Pipeline, which is where they belong:
   * Outreach is the SOP queue for the pipeline, Opportunities is the same pipeline as a board.
   * The founder can put either back on the rail from Console → Sections at any time.
   *
   * This is presentation only. Nothing is deleted, no route is removed, and no access changes —
   * merging the two boards into one is a separate, larger piece of work.
   */
  /**
   * "Pipeline" lands on the BOARD, not the metrics page (founder's call, 06/08/2026): the board is
   * what the team works out of all day, and the metrics screen was a detour they had to click past.
   *
   * Only the href moves. `key` stays "pipeline", so `requireSection` still gates this rail entry on
   * the pipeline section and nobody's access changes — but note the destination route runs
   * `requireSection("opportunities")`, so a user who has pipeline and has had opportunities revoked
   * in Console → Sections would be turned away here. Both default to ADMIN/HEAD/USER, so that only
   * happens if someone deliberately splits them.
   *
   * The metrics page is not orphaned: /opportunities links back to it (see its ListHeader).
   */
  { key: "pipeline", label: "Pipeline", href: "/opportunities", phase: 1, icon: "kanban", group: "Sales", roles: ["ADMIN", "HEAD", "USER"] },
  // Synamate CRM parity (Phase 1): Contacts (the CRM) + Opportunities (the drag-drop board).
  // Grouped with Pipeline under Sales so the whole lead → contact → deal flow sits together.
  { key: "contacts", label: "Contacts", href: "/contacts", phase: 1, icon: "contact", group: "Sales", roles: ["ADMIN", "USER"] },
  { key: "opportunities", label: "Opportunities", href: "/opportunities", phase: 1, icon: "kanban", group: "Sales", roles: ["ADMIN", "HEAD", "USER"], offRail: true },
  // §3: Head R · L1/L2/L3 E. Tutor and Student are `O` — their own calls surface on their own
  // screens, and this is the whole-team calendar, so they are not granted it.
  { key: "bookings", label: "Bookings", href: "/bookings", phase: 1, icon: "calendar-check", group: "Sales", roles: ["ADMIN", "HEAD", "USER"] },
  // The Outreach Specialist SOP queue (Script_for_Outreach_Specialist.docx, Steps 1–23) + the
  // Key Metrics sheet it feeds. USER is in the default list because the outreach specialist IS a
  // USER — this is their day's work, not an admin report.
  { key: "outreach", label: "Outreach", href: "/outreach", phase: 1, icon: "message-circle", group: "Sales", roles: ["ADMIN", "USER"], offRail: true },
  // Synamate Payments parity (Phase 3): invoices, estimates, products, subscriptions.
  { key: "payments", label: "Payments", href: "/payments", phase: 3, icon: "receipt", group: "Finance", roles: ["ADMIN"] },
  // Kept last in the Finance group on purpose: the default sidebar order follows this
  // catalogue order, so placing "Telecaller Pay" after Payments drops it to the bottom of Finance.
  // §3 "Commissions — all": Head R. The telecaller tiers get their OWN commission on My Desk, not
  // the whole-team board — §3 gives them `O` here, not `R`.
  { key: "telecaller", label: "Telecaller Pay", href: "/telecaller", phase: 1, icon: "phone", group: "Finance", roles: ["ADMIN", "HEAD"] },
  { key: "people", label: "Users", href: "/people", phase: 2, icon: "users", group: "People", roles: ["ADMIN"] },
  // §3: Head F · L1/L2/L3 R. Tutor and Student are `O` — a student's own record is /my-journey and
  // a tutor's own batch roster is on German Note; this board is every student.
  { key: "students", label: "Students", href: "/students", phase: 2, icon: "graduation-cap", group: "People", roles: ["ADMIN", "HEAD", "USER"] },
  // §3: Head E · L3 E (L1/L2 hidden). L1/L2/L3 are one USER role, so USER is granted here and the
  // ones who shouldn't have it are switched off per person. Student is `O` — their own agreement
  // is on /my-journey. Issuing still needs the `agreements.issue` capability regardless.
  { key: "agreements", label: "Agreements", href: "/agreements", phase: 4, icon: "file-signature", group: "People", roles: ["ADMIN", "HEAD", "USER"] },
  // §3 gives Tutor `O` here, and this screen is already self-scoped — it is the person's OWN log,
  // which is also where a tutor's sessions-delivered figure comes from.
  { key: "daily-log", label: "My Daily Log", href: "/daily-log", phase: 2, icon: "clipboard-list", group: "People", roles: ["HEAD", "USER", "TUTOR"] },
  // The telecaller's OWN numbers + today's call list — a personal work view (the counterpart to
  // "Telecaller Pay": that board is Ameen looking at the team, this is Nilofer/Asma looking at
  // themselves), so it sits under People. USER is in the default list; ADMIN can inspect it, and
  // the page renders an explainer for anyone with no telecaller profile, since "telecaller" is a
  // TeamProfile.logVariant, not a role that could gate a section.
  { key: "my-desk", label: "My Desk", href: "/my-desk", phase: 1, icon: "phone", group: "People", roles: ["ADMIN", "HEAD", "USER"] },
  { key: "arena", label: "Arena", href: "/arena", phase: 2, icon: "trophy", group: "People", roles: ["ADMIN", "HEAD", "USER"] },
  // STUDENT portal: their own journey only + the CV diagnostic (stores nothing).
  { key: "my-journey", label: "My Journey", href: "/my-journey", phase: 2, icon: "map", group: "People", roles: ["STUDENT"] },
  // German Note LMS: batches + class recordings + community (Phase 4).
  { key: "german-note", label: "German Note", href: "/german-note", phase: 4, icon: "languages", group: "People", roles: ["ADMIN", "HEAD", "TUTOR", "STUDENT"] },
  { key: "funnel", label: "Conversion Funnel", href: "/funnel", phase: 3, icon: "filter", group: "Insights", roles: ["ADMIN"] },
  // Synamate Sites parity (Phase 2): native form + funnel/landing-page builders with public hosting.
  { key: "forms", label: "Forms", href: "/forms", phase: 2, icon: "file-text", group: "Insights", roles: ["ADMIN", "USER"] },
  { key: "funnels", label: "Funnels", href: "/funnels", phase: 2, icon: "layout-template", group: "Insights", roles: ["ADMIN", "USER"] },
  // The public marketing website (b2consultants.de), replacing the GHL-hosted one. ADMIN-only at
  // the section level AND write-gated on `sites.manage`: unlike Forms and Funnels, which capture
  // leads, editing this changes what every ad click lands on.
  { key: "sites", label: "Website", href: "/sites", phase: 2, icon: "globe", group: "Insights", roles: ["ADMIN"] },
  { key: "cv-check", label: "CV Studio", href: "/cv-check", phase: 2, icon: "file-search", group: "Insights", roles: ["ADMIN", "HEAD", "STUDENT"] },
  { key: "whatsapp", label: "WhatsApp", href: "/whatsapp", phase: 3, icon: "message-circle", group: "Insights", roles: ["ADMIN"] },
  // Synamate Conversations parity (Phase 4): unified Email + SMS + WhatsApp inbox + templates.
  { key: "conversations", label: "Conversations", href: "/conversations", phase: 4, icon: "inbox", group: "Insights", roles: ["ADMIN"] },
  // Reporting & Analytics Agent (Phase 6, BUILD_CHECKLIST §10): a minimal pivot report — object →
  // group-by → aggregate — closes the "every number lives on a hardcoded page" gap without new
  // schema. Admin-only, like the rest of Insights' cross-cutting views.
  // §3: Head R · L1/L2/L3 O. Row-level scoping inside the report decides what each one can pull.
  { key: "reports", label: "Reports", href: "/reports", phase: 6, icon: "bar-chart", group: "Insights", roles: ["ADMIN", "HEAD", "USER"] },
  { key: "console", label: "Founder Console", href: "/console", phase: 1, icon: "sliders", group: "Workspace", roles: ["ADMIN"], locked: true },
  // Who did what, when — every write in the app, with an exact IST timestamp.
  // `locked`, for the same reason `console` is: this is the screen that shows whether the
  // access rules are being respected, so it must not be switchable-off or grantable to the
  // people it reports on. A telecaller who could hide the log, or read it, would defeat it.
  { key: "activity", label: "Activity Log", href: "/activity", phase: 1, icon: "shield", group: "Workspace", roles: ["ADMIN"], locked: true },
  // Synamate Automation parity (Phase 5): trigger → action workflow engine.
  // Hidden in code for now — off in the nav and unreachable by route until re-enabled.
  { key: "automation", label: "Automation", href: "/automation", phase: 5, icon: "workflow", group: "Workspace", roles: ["ADMIN"], hidden: true },
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
  /** Enabled and reachable, but not listed in the sidebar. See `offRail` on the catalogue. */
  offRail: boolean;
};

/**
 * Merge the founder's settings over the code catalogue, ordered for the sidebar.
 * A `null` config (nothing saved yet) yields exactly the shipped defaults.
 */
export function resolveSections(config: SectionsConfig | null): ResolvedSection[] {
  const saved = new Map((config?.entries ?? []).map((e) => [e.key, e]));
  return SECTION_CATALOGUE.map((base, i): ResolvedSection => {
    const s = saved.get(base.key);
    // Only some catalogue entries carry `locked` / `hidden`, so the union type doesn't have the keys.
    const locked = "locked" in base && base.locked === true;
    const hiddenByCode = "hidden" in base && base.hidden === true;
    const offRailByCode = "offRail" in base && base.offRail === true;
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
      // A code-hidden section ships off by default, but an explicit config override still wins.
      enabled: locked ? true : (s?.enabled ?? !hiddenByCode),
      // Nav-only. A founder who explicitly enables the section in Console puts it back on the
      // rail too — an explicit "on" should mean what it says.
      offRail: locked ? false : (s?.enabled === true ? false : offRailByCode),
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

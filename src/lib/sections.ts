/** Isomorphic section catalogue - importable from client AND server. rbac.ts layers
 *  the auth/guard logic on top; the access-manager UI renders toggles from this.
 *
 *  TWO LAYERS, ON PURPOSE:
 *   1. SECTION_CATALOGUE - code truth. A section exists because a route exists.
 *      `key`, `href` and `phase` are structural: the founder can't invent them.
 *   2. SectionsConfig - the founder's layer, persisted as JSON in AppSetting.
 *      Label, icon, sidebar group, order, on/off and the default role list are all
 *      theirs to change from /console. Unknown keys are ignored (a route was
 *      removed); missing keys fall back to the catalogue (a route was added).
 *
 *  The `console` section is `locked`: the founder can rename it, but never hide it
 *  or hand it to a non-admin - otherwise the only way back is a database edit.
 */

export type AppRole = "ADMIN" | "HEAD" | "USER" | "STUDENT" | "TUTOR" | "COACH";

export const APP_ROLES: readonly AppRole[] = ["ADMIN", "HEAD", "USER", "STUDENT", "TUTOR", "COACH"] as const;

/** Icon names the console offers. `section-icons.tsx` maps each to a lucide component
 *  and is typed against this list, so adding a name here without a component fails the build. */
export const SECTION_ICON_NAMES = [
  "wallet", "landmark", "phone", "git-branch", "calendar-check", "users",
  "graduation-cap", "clipboard-list", "filter", "file-search", "languages",
  "map", "book-open", "message-circle", "trophy", "sliders", "target", "gift",
  "sparkles", "bar-chart", "shield", "layout-grid", "file-signature", "scale",
  "contact", "kanban", "file-text", "layout-template", "receipt", "inbox", "workflow",
  "globe", "layers", "school", "calendar-days", "calendar-range", "user-check", "medal",
  "route",
] as const;
export type SectionIconName = (typeof SECTION_ICON_NAMES)[number];

/**
 * Sidebar groups the console offers. Free text would let a typo orphan a section.
 *
 * ── Why these seven ─────────────────────────────────────────────────────────────
 * The rail carried ~27 items in five groups, overflowing about 400px below the fold (see
 * AppShell, which had to grow per-group collapse to cope). The size was not really the
 * problem; the shape was. "Insights" had grown into an eight-item drawer holding a
 * landing-page builder, the public website, a WhatsApp console, an inbox and a CV tool -
 * none of which are insights - so its name predicted nothing and every lookup meant
 * reading all eight. "People" was doing the same job for four unrelated audiences at once:
 * staff admin, customers, someone's own daily work, and a tutor's lesson tool.
 *
 * A group name should let you skip the group. These are cut so that each one answers
 * a single question - what am I doing today, what am I teaching, who are we selling to,
 * how do we reach them, how are our students, what did we earn, how are we doing, who
 * runs this - and none holds more than five items for any one role. Nothing removed,
 * nothing renamed except the one pair that genuinely collided (see "funnel" below).
 *
 * ── Why "Classroom" was split out of "My Work" (22 Oct 2026) ───────────────────
 * Shipping the teaching side put My Teaching, Attendance and Leaderboard into My Work,
 * which pushed it to SIX items for ADMIN and SEVEN for HEAD - breaking the only hard
 * rule above. The split restores it: no role now sees more than four in either group.
 *
 * "Students" was the obvious home and is the wrong one. That group answers "who did we
 * sign and what do they owe" (Students, Agreements, German Note, CV Studio) and is read
 * by ADMIN/HEAD/USER. Teaching delivery answers "what am I running today" and is read by
 * COACH/TUTOR/STUDENT, who mostly cannot see Students at all. Merging them would rebuild
 * the four-audiences-one-drawer problem described above, in a new place.
 *
 * Arena deliberately STAYS in My Work. It looks like it belongs here - it is a
 * leaderboard - but its roles are ADMIN/HEAD/USER: it is the sales floor's gamification
 * hub (quests, badges, XP), and no COACH, TUTOR or STUDENT can open it. Filing it under
 * Classroom would put a telecaller's tool under a teaching heading and hand USER a
 * one-item "Classroom" group containing nothing to do with a classroom.
 *
 * "People", "Workspace" and "Money" are kept in this list as legacy-safe fallbacks: a saved
 * founder config that still names one must resolve rather than orphaning its section.
 */
export const SECTION_GROUPS = [
  "My Work",
  "Classroom",
  "Sales",
  "Marketing",
  "Students",
  "Finance",
  "Insights",
  "Admin",
  // Legacy - no longer assigned in the catalogue, still resolvable from a saved config.
  "People",
  "Workspace",
  "Money",
] as const;

/**
 * The groups the Console actually OFFERS, as opposed to the ones it will accept.
 *
 * `SECTION_GROUPS` has to keep the retired names or `config-schema`'s `z.enum` would reject a
 * config saved before the regrouping, orphaning every section in it. But a founder opening the
 * dropdown should not be invited to file something under "Money" - a name nothing has used since
 * that group was split - so the picker reads this shorter list instead.
 */
export const SECTION_GROUPS_ASSIGNABLE = [
  "My Work",
  "Classroom",
  "Sales",
  "Marketing",
  "Students",
  "Finance",
  "Insights",
  "Admin",
] as const satisfies readonly SectionGroup[];
export type SectionGroup = (typeof SECTION_GROUPS)[number];

type SectionCatalogueEntry = {
  readonly key: string;
  readonly href: string;
  readonly phase: number;
  readonly label: string;
  readonly icon: SectionIconName;
  readonly group: SectionGroup;
  readonly roles: readonly AppRole[];
  /** always enabled, always ADMIN-only - the founder can't lock themselves out */
  readonly locked?: boolean;
  /**
   * THE SIGNED-IN PERSON'S OWN PAGE - and therefore STUDENT only, whoever asks.
   *
   * These three (Dashboard, My Journey, My Classroom) don't take a student id: they resolve
   * the signed-in USER to their own `Student` row and show that one person's classes, money
   * and progress. So the section is not a permission to be handed out - no role grant, and no
   * ADMIN bypass, can make the page work for somebody who has no student record. Before this
   * flag existed the ADMIN bypass below listed all three in the founder's rail, and every one
   * of them answered "Your login isn't linked to a student record yet" - three dead ends that
   * read as a bug, and a My Classroom that looked empty while My Teaching listed students.
   *
   * Staff read the same facts where they are editable and scoped to a person they pick: the
   * Students board, the batch timetable and My Teaching.
   */
  readonly personal?: boolean;
  /** hidden in code: ships disabled by default (nav + route), but the console can still re-enable it */
  readonly hidden?: boolean;
  /**
   * THE SCREENS WHERE THE READ IS THE RISK  (issue B7)
   *
   * ── The asymmetry this names ────────────────────────────────────────────────────────────
   * `lib/capabilities.ts` is explicit that seeing and doing are separate concerns, so that "a
   * Head coach can be given the Finance screen to read the numbers without being able to post
   * to the ledger". That holds for the WRITES: `finance.write` is a capability, granted
   * per-person, deliberately, ADMIN-only by default.
   *
   * The READ had no such ceremony. It is step 5 of `sectionAllowed` - `s.roles.includes(role)` -
   * where `s.roles` comes from the founder's saved JSON. So adding USER to `finance` in
   * Console → Sections is one unconfirmed checkbox that hands every telecaller the P&L, the
   * runway, the receivables ledger and the owner's equity. The destructive action was gated and
   * the confidential one was a toggle, which is backwards: a bad write is visible and
   * reversible, and a disclosure is neither.
   *
   * This flag does NOT change what `sectionAllowed` decides. It is metadata the Console reads to
   * require a typed confirmation before WIDENING one of these sections to a new role, and to
   * mark the row so the founder can see which checkboxes are the expensive ones. Narrowing is
   * never gated - taking access away should always be one click.
   *
   * ── Why it is a property of the catalogue ───────────────────────────────────────────────
   * Whether a screen shows the company's money is a fact about the screen, like `personal` and
   * unlike a label. If it lived in the saved config the founder could switch off the
   * confirmation on the very section it exists to protect.
   */
  readonly sensitive?: boolean;
  /**
   * OFF THE RAIL, STILL OPEN.
   *
   * Distinct from `hidden`, and the distinction matters: `hidden` sets `enabled: false`, which
   * makes `requireSection` REFUSE the route - a screen nobody can reach. This one only drops the
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
  /**
   * ROLE DEFAULTS FOLLOW SPEC §3 (`02-dashboard-rebuild-by-role-and-access.md`), by the founder's
   * ruling: grant what the matrix grants, and switch off per person from Console → Sections or
   * a user's Access dialog. Console → Access Matrix reports any remaining drift.
   *
   * ONE DELIBERATE EXCEPTION, and it is the important one. §3's `O` means "own records only".
   * Where the own-records view is a DIFFERENT surface from the team board, the board is NOT
   * granted - a Student with `O` on "Students - all" reads their own journey at /my-journey, and
   * putting them on /students would hand them every other student's record. Same for Tutor and
   * Student on Bookings, and Student on Invoices. `R`/`E`/`F` rows are granted outright; `O` rows
   * are granted only where the section itself is already self-scoped (My Desk, Daily Log).
   *
   * ORDER IS MEANINGFUL. The default sidebar order follows this array, and AppShell lets each
   * group land where its FIRST member does - so moving one entry can move its whole group. The
   * seven blocks below are therefore written in the order they should appear on the rail.
   */

  // ─────────────────────────────── Finance ───────────────────────────────
  // First on the rail by the founder's choice (17 Sep 2026): Finance is what Ameen opens most.
  // Admin-only except Bonus & Commission, so a Head sees that one item at the top and no other role
  // sees this block at all.
  { key: "finance", label: "Finance", href: "/finance", phase: 1, icon: "wallet", group: "Finance", roles: ["ADMIN"], sensitive: true },
  { key: "cash", label: "Cash Health", href: "/cash", phase: 3, icon: "landmark", group: "Finance", roles: ["ADMIN"], sensitive: true },
  /*
   * REMOVED 23/10/2026: `ledger` - the read-only journal, trial balance and audit-chain check.
   *
   * It shipped `hidden: true`, so like `cv-check` and `automation` it was already off the nav and
   * refused by the route for every role including ADMIN. Removed at the founder's instruction,
   * after the trade-off was put to them twice.
   *
   * THE POSTING ENGINE IS UNTOUCHED, and that distinction is the whole of it. `server/ledger.ts`
   * and `server/ledger-core.ts` remain: six modules post through them (finance-actions,
   * finance-autopost, commission-actions, equity-actions, invoice-posting, payments-actions), so
   * every rupee is still double-entry recorded exactly as before. Only the SCREEN is gone.
   *
   * What that costs, recorded plainly: there is no longer any way to read the journal, the trial
   * balance or the hash-chain verification from inside the product. `verifyAuditChain` had no
   * other caller, so the tamper-evidence of `AuditEntry` is now unverifiable through the UI. The
   * functions themselves survive in `ledger-core.ts` and take a `LedgerDb`, so a script or a new
   * screen can call them with no new engine code - see the note at the top of server/ledger.ts.
   */
  // Synamate Payments parity (Phase 3): invoices, estimates, products, subscriptions.
  { key: "payments", label: "Payments", href: "/payments", phase: 3, icon: "receipt", group: "Finance", roles: ["ADMIN"], sensitive: true },
  // Kept last in the Finance group on purpose: the default sidebar order follows this
  // catalogue order, so placing "Bonus & Commission" after Payments drops it to the bottom of Finance.
  // §3 "Commissions - all": Head R. The telecaller tiers get their OWN commission on My Desk, not
  // the whole-team board - §3 gives them `O` here, not `R`.
  { key: "telecaller", label: "Bonus & Commission", href: "/telecaller", phase: 1, icon: "phone", group: "Finance", roles: ["ADMIN", "HEAD"], sensitive: true },

  // ─────────────────────────────── My Work ───────────────────────────────
  // What the person signed in is doing today, first, because it is the only block that is
  // theirs. These were scattered through the old "People" group behind Users and Agreements -
  // My Desk in particular is where a telecaller lives all day, and it sat fourth in a group of
  // six. Every role sees a different two or three of these, and no role sees an empty group.

  // The telecaller's OWN numbers + today's call list - a personal work view (the counterpart to
  // "Bonus & Commission": that board is Ameen looking at the team, this is Nilofer/Asma looking at
  // themselves). USER is in the default list; ADMIN can inspect it, and the page renders an
  // explainer for anyone with no telecaller profile, since "telecaller" is a
  // TeamProfile.logVariant, not a role that could gate a section.
  { key: "my-desk", label: "My Desk", href: "/my-desk", phase: 1, icon: "phone", group: "My Work", roles: ["ADMIN", "HEAD", "USER"] },
  /**
   * §3 gives Tutor `O` here, and this screen is already self-scoped - it is the person's OWN log,
   * which is also where a tutor's sessions-delivered figure comes from.
   *
   * USER is NOT in this list, and that is the telecallers (founder's call). Their day is already
   * counted from their actual calls - My Desk shows their own numbers, Bonus & Commission shows the
   * team board, both derived from CallLog rather than self-reported. Asking them to also write a
   * daily log recorded the same day twice by two methods that could disagree, and the hand-typed
   * one is the one nobody can check. They are off the People logs board for the same reason.
   *
   * Coaches (HEAD) and tutors keep it: a delivery session leaves no CallLog behind, so their log
   * IS the record of it. USER is a single role covering L1/L2/L3, so if a non-telecaller USER
   * ever needs this back it is one toggle in Console → Sections or their Access dialog, per
   * person - which is the mechanism this catalogue is designed to be tuned by.
   */
  { key: "daily-log", label: "My Daily Log", href: "/daily-log", phase: 2, icon: "clipboard-list", group: "My Work", roles: ["HEAD", "TUTOR", "COACH"] },
  /**
   * The student's FRONT DOOR, and the first thing in their rail.
   *
   * The portal had two screens and no landing: My Journey is a scoreboard ("how far have I
   * come") and My Classroom is a timetable ("what is on"). Neither answers the question someone
   * actually signs in with - "what do I need to do now" - so a student arriving on a gamified
   * ring had to work out for themselves which of the other two held the answer. This owns no
   * data; it summarises both and links out.
   */
  { key: "dashboard", label: "Dashboard", href: "/dashboard", phase: 2, icon: "layout-grid", group: "My Work", roles: ["STUDENT"], personal: true },
  // STUDENT portal: their own journey only.
  { key: "my-journey", label: "My Journey", href: "/my-journey", phase: 2, icon: "map", group: "My Work", roles: ["STUDENT"], personal: true },
  /**
   * The student's CLASSROOM - their batch timetable, join links, recordings, coursework and
   * their own attendance.
   *
   * Separate from My Journey rather than another section on it, because the two answer
   * different questions at different cadences. My Journey is "how far have I come" - a
   * scoreboard you open once a week. This is "what is on, when, and what do I owe" - the page
   * a student opens on a Saturday morning to find the Zoom link. Folding the timetable into
   * the scoreboard would have buried the one time-critical thing the portal has to do.
   *
   * STUDENT only. Staff read the same timetable from the batch itself (/batches/[id]), where
   * they can also edit it; this route is deliberately read-only and self-scoped.
   */
  { key: "classroom", label: "My Classroom", href: "/classroom", phase: 2, icon: "calendar-days", group: "Classroom", roles: ["STUDENT"], personal: true },
  /**
   * The TEACHING desk - one screen for everyone who stands in front of a batch.
   *
   * COACH and TUTOR share it on purpose. A coach runs a B2 cohort through the curriculum and a
   * tutor runs a German Note level through its classes, but the DAY is the same shape for both:
   * what am I teaching next, who is in the room, take the register, post the recording, set the
   * coursework. Two screens for that would have been the same code twice with the batch line
   * swapped. The desk scopes itself by what you actually lead - `Batch.tutorId`, plus
   * `Enrollment.coachId` for a coach's own students - so neither sees the other's cohorts.
   *
   * ADMIN and HEAD are included to supervise; both also keep the full Students board.
   */
  { key: "coaching", label: "My Teaching", href: "/coaching", phase: 2, icon: "school", group: "Classroom", roles: ["ADMIN", "HEAD", "COACH", "TUTOR"] },
  /**
   * THE REGISTER DESK - its own door, for a job with a deadline measured in minutes.
   *
   * Taking attendance was already possible from two places, and both of them are somewhere
   * else you were going: a tab on the cohort page and a row on the German Note schedule. That
   * is the right home for a correction a week later, and the wrong one for what this is
   * actually for - the first two minutes of a class, while the tutor is also sharing a screen
   * and greeting eight people. Nobody navigates a cohort page to find a tab at that moment,
   * which is most of why the register has historically gone untaken.
   *
   * It is in My Work rather than beside the batches on purpose: this is a thing you DO on your
   * own day, not a record you browse. Same role list as My Teaching, because it is the same
   * people doing the same job from a different angle - and HEAD is in it because the founders
   * asked for the head coach to be able to enable attendance, which is the one permission this
   * feature widens (see `canMark` in server/attendance-actions.ts).
   */
  { key: "attendance", label: "Attendance", href: "/attendance", phase: 2, icon: "user-check", group: "Classroom", roles: ["ADMIN", "HEAD", "COACH", "TUTOR"] },
  /**
   * BATCHES & PLANS - the setup side of a classroom, as opposed to the running of one.
   *
   * It exists because the job was spread over three doors and named after none of them:
   * cohorts were created on a tab of the Students board, the week-by-week plan on a tab of
   * Programs, and the dates and times on `/batches/[batchId]`, which nothing linked to unless
   * you came through one of the other two. The founders do all three in one sitting - write
   * the plan, make the batch, set its dates - so there is now one door for it.
   *
   * ADMIN only, and not by oversight: `upsertBatch` and every curriculum action are
   * `requireAdmin`, so handing a head coach this section would draw forms the server refuses.
   * Their side of a classroom is My Teaching, which lists every cohort and lets them run any
   * of it. The page re-checks with `requireAdmin()` regardless - the role list is a default
   * the founder can edit, and a rail that can be re-pointed is never the fence.
   */
  /**
   * ── Open to the head coach as well, so `batches.manage` can be exercised (P18) ─────────
   *
   * This was ADMIN-only while `batches.manage` - the capability that gates SEATING - was
   * grantable to a head coach, and the only screen with a roster on it was this one. A
   * permission the role it was written for cannot exercise is a decoration, not a permission.
   *
   * The page itself decides what a visitor may DO: creating, editing and deleting a cohort stay
   * `requireAdmin()` and their controls are not drawn for anyone else, the Plans tab is not
   * built for them either, and a visitor holding neither admin nor `batches.manage` is turned
   * away rather than shown a read-only shell. So widening the section widens who can SEE
   * cohorts, which is the thing a head coach was missing.
   */
  { key: "batches", label: "Batches & Plans", href: "/batches", phase: 2, icon: "calendar-range", group: "Classroom", roles: ["ADMIN", "HEAD"] },
  /**
   * THE SPRINT LEADERBOARD - and the only section in the catalogue a student and their coach
   * both open to look at the same thing.
   *
   * Four taught weeks, then a 90-day (Guided) or 120-day (Elite) sprint. The taught weeks are
   * measured by attendance and coursework; the sprint is measured by what a student does with
   * them - applications, recruiter connections, interviews. One board spans both, because a
   * student who attended everything and applied to nothing and a student who attended nothing
   * and applied to forty roles are both in trouble, and only a number that includes both can
   * say so.
   *
   * STUDENT is in this list, which makes it the first section where a student sees another
   * student. That is a deliberate reversal of the privacy line every other student page holds
   * (on /classroom a classmate is a COUNT, never a name), taken because the founders asked for
   * a leaderboard and a leaderboard of strangers motivates nobody. It is also why the admin can
   * turn the names off: `visibility` in the leaderboard config is NAMED, ANONYMISED or
   * STAFF_ONLY, and `viewFor` in server/leaderboard.ts strips the names on the server rather
   * than hiding them in the page.
   */
  { key: "leaderboard", label: "Leaderboard", href: "/leaderboard", phase: 2, icon: "medal", group: "Classroom", roles: ["ADMIN", "HEAD", "COACH", "TUTOR", "STUDENT"] },
  { key: "arena", label: "Arena", href: "/arena", phase: 2, icon: "trophy", group: "My Work", roles: ["ADMIN", "HEAD", "USER"] },
  // Help belongs beside your own work, not in an admin drawer. It is also what keeps this group
  // non-empty for a Tutor or a Student, who would otherwise be left with a single item.
  { key: "guide", label: "App Guide", href: "/guide", phase: 1, icon: "book-open", group: "My Work", roles: ["ADMIN", "HEAD", "USER", "STUDENT", "TUTOR", "COACH"] },

  // ──────────────────────────────── Sales ────────────────────────────────
  /**
   * ── The Sales group is FOUR entries, not five ──────────────────────────────────
   * It held Pipeline · Contacts · Opportunities · Bookings · Outreach, two of which are the same
   * board twice: `/pipeline` is a kanban of `Lead.stage` and `/opportunities` is a kanban of
   * `Opportunity.stageId` mirrored back onto `Lead.stage`. A telecaller opening the rail saw
   * five doors into what is, to them, one job.
   *
   * Outreach is `offRail` - off the sidebar, still fully built and still reachable, because it
   * is surfaced from Pipeline, which is where it belongs: it is the SOP queue for the pipeline.
   * The founder can put it back on the rail from Console → Sections at any time.
   *
   * Opportunities WAS offRail for the same reason, on the grounds that it was "the same pipeline
   * as a board". It is back on the rail as "Deals" (see its entry): it was off the rail to avoid
   * a duplicate door, and once Pipeline pointed at /pipeline there was no duplicate left.
   *
   * This is presentation only. Nothing is deleted, no route is removed, and no access changes -
   * merging the two boards into one is a separate, larger piece of work.
   */
  /**
   * ── Pipeline points at /pipeline again (refactor step E1, 23/10/2026) ───────────────────
   *
   * It was re-pointed at /opportunities on 06/08/2026 for a good reason: "the board is what the
   * team works out of all day, and the metrics screen was a detour they had to click past". That
   * reason has since stopped applying, and the arrangement had two costs the founder's call never
   * agreed to:
   *
   *  · /pipeline now HAS the board. It carries the lead kanban as its own tab alongside the
   *    metrics, so the detour the move was avoiding is no longer there to avoid.
   *  · The rail entry and the route it opened were gated on DIFFERENT sections. "Pipeline" is
   *    checked against `pipeline`, but /opportunities runs `requireSection("opportunities")` - so
   *    a founder who split the two in Console → Sections produced a visible nav item that
   *    refuses to open. Two doors to one address, each answering to a different key, is the
   *    duplicate-door problem (P7) rather than a shortcut.
   *
   * So each entry now leads to the page gated on its own key, and the deal board gets its own
   * honest name below. No access changes: both keys keep the roles they had.
   */
  { key: "pipeline", label: "Pipeline", href: "/pipeline", phase: 1, icon: "kanban", group: "Sales", roles: ["ADMIN", "HEAD", "USER"] },
  // Synamate CRM parity (Phase 1): Contacts (the CRM) + Opportunities (the drag-drop board).
  // Grouped with Pipeline under Sales so the whole lead → contact → deal flow sits together.
  { key: "contacts", label: "Contacts", href: "/contacts", phase: 1, icon: "contact", group: "Sales", roles: ["ADMIN", "USER"] },
  /**
   * THE DEAL BOARD, called "Deals" and not "Opportunities".
   *
   * `key` stays `opportunities` on purpose. The route's own `requireSection("opportunities")`, the
   * founder's saved `SectionsConfig` and every per-user override are all keyed on it, so renaming
   * the key would silently reset whoever had it configured - and the rename being asked for here
   * is one of wording, not of access. Only what the reader sees changes.
   *
   * Back on the rail, because it is no longer the same door as Pipeline: Pipeline is the lead
   * funnel with its metrics, Deals is the drag-and-drop board of `Opportunity.stageId`. Sales
   * holds four rail items for a founder with this on - inside the catalogue's own limit of five.
   */
  { key: "opportunities", label: "Deals", href: "/opportunities", phase: 1, icon: "kanban", group: "Sales", roles: ["ADMIN", "HEAD", "USER"] },
  // §3: Head R · L1/L2/L3 E. Tutor and Student are `O` - their own calls surface on their own
  // screens, and this is the whole-team calendar, so they are not granted it.
  { key: "bookings", label: "Bookings", href: "/bookings", phase: 1, icon: "calendar-check", group: "Sales", roles: ["ADMIN", "HEAD", "USER"] },
  // The Outreach Specialist SOP queue (Script_for_Outreach_Specialist.docx, Steps 1-23) + the
  // Key Metrics sheet it feeds. USER is in the default list because the outreach specialist IS a
  // USER - this is their day's work, not an admin report.
  { key: "outreach", label: "Outreach", href: "/outreach", phase: 1, icon: "message-circle", group: "Sales", roles: ["ADMIN", "USER"], offRail: true },

  // ────────────────────────────── Marketing ──────────────────────────────
  // How a stranger first reaches us, and how we answer them. All five of these used to sit in
  // "Insights", which is what made that group unreadable: a landing-page builder, the public
  // website and a shared inbox are things you BUILD and OPERATE, not numbers you read.

  // The public marketing website (b2consultants.de), replacing the GHL-hosted one. ADMIN-only at
  // the section level AND write-gated on `sites.manage`: unlike Forms and Funnels, which capture
  // leads, editing this changes what every ad click lands on.
  { key: "sites", label: "Website", href: "/sites", phase: 2, icon: "globe", group: "Marketing", roles: ["ADMIN"] },
  // Synamate Sites parity (Phase 2): native form + funnel/landing-page builders with public hosting.
  { key: "funnels", label: "Funnels", href: "/funnels", phase: 2, icon: "layout-template", group: "Marketing", roles: ["ADMIN", "USER"] },
  { key: "forms", label: "Forms", href: "/forms", phase: 2, icon: "file-text", group: "Marketing", roles: ["ADMIN", "USER"] },
  { key: "whatsapp", label: "WhatsApp", href: "/whatsapp", phase: 3, icon: "message-circle", group: "Marketing", roles: ["ADMIN"] },
  // Synamate Conversations parity (Phase 4): unified Email + SMS + WhatsApp inbox + templates.
  { key: "conversations", label: "Conversations", href: "/conversations", phase: 4, icon: "inbox", group: "Marketing", roles: ["ADMIN"] },

  // ─────────────────────────────── Students ──────────────────────────────
  // Everything about a person once they have bought: their record, their contract, and the two
  // tools we deliver to them. These were split across "People" (Students, Agreements, German
  // Note) and "Insights" (CV Studio), so answering "what is going on with this student" meant
  // opening two unrelated groups.

  /**
   * ONBOARDING - lead → discovery → payment → agreement → cohort → class, on one screen.
   *
   * First in this group because it is the group's entry point: everything else here is about a
   * person who has already arrived, and this is how they arrive.
   *
   * It exists because the journey the business runs on was not a journey anywhere in the app.
   * `Lead.stage` covered the sales half, `Student` + `Enrollment` + a seat covered delivery, and
   * nothing joined them - so no screen could show where somebody had got to, and no screen could
   * list the ones stuck in between. Doing it by hand meant about fifteen screens across six nav
   * groups, and SIX different places could bring a `Student` row into existence, three of which
   * leave it with no enrolment at all. The founder's verdict was the plain one: "there are too
   * many sections to add a student and I myself can't understand."
   *
   * A DOOR, not a seventh way to add a student. It owns no data: every row links to the person
   * hub that already exists and every action links to the screen that already does that job. The
   * state is DERIVED (lib/journey-state.ts), the way `agreement-state.ts` derives its eight -
   * no column, no migration, and the board can never disagree with the record.
   *
   * Same roles as `students`: the people who already read that board are the people who onboard.
   */
  { key: "onboarding", label: "Onboarding", href: "/onboarding", phase: 2, icon: "route", group: "Students", roles: ["ADMIN", "HEAD", "USER"] },
  // §3: Head F · L1/L2/L3 R. Tutor and Student are `O` - a student's own record is /my-journey and
  // a tutor's own batch roster is on German Note; this board is every student.
  { key: "students", label: "Students", href: "/students", phase: 2, icon: "graduation-cap", group: "Students", roles: ["ADMIN", "HEAD", "USER"] },
  // §3: Head E · L3 E (L1/L2 hidden). L1/L2/L3 are one USER role, so USER is granted here and the
  // ones who shouldn't have it are switched off per person. Student is `O` - their own agreement
  // is on /my-journey. Issuing still needs the `agreements.issue` capability regardless.
  { key: "agreements", label: "Agreements", href: "/agreements", phase: 4, icon: "file-signature", group: "Students", roles: ["ADMIN", "HEAD", "USER"] },
  /**
   * German Note LMS: batches + class recordings + community (Phase 4).
   *
   * STUDENT removed 14/10/2026. The role is coarse - a B2 coaching student and a German Note
   * student are both STUDENT - so granting it by role put "German Note" in the sidebar of every
   * student including Solo/Guided/Elite ones, who are not German Note at all. The page itself
   * already knew better (`isParticipant` is false without a GN batch seat, so they saw an empty
   * screen), but the nav entry still said they belonged to a business they had not bought.
   *
   * A real German Note student gets it back through the PER-USER override in Users & access,
   * which wins over the role default - see `canAccessSection` below. If GN students become
   * routine, replace this with a seat check rather than granting STUDENT again.
   */
  { key: "german-note", label: "German Note", href: "/german-note", phase: 4, icon: "languages", group: "Students", roles: ["ADMIN", "HEAD", "TUTOR"] },
  /*
   * REMOVED 23/10/2026: `cv-check` (CV Studio) - the resume builder and AI CV review.
   *
   * It shipped `hidden: true` from 14/10/2026, which means it was off the nav AND refused by the
   * route for every role including ADMIN - so it had been unreachable for nine days before being
   * deleted, and nobody loses a working feature.
   *
   * Removed at the founder's explicit instruction ("I do not want this in the application"). The
   * code is gone: the page, `server/resume-actions`, `server/resume-metrics`,
   * `server/job-descriptions` (which had no importer at all), `lib/resume-*`, `lib/cv-analysis`,
   * the PDF/DOCX renderers, `/api/resume/[id]/download` and `/api/cv-extract`.
   *
   * The `Resume`, `ResumeReview` and `JobDescription` TABLES are deliberately left in place.
   * Deleting code is one `git revert` away from undone; dropping rows is not, and it is a
   * separate decision to take on its own.
   *
   * A saved SectionsConfig that still names "cv-check" resolves harmlessly - `resolveSections`
   * ignores keys the catalogue no longer has, exactly so a removal needs no migration.
   */

  // ─────────────────────────────── Insights ──────────────────────────────
  // What is left once the builders and the inboxes move out: the two screens you open to READ a
  // number rather than to do a job. A two-item group is the point here, not an oversight.

  // Reporting & Analytics Agent (Phase 6, BUILD_CHECKLIST §10): a minimal pivot report - object →
  // group-by → aggregate - closes the "every number lives on a hardcoded page" gap without new
  // schema.
  // §3: Head R · L1/L2/L3 O. Row-level scoping inside the report decides what each one can pull.
  { key: "reports", label: "Reports", href: "/reports", phase: 6, icon: "bar-chart", group: "Insights", roles: ["ADMIN", "HEAD", "USER"] },
  /**
   * "Funnel Report", not "Conversion Funnel".
   *
   * The old label sat four rows above "Funnels" in the SAME group, and the two are unrelated:
   * this is a read-only conversion report, "Funnels" is the landing-page builder. Two names that
   * read the same, side by side, describing different things, is a trap rather than a label.
   * They now sit in different groups AND read differently. `key` is untouched, so no access, no
   * route and no saved config changes.
   */
  { key: "funnel", label: "Funnel Report", href: "/funnel", phase: 3, icon: "filter", group: "Insights", roles: ["ADMIN"], sensitive: true },

  // ──────────────────────────────── Admin ────────────────────────────────
  // Who runs the system. Every member is ADMIN-only, so this group simply does not render for
  // anyone else - which is exactly why "App Guide" was moved out of it and up to My Work.
  { key: "console", label: "Founder Console", href: "/console", phase: 1, icon: "sliders", group: "Admin", roles: ["ADMIN"], locked: true },
  { key: "people", label: "Users", href: "/people", phase: 2, icon: "users", group: "Admin", roles: ["ADMIN"], sensitive: true },
  /**
   * What B2 Consultants sells: the coaching tiers, and the GL account each one's revenue posts to.
   *
   * These lived on a tab inside German Note, which administered the WHOLE level catalogue from a
   * screen about German courses - so the B2 tiers sat where nobody running B2 would look, and the
   * two lists read as one list when they are different products. German Note keeps its own levels
   * on its own Manage page; this is the other half. `src/lib/levels.ts` holds the split.
   */
  { key: "programs", label: "Programs", href: "/programs", phase: 1, icon: "layers", group: "Admin", roles: ["ADMIN"] },
  // Who did what, when - every write in the app, with an exact IST timestamp.
  // `locked`, for the same reason `console` is: this is the screen that shows whether the
  // access rules are being respected, so it must not be switchable-off or grantable to the
  // people it reports on. A telecaller who could hide the log, or read it, would defeat it.
  { key: "activity", label: "Activity Log", href: "/activity", phase: 1, icon: "shield", group: "Admin", roles: ["ADMIN"], locked: true },
  /*
   * REMOVED 23/10/2026: `automation` - the trigger → action workflow builder.
   *
   * Like `cv-check`, it shipped `hidden: true`, so it was already unreachable by route for every
   * role. Removed at the founder's explicit instruction. The four routes are deleted
   * (`/automation`, `/[id]`, `/settings`, `/stage-messages`) along with every link that pointed
   * into them - eleven of which were live references into a section nobody could open.
   *
   * THE ENGINE CODE STAYS, and that is deliberate rather than an oversight. Unlike CV Studio,
   * which was self-contained, automation is wired into shared infrastructure -
   * `lib/config-schema.ts`, `lib/soft-delete.ts`, `lib/outreach-sop.ts`, `api/cron/workflows` and
   * four `server/automation-*` modules. Unpicking that is surgery on files everything else
   * depends on, for no visible benefit: with the routes and the nav entry gone, the feature is
   * out of the application as far as anyone using it is concerned.
   *
   * `server/automation.ts` and friends are now unreferenced by any route. Removing them is a
   * clean follow-up whenever it is wanted; it just should not ride along with a UI change.
   */
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
  /** The signed-in person's own page: STUDENT only, whatever the config says. See the catalogue. */
  personal: boolean;
  /**
   * Widening this section to a new role needs a typed confirmation in the Console (issue B7).
   * Code truth, never read from the saved config - see `sensitive` on the catalogue entry.
   */
  sensitive: boolean;
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
    const personal = "personal" in base && base.personal === true;
    const sensitive = "sensitive" in base && base.sensitive === true;
    return {
      key: base.key,
      href: base.href,
      phase: base.phase,
      locked,
      // Not founder-overridable, and deliberately not read from the saved config: whether a
      // page is self-scoped is a fact about the code, not a setting. The founder can still
      // switch the section off entirely, or rename and reorder it.
      personal,
      // Same reasoning, same reason it is not read from the config: a founder who could switch
      // this off would be switching off the confirmation that protects the money screens.
      sensitive,
      label: s?.label?.trim() || base.label,
      icon: s?.icon ?? base.icon,
      group: s?.group ?? base.group,
      order: s?.order ?? (i + 1) * ORDER_STEP,
      // A locked section is never off and never leaves ADMIN, whatever the JSON says.
      // A code-hidden section ships off by default, but an explicit config override still wins.
      enabled: locked ? true : (s?.enabled ?? !hiddenByCode),
      // Nav-only. A founder who explicitly enables the section in Console puts it back on the
      // rail too - an explicit "on" should mean what it says.
      offRail: locked ? false : (s?.enabled === true ? false : offRailByCode),
      roles: locked ? ["ADMIN"] : (s?.roles ?? [...base.roles]),
    };
  }).sort((a, b) => a.order - b.order || a.key.localeCompare(b.key));
}

/**
 * THE access rule. Four questions, in order:
 *   1. Has the founder switched this section off? Then nobody goes in.
 *   2. Is this a `personal` section - the signed-in person's own page? STUDENT only.
 *   3. Is this user's per-user override set? It wins over the role default.
 *   4. Otherwise, does the section's role list include them?
 *
 * ADMIN skips (3) and (4) but not (1) or (2) - not (1) except for `locked` sections, which are
 * always on and always admin-only, so the founder can never switch off the screen
 * that would switch everything back on; and not (2) because the bypass cannot conjure the
 * student record those pages read. See `personal` on the catalogue for why that is a rule
 * about the page rather than about trust.
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
  // Ahead of the ADMIN bypass on purpose - see `personal` on the catalogue entry.
  if (s.personal) return role === "STUDENT";
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

/**
 * Role defaults only - the baseline the per-user toggles start from.
 *
 * The `personal` test repeats `sectionAllowed`'s because the founder may add a role to a
 * section's list in Console → Sections, and for a self-scoped page that grant cannot take
 * effect. Leaving it out would pre-tick a box the server then ignores.
 */
export function roleDefaultKeys(role: AppRole, config: SectionsConfig | null = null): SectionKey[] {
  return resolveSections(config)
    .filter((s) => s.enabled && !s.locked && grantableTo(s, role) && s.roles.includes(role))
    .map((s) => s.key);
}

/** Role defaults against an already-resolved list (client-side, no config fetch). */
export function roleDefaultKeysFrom(sections: ResolvedSection[], role: AppRole): SectionKey[] {
  return sections
    .filter((s) => s.enabled && !s.locked && grantableTo(s, role) && s.roles.includes(role))
    .map((s) => s.key);
}

/**
 * Is this section a toggle worth OFFERING for someone in this role?
 *
 * False for a `personal` section outside STUDENT: the checkbox would save, and change nothing,
 * because `sectionAllowed` refuses the page anyway. The access dialog hides those rather than
 * presenting a switch with no effect.
 */
export function grantableTo(s: ResolvedSection, role: AppRole): boolean {
  return !s.personal || role === "STUDENT";
}

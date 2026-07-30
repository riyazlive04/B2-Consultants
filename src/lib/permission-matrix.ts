/**
 * The spec's permission matrix (`02-dashboard-rebuild-by-role-and-access.md` §3), encoded so it
 * can be COMPARED against what the app actually does — Error Log O3.
 *
 * O3 asks for two things: the matrix as the documented default per role, and a screen that shows
 * the effective answer. `sections.ts` already decides access correctly; what was missing was any
 * way to see, in one place, whether those decisions still match the agreed table. A matrix that
 * only lives in a Word document drifts silently.
 *
 * WHY THIS IS A COMPARISON AND NOT A SOURCE OF TRUTH
 * -------------------------------------------------
 * The spec names eight roles; the app has five (`AppRole`). Two collapses follow:
 *
 *   OWNER + ADMIN     → ADMIN    — there is no separate Owner account today.
 *   L1 + L2 + L3      → USER     — the telecaller tiers are one role; L1/L2 are told apart by
 *                                  `TeamProfile.logVariant`, which is not a role and cannot gate
 *                                  a section.
 *
 * Wherever the spec gives two collapsed roles DIFFERENT access, the app cannot express the rule at
 * all — not as a role default, only as a per-user override. Those rows resolve to `SPEC_CONFLICT`
 * below rather than being quietly rounded to whichever side seemed safer. They are the concrete
 * argument for the role-model rework (plan item 4.1), and they are the reason this file reports
 * drift instead of enforcing it: making it authoritative would mean picking a side in a conflict
 * the spec never resolved.
 *
 * Access levels are the spec's own: F full · E edit · R read · O own records only · `-` hidden.
 * Sections are BOOLEAN — a section either opens or it does not. So only the hidden/visible
 * distinction is checked here; the F/E/R/O gradations are enforced by `capabilities.ts` and by
 * per-page guards, and are recorded in this table for review rather than diffed.
 */

import type { AppRole, ResolvedSection, SectionKey, SectionOverrides } from "./sections";
import { sectionAllowed } from "./sections";

export const SPEC_ROLES = ["OWNER", "ADMIN", "HEAD_COACH", "L1", "L2", "L3", "TUTOR", "STUDENT"] as const;
export type SpecRole = (typeof SPEC_ROLES)[number];

export const SPEC_ROLE_LABELS: Record<SpecRole, string> = {
  OWNER: "Owner",
  ADMIN: "Admin",
  HEAD_COACH: "Head Coach",
  L1: "L1",
  L2: "L2",
  L3: "L3",
  TUTOR: "Tutor",
  STUDENT: "Student",
};

/** How each spec role lands on a role the app can actually gate with. */
export const SPEC_ROLE_TO_APP_ROLE: Record<SpecRole, AppRole> = {
  OWNER: "ADMIN",
  ADMIN: "ADMIN",
  HEAD_COACH: "HEAD",
  L1: "USER",
  L2: "USER",
  L3: "USER",
  TUTOR: "TUTOR",
  STUDENT: "STUDENT",
};

export type AccessLevel = "F" | "E" | "R" | "O" | "-";

const LEVELS = new Set<string>(["F", "E", "R", "O", "-"]);

export type MatrixRow = {
  readonly key: string;
  readonly label: string;
  /**
   * Section keys this row gates. EMPTY means the module is not a routable section — it is a tab,
   * a card on a page someone else owns, or a capability. Those rows are reported `NOT_GATEABLE`
   * rather than counted as drift, and `note` says what actually enforces them.
   */
  readonly sections: readonly SectionKey[];
  readonly note?: string;
  /** The spec row, in spec column order, space-separated. Kept in the table's own shape so it can be read against the document. */
  readonly spec: string;
};

/**
 * §3, verbatim, in document order. Column order is `SPEC_ROLES`.
 *
 *                                        Own Adm Head L1  L2  L3  Tut Std
 */
export const PERMISSION_MATRIX: readonly MatrixRow[] = [
  { key: "executive", label: "Executive dashboard", sections: [], note: "The home page `/`, which every signed-in user reaches; the cards on it are gated individually, not by a section key.", spec: "F   F   R    -   -   -   -   -" },
  { key: "finance-revenue", label: "Finance — revenue, targets", sections: ["finance"], spec: "F   F   -    -   -   -   -   -" },
  { key: "finance-cash", label: "Finance — runway, cash, break-even", sections: ["cash"], spec: "F   R   -    -   -   -   -   -" },
  { key: "finance-entry", label: "Income & expense entry", sections: [], note: "Enforced by the `finance.write` capability, not by a section — the Finance screen can be read without it.", spec: "F   E   -    -   -   -   -   -" },
  { key: "payables", label: "Payables & receivables", sections: [], note: "Lives inside Cash Health; the `finance.write` capability gates the writes.", spec: "F   E   -    -   -   -   -   -" },
  { key: "ledger", label: "Ledger / journals / trial balance", sections: ["ledger"], note: "Code-hidden today (`hidden: true`) — off in the nav and unreachable by route until the console re-enables it.", spec: "F   R   -    -   -   -   -   -" },
  { key: "commissions-all", label: "Commissions — all", sections: ["telecaller"], spec: "F   R   R    -   -   -   -   -" },
  { key: "commissions-own", label: "Commissions — own", sections: ["my-desk"], note: "A person's own commission shows on their desk; the all-team board is the row above.", spec: "F   F   O    O   O   O   -   -" },
  { key: "pipeline-all", label: "Pipeline — all leads", sections: ["pipeline"], spec: "F   F   R    R   R   R   -   -" },
  { key: "pipeline-assigned", label: "Pipeline — assigned leads", sections: ["pipeline"], note: "Same screen as the row above; row-level scoping decides which leads appear.", spec: "F   F   O    O   O   O   -   -" },
  { key: "opportunities", label: "Opportunity board", sections: ["opportunities"], spec: "F   E   E    E   E   E   -   -" },
  { key: "bookings", label: "Bookings & calendar", sections: ["bookings"], spec: "F   E   R    E   E   E   O   O" },
  { key: "students", label: "Students — all", sections: ["students"], spec: "F   F   F    R   R   R   O   O" },
  { key: "agreements", label: "Agreements", sections: ["agreements"], spec: "F   E   E    -   -   E   -   O" },
  { key: "book-orders", label: "Book orders (German Note)", sections: ["german-note"], spec: "F   E   E    -   -   -   R   O" },
  { key: "invoices", label: "Invoices & estimates", sections: ["payments"], spec: "F   E   -    -   -   -   -   O" },
  { key: "arena", label: "Arena / leaderboard", sections: ["arena"], spec: "F   R   R    R   R   R   -   -" },
  { key: "daily-log", label: "Daily log", sections: ["daily-log"], spec: "F   R   R    O   O   O   O   -" },
  { key: "my-desk", label: "My Desk", sections: ["my-desk"], spec: "F   O   O    O   O   O   O   -" },
  { key: "users", label: "Users & access", sections: ["people"], note: "Admin may create and edit all roles EXCEPT Admin/Owner (spec footnote).", spec: "F   E   -    -   -   -   -   -" },
  { key: "audit", label: "Audit log", sections: ["activity"], note: "`locked` in the catalogue: always on, always Admin — it reports on the people who would otherwise be able to switch it off.", spec: "F   R   -    -   -   -   -   -" },
  { key: "reports", label: "Reports & Excel export", sections: ["reports"], spec: "F   F   R    O   O   O   -   -" },
];

/** Parse a row's spec string into one level per spec role, in `SPEC_ROLES` order. */
export function levelsOf(row: MatrixRow): Record<SpecRole, AccessLevel> {
  const parts = row.spec.trim().split(/\s+/);
  if (parts.length !== SPEC_ROLES.length) {
    throw new Error(`permission-matrix: row "${row.key}" has ${parts.length} levels, expected ${SPEC_ROLES.length}`);
  }
  const out = {} as Record<SpecRole, AccessLevel>;
  SPEC_ROLES.forEach((r, i) => {
    const p = parts[i];
    if (!LEVELS.has(p)) throw new Error(`permission-matrix: row "${row.key}" has unknown level "${p}"`);
    out[r] = p as AccessLevel;
  });
  return out;
}

export type SpecVisibility = "VISIBLE" | "HIDDEN" | "CONFLICT";

/**
 * What the spec says an APP role should see for this module.
 *
 * `CONFLICT` when the spec roles collapsing onto this app role disagree — e.g. Agreements is `E`
 * for L3 but `-` for L1 and L2, and all three are `USER`. There is no honest answer; the app has
 * to pick one for everybody, or the role model has to change.
 */
export function specVisibility(row: MatrixRow, appRole: AppRole): SpecVisibility {
  const levels = levelsOf(row);
  const relevant = SPEC_ROLES.filter((r) => SPEC_ROLE_TO_APP_ROLE[r] === appRole);
  if (relevant.length === 0) return "HIDDEN";
  const visible = relevant.map((r) => levels[r] !== "-");
  if (visible.every(Boolean)) return "VISIBLE";
  if (visible.every((v) => !v)) return "HIDDEN";
  return "CONFLICT";
}

/** The spec roles that disagree for this app role — what the console names when it flags a conflict. */
export function conflictingSpecRoles(row: MatrixRow, appRole: AppRole): SpecRole[] {
  const levels = levelsOf(row);
  return SPEC_ROLES.filter((r) => SPEC_ROLE_TO_APP_ROLE[r] === appRole && levels[r] !== "-");
}

export type DriftVerdict =
  /** app and spec agree */
  | "ALIGNED"
  /** the app opens something the spec hides — the direction that leaks data */
  | "APP_WIDER"
  /** the app hides something the spec grants — an access gap, not a leak */
  | "APP_NARROWER"
  /** the spec's collapsed roles disagree; the app cannot express it either way */
  | "SPEC_CONFLICT"
  /** no section gates this row; see `note` */
  | "NOT_GATEABLE";

/**
 * Compare one module against the live config for one app role.
 *
 * ADMIN short-circuits to allowed in `sectionAllowed`, so every row reads VISIBLE for Admin. That
 * is the app's actual behaviour and the comparison reports it honestly — the spec's narrower Admin
 * column (Ledger `R`, Audit `R`, Cash `R`) is a read/write distinction the section layer does not
 * model, which is exactly what the note on those rows is for.
 */
export function driftFor(
  row: MatrixRow,
  appRole: AppRole,
  sections: ResolvedSection[],
  overrides: SectionOverrides | null = null,
): DriftVerdict {
  if (row.sections.length === 0) return "NOT_GATEABLE";
  const want = specVisibility(row, appRole);
  if (want === "CONFLICT") return "SPEC_CONFLICT";
  // Any one of the row's sections being open makes the module reachable.
  const open = row.sections.some((key) => {
    const s = sections.find((x) => x.key === key);
    return s ? sectionAllowed(s, appRole, overrides) : false;
  });
  if (open === (want === "VISIBLE")) return "ALIGNED";
  return open ? "APP_WIDER" : "APP_NARROWER";
}

export type DriftCell = { row: MatrixRow; appRole: AppRole; verdict: DriftVerdict };

/** Every module × app role, for the console grid. */
export function matrixDrift(sections: ResolvedSection[], appRoles: readonly AppRole[]): DriftCell[] {
  const out: DriftCell[] = [];
  for (const row of PERMISSION_MATRIX) {
    for (const appRole of appRoles) {
      out.push({ row, appRole, verdict: driftFor(row, appRole, sections) });
    }
  }
  return out;
}

/** The cells worth acting on, worst first: a leak outranks a gap outranks an unexpressible rule. */
export function driftSummary(cells: DriftCell[]): { wider: DriftCell[]; narrower: DriftCell[]; conflicts: DriftCell[] } {
  return {
    wider: cells.filter((c) => c.verdict === "APP_WIDER"),
    narrower: cells.filter((c) => c.verdict === "APP_NARROWER"),
    conflicts: cells.filter((c) => c.verdict === "SPEC_CONFLICT"),
  };
}

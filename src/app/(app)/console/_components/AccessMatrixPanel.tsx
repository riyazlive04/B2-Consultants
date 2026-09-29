import { Card, Hint } from "@/components/ui/kit";
import { APP_ROLES, type AppRole, type ResolvedSection } from "@/lib/sections";
import {
  PERMISSION_MATRIX,
  SPEC_ROLES,
  SPEC_ROLE_LABELS,
  SPEC_ROLE_TO_APP_ROLE,
  conflictingSpecRoles,
  driftSummary,
  matrixDrift,
  levelsOf,
  specVisibility,
  type DriftVerdict,
  type MatrixRow,
} from "@/lib/permission-matrix";

/**
 * Access Matrix - the answer to "who can see what", next to what the spec says it should be
 * (Error Log O3).
 *
 * Read-only on purpose. The place to CHANGE access is the Sections tab (role defaults) and the
 * per-person dialog on Users (overrides); a second editor would be a second source of truth. What
 * has never existed is a way to check the result against the agreed table - so this screen reads
 * the same `sectionAllowed` the server uses and reports where the two disagree.
 *
 * Read the columns as the app's five roles and the "Spec §3" column as the eight the document
 * names. Where several spec roles collapse onto one app role and the document gives them different
 * access, the cell says so rather than guessing.
 */

const ROLE_LABELS: Record<AppRole, string> = {
  ADMIN: "Admin",
  HEAD: "Head coach",
  USER: "Telecaller",
  STUDENT: "Student",
  TUTOR: "Tutor",
};

/**
 * Cell presentation for an ALREADY-COMPUTED verdict - the grid computes every verdict once (for
 * the stat tiles) and this reads it back, rather than re-running `driftFor` per cell.
 * Colour is spent on meaning only: a leak is bad, a gap is a warning.
 */
function cellFor(row: MatrixRow, appRole: AppRole, verdict: DriftVerdict) {
  switch (verdict) {
    case "APP_WIDER":
      return { glyph: "✓", tone: "var(--bad)", title: "The app grants this; the spec hides it." };
    case "APP_NARROWER":
      return { glyph: "✕", tone: "var(--warn)", title: "The spec grants this; the app hides it." };
    case "SPEC_CONFLICT": {
      const who = conflictingSpecRoles(row, appRole).join(", ");
      return {
        glyph: "?",
        tone: "var(--warn)",
        title: `The spec grants this to ${who} only, but ${ROLE_LABELS[appRole]} is one role - it cannot be expressed as a default.`,
      };
    }
    case "NOT_GATEABLE":
      return { glyph: "·", tone: "var(--ink-3)", title: row.note ?? "Not gated by a section." };
    default:
      // ALIGNED - app matches spec, so the spec's own visibility says granted vs hidden.
      return specVisibility(row, appRole) === "VISIBLE"
        ? { glyph: "✓", tone: "var(--good)", title: "Granted, and the spec agrees." }
        : { glyph: "-", tone: "var(--ink-3)", title: "Hidden, and the spec agrees." };
  }
}

export function AccessMatrixPanel({ sections }: { sections: ResolvedSection[] }) {
  const cells = matrixDrift(sections, APP_ROLES);
  const { wider, narrower, conflicts } = driftSummary(cells);
  // Read each cell's verdict back from the single computed pass rather than re-deriving per cell.
  const verdictOf = new Map(cells.map((c) => [`${c.row.key}:${c.appRole}`, c.verdict]));

  const stat = (n: number, label: string, tone: string) => (
    <div className="rounded-card border border-line bg-surface px-3 py-2">
      <p className="font-display text-2xl font-bold tnum" style={{ color: n === 0 ? "var(--ink-3)" : tone }}>
        {n}
      </p>
      <p className="text-caption text-muted">{label}</p>
    </div>
  );

  return (
    <div className="space-y-4">
      <Hint>
        What each role can actually open right now, checked against the permission matrix in the
        rebuild spec (§3). This screen only reports - change role defaults on the Sections tab, and
        individual grants from a person&rsquo;s row on Users.
      </Hint>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {stat(wider.length, "granted beyond the spec", "var(--bad)")}
        {stat(narrower.length, "hidden despite the spec", "var(--warn)")}
        {stat(conflicts.length, "cannot be expressed today", "var(--warn)")}
      </div>

      {conflicts.length > 0 && (
        <Card title="Rules this role model cannot express">
          <p className="text-sm text-ink-2">
            The spec names eight roles; the app has five. Owner and Admin are one account here, and
            L1, L2 and L3 are all <span className="font-semibold">Telecaller</span>. Where the
            document gives those collapsed roles different access, there is no default that satisfies
            it - only a per-person override, or the role-model rework.
          </p>
          <ul className="mt-3 space-y-1.5">
            {conflicts.map((c) => (
              <li key={`${c.row.key}-${c.appRole}`} className="text-sm">
                <span className="font-semibold text-ink">{c.row.label}</span>
                <span className="text-muted">
                  {" "}
                  - granted to {conflictingSpecRoles(c.row, c.appRole).join(", ")} only, but{" "}
                  {ROLE_LABELS[c.appRole]} is one role.
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card title="Module access by role">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-line-strong text-left">
                <th className="py-2 pr-3 font-semibold text-ink-2">Module</th>
                {APP_ROLES.map((r) => (
                  <th key={r} className="px-2 py-2 text-center font-semibold text-ink-2">
                    {ROLE_LABELS[r]}
                  </th>
                ))}
                <th className="py-2 pl-3 font-semibold text-ink-2">Spec §3</th>
              </tr>
            </thead>
            <tbody>
              {PERMISSION_MATRIX.map((row) => {
                const levels = levelsOf(row);
                return (
                  <tr key={row.key} className="border-b border-line align-top">
                    <td className="py-2 pr-3">
                      <span className="font-medium text-ink">{row.label}</span>
                      {row.note && <p className="mt-0.5 max-w-md text-caption text-muted">{row.note}</p>}
                    </td>
                    {APP_ROLES.map((r) => {
                      const c = cellFor(row, r, verdictOf.get(`${row.key}:${r}`)!);
                      return (
                        <td key={r} className="px-2 py-2 text-center">
                          <span
                            title={c.title}
                            aria-label={c.title}
                            className="inline-block cursor-help text-base font-bold leading-none"
                            style={{ color: c.tone }}
                          >
                            {c.glyph}
                          </span>
                        </td>
                      );
                    })}
                    <td className="py-2 pl-3">
                      <span className="tnum whitespace-nowrap text-caption text-muted">
                        {SPEC_ROLES.map((sr) => `${SPEC_ROLE_LABELS[sr]} ${levels[sr]}`).join(" · ")}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1.5 text-caption text-muted">
          <span>
            <span style={{ color: "var(--good)" }}>✓</span> granted, spec agrees
          </span>
          <span>
            <span style={{ color: "var(--bad)" }}>✓</span> granted beyond the spec
          </span>
          <span>
            <span style={{ color: "var(--warn)" }}>✕</span> hidden despite the spec
          </span>
          <span>
            <span style={{ color: "var(--warn)" }}>?</span> spec roles disagree
          </span>
          <span>
            <span style={{ color: "var(--ink-3)" }}>·</span> not gated by a section
          </span>
        </div>
      </Card>

      <Card title="How the spec's roles map onto this app">
        <ul className="space-y-1.5 text-sm">
          {SPEC_ROLES.map((sr) => (
            <li key={sr} className="flex items-baseline gap-2">
              <span className="w-24 font-medium text-ink">{SPEC_ROLE_LABELS[sr]}</span>
              <span className="text-muted">→ {ROLE_LABELS[SPEC_ROLE_TO_APP_ROLE[sr]]}</span>
            </li>
          ))}
        </ul>
        <Hint>
          L1 and L2 are told apart by a telecaller&rsquo;s log variant, which drives which My Desk
          they get - it is not a role, so it cannot gate a section.
        </Hint>
      </Card>
    </div>
  );
}

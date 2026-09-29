/**
 * THE signal system (CONTEXT §5/§6). One meaning, everywhere:
 *   GREEN = healthy · AMBER = watch · RED = at risk.
 * Every Green/Amber/Red rule in the PRDs resolves through these thresholds, so the
 * colours read identically across Finance, OKRs, Students, Runway and the target bar.
 *
 * ─────────────────────────── PUBLISHED THRESHOLDS (Error Log D2) ───────────────────────────
 * D2 asked for one documented palette rather than per-screen judgement calls. This is it -
 * every threshold the product applies, in one reviewable place:
 *
 *   Metric                        Green        Amber        Red        Source
 *   ───────────────────────────────────────────────────────────────────────────────────────
 *   OKR / target completion %     ≥ 80%        50–79%       < 50%      signalForPercent
 *   Cash runway (months)          ≥ 6          3–6          < 3        signalForRunway
 *   Speed to lead                 ≤ 5 min      6–60 min     -          signalForSpeedToLead
 *   Signed figures (profit,       > 0          -            < 0        signedColor
 *     margin, balance, variance)               (0 = neutral, no verdict claimed)
 *   Student signal                manual GREEN / AMBER / RED, set by the coach   signalForStudent
 *   L1 outreach targets           per JD - see L1_TARGETS in lib/outreach-sla.ts
 *   L2 discovery targets          per JD - see L2_TARGETS in lib/outreach-sla.ts
 *
 * COLOUR TOKENS. Never hardcode a status colour. `--good` / `--warn` / `--bad` (and their
 * `-bg` fills) adapt to the theme; `--good-on-ink` / `--bad-on-ink` are the variants for chart
 * tooltips, which sit on a dark surface in BOTH themes. Two charts carried raw hex for this and
 * have been moved onto the tokens.
 *
 * A colour that does not come from this file is a bug - it means one screen has quietly decided
 * a different number is "healthy", which is precisely the inconsistency D2 reported.
 */

export type SignalLevel = "ok" | "watch" | "risk";

export const SIGNAL_META: Record<
  SignalLevel,
  { label: string; color: string; soft: string; dot: string }
> = {
  ok:    { label: "Green", color: "var(--good)", soft: "var(--good-bg)", dot: "bg-ok" },
  watch: { label: "Amber", color: "var(--warn)", soft: "var(--warn-bg)", dot: "bg-watch" },
  risk:  { label: "Red",   color: "var(--bad)",  soft: "var(--bad-bg)",  dot: "bg-risk" },
};

/** OKR completion % + monthly target bar (PRD1 §5.4, PRD2 §3.2): ≥80 green, 50-79 amber, <50 red. */
export function signalForPercent(pct: number): SignalLevel {
  if (pct >= 80) return "ok";
  if (pct >= 50) return "watch";
  return "risk";
}

/** Runway months (PRD3 §4.4): ≥6 green, ≥3 and <6 amber, <3 red. */
export function signalForRunway(months: number): SignalLevel {
  if (months >= 6) return "ok";
  if (months >= 3) return "watch";
  return "risk";
}

/** Manual student signal (Prisma enum) → shared level. */
export function signalForStudent(colour: "GREEN" | "AMBER" | "RED"): SignalLevel {
  return colour === "GREEN" ? "ok" : colour === "AMBER" ? "watch" : "risk";
}

/**
 * Colour for a SIGNED figure - profit green, loss red, exactly zero neutral.
 *
 * Only for numbers where the sign carries a decision: net/gross profit, profit
 * margin, a running balance. NEVER for always-positive figures like revenue or
 * collections - if every number is green the colour stops meaning anything, which
 * is the cognitive-load problem this was meant to solve. Returns `undefined` at
 * zero so the value inherits normal ink rather than claiming a verdict.
 */
export function signedColor(value: number): string | undefined {
  if (value > 0) return "var(--good)";
  if (value < 0) return "var(--bad)";
  return undefined;
}

/**
 * Speed-to-lead (Synamate "Speed Ratio", client notes): contacted within 5 minutes is
 * green, 6-60 minutes amber, above an hour carries no colour (plain chip).
 */
export function signalForSpeedToLead(ms: number): SignalLevel | null {
  const mins = ms / 60000;
  if (mins <= 5) return "ok";
  if (mins <= 60) return "watch";
  return null;
}

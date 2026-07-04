/**
 * THE signal system (CONTEXT §5/§6). One meaning, everywhere:
 *   GREEN = healthy · AMBER = watch · RED = at risk.
 * Every Green/Amber/Red rule in the PRDs resolves through these thresholds, so the
 * colours read identically across Finance, OKRs, Students, Runway and the target bar.
 */

export type SignalLevel = "ok" | "watch" | "risk";

export const SIGNAL_META: Record<
  SignalLevel,
  { label: string; color: string; soft: string; dot: string }
> = {
  ok:    { label: "Green", color: "var(--ok)",    soft: "var(--ok-soft)",    dot: "bg-ok" },
  watch: { label: "Amber", color: "var(--watch)", soft: "var(--watch-soft)", dot: "bg-watch" },
  risk:  { label: "Red",   color: "var(--risk)",  soft: "var(--risk-soft)",  dot: "bg-risk" },
};

/** OKR completion % + monthly target bar (PRD1 §5.4, PRD2 §3.2): ≥80 green, 50-79 amber, <50 red. */
export function signalForPercent(pct: number): SignalLevel {
  if (pct >= 80) return "ok";
  if (pct >= 50) return "watch";
  return "risk";
}

/** Runway months (PRD3 §4.4): ≥6 green, 3-6 amber, <3 red. */
export function signalForRunway(months: number): SignalLevel {
  if (months >= 6) return "ok";
  if (months >= 3) return "watch";
  return "risk";
}

/** Manual student signal (Prisma enum) → shared level. */
export function signalForStudent(colour: "GREEN" | "AMBER" | "RED"): SignalLevel {
  return colour === "GREEN" ? "ok" : colour === "AMBER" ? "watch" : "risk";
}

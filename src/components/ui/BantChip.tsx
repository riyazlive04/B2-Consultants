import { HelpCircle } from "lucide-react";
import {
  BANT_ORIGIN_LABELS,
  bantSignal,
  type BantSnapshot,
} from "@/lib/bant-view";

/**
 * The band score, rendered the same way everywhere.
 *
 * ── The rule this component exists to enforce ────────────────────────────────────
 * NOT SCORED IS NOT ZERO. Pass `null` and it renders "Not scored" in muted grey, not "0.0/5" in
 * red. A prospect nobody asked and a prospect who answered badly look nothing alike to a caller
 * deciding who to ring, and collapsing them is how a good lead gets buried - which is exactly
 * what happened while landing-page answers were being dropped at the webhook.
 *
 * The origin is always in the tooltip, because a 3.2 from a full booking form and a 3.2 from a
 * short landing-page form are different amounts of evidence for the same number.
 */
export function BantChip({
  bant,
  size = "sm",
}: {
  bant: BantSnapshot | null;
  size?: "sm" | "md";
}) {
  const pad = size === "md" ? "px-2.5 py-1 text-sm" : "px-2 py-0.5 text-caption";

  if (!bant) {
    return (
      <span
        className={`inline-flex items-center gap-1 rounded-full bg-surface-2 font-medium text-muted ${pad}`}
        title="No qualification answers have been captured for this prospect."
      >
        <HelpCircle size={12} aria-hidden />
        Not scored
      </span>
    );
  }

  const signal = bantSignal(bant.avg);
  const tone = {
    ok: "bg-ok-soft text-ok",
    watch: "bg-watch-soft text-watch",
    risk: "bg-risk-soft text-risk",
  }[signal];

  return (
    <span
      className={`tnum inline-flex items-center gap-1 rounded-full font-semibold ${tone} ${pad}`}
      title={`BANT ${bant.avg.toFixed(1)}/5 - ${bant.score} of 4 dimensions met, ${BANT_ORIGIN_LABELS[bant.origin]}`}
    >
      {/* Spoken, so the meaning never rides on colour alone. */}
      <span className="sr-only">BANT score </span>
      {bant.avg.toFixed(1)}/5
    </span>
  );
}

/** The four dimensions as met/unmet pips - which part of the score is weak, at a glance. */
export function BantDimensions({ bant }: { bant: BantSnapshot | null }) {
  if (!bant) return null;
  const dims: [string, string, boolean][] = [
    ["B", "Budget", bant.budget],
    ["A", "Authority", bant.authority],
    ["N", "Need", bant.need],
    ["T", "Timeline", bant.timeline],
  ];
  return (
    <span className="inline-flex items-center gap-1">
      {dims.map(([letter, label, met]) => (
        <span
          key={letter}
          title={`${label}: ${met ? "met" : "not met"}`}
          className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-caption font-bold ${
            met ? "bg-ok-soft text-ok" : "bg-surface-2 text-muted"
          }`}
        >
          <span className="sr-only">{label} </span>
          {letter}
          <span className="sr-only">{met ? " met" : " not met"}</span>
        </span>
      ))}
    </span>
  );
}

import type { JourneyStep } from "@/lib/journey-state";

/**
 * The ten journey steps, grouped into the six stages the founders describe out loud.
 *
 * The rail below shows all ten; this shows the shape. Two different jobs: "which specific thing
 * is missing" and "roughly where are we", and a layman reads the second one first.
 *
 * Payment is deliberately NOT a stage. It is a GAP in `journey-state.ts` - something missing from
 * a person at whatever position they hold - because it genuinely happens at different points: a
 * deposit before the contract, the balance after signing, sometimes in instalments across the
 * whole thing. Modelling it as a step would have made every other step read wrong for somebody.
 */
export const ONBOARDING_STAGES: { title: string; blurb: string; steps: JourneyStep[] }[] = [
  { title: "Who they are", blurb: "Name, number, where they came from.", steps: ["NEW", "CONTACTED"] },
  { title: "Discovery call", blurb: "Booked, taken, outcome recorded.", steps: ["CALL_BOOKED", "DISCOVERY_DONE"] },
  { title: "They say yes", blurb: "The deal is agreed.", steps: ["WON"] },
  { title: "Agreement", blurb: "Sent, then signed.", steps: ["AGREEMENT_SENT", "SIGNED"] },
  { title: "Student record", blurb: "A student number and a programme.", steps: ["ENROLLED"] },
  { title: "Cohort and class", blurb: "A seat, and a class that has started.", steps: ["SEATED", "IN_CLASS"] },
];

/** Which of the six stages a journey step belongs to, 1-based. Falls back to the last. */
export function stageOf(step: JourneyStep | null): number {
  if (!step) return ONBOARDING_STAGES.length;
  const i = ONBOARDING_STAGES.findIndex((s) => s.steps.includes(step));
  return i === -1 ? ONBOARDING_STAGES.length : i + 1;
}

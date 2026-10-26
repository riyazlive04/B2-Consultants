import type { Tone } from "@/components/ui/kit";
import type { BatchReadiness } from "@/lib/batch";

/**
 * How each cohort state is coloured - one map, because two of them drifted apart once already.
 *
 * It lives in its own module rather than on either component: `BatchChecklist` is a server
 * component that imports the Activate button, so importing a constant FROM it would drag that
 * whole tree into the client bundle of every screen that showed a cohort list.
 *
 * DRAFT is `warn` and not `bad`: an unfinished cohort is normal work in progress, not an error.
 */
export const READINESS_TONE: Record<BatchReadiness, Tone> = {
  DRAFT: "warn",
  READY: "primary",
  ACTIVE: "good",
  COMPLETED: "info",
  ARCHIVED: "neutral",
};

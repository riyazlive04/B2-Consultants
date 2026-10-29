import type { Tone } from "@/components/ui/kit";
import type { ImprovementSeverity, ImprovementStatus } from "@/lib/improvement";

/**
 * Colour for a severity and a status pill, in one place so the list and the detail cannot
 * disagree about what red means.
 *
 * `bad` is spent on one thing only: somebody cannot do their job. A queue where four shades
 * compete for attention has no attention left to direct, which is the same reason the design
 * system keeps the action red rare.
 */
export function severityTone(severity: ImprovementSeverity): Tone {
  return severity === "BLOCKING" ? "bad" : severity === "ANNOYING" ? "warn" : "neutral";
}

/**
 * NEW is `primary`, not `warn`. An unread report is the normal state of a working queue, not a
 * fault - and if every new report arrived painted as a warning the colour would stop meaning
 * anything by the second week.
 */
export function statusTone(status: ImprovementStatus): Tone {
  switch (status) {
    case "NEW":
      return "primary";
    case "TRIAGED":
    case "ACCEPTED":
      return "info";
    case "IN_PROGRESS":
      return "warn";
    case "FIXED":
    case "CLOSED":
      return "good";
    default:
      // DECLINED and DUPLICATE: closed without a change. Neutral, because neither is a failure.
      return "neutral";
  }
}

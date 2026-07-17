import {
  agreementStateLabel,
  agreementStateTone,
  type AgreementState,
  type AgreementStateTone,
  type AgreementWorkflowConfig,
} from "@/lib/agreement-state";

/**
 * The 8-state pill. Same shape and tone vocabulary as StatusBadge (which shows the raw DB status on
 * the agreement row itself) — this one shows the DERIVED workflow state of a client.
 *
 * The dot is never the only carrier of meaning: the word is always there too (§7 / WCAG 1.4.1).
 */

const TONE_STYLE: Record<AgreementStateTone, { bg: string; fg: string }> = {
  primary: { bg: "var(--primary-soft)", fg: "var(--primary)" },
  good: { bg: "var(--good-bg)", fg: "var(--good)" },
  warn: { bg: "var(--warn-bg)", fg: "var(--warn)" },
  bad: { bg: "var(--risk-soft)", fg: "var(--risk)" },
  muted: { bg: "var(--surface-2)", fg: "var(--muted)" },
};

export function AgreementStateBadge({
  state,
  config,
  size = "md",
}: {
  state: AgreementState;
  config?: AgreementWorkflowConfig;
  size?: "sm" | "md";
}) {
  const tone = TONE_STYLE[agreementStateTone(state)];
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full font-medium ${
        size === "sm" ? "px-2 py-0.5 text-caption" : "px-2.5 py-1 text-xs"
      }`}
      style={{ background: tone.bg, color: tone.fg }}
    >
      <span className="inline-block h-1.5 w-1.5 flex-none rounded-full" style={{ background: tone.fg }} />
      {agreementStateLabel(state, config)}
    </span>
  );
}

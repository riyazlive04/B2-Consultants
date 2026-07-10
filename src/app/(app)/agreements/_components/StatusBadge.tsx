import { AGREEMENT_STATUS_LABELS, agreementStatusTone, type AgreementStatusKey } from "@/lib/agreement";

const TONE_STYLE: Record<ReturnType<typeof agreementStatusTone>, { bg: string; fg: string }> = {
  good: { bg: "var(--good-bg)", fg: "var(--good)" },
  warn: { bg: "var(--warn-bg)", fg: "var(--warn)" },
  bad: { bg: "var(--risk-soft)", fg: "var(--risk)" },
  muted: { bg: "var(--surface-2)", fg: "var(--muted)" },
};

export function StatusBadge({ status }: { status: AgreementStatusKey }) {
  const tone = TONE_STYLE[agreementStatusTone(status)];
  return (
    <span
      className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium"
      style={{ background: tone.bg, color: tone.fg }}
    >
      <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: tone.fg }} />
      {AGREEMENT_STATUS_LABELS[status]}
    </span>
  );
}

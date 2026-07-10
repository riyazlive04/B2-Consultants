import { PROGRAM_LEVEL_LABELS } from "@/lib/labels";

/** Program chip in the fixed German Note teal (design system §program colours). */
export function LevelChip({ level }: { level: string }) {
  return (
    <span
      className="rounded-full px-2.5 py-0.5 text-[11px] font-semibold"
      style={{ color: "var(--lvl-gn)", background: "#3fc0b722" }}
    >
      {PROGRAM_LEVEL_LABELS[level] ?? level}
    </span>
  );
}

export function StatusChip({ status }: { status: "ACTIVE" | "ARCHIVED" }) {
  if (status === "ACTIVE") return null;
  return (
    <span className="rounded-full bg-ink/10 px-2.5 py-0.5 text-[11px] font-semibold text-muted">
      Archived
    </span>
  );
}

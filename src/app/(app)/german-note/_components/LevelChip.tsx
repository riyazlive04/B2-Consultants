import { PROGRAM_LEVEL_LABELS } from "@/lib/labels";

/**
 * Program chip in the fixed German Note teal (design system §program colours).
 * The teal is an identity TINT only — used as text on white it measures 2.23:1
 * and fails AA (§8), so it is the background and the label stays `--ink`.
 */
export function LevelChip({ level }: { level: string }) {
  return (
    <span className="rounded-full bg-lvl-gn/10 px-2.5 py-0.5 text-caption font-semibold text-ink">
      {PROGRAM_LEVEL_LABELS[level] ?? level}
    </span>
  );
}

export function StatusChip({ status }: { status: "ACTIVE" | "ARCHIVED" }) {
  if (status === "ACTIVE") return null;
  return (
    <span className="rounded-full bg-ink/10 px-2.5 py-0.5 text-caption font-semibold text-muted">
      Archived
    </span>
  );
}

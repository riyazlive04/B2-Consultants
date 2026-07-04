import { SIGNAL_META, type SignalLevel } from "@/lib/signals";

/**
 * The one Green/Amber/Red component (CONTEXT §6). Every signal in the app -
 * OKR circles, student tracker dots, runway badge, overdue rows - renders here
 * so colour always means the same thing.
 */
export function SignalBadge({
  level,
  label,
  size = "md",
}: {
  level: SignalLevel;
  label?: string; // defaults to Green / Amber / Red
  size?: "sm" | "md";
}) {
  const meta = SIGNAL_META[level];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full font-medium ${
        size === "sm" ? "px-2 py-0.5 text-xs" : "px-2.5 py-1 text-sm"
      }`}
      style={{ background: meta.soft, color: meta.color }}
    >
      <span
        aria-hidden
        className="inline-block h-2 w-2 rounded-full"
        style={{ background: meta.color }}
      />
      {label ?? meta.label}
    </span>
  );
}

/** Bare dot for dense lists (e.g. the 3 OKR circles per team member). */
export function SignalDot({ level, title }: { level: SignalLevel; title?: string }) {
  return (
    <span
      title={title}
      className="inline-block h-3 w-3 rounded-full"
      style={{ background: SIGNAL_META[level].color }}
    />
  );
}

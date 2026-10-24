import { ChevronRight } from "lucide-react";

/**
 * HOW YOU GET THERE, as a breadcrumb: Sidebar › Classroom › Batches & Plans › Roster.
 *
 * The guide used to say what each screen does and never where it is. For somebody who already
 * knows the app that is fine; for a new employee - the person the guide is actually for - "open
 * Batches & Plans" is not an instruction, and that is most of why the lead-to-class journey could
 * not be learned from inside the app.
 *
 * Rendered as ONE list with separators marked `aria-hidden`, so a screen reader hears
 * "Sidebar, Classroom, Batches and Plans, Roster" rather than a chevron between every word.
 */
export function GuidePath({ path, label = "Where" }: { path: string[]; label?: string }) {
  if (path.length === 0) return null;
  return (
    <nav aria-label={`${label}: ${path.join(", ")}`} className="flex flex-wrap items-center gap-1">
      {path.map((part, i) => (
        <span key={`${part}-${i}`} className="flex items-center gap-1">
          <span className="rounded-field bg-surface-2 px-1.5 py-0.5 text-caption font-medium text-ink-2">
            {part}
          </span>
          {i < path.length - 1 && (
            <ChevronRight size={11} aria-hidden className="flex-none text-ink-3" />
          )}
        </span>
      ))}
    </nav>
  );
}

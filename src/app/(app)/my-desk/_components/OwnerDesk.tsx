import Link from "next/link";
import { CheckCircle2, ChevronRight } from "lucide-react";
import { EmptyState } from "@/components/ui/kit";
import { SIGNAL_META } from "@/lib/signals";
import type { DeskTask, OwnerDesk as OwnerDeskData } from "@/server/owner-desk";

/**
 * My Desk for an admin or head coach (Error Log Q2) — the queues waiting on a decision, rather
 * than the call statistics the specialist desks show.
 *
 * Cleared queues stay visible, greyed, instead of disappearing. A list that empties itself gives
 * no way to tell "nothing is waiting" from "this screen is broken", and the founder checking at
 * 8am needs to trust the empty state as much as the full one.
 */

function TaskRow({ task }: { task: DeskTask }) {
  const clear = task.count === 0;
  const tone = SIGNAL_META[task.tone];

  return (
    <Link
      href={task.href}
      className="press flex items-center gap-4 rounded-card border border-line bg-surface p-4 transition-colors hover:border-primary-tint hover:bg-surface-2"
    >
      <span
        className="tnum flex h-11 w-11 flex-none items-center justify-center rounded-field font-display text-lg font-bold"
        style={
          clear
            ? { color: "var(--ink-3)", background: "var(--bg-surface-2)" }
            : { color: tone.color, background: tone.soft }
        }
        aria-hidden
      >
        {clear ? <CheckCircle2 size={18} /> : task.count}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold text-ink">
          {task.label}
          <span className="sr-only">: {clear ? "nothing waiting" : `${task.count} waiting`}</span>
        </span>
        <span className="mt-0.5 block text-caption text-muted">
          {clear ? "Nothing waiting." : task.detail}
        </span>
      </span>
      <ChevronRight size={18} className="flex-none text-ink-3" aria-hidden />
    </Link>
  );
}

export function OwnerDesk({ desk }: { desk: OwnerDeskData }) {
  if (desk.tasks.length === 0) {
    return (
      <EmptyState
        title="Nothing is assigned to this desk"
        body="No queues are enabled for your role yet."
      />
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-2">
        {desk.total === 0 ? (
          <>Everything is clear — nothing is waiting on you right now.</>
        ) : (
          <>
            <span className="tnum font-semibold text-ink">{desk.total}</span>{" "}
            {desk.total === 1 ? "item is" : "items are"} waiting on a decision from you.
          </>
        )}
      </p>

      <div className="space-y-3">
        {/* Sorted so anything outstanding rises above what is already clear. */}
        {[...desk.tasks]
          .sort((a, b) => (b.count > 0 ? 1 : 0) - (a.count > 0 ? 1 : 0))
          .map((t) => (
            <TaskRow key={t.key} task={t} />
          ))}
      </div>
    </div>
  );
}

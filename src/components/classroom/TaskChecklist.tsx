"use client";

import { useState } from "react";
import { CheckCircle2, Circle } from "lucide-react";
import { completeSessionTask } from "@/server/session-tasks";
import { toast } from "@/components/ui/feedback";
import { formatDate } from "@/lib/format";
import { safeAction } from "@/lib/action-guard";

/**
 * A student's own coursework, tick-able.
 *
 * Shared by the classroom (under each class) and the dashboard (everything outstanding, across
 * classes), so the two cannot drift into two different ways of ticking the same box. The server
 * action is the same one in both cases, and it checks that the completion row belongs to this
 * student - a hidden checkbox was never the fence.
 */

export type ChecklistTask = {
  completionId: string;
  title: string;
  description: string | null;
  dueAt: string | null;
  status: "YES" | "NO" | "PENDING";
  autoCompleted: boolean;
  /** Optional context line - the dashboard needs it, the classroom does not. */
  context?: string | null;
};

export function TaskChecklist({
  tasks,
  onChanged,
  className = "",
}: {
  tasks: ChecklistTask[];
  onChanged: () => void;
  className?: string;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  if (tasks.length === 0) return null;

  return (
    <ul className={`space-y-1.5 ${className}`}>
      {tasks.map((t) => {
        const done = t.status === "YES";
        return (
          <li key={t.completionId}>
            <button
              type="button"
              disabled={busy === t.completionId}
              className="flex w-full items-start gap-2 rounded-field px-1 py-1 text-left hover:bg-ink/5 disabled:opacity-60"
              onClick={async () => {
                setBusy(t.completionId);
                const res = await safeAction(() => completeSessionTask(t.completionId, !done));
                setBusy(null);
                if (!res.ok) return toast(res.error, "error");
                toast(done ? "Marked not done" : "Nice - marked done");
                onChanged();
              }}
            >
              {done ? (
                <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-good" aria-hidden />
              ) : (
                <Circle size={16} className="mt-0.5 shrink-0 text-muted" aria-hidden />
              )}
              <span className="min-w-0 flex-1">
                <span className={`text-sm ${done ? "text-muted line-through" : "text-ink"}`}>{t.title}</span>
                {t.context && <span className="block text-caption text-muted">{t.context}</span>}
                {t.description && <span className="block text-caption text-muted">{t.description}</span>}
                {t.dueAt && <span className="block text-caption text-muted">Due {formatDate(t.dueAt)}</span>}
                {t.autoCompleted && (
                  <span className="block text-caption text-muted">Ticked automatically from your watch progress</span>
                )}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

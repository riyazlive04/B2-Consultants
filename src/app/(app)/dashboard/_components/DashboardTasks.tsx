"use client";

import { useRouter } from "next/navigation";
import { TaskChecklist, type ChecklistTask } from "@/components/classroom/TaskChecklist";

/**
 * The outstanding-coursework list on the dashboard.
 *
 * A thin client wrapper purely so the server page can stay a server component: the checklist
 * needs `router.refresh()` after a tick, and a page cannot hand a function to a client child.
 */
export function DashboardTasks({ tasks }: { tasks: ChecklistTask[] }) {
  const router = useRouter();
  return <TaskChecklist tasks={tasks} onChanged={() => router.refresh()} />;
}

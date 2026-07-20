"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/rbac";
import { parseDateInput, toDateInputValue } from "@/lib/dates";
import { optionalRule } from "@/lib/field-rules";
import { logActivity, diffFields } from "./activity-log";
import type { ActionResult } from "./finance-actions";

/** Weekly funnel snapshot (PRD3 §3.2) - Admin-only, one row per week (Monday). */

// Deliberately NOT rule("int") from lib/field-rules: this one also has to turn an untouched box
// into 0 and hand the column a number, which that (string) schema doesn't do. The character rule
// it enforces is the same — the matching inputs carry kind="int" plus maxLength={7}.
const intField = z
  .string()
  .trim()
  .regex(/^\d{0,7}$/, "Numbers only")
  .transform((s) => (s === "" ? 0 : parseInt(s, 10)));

const snapshotSchema = z.object({
  weekStart: z.string().min(10),
  awarenessReach: intField,
  leadsCaptured: intField,
  callsCompleted: intField,
  proposalsSent: intField,
  enrollmentsSolo: intField,
  enrollmentsGuided: intField,
  enrollmentsElite: intField,
  ghostedDownloads: intField,
  workshopAttendees: intField,
  notes: optionalRule("text"),
});

export async function saveWeeklySnapshot(form: FormData): Promise<ActionResult> {
  const session = await requireAdmin();
  const parsed = snapshotSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const d = parsed.data;

  const week = parseDateInput(d.weekStart);
  if (week.getUTCDay() !== 1) {
    return { ok: false, error: "Week start must be a Monday" };
  }

  const data = {
    awarenessReach: d.awarenessReach,
    leadsCaptured: d.leadsCaptured,
    callsCompleted: d.callsCompleted,
    proposalsSent: d.proposalsSent,
    enrollmentsSolo: d.enrollmentsSolo,
    enrollmentsGuided: d.enrollmentsGuided,
    enrollmentsElite: d.enrollmentsElite,
    ghostedDownloads: d.ghostedDownloads,
    workshopAttendees: d.workshopAttendees,
    notes: d.notes || null,
  };
  const before = await prisma.weeklyFunnelSnapshot.findUnique({ where: { weekStart: week } });
  const row = await prisma.weeklyFunnelSnapshot.upsert({
    where: { weekStart: week },
    update: data,
    create: { weekStart: week, ...data },
  });
  const label = `week of ${toDateInputValue(week)}`;
  if (!before) {
    await logActivity(session, {
      action: "funnel.snapshot.record",
      section: "funnel",
      entityType: "WeeklyFunnelSnapshot",
      entityId: row.id,
      summary: `Recorded the funnel snapshot for the ${label}`,
      meta: { weekStart: toDateInputValue(week), ...data },
    });
  } else {
    const diff = diffFields(before as unknown as Record<string, unknown>, data);
    if (diff.changed.length) {
      await logActivity(session, {
        action: "funnel.snapshot.update",
        section: "funnel",
        entityType: "WeeklyFunnelSnapshot",
        entityId: row.id,
        summary: `Updated the funnel snapshot for the ${label}`,
        meta: { weekStart: toDateInputValue(week), changed: diff.changed, before: diff.before, after: diff.after },
      });
    }
  }
  revalidatePath("/funnel");
  return { ok: true };
}

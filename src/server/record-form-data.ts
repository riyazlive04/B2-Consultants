"use server";

import { capabilityCheck } from "@/lib/rbac";
import { getTodayInrPerEur } from "@/lib/fx";
import { prisma } from "@/lib/prisma";
import { getActiveLevels } from "@/server/levels";
import { levelOptions } from "@/lib/levels";
import { toDateInputValue, istToday } from "@/lib/dates";

/**
 * The dependencies the quick-record forms need — the live FX rate (so the ₹↔€ preview matches
 * what the server will stamp), the student list for the income autocomplete, and the level list.
 *
 * Fetched lazily when the Record modal first opens rather than shipped with every page: the CTA
 * lives in the shell on every screen, and none of this is needed until someone actually clicks it.
 * Guarded by the same capability the write actions check, so it never leaks the roster to a viewer
 * who couldn't record anyway — it returns null instead.
 */
export type RecordFormData = {
  today: string;
  fxRate: number;
  fxStale: boolean;
  fxDate: string;
  studentOptions: { value: string; label: string; hint?: string }[];
  levelOptions: { value: string; label: string }[];
};

export async function getRecordFormData(): Promise<RecordFormData | null> {
  const { allowed } = await capabilityCheck("finance.write");
  if (!allowed) return null;

  const [fx, students, levels] = await Promise.all([
    getTodayInrPerEur(),
    prisma.student.findMany({ orderBy: { fullName: "asc" }, select: { id: true, fullName: true, code: true } }),
    getActiveLevels(),
  ]);

  return {
    today: toDateInputValue(istToday()),
    fxRate: Number(fx.rate),
    fxStale: fx.stale,
    fxDate: fx.date.toISOString(),
    // Code rides as a searchable `hint`, never written into the name field (§6.1 / ComboBox).
    studentOptions: students.map((s) => ({ value: s.id, label: s.fullName, hint: s.code ?? undefined })),
    levelOptions: levelOptions(levels),
  };
}

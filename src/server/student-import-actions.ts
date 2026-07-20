"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/rbac";
import { parseStudentCsv, planStudentImport, type ImportPlan } from "@/lib/student-import";
import { logActivity } from "./activity-log";
import type { ActionResult } from "./finance-actions";
import { allocateStudentCode } from "./student-code";

/**
 * Student import (spec Part 2 §9). Admin-only.
 *
 * Two steps on purpose: `previewStudentImport` writes NOTHING and returns the plan, and only
 * `commitStudentImport` touches the database. The founder sees exactly what will happen —
 * how many created, how many updated, and every row that will be skipped and why — before
 * anything is irreversible. This is a bulk write into a live roster of real people; a
 * one-click "import" that reports afterwards is how a bad paste becomes a cleanup job.
 */

/** Guard: this arrives from a browser file read, so bound it before it becomes 100k rows. */
const MAX_CSV_CHARS = 2_000_000;
const MAX_ROWS = 5_000;

async function loadExisting() {
  return prisma.student.findMany({
    select: { id: true, email: true, fullName: true, phone: true, address: true },
  });
}

export async function previewStudentImport(
  csv: string,
): Promise<{ ok: true; plan: ImportPlan } | { ok: false; error: string }> {
  await requireAdmin();
  if (csv.length > MAX_CSV_CHARS) return { ok: false, error: "That file is too large to import in one go." };

  const parsed = parseStudentCsv(csv);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  if (parsed.rows.length > MAX_ROWS) {
    return { ok: false, error: `${parsed.rows.length} rows is over the ${MAX_ROWS}-row limit — split the file.` };
  }

  const plan = planStudentImport(parsed.rows, await loadExisting(), parsed.skipped);
  return { ok: true, plan };
}

/**
 * Apply an import.
 *
 * Re-plans from scratch against a FRESH read rather than trusting a plan posted back from the
 * browser: the roster may have changed since the preview, and a client-supplied list of
 * "student ids to update" is a straightforward way to let a crafted POST rewrite arbitrary
 * rows. The preview is for the human; the server decides again.
 */
export async function commitStudentImport(csv: string): Promise<ActionResult & { summary?: string }> {
  const session = await requireAdmin();
  if (csv.length > MAX_CSV_CHARS) return { ok: false, error: "That file is too large to import in one go." };

  const parsed = parseStudentCsv(csv);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  if (parsed.rows.length > MAX_ROWS) {
    return { ok: false, error: `${parsed.rows.length} rows is over the ${MAX_ROWS}-row limit — split the file.` };
  }
  const plan = planStudentImport(parsed.rows, await loadExisting(), parsed.skipped);

  let created = 0;
  let updated = 0;
  for (const p of plan.plans) {
    if (p.kind === "create") {
      await prisma.student.create({
        data: {
          code: await allocateStudentCode(),
          fullName: p.row.fullName,
          email: p.row.email,
          phone: p.row.phone,
          address: p.row.address,
        },
      });
      created++;
    } else if (p.kind === "update") {
      await prisma.student.update({
        where: { id: p.studentId },
        data: {
          // `undefined` = leave alone. A blank cell in the sheet means "no data here", not
          // "delete what's on file" — an import is usually a partial export.
          fullName: p.row.fullName || undefined,
          phone: p.row.phone ?? undefined,
          address: p.row.address ?? undefined,
        },
      });
      updated++;
    }
  }

  const summary = `Imported students: ${created} created, ${updated} updated, ${plan.unchanged} unchanged, ${plan.skipped} skipped`;
  await logActivity(session, {
    action: "students.import",
    section: "students",
    entityType: "Student",
    entityId: "bulk",
    summary,
    meta: { created, updated, unchanged: plan.unchanged, skipped: plan.skipped },
  });
  revalidatePath("/students");
  return { ok: true, summary };
}

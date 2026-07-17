"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { prisma } from "@/lib/prisma";
import { requireAdmin, requireSection } from "@/lib/rbac";
import { parseDateInput } from "@/lib/dates";
import { parseVideoUrl } from "@/lib/video-embed";
import { parseMentions } from "@/lib/gn-mentions";
import { getGnAccess, getGnMemberProfile, loadMentionCandidates, type GnMemberProfile } from "./german-note-metrics";
import { logActivity, diffFields } from "./activity-log";
import type { ActionResult } from "./finance-actions";

/** Post images are stored inline as resized data URLs (same as avatars — no object store). */
const MAX_POST_IMAGE_CHARS = 900_000;
function validPostImage(raw: string | undefined): { ok: true; value: string | null } | { ok: false; error: string } {
  if (!raw) return { ok: true, value: null };
  if (!raw.startsWith("data:image/") || raw.startsWith("data:image/svg")) {
    return { ok: false, error: "Unsupported image" };
  }
  if (raw.length > MAX_POST_IMAGE_CHARS) return { ok: false, error: "Image is too large — try a smaller one" };
  return { ok: true, value: raw };
}

/**
 * German Note (Phase 4): batches, class-recording links, Skool-style community.
 * Batch/member/tutor management = Admin. Recordings = Admin or the batch's
 * tutor. Community writes = any GN participant, scoped to what they can see.
 * Every guard is re-checked here — the UI hiding a button is never the fence.
 */

function firstError(e: z.ZodError): string {
  return e.issues[0]?.message ?? "Invalid input";
}

const GN_LEVELS = ["GN_A1", "GN_A2", "GN_B1", "GN_B2"] as const;

// ── Guards ─────────────────────────────────────────────────────

async function requireGn() {
  return requireSection("german-note");
}

/** Admin, or the TUTOR assigned to this batch. */
async function canManageBatch(session: { role: string; user: { id: string } }, batchId: string) {
  if (session.role === "ADMIN") return true;
  if (session.role !== "TUTOR") return false;
  const batch = await prisma.gnBatch.findUnique({ where: { id: batchId }, select: { tutorId: true } });
  return batch?.tutorId === session.user.id;
}

/** Manager, or a student who is a member of this batch. */
async function isBatchParticipant(session: { role: string; user: { id: string } }, batchId: string) {
  if (await canManageBatch(session, batchId)) return true;
  const count = await prisma.gnBatchMember.count({
    where: { batchId, student: { userId: session.user.id } },
  });
  return count > 0;
}

/** May post to the GLOBAL feed: Admin, any tutor, or a member of any ACTIVE batch. */
async function isGnParticipant(session: { role: string; user: { id: string } }) {
  if (session.role === "ADMIN" || session.role === "TUTOR") return true;
  const count = await prisma.gnBatchMember.count({
    where: { student: { userId: session.user.id }, batch: { status: "ACTIVE" } },
  });
  return count > 0;
}

/** Read a member's public community profile (for the Members directory modal). */
export async function loadGnMemberProfile(userId: string): Promise<{ ok: true; profile: GnMemberProfile } | { ok: false; error: string }> {
  const session = await requireGn();
  const access = await getGnAccess(session.role, session.user.id);
  if (!access.isParticipant) return { ok: false, error: "Not allowed" };
  const profile = await getGnMemberProfile(userId);
  if (!profile) return { ok: false, error: "Member not found" };
  return { ok: true, profile };
}

function revalidateBatch(batchId: string) {
  revalidatePath("/german-note");
  revalidatePath(`/german-note/${batchId}`);
  revalidatePath("/german-note/manage");
}

// ── Batches (Admin) ────────────────────────────────────────────

const batchSchema = z.object({
  name: z.string().trim().min(1, "Batch name is required").max(120),
  level: z.enum(GN_LEVELS, { message: "Pick a level (A1–B2)" }),
  tutorId: z.string().trim().optional(),
  targetStrength: z.coerce.number().int().min(1).max(100).optional(), // target class size (~8)
  notes: z.string().trim().max(2000).optional(),
});

async function validTutorId(tutorId: string | undefined): Promise<string | null | undefined> {
  if (!tutorId) return null;
  const tutor = await prisma.user.findUnique({ where: { id: tutorId }, select: { role: true } });
  if (!tutor || tutor.role !== "TUTOR") return undefined; // undefined = invalid
  return tutorId;
}

export async function createBatch(form: FormData): Promise<ActionResult> {
  const session = await requireAdmin();
  const parsed = batchSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const tutorId = await validTutorId(parsed.data.tutorId);
  if (tutorId === undefined) return { ok: false, error: "Selected tutor account not found" };
  const batch = await prisma.gnBatch.create({
    data: {
      name: parsed.data.name,
      level: parsed.data.level,
      tutorId,
      targetStrength: parsed.data.targetStrength ?? 8,
      notes: parsed.data.notes || null,
    },
  });
  await logActivity(session, {
    action: "gn.batch.create",
    section: "german-note",
    entityType: "GnBatch",
    entityId: batch.id,
    summary: `Created the German Note batch "${batch.name}"`,
    meta: { level: batch.level, tutorId, targetStrength: batch.targetStrength },
  });
  revalidatePath("/german-note");
  revalidatePath("/german-note/manage");
  return { ok: true };
}

export async function updateBatch(batchId: string, form: FormData): Promise<ActionResult> {
  const session = await requireAdmin();
  const parsed = batchSchema
    .extend({ status: z.enum(["ACTIVE", "ARCHIVED"]) })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const tutorId = await validTutorId(parsed.data.tutorId);
  if (tutorId === undefined) return { ok: false, error: "Selected tutor account not found" };
  const before = await prisma.gnBatch.findUnique({
    where: { id: batchId },
    select: { name: true, level: true, tutorId: true, targetStrength: true, status: true, notes: true },
  });
  const batch = await prisma.gnBatch.update({
    where: { id: batchId },
    data: {
      name: parsed.data.name,
      level: parsed.data.level,
      tutorId,
      // undefined = form didn't carry it → leave the existing target untouched.
      targetStrength: parsed.data.targetStrength,
      status: parsed.data.status,
      notes: parsed.data.notes || null,
    },
  });
  // Diff the stored row rather than the form: an omitted `targetStrength` means "leave it"
  // to Prisma, but a bare undefined would read as "cleared" to diffFields.
  const d = before
    ? diffFields(before as Record<string, unknown>, {
        name: batch.name,
        level: batch.level,
        tutorId: batch.tutorId,
        targetStrength: batch.targetStrength,
        status: batch.status,
        notes: batch.notes,
      })
    : null;
  if (d && d.changed.length > 0) {
    await logActivity(session, {
      action: "gn.batch.update",
      section: "german-note",
      entityType: "GnBatch",
      entityId: batchId,
      summary: `Edited the German Note batch "${batch.name}"`,
      meta: { changed: d.changed, before: d.before, after: d.after },
    });
  }
  revalidateBatch(batchId);
  return { ok: true };
}

/** Hard delete — cascades members, recordings and the batch discussion. Archive is the normal path. */
export async function deleteBatch(batchId: string): Promise<ActionResult> {
  const session = await requireAdmin();
  const batch = await prisma.gnBatch.delete({ where: { id: batchId } });
  await logActivity(session, {
    action: "gn.batch.delete",
    section: "german-note",
    entityType: "GnBatch",
    entityId: batchId,
    summary: `Deleted the German Note batch "${batch.name}"`,
    meta: { level: batch.level, status: batch.status },
  });
  revalidatePath("/german-note");
  revalidatePath("/german-note/manage");
  return { ok: true };
}

// ── Members (Admin) ────────────────────────────────────────────

export async function addExistingMember(batchId: string, form: FormData): Promise<ActionResult> {
  const session = await requireAdmin();
  const studentId = String(form.get("studentId") ?? "");
  if (!studentId) return { ok: false, error: "Pick a student" };
  const student = await prisma.student.findUnique({ where: { id: studentId }, select: { id: true, fullName: true } });
  if (!student) return { ok: false, error: "Student not found" };
  const batch = await prisma.gnBatch.findUnique({ where: { id: batchId }, select: { name: true } });
  try {
    const member = await prisma.gnBatchMember.create({ data: { batchId, studentId } });
    await logActivity(session, {
      action: "gn.member.create",
      section: "german-note",
      entityType: "GnBatchMember",
      entityId: member.id,
      summary: `Added ${student.fullName} to the batch "${batch?.name ?? "German Note"}"`,
      meta: { batchId, studentId },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return { ok: false, error: "Already in this batch" };
    }
    throw e;
  }
  revalidateBatch(batchId);
  return { ok: true };
}

const newMemberSchema = z.object({
  fullName: z.string().trim().min(1, "Full name is required").max(120),
  email: z.string().trim().email("Valid email required").optional().or(z.literal("")),
  phone: z.string().trim().max(30).optional(),
});

const nameKey = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/** Quick-create a German Note learner: Student WITHOUT enrollment + membership in one go. */
export async function addNewMember(batchId: string, form: FormData): Promise<ActionResult> {
  const session = await requireAdmin();
  const parsed = newMemberSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const d = parsed.data;

  const student = await prisma.$transaction(async (tx) => {
    const s = await tx.student.create({
      data: { fullName: d.fullName, email: d.email || null, phone: d.phone || null },
    });
    await tx.gnBatchMember.create({ data: { batchId, studentId: s.id } });
    return s;
  });

  // Same auto-link as createStudent: attach past GN income rows entered by name.
  const candidates = await prisma.income.findMany({ where: { studentId: null } });
  const ids = candidates.filter((i) => nameKey(i.studentName) === nameKey(student.fullName)).map((i) => i.id);
  if (ids.length) {
    await prisma.income.updateMany({ where: { id: { in: ids } }, data: { studentId: student.id } });
  }
  const batch = await prisma.gnBatch.findUnique({ where: { id: batchId }, select: { name: true } });
  await logActivity(session, {
    action: "gn.member.create",
    section: "german-note",
    entityType: "Student",
    entityId: student.id,
    summary: `Added ${student.fullName} to the batch "${batch?.name ?? "German Note"}" as a new learner`,
    meta: { batchId, linkedIncomeRows: ids.length },
  });
  revalidateBatch(batchId);
  return { ok: true };
}

export async function removeBatchMember(memberId: string): Promise<ActionResult> {
  const session = await requireAdmin();
  const member = await prisma.gnBatchMember.findUnique({
    where: { id: memberId },
    select: { batchId: true, student: { select: { fullName: true } }, batch: { select: { name: true } } },
  });
  if (!member) return { ok: false, error: "Member not found" };
  await prisma.gnBatchMember.delete({ where: { id: memberId } });
  await logActivity(session, {
    action: "gn.member.delete",
    section: "german-note",
    entityType: "GnBatchMember",
    entityId: memberId,
    summary: `Removed ${member.student.fullName} from the batch "${member.batch.name}"`,
    meta: { batchId: member.batchId },
  });
  revalidateBatch(member.batchId);
  return { ok: true };
}

// ── Tutor accounts (Admin) ─────────────────────────────────────
// Same provisioning trick as users/students actions: a local better-auth
// instance with sign-up enabled, called only inside admin-guarded actions.
// NOT routed through users-actions.createUser — its section-access checkbox
// parsing would write an all-false override map; tutors run on role defaults.

const tutorAuth = betterAuth({
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
  emailAndPassword: { enabled: true },
  user: {
    additionalFields: {
      role: { type: "string", defaultValue: "USER", input: false },
    },
  },
});

const tutorLoginSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  email: z.string().trim().email("Valid email required"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

export async function createTutorLogin(form: FormData): Promise<ActionResult> {
  const session = await requireAdmin();
  const parsed = tutorLoginSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const d = parsed.data;

  const existing = await prisma.user.findUnique({ where: { email: d.email } });
  if (existing) return { ok: false, error: "A user with this email already exists" };

  let createdUserId: string | null = null;
  try {
    const res = await tutorAuth.api.signUpEmail({
      body: { name: d.name, email: d.email, password: d.password },
    });
    createdUserId = res.user.id;
    await prisma.user.update({
      where: { id: res.user.id },
      data: { role: "TUTOR", emailVerified: true },
    });
    await logActivity(session, {
      action: "gn.tutor.grant",
      section: "german-note",
      entityType: "User",
      entityId: res.user.id,
      summary: `Created a tutor login for ${d.name}`,
      meta: { email: d.email },
    });
  } catch (e) {
    if (createdUserId) {
      await prisma.user.delete({ where: { id: createdUserId } }).catch(() => {});
    }
    console.error("createTutorLogin failed", e);
    return { ok: false, error: "Could not create the tutor login - please try again" };
  }
  revalidatePath("/german-note/manage");
  revalidatePath("/people");
  return { ok: true };
}

/** Delete the tutor's account. Their batches stay (tutor unassigned); their posts stay ("Former member"). */
export async function revokeTutorLogin(userId: string): Promise<ActionResult> {
  const session = await requireAdmin();
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true, name: true } });
  if (!user || user.role !== "TUTOR") return { ok: false, error: "Not a tutor account" };
  await prisma.user.delete({ where: { id: userId } });
  await logActivity(session, {
    action: "gn.tutor.revoke",
    section: "german-note",
    entityType: "User",
    entityId: userId,
    summary: `Deleted the tutor login for ${user.name}`,
  });
  revalidatePath("/german-note");
  revalidatePath("/german-note/manage");
  revalidatePath("/people");
  return { ok: true };
}

// ── Class recordings (Admin or the batch's tutor) ──────────────

const recordingSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(160),
  classDate: z.string().min(10, "Class date is required"),
  videoUrl: z.string().trim().min(1, "Video link is required").max(500),
  notes: z.string().trim().max(2000).optional(),
  moduleId: z.string().trim().optional(),
});

/** null = default section; undefined = the id didn't belong to this batch (reject). */
async function resolveModuleId(batchId: string, moduleId: string | undefined): Promise<string | null | undefined> {
  if (!moduleId) return null;
  const mod = await prisma.gnModule.findUnique({ where: { id: moduleId }, select: { batchId: true } });
  if (!mod || mod.batchId !== batchId) return undefined;
  return moduleId;
}

export async function postRecording(batchId: string, form: FormData): Promise<ActionResult> {
  const session = await requireGn();
  if (!(await canManageBatch(session, batchId))) return { ok: false, error: "Not allowed" };
  const parsed = recordingSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const d = parsed.data;
  const video = parseVideoUrl(d.videoUrl);
  if (!video) return { ok: false, error: "Paste the Fathom share link (or a YouTube / Vimeo / Google Drive video link)" };
  const moduleId = await resolveModuleId(batchId, d.moduleId);
  if (moduleId === undefined) return { ok: false, error: "That module doesn't belong to this batch" };

  const recording = await prisma.gnRecording.create({
    data: {
      batchId,
      moduleId,
      title: d.title,
      classDate: parseDateInput(d.classDate),
      videoUrl: d.videoUrl,
      provider: video.provider,
      embedUrl: video.embedUrl,
      notes: d.notes || null,
      postedById: session.user.id,
    },
  });
  await logActivity(session, {
    action: "gn.recording.post",
    section: "german-note",
    entityType: "GnRecording",
    entityId: recording.id,
    summary: `Posted the class recording "${recording.title}"`,
    meta: { batchId, moduleId, provider: recording.provider, classDate: d.classDate },
  });
  revalidateBatch(batchId);
  return { ok: true };
}

export async function updateRecording(recordingId: string, form: FormData): Promise<ActionResult> {
  const session = await requireGn();
  const recording = await prisma.gnRecording.findUnique({
    where: { id: recordingId },
    select: { batchId: true, moduleId: true, title: true, classDate: true, videoUrl: true, notes: true },
  });
  if (!recording) return { ok: false, error: "Recording not found" };
  if (!(await canManageBatch(session, recording.batchId))) return { ok: false, error: "Not allowed" };
  const parsed = recordingSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const d = parsed.data;
  const video = parseVideoUrl(d.videoUrl);
  if (!video) return { ok: false, error: "Paste the Fathom share link (or a YouTube / Vimeo / Google Drive video link)" };
  const moduleId = await resolveModuleId(recording.batchId, d.moduleId);
  if (moduleId === undefined) return { ok: false, error: "That module doesn't belong to this batch" };

  const updated = await prisma.gnRecording.update({
    where: { id: recordingId },
    data: {
      moduleId,
      title: d.title,
      classDate: parseDateInput(d.classDate),
      videoUrl: d.videoUrl,
      provider: video.provider,
      embedUrl: video.embedUrl,
      notes: d.notes || null,
    },
  });
  const diff = diffFields(recording as Record<string, unknown>, {
    moduleId: updated.moduleId,
    title: updated.title,
    classDate: updated.classDate,
    videoUrl: updated.videoUrl,
    notes: updated.notes,
  });
  if (diff.changed.length > 0) {
    await logActivity(session, {
      action: "gn.recording.update",
      section: "german-note",
      entityType: "GnRecording",
      entityId: recordingId,
      summary: `Edited the class recording "${updated.title}"`,
      meta: { changed: diff.changed, before: diff.before, after: diff.after },
    });
  }
  revalidateBatch(recording.batchId);
  return { ok: true };
}

// ── Classroom modules (Admin or the batch's tutor) ─────────────

const moduleSchema = z.object({ title: z.string().trim().min(1, "Module title is required").max(120) });

export async function createGnModule(batchId: string, form: FormData): Promise<ActionResult> {
  const session = await requireGn();
  if (!(await canManageBatch(session, batchId))) return { ok: false, error: "Not allowed" };
  const parsed = moduleSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const last = await prisma.gnModule.findFirst({ where: { batchId }, orderBy: { orderIndex: "desc" }, select: { orderIndex: true } });
  const created = await prisma.gnModule.create({ data: { batchId, title: parsed.data.title, orderIndex: (last?.orderIndex ?? -1) + 1 } });
  await logActivity(session, {
    action: "gn.module.create",
    section: "german-note",
    entityType: "GnModule",
    entityId: created.id,
    summary: `Created the classroom module "${created.title}"`,
    meta: { batchId },
  });
  revalidateBatch(batchId);
  return { ok: true };
}

export async function renameGnModule(moduleId: string, form: FormData): Promise<ActionResult> {
  const session = await requireGn();
  const mod = await prisma.gnModule.findUnique({ where: { id: moduleId }, select: { batchId: true, title: true } });
  if (!mod) return { ok: false, error: "Module not found" };
  if (!(await canManageBatch(session, mod.batchId))) return { ok: false, error: "Not allowed" };
  const parsed = moduleSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  await prisma.gnModule.update({ where: { id: moduleId }, data: { title: parsed.data.title } });
  const diff = diffFields({ title: mod.title }, { title: parsed.data.title });
  if (diff.changed.length > 0) {
    await logActivity(session, {
      action: "gn.module.update",
      section: "german-note",
      entityType: "GnModule",
      entityId: moduleId,
      summary: `Renamed the classroom module "${mod.title}" to "${parsed.data.title}"`,
      meta: { changed: diff.changed, before: diff.before, after: diff.after, batchId: mod.batchId },
    });
  }
  revalidateBatch(mod.batchId);
  return { ok: true };
}

/** Delete a module — its recordings drop to the default "Class recordings" section (SetNull). */
export async function deleteGnModule(moduleId: string): Promise<ActionResult> {
  const session = await requireGn();
  const mod = await prisma.gnModule.findUnique({ where: { id: moduleId }, select: { batchId: true, title: true } });
  if (!mod) return { ok: false, error: "Module not found" };
  if (!(await canManageBatch(session, mod.batchId))) return { ok: false, error: "Not allowed" };
  await prisma.gnModule.delete({ where: { id: moduleId } });
  await logActivity(session, {
    action: "gn.module.delete",
    section: "german-note",
    entityType: "GnModule",
    entityId: moduleId,
    summary: `Deleted the classroom module "${mod.title}"`,
    meta: { batchId: mod.batchId },
  });
  revalidateBatch(mod.batchId);
  return { ok: true };
}

export async function reorderGnModule(moduleId: string, direction: "up" | "down"): Promise<ActionResult> {
  const session = await requireGn();
  const mod = await prisma.gnModule.findUnique({ where: { id: moduleId }, select: { batchId: true, orderIndex: true, title: true } });
  if (!mod) return { ok: false, error: "Module not found" };
  if (!(await canManageBatch(session, mod.batchId))) return { ok: false, error: "Not allowed" };
  const neighbour = await prisma.gnModule.findFirst({
    where: {
      batchId: mod.batchId,
      orderIndex: direction === "up" ? { lt: mod.orderIndex } : { gt: mod.orderIndex },
    },
    orderBy: { orderIndex: direction === "up" ? "desc" : "asc" },
    select: { id: true, orderIndex: true },
  });
  if (!neighbour) return { ok: true }; // already at the edge
  await prisma.$transaction([
    prisma.gnModule.update({ where: { id: moduleId }, data: { orderIndex: neighbour.orderIndex } }),
    prisma.gnModule.update({ where: { id: neighbour.id }, data: { orderIndex: mod.orderIndex } }),
  ]);
  await logActivity(session, {
    action: "gn.module.reorder",
    section: "german-note",
    entityType: "GnModule",
    entityId: moduleId,
    summary: `Moved the classroom module "${mod.title}" ${direction}`,
    meta: { batchId: mod.batchId, direction, before: { orderIndex: mod.orderIndex }, after: { orderIndex: neighbour.orderIndex } },
  });
  revalidateBatch(mod.batchId);
  return { ok: true };
}

// ── Calendar: scheduled live classes (Admin or the batch's tutor) ──

const GN_EVENT_TYPES = ["KICKOFF", "COACHING", "LINKEDIN", "QA", "OPEN_MARKET", "LIVE_CLASS", "OTHER"] as const;

const eventSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(160),
  type: z.enum(GN_EVENT_TYPES).optional(), // session kind; DB default LIVE_CLASS
  startsAt: z.string().min(10, "Start time is required"),
  durationMins: z.string().trim().regex(/^\d{0,4}$/).optional(),
  joinUrl: z.string().trim().max(500).optional(),
  notes: z.string().trim().max(1000).optional(),
});

function parseEventFields(d: z.infer<typeof eventSchema>) {
  const startsAt = new Date(d.startsAt);
  if (isNaN(startsAt.getTime())) return null;
  return {
    title: d.title,
    // undefined → create uses the DB default (LIVE_CLASS); update leaves it unchanged.
    type: d.type || undefined,
    startsAt,
    durationMins: d.durationMins?.trim() ? parseInt(d.durationMins, 10) : null,
    joinUrl: d.joinUrl?.trim() || null,
    notes: d.notes?.trim() || null,
  };
}

export async function scheduleGnEvent(batchId: string, form: FormData): Promise<ActionResult> {
  const session = await requireGn();
  if (!(await canManageBatch(session, batchId))) return { ok: false, error: "Not allowed" };
  const parsed = eventSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const fields = parseEventFields(parsed.data);
  if (!fields) return { ok: false, error: "Invalid start time" };
  const event = await prisma.gnEvent.create({ data: { batchId, createdById: session.user.id, ...fields } });
  await logActivity(session, {
    action: "gn.event.create",
    section: "german-note",
    entityType: "GnEvent",
    entityId: event.id,
    summary: `Scheduled "${event.title}" on the German Note calendar`,
    meta: { batchId, type: event.type, startsAt: parsed.data.startsAt, durationMins: event.durationMins },
  });
  revalidateBatch(batchId);
  return { ok: true };
}

export async function updateGnEvent(eventId: string, form: FormData): Promise<ActionResult> {
  const session = await requireGn();
  const event = await prisma.gnEvent.findUnique({
    where: { id: eventId },
    select: { batchId: true, title: true, type: true, startsAt: true, durationMins: true, joinUrl: true, notes: true },
  });
  if (!event) return { ok: false, error: "Event not found" };
  if (!(await canManageBatch(session, event.batchId))) return { ok: false, error: "Not allowed" };
  const parsed = eventSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const fields = parseEventFields(parsed.data);
  if (!fields) return { ok: false, error: "Invalid start time" };
  const updated = await prisma.gnEvent.update({ where: { id: eventId }, data: fields });
  const diff = diffFields(event as Record<string, unknown>, {
    title: updated.title,
    type: updated.type,
    startsAt: updated.startsAt,
    durationMins: updated.durationMins,
    joinUrl: updated.joinUrl,
    notes: updated.notes,
  });
  if (diff.changed.length > 0) {
    await logActivity(session, {
      action: "gn.event.update",
      section: "german-note",
      entityType: "GnEvent",
      entityId: eventId,
      summary: `Edited the calendar event "${updated.title}"`,
      meta: { changed: diff.changed, before: diff.before, after: diff.after, batchId: event.batchId },
    });
  }
  revalidateBatch(event.batchId);
  return { ok: true };
}

export async function deleteGnEvent(eventId: string): Promise<ActionResult> {
  const session = await requireGn();
  const event = await prisma.gnEvent.findUnique({ where: { id: eventId }, select: { batchId: true, title: true } });
  if (!event) return { ok: false, error: "Event not found" };
  if (!(await canManageBatch(session, event.batchId))) return { ok: false, error: "Not allowed" };
  await prisma.gnEvent.delete({ where: { id: eventId } });
  await logActivity(session, {
    action: "gn.event.delete",
    section: "german-note",
    entityType: "GnEvent",
    entityId: eventId,
    summary: `Deleted the calendar event "${event.title}"`,
    meta: { batchId: event.batchId },
  });
  revalidateBatch(event.batchId);
  return { ok: true };
}

export async function deleteRecording(recordingId: string): Promise<ActionResult> {
  const session = await requireGn();
  const recording = await prisma.gnRecording.findUnique({
    where: { id: recordingId },
    select: { batchId: true, title: true },
  });
  if (!recording) return { ok: false, error: "Recording not found" };
  if (!(await canManageBatch(session, recording.batchId))) return { ok: false, error: "Not allowed" };
  await prisma.gnRecording.delete({ where: { id: recordingId } });
  await logActivity(session, {
    action: "gn.recording.delete",
    section: "german-note",
    entityType: "GnRecording",
    entityId: recordingId,
    summary: `Deleted the class recording "${recording.title}"`,
    meta: { batchId: recording.batchId },
  });
  revalidateBatch(recording.batchId);
  return { ok: true };
}

// ── Community: posts, comments, likes ──────────────────────────

const postSchema = z.object({
  title: z.string().trim().max(150, "Keep the title under 150 characters").optional(),
  category: z.enum(["GENERAL", "ANNOUNCEMENT", "QUESTION", "WIN"]).default("GENERAL"),
  body: z.string().trim().min(1, "Write something first").max(5000, "Keep posts under 5000 characters"),
  batchId: z.string().trim().optional(),
  imageUrl: z.string().optional(),
});

export async function createGnPost(form: FormData): Promise<ActionResult> {
  const session = await requireGn();
  const parsed = postSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const batchId = parsed.data.batchId || null;

  let batchName: string | null = null;
  if (batchId) {
    const batch = await prisma.gnBatch.findUnique({ where: { id: batchId }, select: { status: true, name: true } });
    if (!batch) return { ok: false, error: "Batch not found" };
    if (batch.status !== "ACTIVE") return { ok: false, error: "This batch is archived" };
    if (!(await isBatchParticipant(session, batchId))) return { ok: false, error: "Not allowed" };
    batchName = batch.name;
  } else if (!(await isGnParticipant(session))) {
    return { ok: false, error: "Not allowed" };
  }

  const image = validPostImage(parsed.data.imageUrl);
  if (!image.ok) return { ok: false, error: image.error };
  const candidates = await loadMentionCandidates(batchId);
  const mentionedUserIds = parseMentions(parsed.data.body, candidates);

  const post = await prisma.gnPost.create({
    data: {
      batchId,
      authorId: session.user.id,
      title: parsed.data.title || null,
      category: parsed.data.category,
      body: parsed.data.body,
      imageUrl: image.value,
      mentionedUserIds,
    },
  });
  await logActivity(session, {
    action: "gn.post.create",
    section: "german-note",
    entityType: "GnPost",
    entityId: post.id,
    summary: `Posted ${post.title ? `"${post.title}"` : "a message"} to ${
      batchName ? `the batch "${batchName}"` : "the German Note community"
    }`,
    meta: { batchId, category: post.category, mentions: mentionedUserIds.length, hasImage: image.value !== null },
  });
  if (batchId) revalidatePath(`/german-note/${batchId}`);
  revalidatePath("/german-note");
  return { ok: true };
}

/** Pin/unpin (Skool-style). Admin everywhere; a tutor inside their own batch. */
export async function toggleGnPin(postId: string): Promise<ActionResult> {
  const session = await requireGn();
  const post = await prisma.gnPost.findUnique({
    where: { id: postId },
    select: { pinned: true, title: true, batchId: true, batch: { select: { tutorId: true } } },
  });
  if (!post) return { ok: false, error: "Post not found" };
  const allowed =
    session.role === "ADMIN" ||
    (post.batch?.tutorId != null && post.batch.tutorId === session.user.id);
  if (!allowed) return { ok: false, error: "Not allowed" };

  const updated = await prisma.gnPost.update({ where: { id: postId }, data: { pinned: !post.pinned } });
  await logActivity(session, {
    action: "gn.post.update",
    section: "german-note",
    entityType: "GnPost",
    entityId: postId,
    summary: `${updated.pinned ? "Pinned" : "Unpinned"} the post ${
      post.title ? `"${post.title}"` : "in the German Note community"
    }`,
    meta: { changed: ["pinned"], before: { pinned: post.pinned }, after: { pinned: updated.pinned } },
  });
  revalidatePath(post.batchId ? `/german-note/${post.batchId}` : "/german-note");
  return { ok: true };
}

/** Post-scope participation: global post → GN participant; batch post → that batch. */
async function canParticipateInPostScope(
  session: { role: string; user: { id: string } },
  post: { batchId: string | null }
) {
  return post.batchId ? isBatchParticipant(session, post.batchId) : isGnParticipant(session);
}

const commentSchema = z.object({
  body: z.string().trim().min(1, "Write something first").max(2000, "Keep comments under 2000 characters"),
});

export async function createGnComment(postId: string, form: FormData): Promise<ActionResult> {
  const session = await requireGn();
  const parsed = commentSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const post = await prisma.gnPost.findUnique({ where: { id: postId }, select: { batchId: true, title: true } });
  if (!post) return { ok: false, error: "Post not found" };
  if (!(await canParticipateInPostScope(session, post))) return { ok: false, error: "Not allowed" };

  const candidates = await loadMentionCandidates(post.batchId);
  const mentionedUserIds = parseMentions(parsed.data.body, candidates);

  const comment = await prisma.gnComment.create({
    data: { postId, authorId: session.user.id, body: parsed.data.body, mentionedUserIds },
  });
  await logActivity(session, {
    action: "gn.post.comment",
    section: "german-note",
    entityType: "GnComment",
    entityId: comment.id,
    summary: `Commented on the post ${post.title ? `"${post.title}"` : "in the German Note community"}`,
    meta: { postId, batchId: post.batchId, mentions: mentionedUserIds.length },
  });
  revalidatePath(post.batchId ? `/german-note/${post.batchId}` : "/german-note");
  return { ok: true };
}

export async function toggleGnLike(postId: string): Promise<ActionResult> {
  const session = await requireGn();
  const post = await prisma.gnPost.findUnique({ where: { id: postId }, select: { batchId: true } });
  if (!post) return { ok: false, error: "Post not found" };
  if (!(await canParticipateInPostScope(session, post))) return { ok: false, error: "Not allowed" };

  const existing = await prisma.gnLike.findUnique({
    where: { postId_userId: { postId, userId: session.user.id } },
  });
  if (existing) {
    await prisma.gnLike.delete({ where: { id: existing.id } });
  } else {
    await prisma.gnLike.create({ data: { postId, userId: session.user.id } });
  }
  revalidatePath(post.batchId ? `/german-note/${post.batchId}` : "/german-note");
  return { ok: true };
}

/** Like/unlike a comment — feeds the author's community points like post likes do. */
export async function toggleGnCommentLike(commentId: string): Promise<ActionResult> {
  const session = await requireGn();
  const comment = await prisma.gnComment.findUnique({
    where: { id: commentId },
    select: { post: { select: { batchId: true } } },
  });
  if (!comment) return { ok: false, error: "Comment not found" };
  if (!(await canParticipateInPostScope(session, comment.post))) return { ok: false, error: "Not allowed" };

  const existing = await prisma.gnCommentLike.findUnique({
    where: { commentId_userId: { commentId, userId: session.user.id } },
  });
  if (existing) {
    await prisma.gnCommentLike.delete({ where: { id: existing.id } });
  } else {
    await prisma.gnCommentLike.create({ data: { commentId, userId: session.user.id } });
  }
  revalidatePath(comment.post.batchId ? `/german-note/${comment.post.batchId}` : "/german-note");
  return { ok: true };
}

/** Mark/unmark a class recording as watched (per viewer) — drives the batch progress bar. */
export async function toggleRecordingWatched(recordingId: string): Promise<ActionResult> {
  const session = await requireGn();
  const recording = await prisma.gnRecording.findUnique({
    where: { id: recordingId },
    select: { batchId: true },
  });
  if (!recording) return { ok: false, error: "Recording not found" };
  if (!(await isBatchParticipant(session, recording.batchId))) return { ok: false, error: "Not allowed" };

  const existing = await prisma.gnRecordingWatch.findUnique({
    where: { recordingId_userId: { recordingId, userId: session.user.id } },
  });
  if (existing) {
    await prisma.gnRecordingWatch.delete({ where: { id: existing.id } });
  } else {
    await prisma.gnRecordingWatch.create({ data: { recordingId, userId: session.user.id } });
  }
  revalidatePath(`/german-note/${recording.batchId}`);
  revalidatePath("/german-note");
  return { ok: true };
}

export async function deleteGnPost(postId: string): Promise<ActionResult> {
  const session = await requireGn();
  const post = await prisma.gnPost.findUnique({
    where: { id: postId },
    select: { authorId: true, title: true, batchId: true, batch: { select: { tutorId: true } } },
  });
  if (!post) return { ok: false, error: "Post not found" };
  const allowed =
    session.role === "ADMIN" ||
    post.authorId === session.user.id ||
    (post.batch?.tutorId != null && post.batch.tutorId === session.user.id);
  if (!allowed) return { ok: false, error: "Not allowed" };

  await prisma.gnPost.delete({ where: { id: postId } });
  await logActivity(session, {
    action: "gn.post.delete",
    section: "german-note",
    entityType: "GnPost",
    entityId: postId,
    summary: `Deleted the post ${post.title ? `"${post.title}"` : "in the German Note community"}`,
    meta: { batchId: post.batchId, authorId: post.authorId },
  });
  revalidatePath(post.batchId ? `/german-note/${post.batchId}` : "/german-note");
  return { ok: true };
}

export async function deleteGnComment(commentId: string): Promise<ActionResult> {
  const session = await requireGn();
  const comment = await prisma.gnComment.findUnique({
    where: { id: commentId },
    select: {
      authorId: true,
      post: { select: { batchId: true, title: true, batch: { select: { tutorId: true } } } },
    },
  });
  if (!comment) return { ok: false, error: "Comment not found" };
  const allowed =
    session.role === "ADMIN" ||
    comment.authorId === session.user.id ||
    (comment.post.batch?.tutorId != null && comment.post.batch.tutorId === session.user.id);
  if (!allowed) return { ok: false, error: "Not allowed" };

  await prisma.gnComment.delete({ where: { id: commentId } });
  await logActivity(session, {
    action: "gn.comment.delete",
    section: "german-note",
    entityType: "GnComment",
    entityId: commentId,
    summary: `Deleted a comment on the post ${
      comment.post.title ? `"${comment.post.title}"` : "in the German Note community"
    }`,
    meta: { batchId: comment.post.batchId, authorId: comment.authorId },
  });
  revalidatePath(comment.post.batchId ? `/german-note/${comment.post.batchId}` : "/german-note");
  return { ok: true };
}

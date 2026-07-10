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
  notes: z.string().trim().max(2000).optional(),
});

async function validTutorId(tutorId: string | undefined): Promise<string | null | undefined> {
  if (!tutorId) return null;
  const tutor = await prisma.user.findUnique({ where: { id: tutorId }, select: { role: true } });
  if (!tutor || tutor.role !== "TUTOR") return undefined; // undefined = invalid
  return tutorId;
}

export async function createBatch(form: FormData): Promise<ActionResult> {
  await requireAdmin();
  const parsed = batchSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const tutorId = await validTutorId(parsed.data.tutorId);
  if (tutorId === undefined) return { ok: false, error: "Selected tutor account not found" };
  await prisma.gnBatch.create({
    data: {
      name: parsed.data.name,
      level: parsed.data.level,
      tutorId,
      notes: parsed.data.notes || null,
    },
  });
  revalidatePath("/german-note");
  revalidatePath("/german-note/manage");
  return { ok: true };
}

export async function updateBatch(batchId: string, form: FormData): Promise<ActionResult> {
  await requireAdmin();
  const parsed = batchSchema
    .extend({ status: z.enum(["ACTIVE", "ARCHIVED"]) })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const tutorId = await validTutorId(parsed.data.tutorId);
  if (tutorId === undefined) return { ok: false, error: "Selected tutor account not found" };
  await prisma.gnBatch.update({
    where: { id: batchId },
    data: {
      name: parsed.data.name,
      level: parsed.data.level,
      tutorId,
      status: parsed.data.status,
      notes: parsed.data.notes || null,
    },
  });
  revalidateBatch(batchId);
  return { ok: true };
}

/** Hard delete — cascades members, recordings and the batch discussion. Archive is the normal path. */
export async function deleteBatch(batchId: string): Promise<ActionResult> {
  await requireAdmin();
  await prisma.gnBatch.delete({ where: { id: batchId } });
  revalidatePath("/german-note");
  revalidatePath("/german-note/manage");
  return { ok: true };
}

// ── Members (Admin) ────────────────────────────────────────────

export async function addExistingMember(batchId: string, form: FormData): Promise<ActionResult> {
  await requireAdmin();
  const studentId = String(form.get("studentId") ?? "");
  if (!studentId) return { ok: false, error: "Pick a student" };
  const student = await prisma.student.findUnique({ where: { id: studentId }, select: { id: true } });
  if (!student) return { ok: false, error: "Student not found" };
  try {
    await prisma.gnBatchMember.create({ data: { batchId, studentId } });
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
  await requireAdmin();
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
  revalidateBatch(batchId);
  return { ok: true };
}

export async function removeBatchMember(memberId: string): Promise<ActionResult> {
  await requireAdmin();
  const member = await prisma.gnBatchMember.findUnique({ where: { id: memberId }, select: { batchId: true } });
  if (!member) return { ok: false, error: "Member not found" };
  await prisma.gnBatchMember.delete({ where: { id: memberId } });
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
  await requireAdmin();
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
  await requireAdmin();
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
  if (!user || user.role !== "TUTOR") return { ok: false, error: "Not a tutor account" };
  await prisma.user.delete({ where: { id: userId } });
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

  await prisma.gnRecording.create({
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
  revalidateBatch(batchId);
  return { ok: true };
}

export async function updateRecording(recordingId: string, form: FormData): Promise<ActionResult> {
  const session = await requireGn();
  const recording = await prisma.gnRecording.findUnique({
    where: { id: recordingId },
    select: { batchId: true },
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

  await prisma.gnRecording.update({
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
  await prisma.gnModule.create({ data: { batchId, title: parsed.data.title, orderIndex: (last?.orderIndex ?? -1) + 1 } });
  revalidateBatch(batchId);
  return { ok: true };
}

export async function renameGnModule(moduleId: string, form: FormData): Promise<ActionResult> {
  const session = await requireGn();
  const mod = await prisma.gnModule.findUnique({ where: { id: moduleId }, select: { batchId: true } });
  if (!mod) return { ok: false, error: "Module not found" };
  if (!(await canManageBatch(session, mod.batchId))) return { ok: false, error: "Not allowed" };
  const parsed = moduleSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  await prisma.gnModule.update({ where: { id: moduleId }, data: { title: parsed.data.title } });
  revalidateBatch(mod.batchId);
  return { ok: true };
}

/** Delete a module — its recordings drop to the default "Class recordings" section (SetNull). */
export async function deleteGnModule(moduleId: string): Promise<ActionResult> {
  const session = await requireGn();
  const mod = await prisma.gnModule.findUnique({ where: { id: moduleId }, select: { batchId: true } });
  if (!mod) return { ok: false, error: "Module not found" };
  if (!(await canManageBatch(session, mod.batchId))) return { ok: false, error: "Not allowed" };
  await prisma.gnModule.delete({ where: { id: moduleId } });
  revalidateBatch(mod.batchId);
  return { ok: true };
}

export async function reorderGnModule(moduleId: string, direction: "up" | "down"): Promise<ActionResult> {
  const session = await requireGn();
  const mod = await prisma.gnModule.findUnique({ where: { id: moduleId }, select: { batchId: true, orderIndex: true } });
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
  revalidateBatch(mod.batchId);
  return { ok: true };
}

// ── Calendar: scheduled live classes (Admin or the batch's tutor) ──

const eventSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(160),
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
  await prisma.gnEvent.create({ data: { batchId, createdById: session.user.id, ...fields } });
  revalidateBatch(batchId);
  return { ok: true };
}

export async function updateGnEvent(eventId: string, form: FormData): Promise<ActionResult> {
  const session = await requireGn();
  const event = await prisma.gnEvent.findUnique({ where: { id: eventId }, select: { batchId: true } });
  if (!event) return { ok: false, error: "Event not found" };
  if (!(await canManageBatch(session, event.batchId))) return { ok: false, error: "Not allowed" };
  const parsed = eventSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const fields = parseEventFields(parsed.data);
  if (!fields) return { ok: false, error: "Invalid start time" };
  await prisma.gnEvent.update({ where: { id: eventId }, data: fields });
  revalidateBatch(event.batchId);
  return { ok: true };
}

export async function deleteGnEvent(eventId: string): Promise<ActionResult> {
  const session = await requireGn();
  const event = await prisma.gnEvent.findUnique({ where: { id: eventId }, select: { batchId: true } });
  if (!event) return { ok: false, error: "Event not found" };
  if (!(await canManageBatch(session, event.batchId))) return { ok: false, error: "Not allowed" };
  await prisma.gnEvent.delete({ where: { id: eventId } });
  revalidateBatch(event.batchId);
  return { ok: true };
}

export async function deleteRecording(recordingId: string): Promise<ActionResult> {
  const session = await requireGn();
  const recording = await prisma.gnRecording.findUnique({
    where: { id: recordingId },
    select: { batchId: true },
  });
  if (!recording) return { ok: false, error: "Recording not found" };
  if (!(await canManageBatch(session, recording.batchId))) return { ok: false, error: "Not allowed" };
  await prisma.gnRecording.delete({ where: { id: recordingId } });
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

  if (batchId) {
    const batch = await prisma.gnBatch.findUnique({ where: { id: batchId }, select: { status: true } });
    if (!batch) return { ok: false, error: "Batch not found" };
    if (batch.status !== "ACTIVE") return { ok: false, error: "This batch is archived" };
    if (!(await isBatchParticipant(session, batchId))) return { ok: false, error: "Not allowed" };
  } else if (!(await isGnParticipant(session))) {
    return { ok: false, error: "Not allowed" };
  }

  const image = validPostImage(parsed.data.imageUrl);
  if (!image.ok) return { ok: false, error: image.error };
  const candidates = await loadMentionCandidates(batchId);
  const mentionedUserIds = parseMentions(parsed.data.body, candidates);

  await prisma.gnPost.create({
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
  if (batchId) revalidatePath(`/german-note/${batchId}`);
  revalidatePath("/german-note");
  return { ok: true };
}

/** Pin/unpin (Skool-style). Admin everywhere; a tutor inside their own batch. */
export async function toggleGnPin(postId: string): Promise<ActionResult> {
  const session = await requireGn();
  const post = await prisma.gnPost.findUnique({
    where: { id: postId },
    select: { pinned: true, batchId: true, batch: { select: { tutorId: true } } },
  });
  if (!post) return { ok: false, error: "Post not found" };
  const allowed =
    session.role === "ADMIN" ||
    (post.batch?.tutorId != null && post.batch.tutorId === session.user.id);
  if (!allowed) return { ok: false, error: "Not allowed" };

  await prisma.gnPost.update({ where: { id: postId }, data: { pinned: !post.pinned } });
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
  const post = await prisma.gnPost.findUnique({ where: { id: postId }, select: { batchId: true } });
  if (!post) return { ok: false, error: "Post not found" };
  if (!(await canParticipateInPostScope(session, post))) return { ok: false, error: "Not allowed" };

  const candidates = await loadMentionCandidates(post.batchId);
  const mentionedUserIds = parseMentions(parsed.data.body, candidates);

  await prisma.gnComment.create({
    data: { postId, authorId: session.user.id, body: parsed.data.body, mentionedUserIds },
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
    select: { authorId: true, batchId: true, batch: { select: { tutorId: true } } },
  });
  if (!post) return { ok: false, error: "Post not found" };
  const allowed =
    session.role === "ADMIN" ||
    post.authorId === session.user.id ||
    (post.batch?.tutorId != null && post.batch.tutorId === session.user.id);
  if (!allowed) return { ok: false, error: "Not allowed" };

  await prisma.gnPost.delete({ where: { id: postId } });
  revalidatePath(post.batchId ? `/german-note/${post.batchId}` : "/german-note");
  return { ok: true };
}

export async function deleteGnComment(commentId: string): Promise<ActionResult> {
  const session = await requireGn();
  const comment = await prisma.gnComment.findUnique({
    where: { id: commentId },
    select: {
      authorId: true,
      post: { select: { batchId: true, batch: { select: { tutorId: true } } } },
    },
  });
  if (!comment) return { ok: false, error: "Comment not found" };
  const allowed =
    session.role === "ADMIN" ||
    comment.authorId === session.user.id ||
    (comment.post.batch?.tutorId != null && comment.post.batch.tutorId === session.user.id);
  if (!allowed) return { ok: false, error: "Not allowed" };

  await prisma.gnComment.delete({ where: { id: commentId } });
  revalidatePath(comment.post.batchId ? `/german-note/${comment.post.batchId}` : "/german-note");
  return { ok: true };
}

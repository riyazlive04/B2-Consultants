import "server-only";

import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { resolveWatchTruth } from "@/lib/video-progress";
import type { AppRole } from "@/lib/rbac";

/**
 * German Note read layer (Phase 4). Access rules live HERE and in the action
 * guards — never UI-only:
 *  - global community: ADMIN, any TUTOR, students with ≥1 ACTIVE-batch membership
 *  - batch page: that batch's members (any batch status — alumni keep read
 *    access to their recordings), its tutor, Admin
 * HEAD/USER granted the section via a per-user override see a "not enrolled"
 * empty state (isParticipant stays false).
 */

export type GnAccess = {
  isAdmin: boolean;
  isTutor: boolean;
  /** HEAD: sees every batch and the community, but writes nothing. `isParticipant`
   *  is true so the feed loads, so it can no longer stand in for "may post" — the
   *  post/comment/like paths must check `!isViewer` alongside it. */
  isViewer: boolean;
  isParticipant: boolean;
  memberBatchIds: string[];
  tutorBatchIds: string[];
};

export type GnBatchCard = {
  id: string;
  name: string;
  level: string;
  status: "ACTIVE" | "ARCHIVED";
  tutorName: string | null;
  memberCount: number;
  recordingCount: number;
  watchedCount: number | null; // student progress; null when the viewer isn't a learner
};

export type GnMentionCandidate = { id: string; name: string };

export type GnFeedComment = {
  id: string;
  authorName: string | null; // null = deleted login → "Former member"
  authorImage: string | null;
  authorLevel: number;
  body: string;
  createdAt: string;
  likeCount: number;
  likedByMe: boolean;
  canDelete: boolean;
};

export type GnPostCategoryKey = "GENERAL" | "ANNOUNCEMENT" | "QUESTION" | "WIN";

export type GnFeedPost = {
  id: string;
  batchId: string | null;
  authorName: string | null;
  authorImage: string | null;
  authorRole: string | null;
  authorLevel: number; // Skool-style level from likes received (community points)
  title: string | null;
  category: GnPostCategoryKey;
  pinned: boolean;
  body: string;
  imageUrl: string | null;
  createdAt: string;
  likeCount: number;
  likedByMe: boolean;
  canDelete: boolean;
  canPin: boolean;
  comments: GnFeedComment[];
};

/** Skool's level curve: points (likes received) → level 1–9. */
const LEVEL_THRESHOLDS = [0, 5, 20, 65, 155, 515, 2015, 8015, 33015];

export function gnLevelForPoints(points: number): number {
  let level = 1;
  for (let i = 1; i < LEVEL_THRESHOLDS.length; i++) {
    if (points >= LEVEL_THRESHOLDS[i]) level = i + 1;
  }
  return level;
}

export type GnLevelProgress = {
  level: number;
  points: number;
  floor: number;
  ceil: number | null; // points needed for the next level; null at max level
  toNext: number;
  pct: number; // progress through the current level band
};

/** Where a member sits within their level band — powers the "N points to level X" meter. */
export function gnLevelProgress(points: number): GnLevelProgress {
  const level = gnLevelForPoints(points);
  const floor = LEVEL_THRESHOLDS[level - 1] ?? 0;
  const ceil = level < LEVEL_THRESHOLDS.length ? LEVEL_THRESHOLDS[level] : null;
  const pct = ceil === null ? 100 : Math.round(((points - floor) / (ceil - floor)) * 100);
  return { level, points, floor, ceil, toNext: ceil === null ? 0 : ceil - points, pct };
}

/** Community points per user = likes received on their posts AND comments (Skool counts both). */
async function loadAuthorPoints(): Promise<Map<string, number>> {
  const [postRows, commentRows] = await Promise.all([
    prisma.gnPost.findMany({
      where: { authorId: { not: null } },
      select: { authorId: true, _count: { select: { likes: true } } },
    }),
    prisma.gnComment.findMany({
      where: { authorId: { not: null } },
      select: { authorId: true, _count: { select: { likes: true } } },
    }),
  ]);
  const points = new Map<string, number>();
  for (const r of [...postRows, ...commentRows]) {
    points.set(r.authorId!, (points.get(r.authorId!) ?? 0) + r._count.likes);
  }
  return points;
}

async function loadAuthorLevels(): Promise<Map<string, number>> {
  const points = await loadAuthorPoints();
  const levels = new Map<string, number>();
  for (const [userId, p] of points) levels.set(userId, gnLevelForPoints(p));
  return levels;
}

export type GnRecordingRow = {
  id: string;
  moduleId: string | null;
  title: string;
  classDate: string;
  videoUrl: string;
  provider: "FATHOM" | "YOUTUBE" | "VIMEO" | "GDRIVE";
  embedUrl: string;
  notes: string | null;
  postedByName: string | null;
  /** Completion, resolved by lib/video-progress: tracking wins over the tick (spec §10.3). */
  watched: boolean;
  /** Tracked %, or null when the provider reports nothing. */
  watchedPct: number | null;
  /** They ticked it, but the tracking says otherwise — the case the founders want visible. */
  disputed: boolean;
};

/** A Classroom section: a real module, or the synthetic "Class recordings" bucket (id null). */
export type GnSection = {
  id: string | null;
  title: string;
  orderIndex: number;
  recordings: GnRecordingRow[];
  watchedCount: number;
};

export type GnModuleRow = { id: string; title: string; orderIndex: number };

export type GnEventRow = {
  id: string;
  batchId: string;
  batchName: string | null;
  title: string;
  type: string;
  startsAt: string;
  durationMins: number | null;
  joinUrl: string | null;
  notes: string | null;
  createdByName: string | null;
  isPast: boolean;
};

export type GnBatchDetail = {
  id: string;
  name: string;
  level: string;
  status: "ACTIVE" | "ARCHIVED";
  notes: string | null;
  tutorName: string | null;
  canManage: boolean;
  /** false for a read-only viewer (HEAD), who can open any batch but writes nothing */
  canPost: boolean;
  members: { id: string; fullName: string }[];
  mentionCandidates: GnMentionCandidate[];
  classroom: GnSection[];
  modules: GnModuleRow[];
  events: GnEventRow[];
  recordingTotal: number;
  watchedCount: number;
  feed: GnFeedPost[];
};

/**
 * The LMS at a glance, for the ADMIN/HEAD home tile.
 *
 * Deliberately unscoped — this is an oversight read, so it counts every ACTIVE batch
 * rather than the viewer's own. Callers must gate it by role; it does no checking.
 */
export const getGnHomeSnapshot = cache(async () => {
  const [activeBatches, learners, nextEvent] = await Promise.all([
    prisma.gnBatch.count({ where: { status: "ACTIVE" } }),
    prisma.gnBatchMember.count({ where: { batch: { status: "ACTIVE" } } }),
    prisma.gnEvent.findFirst({
      where: { startsAt: { gte: new Date() }, batch: { status: "ACTIVE" } },
      orderBy: { startsAt: "asc" },
      select: { title: true, startsAt: true, batch: { select: { name: true } } },
    }),
  ]);
  return { activeBatches, learners, nextEvent };
});

export const getGnAccess = cache(async (role: AppRole, userId: string): Promise<GnAccess> => {
  if (role === "ADMIN") {
    return { isAdmin: true, isTutor: false, isViewer: false, isParticipant: true, memberBatchIds: [], tutorBatchIds: [] };
  }
  // HEAD oversees the LMS without being in it: every batch, read-only. No `isAdmin`,
  // because that flag also carries manage + moderate rights (canManage, canPin,
  // canModerate) — a Head must not be able to delete a student's post.
  if (role === "HEAD") {
    return { isAdmin: false, isTutor: false, isViewer: true, isParticipant: true, memberBatchIds: [], tutorBatchIds: [] };
  }
  if (role === "TUTOR") {
    const batches = await prisma.gnBatch.findMany({ where: { tutorId: userId }, select: { id: true } });
    return {
      isAdmin: false,
      isTutor: true,
      isViewer: false,
      isParticipant: true,
      memberBatchIds: [],
      tutorBatchIds: batches.map((b) => b.id),
    };
  }
  if (role === "STUDENT") {
    const memberships = await prisma.gnBatchMember.findMany({
      where: { student: { userId } },
      select: { batchId: true, batch: { select: { status: true } } },
    });
    return {
      isAdmin: false,
      isTutor: false,
      isViewer: false,
      // global feed needs a live cohort; archived-batch alumni keep batch access only
      isParticipant: memberships.some((m) => m.batch.status === "ACTIVE"),
      memberBatchIds: memberships.map((m) => m.batchId),
      tutorBatchIds: [],
    };
  }
  return { isAdmin: false, isTutor: false, isViewer: false, isParticipant: false, memberBatchIds: [], tutorBatchIds: [] };
});

/** Can this viewer delete the given post/comment? Author, Admin, or tutor of the post's batch. */
function canModerate(
  viewerId: string,
  access: GnAccess,
  authorId: string | null,
  batchTutorId: string | null
): boolean {
  if (access.isAdmin) return true;
  if (authorId && authorId === viewerId) return true;
  if (batchTutorId && batchTutorId === viewerId) return true;
  return false;
}

async function loadFeed(
  scope: { batchId: string | null; batchTutorId: string | null },
  viewerId: string,
  access: GnAccess
): Promise<GnFeedPost[]> {
  const [posts, authorLevels] = await Promise.all([
    prisma.gnPost.findMany({
      where: { batchId: scope.batchId },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: {
        author: { select: { id: true, name: true, image: true, role: true } },
        comments: {
          orderBy: { createdAt: "asc" },
          include: {
            author: { select: { id: true, name: true, image: true } },
            likes: { where: { userId: viewerId }, select: { id: true } },
            _count: { select: { likes: true } },
          },
        },
        likes: { where: { userId: viewerId }, select: { id: true } },
        _count: { select: { likes: true } },
      },
    }),
    loadAuthorLevels(),
  ]);
  // Pin rights: Admin everywhere; the batch's tutor inside their batch.
  const canPin = access.isAdmin || (scope.batchTutorId != null && scope.batchTutorId === viewerId);
  const mapped = posts.map((p) => {
    const lastComment = p.comments[p.comments.length - 1];
    return {
      post: {
        id: p.id,
        batchId: p.batchId,
        authorName: p.author?.name ?? null,
        authorImage: p.author?.image ?? null,
        authorRole: p.author?.role ?? null,
        authorLevel: p.author ? (authorLevels.get(p.author.id) ?? 1) : 1,
        title: p.title,
        category: p.category,
        pinned: p.pinned,
        body: p.body,
        imageUrl: p.imageUrl,
        createdAt: p.createdAt.toISOString(),
        likeCount: p._count.likes,
        likedByMe: p.likes.length > 0,
        canDelete: canModerate(viewerId, access, p.authorId, scope.batchTutorId),
        canPin,
        comments: p.comments.map((c) => ({
          id: c.id,
          authorName: c.author?.name ?? null,
          authorImage: c.author?.image ?? null,
          authorLevel: c.author ? (authorLevels.get(c.author.id) ?? 1) : 1,
          body: c.body,
          createdAt: c.createdAt.toISOString(),
          likeCount: c._count.likes,
          likedByMe: c.likes.length > 0,
          canDelete: canModerate(viewerId, access, c.authorId, scope.batchTutorId),
        })),
      },
      // Skool-style bumping: fresh comments float a post back to the top.
      lastActivity: Math.max(
        p.createdAt.getTime(),
        lastComment ? lastComment.createdAt.getTime() : 0
      ),
    };
  });
  mapped.sort((a, b) =>
    a.post.pinned !== b.post.pinned
      ? (a.post.pinned ? -1 : 1)
      : b.lastActivity - a.lastActivity
  );
  return mapped.map((m) => m.post);
}

const batchToCard = (
  b: {
    id: string;
    name: string;
    level: string;
    status: "ACTIVE" | "ARCHIVED";
    tutor: { name: string } | null;
    _count: { members: number; recordings: number };
  },
  watchedCount: number | null = null
): GnBatchCard => ({
  id: b.id,
  name: b.name,
  level: b.level,
  status: b.status,
  tutorName: b.tutor?.name ?? null,
  memberCount: b._count.members,
  recordingCount: b._count.recordings,
  watchedCount,
});

/** Mentionable people for a scope: batch tutor + member logins, or (global) all staff + GN members. */
export async function loadMentionCandidates(batchId: string | null): Promise<GnMentionCandidate[]> {
  const byId = new Map<string, string>();
  if (batchId) {
    const [batch, memberUsers] = await Promise.all([
      prisma.gnBatch.findUnique({ where: { id: batchId }, select: { tutor: { select: { id: true, name: true } } } }),
      prisma.user.findMany({
        where: { studentProfile: { gnMemberships: { some: { batchId } } } },
        select: { id: true, name: true },
      }),
    ]);
    if (batch?.tutor) byId.set(batch.tutor.id, batch.tutor.name);
    for (const u of memberUsers) byId.set(u.id, u.name);
  } else {
    const [staff, memberUsers] = await Promise.all([
      prisma.user.findMany({ where: { role: { in: ["ADMIN", "TUTOR"] } }, select: { id: true, name: true } }),
      prisma.user.findMany({
        where: { role: "STUDENT", studentProfile: { gnMemberships: { some: {} } } },
        select: { id: true, name: true },
      }),
    ]);
    for (const u of [...staff, ...memberUsers]) byId.set(u.id, u.name);
  }
  return [...byId].map(([id, name]) => ({ id, name }));
}

const BATCH_CARD_INCLUDE = {
  tutor: { select: { name: true } },
  _count: { select: { members: true, recordings: true } },
} as const;

// ── Leaderboard (Skool-style: 7-day / 30-day / all-time by likes received) ──

export type GnLeaderRow = {
  userId: string;
  name: string;
  image: string | null;
  role: string | null;
  points: number; // likes received in the window
  level: number; // all-time level
  rank: number;
  isMe: boolean;
};

export type GnLeaderWindow = { rows: GnLeaderRow[]; me: GnLeaderRow | null };

export type GnLeaderboard = {
  sevenDay: GnLeaderWindow;
  thirtyDay: GnLeaderWindow;
  allTime: GnLeaderWindow;
};

type LikeAuthor = { id: string; name: string; image: string | null; role: string };

/** Rank a points map into a leaderboard window: top 10 + the viewer's own row. */
function rankWindow(
  points: Map<string, number>,
  authors: Map<string, LikeAuthor>,
  allTimeLevel: Map<string, number>,
  viewerId: string
): GnLeaderWindow {
  const sorted = [...points.entries()]
    .filter(([id]) => authors.has(id))
    .sort((a, b) => b[1] - a[1]);
  // standard competition ranking (ties share a rank)
  const ranked: GnLeaderRow[] = [];
  let prevPoints: number | null = null;
  let prevRank = 0;
  sorted.forEach(([id, pts], i) => {
    const rank = prevPoints !== null && pts === prevPoints ? prevRank : i + 1;
    prevPoints = pts;
    prevRank = rank;
    const a = authors.get(id)!;
    ranked.push({
      userId: id,
      name: a.name,
      image: a.image,
      role: a.role,
      points: pts,
      level: allTimeLevel.get(id) ?? 1,
      rank,
      isMe: id === viewerId,
    });
  });
  const me = ranked.find((r) => r.isMe) ?? null;
  return { rows: ranked.slice(0, 10), me };
}

/** Community leaderboard across all German Note content (global, like Skool). */
export const getGnLeaderboard = cache(async (viewerId: string): Promise<GnLeaderboard> => {
  const [postLikes, commentLikes] = await Promise.all([
    prisma.gnLike.findMany({
      select: { createdAt: true, post: { select: { author: { select: { id: true, name: true, image: true, role: true } } } } },
    }),
    prisma.gnCommentLike.findMany({
      select: { createdAt: true, comment: { select: { author: { select: { id: true, name: true, image: true, role: true } } } } },
    }),
  ]);
  const now = Date.now();
  const day = 86400000;
  const authors = new Map<string, LikeAuthor>();
  const all = new Map<string, number>();
  const d30 = new Map<string, number>();
  const d7 = new Map<string, number>();
  const bump = (author: LikeAuthor | null, createdAt: Date) => {
    if (!author) return; // like on content whose author was deleted → doesn't score anyone
    authors.set(author.id, author);
    const add = (m: Map<string, number>) => m.set(author.id, (m.get(author.id) ?? 0) + 1);
    add(all);
    if (now - createdAt.getTime() <= 30 * day) add(d30);
    if (now - createdAt.getTime() <= 7 * day) add(d7);
  };
  for (const l of postLikes) bump(l.post.author, l.createdAt);
  for (const l of commentLikes) bump(l.comment.author, l.createdAt);

  const allTimeLevel = new Map<string, number>();
  for (const [id, pts] of all) allTimeLevel.set(id, gnLevelForPoints(pts));

  return {
    sevenDay: rankWindow(d7, authors, allTimeLevel, viewerId),
    thirtyDay: rankWindow(d30, authors, allTimeLevel, viewerId),
    allTime: rankWindow(all, authors, allTimeLevel, viewerId),
  };
});

/** Overview page: the viewer's batches + the global community feed + leaderboard. */
export const getGnOverview = cache(async (role: AppRole, userId: string) => {
  const access = await getGnAccess(role, userId);
  if (!access.isAdmin && !access.isViewer && !access.isTutor && access.memberBatchIds.length === 0) {
    return {
      access,
      batches: [] as GnBatchCard[],
      feed: [] as GnFeedPost[],
      leaderboard: null as GnLeaderboard | null,
      levelProgress: null as GnLevelProgress | null,
      upcomingEvents: [] as GnEventRow[],
      mentionCandidates: [] as GnMentionCandidate[],
    };
  }
  const where = access.isAdmin || access.isViewer
    ? {}
    : access.isTutor
      ? { tutorId: userId }
      : { id: { in: access.memberBatchIds } };
  const isLearner = !access.isAdmin && !access.isViewer && !access.isTutor;
  const [batches, feed, leaderboard, mentionCandidates, myWatches, upcoming] = await Promise.all([
    prisma.gnBatch.findMany({
      where,
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      include: BATCH_CARD_INCLUDE,
    }),
    access.isParticipant
      ? loadFeed({ batchId: null, batchTutorId: null }, userId, access)
      : Promise.resolve([] as GnFeedPost[]),
    access.isParticipant ? getGnLeaderboard(userId) : Promise.resolve(null),
    access.isParticipant ? loadMentionCandidates(null) : Promise.resolve([] as GnMentionCandidate[]),
    isLearner
      ? prisma.gnRecordingWatch.findMany({ where: { userId }, select: { recording: { select: { batchId: true } } } })
      : Promise.resolve([] as { recording: { batchId: string } }[]),
    prisma.gnEvent.findMany({
      where: { startsAt: { gte: new Date() }, batch: where },
      orderBy: { startsAt: "asc" },
      take: 6,
      include: { batch: { select: { name: true } }, createdBy: { select: { name: true } } },
    }),
  ]);
  // Per-batch watched counts drive the student progress bar on each card.
  const watchedByBatch = new Map<string, number>();
  for (const w of myWatches) watchedByBatch.set(w.recording.batchId, (watchedByBatch.get(w.recording.batchId) ?? 0) + 1);
  const mePoints = leaderboard?.allTime.me?.points ?? 0;
  return {
    access,
    batches: batches.map((b) => batchToCard(b, isLearner ? (watchedByBatch.get(b.id) ?? 0) : null)),
    feed,
    leaderboard,
    // A viewer has no cohort of their own, so a personal level bar would read 0/…
    levelProgress: access.isParticipant && !access.isViewer ? gnLevelProgress(mePoints) : null,
    upcomingEvents: upcoming.map((e): GnEventRow => ({
      id: e.id,
      batchId: e.batchId,
      batchName: e.batch.name,
      title: e.title,
      type: e.type,
      startsAt: e.startsAt.toISOString(),
      durationMins: e.durationMins,
      joinUrl: e.joinUrl,
      notes: e.notes,
      createdByName: e.createdBy?.name ?? null,
      isPast: false,
    })),
    mentionCandidates,
  };
});

/** Batch page. Returns null when the viewer has no business seeing this batch. */
export const getGnBatchDetail = cache(
  async (batchId: string, role: AppRole, userId: string): Promise<GnBatchDetail | null> => {
    const access = await getGnAccess(role, userId);
    const batch = await prisma.gnBatch.findUnique({
      where: { id: batchId },
      include: {
        tutor: { select: { id: true, name: true } },
        members: {
          orderBy: { addedAt: "asc" },
          include: { student: { select: { fullName: true } } },
        },
        modules: { orderBy: { orderIndex: "asc" } },
        events: { orderBy: { startsAt: "asc" }, include: { createdBy: { select: { name: true } } } },
        // Classroom order is oldest-first: lesson 1 → lesson n (chronological classes).
        recordings: {
          orderBy: [{ classDate: "asc" }, { createdAt: "asc" }],
          include: {
            postedBy: { select: { name: true } },
            watches: {
              where: { userId },
              select: { id: true, selfReported: true, watchedPct: true },
            },
          },
        },
      },
    });
    if (!batch) return null;
    const isTutorOfBatch = batch.tutorId === userId;
    const isMember = access.memberBatchIds.includes(batchId);
    if (!access.isAdmin && !access.isViewer && !isTutorOfBatch && !isMember) return null;

    const [feed, mentionCandidates] = await Promise.all([
      loadFeed({ batchId, batchTutorId: batch.tutorId }, userId, access),
      loadMentionCandidates(batchId),
    ]);
    const recordings: GnRecordingRow[] = batch.recordings.map((r) => ({
      id: r.id,
      moduleId: r.moduleId,
      title: r.title,
      classDate: r.classDate.toISOString(),
      videoUrl: r.videoUrl,
      provider: r.provider,
      embedUrl: r.embedUrl,
      notes: r.notes,
      postedByName: r.postedBy?.name ?? null,
      // A watch row no longer implies "watched" — tracking may exist with no tick, and a tick
      // may be contradicted by tracking. resolveWatchTruth is the single place that decides.
      ...(() => {
        const w = r.watches[0];
        const truth = resolveWatchTruth({
          watchedPct: w?.watchedPct ?? null,
          selfReported: w?.selfReported ?? false,
        });
        return { watched: truth.complete, watchedPct: truth.pct, disputed: truth.disputed };
      })(),
    }));

    // Build Classroom sections: each module (ordered) with its lessons, then a
    // trailing "Class recordings" bucket for anything not filed into a module.
    const section = (id: string | null, title: string, orderIndex: number): GnSection => {
      const recs = recordings.filter((r) => r.moduleId === id);
      return { id, title, orderIndex, recordings: recs, watchedCount: recs.filter((r) => r.watched).length };
    };
    const classroom: GnSection[] = batch.modules.map((m) => section(m.id, m.title, m.orderIndex));
    const ungrouped = section(null, batch.modules.length ? "Class recordings" : "Class recordings", 9999);
    if (ungrouped.recordings.length || batch.modules.length === 0) classroom.push(ungrouped);

    const now = Date.now();
    const events: GnEventRow[] = batch.events.map((e) => ({
      id: e.id,
      batchId: batch.id,
      batchName: batch.name,
      title: e.title,
      type: e.type,
      startsAt: e.startsAt.toISOString(),
      durationMins: e.durationMins,
      joinUrl: e.joinUrl,
      notes: e.notes,
      createdByName: e.createdBy?.name ?? null,
      isPast: e.startsAt.getTime() < now,
    }));

    return {
      id: batch.id,
      name: batch.name,
      level: batch.level,
      status: batch.status,
      notes: batch.notes,
      tutorName: batch.tutor?.name ?? null,
      canManage: access.isAdmin || isTutorOfBatch,
      // reaching here already proves admin / viewer / tutor-of-batch / member
      canPost: !access.isViewer,
      members: batch.members.map((m) => ({ id: m.id, fullName: m.student.fullName })),
      mentionCandidates,
      classroom: classroom.filter((s) => s.recordings.length > 0 || s.id !== null),
      modules: batch.modules.map((m) => ({ id: m.id, title: m.title, orderIndex: m.orderIndex })),
      events,
      recordingTotal: recordings.length,
      watchedCount: recordings.filter((r) => r.watched).length,
      feed,
    };
  }
);

// ── Admin manage screen ────────────────────────────────────────

export type GnManageBatch = GnBatchCard & {
  notes: string | null;
  tutorId: string | null;
  targetStrength: number;
  createdAt: string;
  members: { id: string; studentId: string; fullName: string; email: string | null; hasLogin: boolean }[];
};

export type GnTutorRow = { id: string; name: string; email: string; batchCount: number };

export type GnStudentOption = {
  id: string;
  fullName: string;
  email: string | null;
  hasLogin: boolean;
  batchNames: string[];
};

export const getGnManageData = cache(async () => {
  const [batches, tutors, students] = await Promise.all([
    prisma.gnBatch.findMany({
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      include: {
        ...BATCH_CARD_INCLUDE,
        members: {
          orderBy: { addedAt: "asc" },
          include: { student: { select: { id: true, fullName: true, email: true, userId: true } } },
        },
      },
    }),
    prisma.user.findMany({
      where: { role: "TUTOR" },
      orderBy: { name: "asc" },
      select: { id: true, name: true, email: true, _count: { select: { gnBatchesTutored: true } } },
    }),
    prisma.student.findMany({
      orderBy: { fullName: "asc" },
      select: {
        id: true,
        fullName: true,
        email: true,
        userId: true,
        gnMemberships: { select: { batch: { select: { name: true } } } },
      },
    }),
  ]);

  return {
    batches: batches.map((b) => ({
      ...batchToCard(b),
      notes: b.notes,
      tutorId: b.tutorId,
      targetStrength: b.targetStrength,
      createdAt: b.createdAt.toISOString(),
      members: b.members.map((m) => ({
        id: m.id,
        studentId: m.student.id,
        fullName: m.student.fullName,
        email: m.student.email,
        hasLogin: m.student.userId !== null,
      })),
    })) as GnManageBatch[],
    tutors: tutors.map((t) => ({
      id: t.id,
      name: t.name,
      email: t.email,
      batchCount: t._count.gnBatchesTutored,
    })) as GnTutorRow[],
    students: students.map((s) => ({
      id: s.id,
      fullName: s.fullName,
      email: s.email,
      hasLogin: s.userId !== null,
      batchNames: s.gnMemberships.map((m) => m.batch.name),
    })) as GnStudentOption[],
  };
});

// ── Members directory + profile (Skool "Members" tab) ──────────

export type GnMemberRow = {
  userId: string;
  name: string;
  image: string | null;
  role: string;
  level: number;
  points: number;
  batchNames: string[];
  joinedAt: string;
  postCount: number;
};

export type GnMemberProfile = GnMemberRow & {
  commentCount: number;
  likesReceived: number;
  recentPosts: { id: string; title: string | null; category: GnPostCategoryKey; batchName: string | null; createdAt: string; likeCount: number }[];
};

/** Everyone in the community: staff (Admin/Tutor) + students with a GN membership. */
export const getGnMembers = cache(async (): Promise<GnMemberRow[]> => {
  const [users, points, postCounts] = await Promise.all([
    prisma.user.findMany({
      where: {
        OR: [{ role: { in: ["ADMIN", "TUTOR"] } }, { role: "STUDENT", studentProfile: { gnMemberships: { some: {} } } }],
      },
      select: {
        id: true, name: true, image: true, role: true, createdAt: true,
        gnBatchesTutored: { select: { name: true } },
        studentProfile: { select: { gnMemberships: { select: { batch: { select: { name: true } } } } } },
      },
    }),
    loadAuthorPoints(),
    prisma.gnPost.groupBy({ by: ["authorId"], where: { authorId: { not: null } }, _count: { _all: true } }),
  ]);
  const postCountByUser = new Map<string, number>();
  for (const p of postCounts) if (p.authorId) postCountByUser.set(p.authorId, p._count._all);

  return users
    .map((u): GnMemberRow => {
      const pts = points.get(u.id) ?? 0;
      const batchNames = [
        ...u.gnBatchesTutored.map((b) => b.name),
        ...(u.studentProfile?.gnMemberships.map((m) => m.batch.name) ?? []),
      ];
      return {
        userId: u.id,
        name: u.name,
        image: u.image,
        role: u.role,
        level: gnLevelForPoints(pts),
        points: pts,
        batchNames,
        joinedAt: u.createdAt.toISOString(),
        postCount: postCountByUser.get(u.id) ?? 0,
      };
    })
    .sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
});

export const getGnMemberProfile = cache(async (userId: string): Promise<GnMemberProfile | null> => {
  const [base, points, postCount, commentCount, postLikes, commentLikes, recent] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true, name: true, image: true, role: true, createdAt: true,
        gnBatchesTutored: { select: { name: true } },
        studentProfile: { select: { gnMemberships: { select: { batch: { select: { name: true } } } } } },
      },
    }),
    loadAuthorPoints(),
    prisma.gnPost.count({ where: { authorId: userId } }),
    prisma.gnComment.count({ where: { authorId: userId } }),
    prisma.gnLike.count({ where: { post: { authorId: userId } } }),
    prisma.gnCommentLike.count({ where: { comment: { authorId: userId } } }),
    prisma.gnPost.findMany({
      where: { authorId: userId },
      orderBy: { createdAt: "desc" },
      take: 8,
      include: { batch: { select: { name: true } }, _count: { select: { likes: true } } },
    }),
  ]);
  if (!base) return null;
  const pts = points.get(userId) ?? 0;
  return {
    userId: base.id,
    name: base.name,
    image: base.image,
    role: base.role,
    level: gnLevelForPoints(pts),
    points: pts,
    batchNames: [
      ...base.gnBatchesTutored.map((b) => b.name),
      ...(base.studentProfile?.gnMemberships.map((m) => m.batch.name) ?? []),
    ],
    joinedAt: base.createdAt.toISOString(),
    postCount,
    commentCount,
    likesReceived: postLikes + commentLikes,
    recentPosts: recent.map((p) => ({
      id: p.id,
      title: p.title,
      category: p.category,
      batchName: p.batch?.name ?? null,
      createdAt: p.createdAt.toISOString(),
      likeCount: p._count.likes,
    })),
  };
});

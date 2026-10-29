import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { ACTIVE } from "@/lib/soft-delete";
import { hasCapability, requireSession } from "@/lib/rbac";
import { takeToken } from "@/lib/rate-limit";
import {
  RECORDING_LIMITS,
  RECORDING_MAX_BYTES,
  clampClipSeconds,
  parseRecordingKind,
  recordingFilename,
  recordingMime,
  sniffContainer,
  type RecordingKind,
} from "@/lib/recording";

/**
 * THE RECORDING ON ONE IMPROVEMENT REPORT - uploaded here, played back from here.
 *
 * Either the reporter's voice, or their SCREEN with their voice over it. See
 * `src/lib/recording.ts` for the caps, the containers and why nothing is transcribed.
 *
 * ── WHY A ROUTE HANDLER AND NOT THE SERVER ACTION ──────────────────────────────────────────
 * `submitImprovement` is a server action, and Next 14 caps an action's request body at 1 MB with
 * nothing in `next.config.mjs` raising it. A screen recording is TWENTY megabytes. So the report
 * is created by the action exactly as it always was, and the media is posted here afterwards
 * against the id it returns. The consequence is deliberate and the UI says so: if this upload
 * fails, THE REPORT IS ALREADY FILED. Losing the recording must never lose the words.
 *
 * ── WHY THE BYTES ARE IN POSTGRES ──────────────────────────────────────────────────────────
 * Same answer as `AgreementAttachment`, whose route this one is modelled on: there is no private
 * object store in this app. `lib/supabase-storage.ts` is the only upload path, its bucket is
 * public-read by design - it is the marketing site's media origin - and its credentials are not
 * configured here at all. A recording of somebody walking through a student's payment schedule
 * does not belong behind a guessable public URL, so it lives in the database and comes back
 * through this authenticated route. No CDN, no caching, no public link anywhere.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The same shape as the submit limiter, because there can never be more recordings than reports:
 * 12 in a half hour. It is charged to its own bucket all the same, so a retry storm on a flaky
 * 20 MB upload cannot eat the allowance somebody needs to FILE their next report.
 */
const UPLOAD_RULE = { capacity: 12, refillPerSec: 12 / 1800 } as const;

// ─────────────────────────────── attach ───────────────────────────────

/**
 * Attach the recording. Only the person who filed the report, and only while it has none.
 *
 * Not "anyone who can triage": a recording is the reporter's own account of what happened, and
 * nothing in this module wants a second person's screen on somebody else's report. A triager with
 * something to add has `ImprovementEvent` comments.
 *
 * A second attempt gets 409 rather than overwriting. The window in which this is legitimately
 * called is the few seconds after Send, so a repeat is either a double-fired request - which the
 * 409 makes harmless - or an attempt to swap the media after a developer has watched it, which is
 * not something this route should make possible.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await requireSession();

  const gate = takeToken(`improvement-recording:${session.user.id}`, UPLOAD_RULE);
  if (!gate.ok) {
    return NextResponse.json(
      { ok: false, error: "That is a lot of recordings in a short time. Give it a few minutes." },
      { status: 429, headers: { "Retry-After": String(gate.retryAfterSec) } },
    );
  }

  const q = new URL(req.url).searchParams;
  const kind: RecordingKind | null = parseRecordingKind(q.get("kind"));
  if (!kind) {
    return NextResponse.json({ ok: false, error: "Unknown recording kind" }, { status: 400 });
  }
  const limit = RECORDING_LIMITS[kind];

  const report = await prisma.improvement.findFirst({
    where: { id: params.id, ...ACTIVE },
    select: { id: true, reporterId: true, recording: { select: { id: true } } },
  });
  // One 404 for "no such report" AND "not yours". Nobody has business learning whether a given id
  // exists on somebody else's report.
  if (!report || report.reporterId !== session.user.id) {
    return NextResponse.json({ ok: false, error: "Report not found" }, { status: 404 });
  }
  if (report.recording) {
    return NextResponse.json(
      { ok: false, error: "This report already has a recording" },
      { status: 409 },
    );
  }

  /**
   * The declared length is checked BEFORE the body is read, so an oversized upload is refused
   * without being buffered into memory first - which matters a great deal more at 25 MB than it
   * did at 2. The real byte count is checked again below, because a Content-Length is just a
   * number somebody sent us.
   */
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > RECORDING_MAX_BYTES) {
    return NextResponse.json({ ok: false, error: "That recording is too big" }, { status: 413 });
  }

  const buf = Buffer.from(await req.arrayBuffer());
  if (buf.length === 0) {
    return NextResponse.json({ ok: false, error: "Empty recording" }, { status: 400 });
  }
  // Checked against THIS kind's cap, not the global one: a 20 MB "voice note" is not a voice note.
  if (buf.length > limit.bytes) {
    return NextResponse.json({ ok: false, error: "That recording is too big" }, { status: 413 });
  }

  /**
   * THE CONTAINER COMES FROM THE BYTES, NEVER FROM THE REQUEST.
   *
   * Whatever is stored here is handed straight back as the `Content-Type` of a response rendered
   * on this origin, so trusting the uploader's header would let a session holder store HTML and
   * have a browser run it. The audio-or-video half comes from `kind` because `audio/webm` and
   * `video/webm` are byte-identical in their header - see `recordingMime`, which explains why
   * that is still safe.
   */
  const container = sniffContainer(new Uint8Array(buf.subarray(0, 16)));
  const mimeType = container ? recordingMime(container, kind) : null;
  if (!mimeType) {
    return NextResponse.json(
      { ok: false, error: "That file is not a recording this app can store" },
      { status: 415 },
    );
  }

  try {
    await prisma.improvementRecording.create({
      data: {
        reportId: report.id,
        kind,
        bytes: buf,
        mimeType,
        size: buf.length,
        seconds: clampClipSeconds(q.get("seconds"), kind),
        hasAudio: q.get("mute") !== "1",
        recordedById: session.user.id,
      },
    });
  } catch (e) {
    // P2002 on the unique reportId: two requests raced. The first won and the recording is there,
    // which is the outcome the caller wanted, so this is a 409 and not a 500.
    if ((e as { code?: string })?.code === "P2002") {
      return NextResponse.json(
        { ok: false, error: "This report already has a recording" },
        { status: 409 },
      );
    }
    throw e;
  }

  /**
   * REVALIDATE, BECAUSE THE ACTION ALREADY DID IT TOO EARLY.
   *
   * `submitImprovement` calls `revalidatePath("/improvements")` when it creates the row - which is
   * BEFORE this request exists, since the media can only be posted once the id comes back. So the
   * queue and the detail page were both re-rendered at a moment when the report genuinely had no
   * recording, and without this they keep that answer: the row is in the database, the player is
   * not on the screen, and nothing will ever go and look again.
   *
   * This was a real bug, found by somebody recording a note and not seeing it. The client calls
   * `router.refresh()` as well, for the page the person is standing on; this one is for every
   * other viewer of the queue.
   */
  revalidatePath("/improvements");

  return NextResponse.json({ ok: true });
}

// ─────────────────────────────── play ───────────────────────────────

/**
 * Stream the recording to an `<audio>` or `<video>` element.
 *
 * Readable by whoever can triage, and by the person who recorded it. The reporter is included on
 * purpose: they can already see their own report, and one whose own author cannot replay what
 * they said is a confusing thing to own.
 *
 * `inline`, where the agreement attachment route uses `attachment` - and the difference is worth
 * stating, because that route's comment argues the opposite case. It serves identity documents
 * uploaded by a stranger during a signing ceremony, so it refuses to render them in the founder's
 * browser at all. This is an authenticated colleague's own recording, narrowed by our own
 * magic-byte sniff to a short whitelist of media types, and a player has to be handed the bytes
 * inline to play them. `nosniff` holds the browser to the type we determined.
 *
 * ── RANGE REQUESTS ─────────────────────────────────────────────────────────────────────────
 * `Accept-Ranges: none`, and the whole file is sent. A three-minute screen recording is ~20 MB,
 * which a player will happily buffer; implementing 206 here would mean re-reading the bytea per
 * range and is not worth it until somebody is storing something far longer. Chrome will not let
 * the viewer seek before the download completes, which is the only visible cost.
 */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await requireSession();

  const row = await prisma.improvementRecording.findFirst({
    where: { reportId: params.id, report: { ...ACTIVE } },
    select: {
      bytes: true,
      mimeType: true,
      kind: true,
      recordedById: true,
      report: { select: { ref: true, reporterId: true } },
    },
  });
  if (!row) return new NextResponse("Not found", { status: 404 });

  const allowed =
    hasCapability(session.role, session.capabilities, "improvements.triage") ||
    row.report.reporterId === session.user.id ||
    row.recordedById === session.user.id;
  if (!allowed) return new NextResponse("Forbidden", { status: 403 });

  const bytes = Buffer.from(row.bytes);
  const filename = recordingFilename(row.report.ref, row.mimeType, row.kind);
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": row.mimeType,
      "Content-Length": String(bytes.length),
      "Content-Disposition": `inline; filename="${filename}"`,
      "Accept-Ranges": "none",
      // Private, like every other authenticated document this app serves. Nothing showing a
      // student's record should sit in a shared cache.
      "Cache-Control": "private, no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

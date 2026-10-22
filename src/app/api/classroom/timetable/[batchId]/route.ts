import { NextResponse } from "next/server";
import { requireSession } from "@/lib/rbac";
import { getMyClassroom } from "@/server/student-classroom";
import { renderTimetablePdf } from "@/documents/timetable-pdf";
import { buildIcs, type IcsEvent } from "@/lib/ics";

/**
 * The student's own timetable, as a PDF (@15:36, @16:33).
 *
 * ── The authorisation, and why it is shaped like this ──────────────────────────────────
 * `batchId` is a path parameter, and a batch id in a URL is NOT authorisation. So this route
 * never queries that batch: it loads the READER's own classroom - the same privacy-filtered view
 * `/classroom` renders - and then looks for the requested cohort inside it. A student who is not
 * seated in that batch has no such entry, and gets a 404 rather than a 403: "that cohort exists
 * and you may not have it" is itself a fact about somebody else's cohort.
 *
 * The consequence is that this is a STUDENT route by construction. Staff have the batch screens,
 * which carry the roster and the register and are gated accordingly; pointing this route at a
 * staff path would mean a second way to read a cohort, with its own chance of being wrong.
 *
 * `no-store`, because the document names a person and is generated on demand. A copy of one
 * student's timetable sitting in a shared proxy is exactly what should not happen to it.
 *
 * ── Two formats, ONE authorisation ─────────────────────────────────────────────────────
 * `?format=ics` returns the same timetable as a calendar feed. It is a query parameter rather
 * than a second route specifically so the permission check above cannot be implemented twice
 * and drift - the expensive half of this route is the question "may you read this cohort", and
 * the answer must not depend on which file format you asked for.
 */

export const runtime = "nodejs"; // @react-pdf/renderer is a Node library
export const dynamic = "force-dynamic";

function safeName(s: string): string {
  const base = s.trim().replace(/[^\p{L}\p{N}\-_ ]/gu, "").replace(/\s+/g, "_").slice(0, 60);
  return base || "timetable";
}

// Next 14 route params - a plain object, as in the other PDF routes in this folder.
export async function GET(req: Request, { params }: { params: { batchId: string } }) {
  const session = await requireSession();
  const { batchId } = params;

  const classroom = await getMyClassroom(session.user.id);
  if (!classroom) {
    return new NextResponse("Your login isn't linked to a student record yet.", { status: 404 });
  }

  const batch = classroom.batches.find((b) => b.id === batchId);
  if (!batch) return new NextResponse("Timetable not found", { status: 404 });

  if (new URL(req.url).searchParams.get("format") === "ics") {
    /**
     * The calendar feed.
     *
     * `session.id` is the UID, so re-importing after a class moves UPDATES the entry instead of
     * adding a second one - which is the whole advantage this has over the PDF.
     *
     * Join links are omitted here as well, and for the same reason as the document: a calendar
     * file is forwarded and synced to devices the login does not control. The description points
     * back at the app, which is where the link belongs.
     */
    const events: IcsEvent[] = batch.sessions.map((s) => ({
      uid: `${s.id}@b2consultants`,
      start: new Date(s.startsAt),
      end:
        s.delivery === "PRE_RECORDED"
          ? undefined
          : new Date(new Date(s.startsAt).getTime() + (s.durationMins ?? 90) * 60_000),
      // A pre-recorded module has no clock - `startsAt` carries its release day.
      allDay: s.delivery === "PRE_RECORDED",
      summary:
        s.delivery === "PRE_RECORDED" ? `${s.title} (recording available)` : `${batch.name}: ${s.title}`,
      description: [
        s.framework,
        s.weekNumber ? `Week ${s.weekNumber}` : null,
        "Join link and materials: open My Classroom in the app.",
      ]
        .filter(Boolean)
        .join("\n"),
    }));

    const ics = buildIcs(events, `${batch.name} timetable`);
    return new NextResponse(ics, {
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": `attachment; filename="${safeName(batch.name)}_timetable.ics"`,
        "Cache-Control": "private, no-store, max-age=0",
      },
    });
  }

  try {
    const bytes = await renderTimetablePdf({
      studentName: classroom.fullName,
      batch,
      generatedAt: new Date().toISOString(),
    });
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Length": String(bytes.length),
        "Content-Disposition": `attachment; filename="${safeName(batch.name)}_timetable.pdf"`,
        "Cache-Control": "private, no-store, max-age=0",
      },
    });
  } catch (err) {
    console.error("timetable render failed:", err);
    return new NextResponse("Couldn't generate that timetable.", { status: 500 });
  }
}

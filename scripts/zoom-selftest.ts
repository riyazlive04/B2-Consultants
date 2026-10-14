/**
 * End-to-end self-test for the Zoom meeting integration.
 *
 *   npm run verify:zoom
 *
 * Drives the REAL reconciler (`src/server/zoom-meetings.ts`) against the REAL Zoom API and a
 * real database, through the whole life of a call: booked → rescheduled → cancelled. It asserts
 * what the prospect would actually get at each step, and confirms with Zoom rather than trusting
 * our own columns - a join url written to the database is worthless if the room is not there.
 *
 * It creates a throwaway slot and booking, and DELETES BOTH plus the Zoom meeting on the way out,
 * including when an assertion fails. Point it at a local database; it refuses to run against a
 * host that looks like Supabase, because the rows it writes are junk and production is not the
 * place to find that out.
 *
 * Run with the repo's usual server-module conditions:
 *   node --conditions=react-server --import tsx scripts/zoom-selftest.ts
 */

import { prisma } from "../src/lib/prisma";
import { getZoomMeeting, getZoomRuntime } from "../src/lib/zoom";
import { syncBookingMeeting } from "../src/server/zoom-meetings";

const TAG = "[zoom-selftest]";

let failures = 0;

function check(label: string, pass: boolean, detail = ""): void {
  if (pass) {
    console.log(`  PASS  ${label}${detail ? ` - ${detail}` : ""}`);
  } else {
    failures += 1;
    console.error(`  FAIL  ${label}${detail ? ` - ${detail}` : ""}`);
  }
}

/** A plain minute-resolution comparison, the same tolerance the reconciler itself uses. */
function sameMinute(a: Date, b: Date): boolean {
  return Math.floor(a.getTime() / 60_000) === Math.floor(b.getTime() / 60_000);
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL ?? "";
  if (/supabase|pooler\./i.test(url)) {
    console.error(`${TAG} refusing to run: DATABASE_URL looks like production.`);
    process.exit(2);
  }
  if (!url) {
    console.error(`${TAG} set DATABASE_URL (e.g. the local :5435 instance) before running.`);
    process.exit(2);
  }

  const runtime = getZoomRuntime();
  console.log(`${TAG} runtime: enabled=${runtime.enabled} configured=${runtime.configured}`);
  if (!runtime.enabled) {
    console.error(`${TAG} Zoom is not armed - set ZOOM_ENABLED=true and the three ZOOM_* secrets.`);
    process.exit(2);
  }

  // Far enough out that the booking rules would accept it and no real call is nearby.
  const firstTime = new Date(Date.now() + 9 * 24 * 60 * 60 * 1000);
  firstTime.setUTCSeconds(0, 0);
  const secondTime = new Date(firstTime.getTime() + 2 * 60 * 60 * 1000);

  const slot = await prisma.appointmentSlot.create({
    data: { startsAt: firstTime, durationMins: 30, status: "BOOKED" },
  });
  const booking = await prisma.bookingRequest.create({
    data: {
      slotId: slot.id,
      name: "Zoom Selftest (delete me)",
      email: "zoom-selftest@example.invalid",
      phone: "+910000000000",
      status: "BOOKED",
    },
  });
  console.log(`${TAG} created slot ${slot.id} + booking ${booking.id}`);

  let meetingId: string | null = null;

  try {
    // ── 1. A booked call gets a room ────────────────────────────────────────────────
    console.log(`\n${TAG} 1. create`);
    const created = await syncBookingMeeting(booking.id);
    check("reconciler reports 'created'", created.outcome === "created", created.outcome);

    const afterCreate = await prisma.bookingRequest.findUnique({
      where: { id: booking.id },
      select: { zoomMeetingId: true, zoomJoinUrl: true, zoomStartUrl: true, zoomStartsAt: true },
    });
    meetingId = afterCreate?.zoomMeetingId ?? null;

    check("a join url was stored", Boolean(afterCreate?.zoomJoinUrl), afterCreate?.zoomJoinUrl ?? "none");
    check("a host start url was stored", Boolean(afterCreate?.zoomStartUrl));
    check("the join url is a zoom.us link", /zoom\.us\//.test(afterCreate?.zoomJoinUrl ?? ""));
    check(
      "the join url carries its passcode (no typing for the prospect)",
      /[?&]pwd=/.test(afterCreate?.zoomJoinUrl ?? ""),
    );
    check(
      "the host link and the prospect link are different",
      Boolean(afterCreate?.zoomStartUrl) && afterCreate?.zoomStartUrl !== afterCreate?.zoomJoinUrl,
    );
    check(
      "zoomStartsAt matches the slot",
      Boolean(afterCreate?.zoomStartsAt) && sameMinute(afterCreate!.zoomStartsAt!, firstTime),
    );

    // Confirm with ZOOM, not with our own columns.
    const live = meetingId ? await getZoomMeeting(meetingId) : null;
    check("Zoom itself has the meeting", Boolean(live?.ok), live && !live.ok ? live.error : "");

    // ── 2. Calling it again changes nothing ─────────────────────────────────────────
    console.log(`\n${TAG} 2. idempotence`);
    const again = await syncBookingMeeting(booking.id);
    check("a second sync is a no-op", again.outcome === "unchanged", again.outcome);

    // ── 3. A reschedule MOVES the room, it does not mint a second one ───────────────
    console.log(`\n${TAG} 3. reschedule`);
    await prisma.appointmentSlot.update({ where: { id: slot.id }, data: { startsAt: secondTime } });
    // What every reschedule path in the app writes: keep the meeting id, mark the time stale.
    await prisma.bookingRequest.update({ where: { id: booking.id }, data: { zoomStartsAt: null } });

    const moved = await syncBookingMeeting(booking.id);
    check("reconciler reports 'moved'", moved.outcome === "moved", moved.outcome);

    const afterMove = await prisma.bookingRequest.findUnique({
      where: { id: booking.id },
      select: { zoomMeetingId: true, zoomJoinUrl: true, zoomStartsAt: true },
    });
    check(
      "the SAME meeting was reused (no second room)",
      Boolean(afterMove?.zoomMeetingId) && afterMove?.zoomMeetingId === meetingId,
      `${meetingId} -> ${afterMove?.zoomMeetingId}`,
    );
    check(
      "the prospect's existing link still works",
      Boolean(afterMove?.zoomJoinUrl) && afterMove?.zoomJoinUrl === afterCreate?.zoomJoinUrl,
    );
    check(
      "zoomStartsAt followed the slot",
      Boolean(afterMove?.zoomStartsAt) && sameMinute(afterMove!.zoomStartsAt!, secondTime),
    );

    const moatZoom = meetingId ? await getZoomMeeting(meetingId) : null;
    check("Zoom still has it after the move", Boolean(moatZoom?.ok));

    // ── 4. A cancellation takes the room down with it ───────────────────────────────
    console.log(`\n${TAG} 4. cancel`);
    await prisma.bookingRequest.update({
      where: { id: booking.id },
      data: { status: "CANCELLED", slotId: null },
    });
    const removed = await syncBookingMeeting(booking.id);
    check("reconciler reports 'removed'", removed.outcome === "removed", removed.outcome);

    const afterCancel = await prisma.bookingRequest.findUnique({
      where: { id: booking.id },
      select: { zoomMeetingId: true, zoomJoinUrl: true, zoomStartUrl: true, zoomStartsAt: true },
    });
    check(
      "every zoom column was cleared",
      !afterCancel?.zoomMeetingId &&
        !afterCancel?.zoomJoinUrl &&
        !afterCancel?.zoomStartUrl &&
        !afterCancel?.zoomStartsAt,
    );

    const gone = meetingId ? await getZoomMeeting(meetingId) : null;
    check("Zoom no longer has the meeting", Boolean(gone && !gone.ok), gone && !gone.ok ? gone.error : "still there");
    if (gone && !gone.ok) meetingId = null; // nothing left to clean up
  } finally {
    // ── Clean up, whatever happened above ──────────────────────────────────────────
    console.log(`\n${TAG} cleanup`);
    if (meetingId) {
      const { deleteZoomMeeting } = await import("../src/lib/zoom");
      const out = await deleteZoomMeeting(meetingId);
      console.log(`  zoom meeting ${meetingId}: ${out.ok ? "deleted" : `NOT deleted - ${out.error}`}`);
    }
    await prisma.bookingRequest.deleteMany({ where: { id: booking.id } });
    await prisma.appointmentSlot.deleteMany({ where: { id: slot.id } });
    console.log("  test rows deleted");
    await prisma.$disconnect();
  }

  console.log(`\n${TAG} ${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(`${TAG} crashed:`, e);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});

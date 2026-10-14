-- Zoom meeting links for booked calls.
--
-- Purely ADDITIVE: five nullable columns, no defaults, no backfill, no constraint changes. Every
-- existing row keeps working with all five null, which is exactly the state a deployment with
-- Zoom unarmed stays in forever. Hand-written rather than generated so it can be read before it
-- is applied to a live database holding 23k+ leads.
--
-- `zoom_start_url` is the HOST link (it signs whoever opens it in as the host) and is deliberately
-- a separate column from the prospect-safe `zoom_join_url`.

ALTER TABLE "booking_request" ADD COLUMN "zoomMeetingId" TEXT;
ALTER TABLE "booking_request" ADD COLUMN "zoomJoinUrl" TEXT;
ALTER TABLE "booking_request" ADD COLUMN "zoomStartUrl" TEXT;

ALTER TABLE "outreach_journey" ADD COLUMN "zoomMeetingId" TEXT;

-- What the Zoom meeting is CURRENTLY scheduled for, so the reconciler can tell "Zoom already
-- agrees with the calendar" from "Zoom is stale and needs moving" without re-PATCHing everything.
ALTER TABLE "booking_request" ADD COLUMN "zoomStartsAt" TIMESTAMP(3);
ALTER TABLE "outreach_journey" ADD COLUMN "zoomStartsAt" TIMESTAMP(3);

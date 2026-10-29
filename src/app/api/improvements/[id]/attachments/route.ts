import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { ACTIVE } from "@/lib/soft-delete";
import { requireSession } from "@/lib/rbac";
import { takeToken } from "@/lib/rate-limit";
import {
  ATTACHMENT_MAX_BYTES,
  ATTACHMENT_MAX_COUNT,
  ATTACHMENT_MAX_TOTAL_BYTES,
  attachmentRejection,
  safeAttachmentName,
  sniffAttachment,
} from "@/lib/attachment";

/**
 * FILES ATTACHED TO ONE IMPROVEMENT REPORT - uploaded here, downloaded from the sibling route.
 *
 * The statement the figure should have matched, the invoice the student was sent, the
 * spreadsheet the real numbers live in, the photo of a broken screen taken on a phone. See
 * `src/lib/attachment.ts` for the allow-list, the caps and why text files are not on it.
 *
 * ── WHY A ROUTE HANDLER AND NOT THE SERVER ACTION ──────────────────────────────────────────
 * The same reason the recording route gives: `submitImprovement` is a server action and Next 14
 * caps an action's request body at 1 MB with nothing in `next.config.mjs` raising it. One
 * attachment may be 10 MB. So the report is created by the action exactly as it always was and
 * the files are posted here against the id it returns.
 *
 * The consequence is deliberate and the UI says so: if this upload fails, THE REPORT IS ALREADY
 * FILED. Losing an attachment must never lose the words.
 *
 * ── ONE FILE PER REQUEST, ON PURPOSE ───────────────────────────────────────────────────────
 * The form posts a batch of five as five requests rather than one multipart body of 20 MB. A
 * single request means one slow connection drops the whole set and the person is told "the
 * attachments did not upload" with no idea which; five means four can succeed, each is checked
 * against the budget as it arrives, and the one that failed can be named.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Five files per report and a 30-minute window, so the bucket is sized to let somebody file two
 * fully-loaded reports and still have room to fix a mistake. Charged to its own key, so a retry
 * storm on a flaky 10 MB upload cannot eat the allowance somebody needs to FILE their next
 * report - the same separation the recording route makes.
 */
const UPLOAD_RULE = { capacity: 24, refillPerSec: 24 / 1800 } as const;

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await requireSession();

  const gate = takeToken(`improvement-attachment:${session.user.id}`, UPLOAD_RULE);
  if (!gate.ok) {
    return NextResponse.json(
      { ok: false, error: "That is a lot of uploads in a short time. Give it a few minutes." },
      { status: 429, headers: { "Retry-After": String(gate.retryAfterSec) } },
    );
  }

  /**
   * Refused before the body is read, so an oversized upload is not buffered into memory first.
   * The real byte count is checked again below - a `Content-Length` is just a number somebody
   * sent us, and the one that matters is the length of the bytes actually in hand.
   */
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > ATTACHMENT_MAX_BYTES + 64 * 1024) {
    return NextResponse.json({ ok: false, error: "That file is too big" }, { status: 413 });
  }

  const report = await prisma.improvement.findFirst({
    where: { id: params.id, ...ACTIVE },
    select: {
      id: true,
      reporterId: true,
      // Shape only. Selecting `bytes` here to count the files would load every attachment already
      // on the report in order to add one more.
      attachments: { select: { size: true } },
    },
  });
  /**
   * One 404 for "no such report" AND "not yours", like the recording route: nobody has business
   * learning whether a given id exists on somebody else's report.
   *
   * Reporter-only, and NOT "anyone who can triage". An attachment is part of the reporter's own
   * account of what happened, and a triager with a document to add has `ImprovementEvent`
   * comments. It also keeps the provenance question simple: every file on a report came from the
   * person who filed it.
   */
  if (!report || report.reporterId !== session.user.id) {
    return NextResponse.json({ ok: false, error: "Report not found" }, { status: 404 });
  }

  let file: File | null = null;
  try {
    const body = await req.formData();
    const f = body.get("file");
    if (f instanceof File) file = f;
  } catch {
    return NextResponse.json({ ok: false, error: "Could not read the upload" }, { status: 400 });
  }
  if (!file) return NextResponse.json({ ok: false, error: "No file provided" }, { status: 400 });

  const buf = Buffer.from(await file.arrayBuffer());

  /**
   * THE CAPS, from the same function the picker calls.
   *
   * Checked against the bytes in hand and against what the report already holds, so the budget
   * cannot be beaten by posting five files at once: each request re-reads the current total. The
   * refusal text comes from that shared function too - the form that stopped somebody and the
   * server that would have stopped them should not give different reasons.
   */
  const rejection = attachmentRejection(report.attachments, { size: buf.length, name: file.name });
  if (rejection) {
    const status = report.attachments.length >= ATTACHMENT_MAX_COUNT ? 409 : 413;
    return NextResponse.json(
      { ok: false, error: rejection },
      { status: buf.length === 0 ? 400 : status },
    );
  }

  /**
   * THE TYPE COMES FROM THE BYTES, NEVER FROM THE REQUEST.
   *
   * Whatever is stored here is handed back as the `Content-Type` of a download response from this
   * origin, so trusting the browser's header - or the filename - would let a session holder store
   * HTML and have a browser run it. The filename is passed in for ONE purpose: choosing between
   * members of the Office families, whose headers are identical. `sniffAttachment` explains why
   * that is safe.
   */
  const sniffed = sniffAttachment(new Uint8Array(buf.subarray(0, 32)), file.name);
  if (!sniffed) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "That file type is not accepted. Send a PDF, a Word or Excel document, a PowerPoint, or an image.",
      },
      { status: 415 },
    );
  }

  const filename = safeAttachmentName(file.name, sniffed.ext);
  const created = await prisma.improvementAttachment.create({
    data: {
      reportId: report.id,
      bytes: buf,
      filename,
      mimeType: sniffed.mime,
      size: buf.length,
      sha256: createHash("sha256").update(buf).digest("hex"),
      uploadedById: session.user.id,
    },
    select: { id: true, filename: true, size: true, mimeType: true },
  });

  /**
   * REVALIDATE, BECAUSE THE ACTION ALREADY DID IT TOO EARLY.
   *
   * `submitImprovement` calls `revalidatePath("/improvements")` as it writes the row - necessarily
   * BEFORE this request exists, since the files can only be posted once the id comes back. So the
   * queue was re-rendered at a moment when the report genuinely had no attachments, and without
   * this it keeps that answer: the rows are in the database, the files are not on the screen, and
   * nothing will ever go and look again.
   *
   * This exact bug shipped once with recordings, found by somebody who recorded a note and could
   * not see it. The client calls `router.refresh()` as well, for the page the person is standing
   * on; this one is for every other viewer of the queue.
   */
  revalidatePath("/improvements");

  return NextResponse.json({ ok: true, attachment: created });
}

/**
 * What one report is carrying. Shape only, never the bytes.
 *
 * The triage screen gets this list from its own server query; this exists for the form, which
 * needs to show what has landed so far without being told to trust its own optimistic state.
 */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await requireSession();

  const report = await prisma.improvement.findFirst({
    where: { id: params.id, ...ACTIVE },
    select: { reporterId: true },
  });
  if (!report || report.reporterId !== session.user.id) {
    return NextResponse.json({ ok: false, error: "Report not found" }, { status: 404 });
  }

  const rows = await prisma.improvementAttachment.findMany({
    where: { reportId: params.id },
    orderBy: { createdAt: "asc" },
    select: { id: true, filename: true, mimeType: true, size: true, createdAt: true },
  });

  return NextResponse.json(
    {
      ok: true,
      attachments: rows,
      remaining: {
        files: Math.max(0, ATTACHMENT_MAX_COUNT - rows.length),
        bytes: Math.max(0, ATTACHMENT_MAX_TOTAL_BYTES - rows.reduce((s, r) => s + r.size, 0)),
      },
    },
    { headers: { "Cache-Control": "private, no-store, max-age=0" } },
  );
}

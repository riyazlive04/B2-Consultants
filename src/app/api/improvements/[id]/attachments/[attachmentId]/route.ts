import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ACTIVE } from "@/lib/soft-delete";
import { requireSession } from "@/lib/rbac";
import { canReadImprovementMedia } from "@/lib/improvement-access";

/**
 * Download one file attached to an improvement report.
 *
 * Who may read it is decided by `canReadImprovementMedia` and nowhere else: the founder, the
 * developer, the head coach, and the reporter themselves. The reporter is included because they
 * can already see their own report, and one whose own author cannot open what they sent is a
 * confusing thing to own.
 *
 * `attachmentId` is checked AGAINST the report in the path rather than looked up on its own, the
 * same way the agreement attachment route does it. Both are opaque cuids, so guessing one is not
 * a realistic attack - but a scoped query means a mismatched pair is a 404 rather than a file
 * served from under a different report, and that is one fewer thing to reason about.
 *
 * ── ALWAYS `attachment`, NEVER `inline` - INCLUDING FOR IMAGES ─────────────────────────────
 * This is the opposite of what the recording route does, and the difference is the point. A
 * recording HAS to be inline, because a player cannot play bytes it was handed as a download, and
 * what it serves is narrowed by our own sniff to five media types a browser only ever decodes.
 *
 * An attachment is a document. The set includes PDF, which a browser renders with a full document
 * viewer, and the people opening these are the founder and the developer - the two accounts worth
 * the most to anybody who got a login. Handing them a download does the same job for a reader and
 * renders nothing on this origin, so there is no reason to take the other trade. Images are not
 * carved out: one rule for every attachment is a rule that stays true after somebody adds a
 * format to the allow-list.
 *
 * No preview is offered in the UI for the same reason, and that cost is real and accepted: triage
 * must download a screenshot to look at it.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: { id: string; attachmentId: string } },
) {
  const session = await requireSession();

  const row = await prisma.improvementAttachment.findFirst({
    where: { id: params.attachmentId, reportId: params.id, report: { ...ACTIVE } },
    select: {
      bytes: true,
      mimeType: true,
      filename: true,
      uploadedById: true,
      report: { select: { reporterId: true } },
    },
  });
  if (!row) return new NextResponse("Not found", { status: 404 });

  // ONE rule, shared with the recording route and the triage screen. Never re-derived here -
  // see the note in `lib/improvement-access.ts` about the head coach going missing.
  if (!canReadImprovementMedia(session, {
    reporterId: row.report.reporterId,
    uploadedById: row.uploadedById,
  })) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const bytes = Buffer.from(row.bytes);
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": row.mimeType,
      "Content-Length": String(bytes.length),
      /**
       * The filename is already rebuilt from a safe character set at upload
       * (`safeAttachmentName`), so the quote strip here is belt and braces on the one header
       * where a stray quote would break out of its parameter.
       */
      "Content-Disposition": `attachment; filename="${row.filename.replace(/"/g, "")}"`,
      // Private, like every other authenticated document this app serves. Nothing that might show
      // a student's record should sit in a shared cache.
      "Cache-Control": "private, no-store, max-age=0",
      // The type is from our own sniff, but belt-and-braces on a file we did not author.
      "X-Content-Type-Options": "nosniff",
    },
  });
}

import { NextResponse } from "next/server";
import { requireSession } from "@/lib/rbac";
import { hasCapability } from "@/lib/capabilities";
import { getTerminationReport } from "@/server/termination-report";
import { renderTerminationReportPdf } from "@/documents/termination-report";

/**
 * The offboarding record as a PDF.
 *
 * Gated on `users.manage` — the same capability that can actually terminate someone. A section
 * check would not be enough: `people` is Admin-only today, but the capability is delegable, and
 * this document carries one person's pay and performance. Whoever may offboard them may read it;
 * nobody else may.
 *
 * `no-store` because the content is personal and the document is generated on demand — a cached
 * copy sitting in a shared proxy is exactly what should not happen to this.
 */

export const runtime = "nodejs"; // @react-pdf/renderer is a Node library
export const dynamic = "force-dynamic";

function safeName(s: string): string {
  const base = s.trim().replace(/[^\p{L}\p{N}\-_ ]/gu, "").replace(/\s+/g, "_").slice(0, 60);
  return base || "team-member";
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await requireSession();
  if (!hasCapability(session.role, session.capabilities, "users.manage")) {
    return new NextResponse("You don't have access to offboarding records.", { status: 403 });
  }

  const report = await getTerminationReport(params.id);
  if (!report) return new NextResponse("Team member not found", { status: 404 });

  try {
    const bytes = await renderTerminationReportPdf(report);
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Length": String(bytes.length),
        "Content-Disposition": `attachment; filename="${safeName(report.profile.name)}_offboarding.pdf"`,
        "Cache-Control": "private, no-store, max-age=0",
      },
    });
  } catch (err) {
    console.error("termination report render failed:", err);
    return new NextResponse("Couldn't generate that report.", { status: 500 });
  }
}

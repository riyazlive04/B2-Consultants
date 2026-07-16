import { NextResponse } from "next/server";
import { requireSession, resolveSections, sectionAllowed } from "@/lib/rbac";
import { getSectionsConfig } from "@/server/founder-config";
import { getResumeForRender, getResumeTemplate } from "@/server/resume-metrics";
import { renderResumePdf } from "@/documents/resume-pdf";
import { renderResumeDocx } from "@/documents/resume-docx";

/**
 * Authenticated CV export. `?format=pdf` (default) or `?format=docx`. Gated to the
 * cv-check section exactly like /api/cv-extract, so only coaches/students who can open
 * the Studio can download a CV. Rendered on demand from the stored ResumeData.
 */

export const runtime = "nodejs"; // @react-pdf/renderer + docx are Node libraries
export const dynamic = "force-dynamic";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function safeName(s: string): string {
  const base = s.trim().replace(/[^\p{L}\p{N}\-_ ]/gu, "").replace(/\s+/g, "_").slice(0, 60);
  return base || "resume";
}

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const session = await requireSession();
  const section = resolveSections(await getSectionsConfig()).find((s) => s.key === "cv-check");
  if (!section || !sectionAllowed(section, session.role, session.overrides)) {
    return new NextResponse("You don't have access to the CV Studio.", { status: 403 });
  }

  const [resume, template] = await Promise.all([getResumeForRender(params.id), getResumeTemplate()]);
  if (!resume) return new NextResponse("CV not found", { status: 404 });

  const format = new URL(req.url).searchParams.get("format") === "docx" ? "docx" : "pdf";
  const filename = `${safeName(resume.data.header.fullName || resume.title)}_CV`;

  try {
    if (format === "docx") {
      const bytes = await renderResumeDocx(resume.data, template, resume.language);
      return new NextResponse(new Uint8Array(bytes), {
        headers: {
          "Content-Type": DOCX_MIME,
          "Content-Length": String(bytes.length),
          "Content-Disposition": `attachment; filename="${filename}.docx"`,
          "Cache-Control": "private, no-store, max-age=0",
        },
      });
    }
    const bytes = await renderResumePdf(resume.data, template, resume.language);
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Length": String(bytes.length),
        "Content-Disposition": `attachment; filename="${filename}.pdf"`,
        "Cache-Control": "private, no-store, max-age=0",
      },
    });
  } catch (err) {
    console.error("resume export failed:", err);
    return new NextResponse("Couldn't generate that file.", { status: 500 });
  }
}

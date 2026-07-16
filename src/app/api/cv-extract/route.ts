import { NextResponse } from "next/server";
import mammoth from "mammoth";
import pdfParse from "pdf-parse";
import { requireSession, resolveSections, sectionAllowed } from "@/lib/rbac";
import { getSectionsConfig } from "@/server/founder-config";

/**
 * CV-upload text extractor for the CV Diagnostic (report §3.C).
 *
 * STATELESS BY DESIGN: the uploaded file is parsed in memory and the extracted
 * text is returned to the browser. Nothing is written to disk or the database -
 * the feature's promise ("nothing is saved") holds, and the deterministic scoring
 * still happens client-side. This route only turns a .pdf/.docx/.txt into plain
 * text so the coach doesn't have to copy-paste.
 */

export const runtime = "nodejs"; // mammoth + pdf-parse are Node libraries (Buffer, no edge)
export const dynamic = "force-dynamic";

const MAX_BYTES = 8 * 1024 * 1024; // 8 MB — a CV is a few hundred KB; this is generous
const PDF = "application/pdf";
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function tidy(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function POST(req: Request) {
  // Auth + section gate. requireSession redirects unauthenticated callers (fails
  // closed); an authenticated user without cv-check access gets a clean 403.
  const session = await requireSession();
  const section = resolveSections(await getSectionsConfig()).find((s) => s.key === "cv-check");
  if (!section || !sectionAllowed(section, session.role, session.overrides)) {
    return NextResponse.json({ error: "You don't have access to the CV Diagnostic." }, { status: 403 });
  }

  let file: File | null = null;
  try {
    const form = await req.formData();
    const f = form.get("file");
    if (f instanceof File) file = f;
  } catch {
    return NextResponse.json({ error: "Couldn't read the upload." }, { status: 400 });
  }
  if (!file) return NextResponse.json({ error: "No file received." }, { status: 400 });
  if (file.size === 0) return NextResponse.json({ error: "That file is empty." }, { status: 400 });
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "File is too large (max 8 MB)." }, { status: 413 });
  }

  const name = file.name.toLowerCase();
  const type = file.type || "";
  const buffer = Buffer.from(await file.arrayBuffer());

  try {
    let text = "";
    if (name.endsWith(".docx") || type === DOCX) {
      const { value } = await mammoth.extractRawText({ buffer });
      text = value;
    } else if (name.endsWith(".pdf") || type === PDF) {
      const data = await pdfParse(buffer);
      text = data.text;
    } else if (name.endsWith(".txt") || type.startsWith("text/")) {
      text = buffer.toString("utf8");
    } else if (name.endsWith(".doc")) {
      return NextResponse.json(
        { error: "Legacy .doc isn't supported — re-save as .docx or PDF, or paste the text." },
        { status: 415 },
      );
    } else {
      return NextResponse.json(
        { error: "Unsupported file. Upload a .pdf, .docx or .txt — or paste the text." },
        { status: 415 },
      );
    }

    text = tidy(text);
    if (!text) {
      return NextResponse.json(
        { error: "No selectable text found — a scanned/image PDF can't be read. Paste the text instead." },
        { status: 422 },
      );
    }
    return NextResponse.json({ text, filename: file.name, chars: text.length });
  } catch (err) {
    console.error("cv-extract failed:", err);
    return NextResponse.json({ error: "Couldn't extract text from that file." }, { status: 500 });
  }
}

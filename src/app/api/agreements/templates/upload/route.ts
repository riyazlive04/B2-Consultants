import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { hasCapability, requireSession } from "@/lib/rbac";
import { clientIpFrom, rateLimitOk } from "@/lib/rate-limit";
import { logActivity } from "@/server/activity-log";
import { parseUpload } from "@/server/agreement-upload";
import { describeFields } from "@/lib/agreement-doc";

/**
 * Upload an agreement document: either as a NEW template, or as a new version of an existing one.
 *
 * A route handler rather than a server action, for the reason `/api/form-upload` already gives:
 * actions cannot stream a file body, so the whole payload would be serialised into the action
 * argument and hit Next's request-body cap. Everything else about the template library is a
 * server action (`server/agreement-template-actions.ts`).
 *
 * ── GATING ──────────────────────────────────────────────────────────────────────────────────
 * Session + `agreements.issue`, the same capability that can countersign and send a contract.
 * This is not a general uploader: the bytes land in a `bytea` on a row only this capability can
 * reach, never in the public Supabase bucket, and `parseUpload` sniffs the magic number rather
 * than trusting the filename or the browser's Content-Type.
 *
 * ── VERSIONS ARE ALLOCATED UNDER A UNIQUE INDEX ─────────────────────────────────────────────
 * `(templateId, version)` is unique, so two uploads racing each other produce a P2002 rather than
 * two v3s, and the loser retries. Same pattern as `nextDocumentNo`.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const session = await requireSession();
  if (!hasCapability(session.role, session.capabilities, "agreements.issue")) {
    return NextResponse.json({ ok: false, error: "You cannot manage agreement templates." }, { status: 403 });
  }
  const ip = clientIpFrom(new Headers(req.headers));
  // Parsing a document is CPU-bound and writes megabytes. Capped even for a trusted session.
  if (!rateLimitOk(`agr:tpl:upload:${session.user.id}:${ip}`, 30, 60 * 60_000)) {
    return NextResponse.json({ ok: false, error: "Too many uploads. Wait a few minutes." }, { status: 429 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ ok: false, error: "That upload could not be read." }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ ok: false, error: "Choose a .docx or .pdf file." }, { status: 400 });
  }
  const templateId = typeof form.get("templateId") === "string" ? String(form.get("templateId")) : null;
  const name = String(form.get("name") ?? "").trim().slice(0, 120);
  const description = String(form.get("description") ?? "").trim().slice(0, 500);
  const label = String(form.get("label") ?? "").trim().slice(0, 120);

  const parsed = await parseUpload({
    bytes: Buffer.from(await file.arrayBuffer()),
    filename: file.name,
  });
  if (!parsed.ok) return NextResponse.json(parsed, { status: 400 });

  const payload = {
    kind: parsed.kind,
    blocks:
      parsed.kind === "DOCX" ? (parsed.blocks as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
    sourceBytes: parsed.bytes,
    sourceName: parsed.sourceName,
    sourceMime: parsed.sourceMime,
    sourceSize: parsed.sourceSize,
    sourceSha256: parsed.sourceSha256,
    pageCount: parsed.kind === "PDF" ? parsed.pageCount : null,
    pageSizes:
      parsed.kind === "PDF" ? (parsed.pageSizes as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
    /**
     * Both kinds can arrive with fields already on them, by different routes: a DOCX carries
     * whatever its `[[sign:…]]` placeholders created, and a fillable PDF carries whatever its own
     * form boxes declared (`agreement-acroform.ts`). Either way they are a starting point the
     * founder corrects in the designer, not a finished markup.
     */
    fields: parsed.fields as unknown as Prisma.InputJsonValue,
    createdById: session.user.id,
    label: label || null,
  };

  // ── A new version of an existing template ──
  if (templateId) {
    const template = await prisma.agreementTemplate.findUnique({
      where: { id: templateId },
      select: { id: true, name: true, kind: true },
    });
    if (!template) {
      return NextResponse.json({ ok: false, error: "That template no longer exists." }, { status: 404 });
    }
    /**
     * A template cannot change kind, and this is the check that holds the line.
     *
     * Its versions' fields are either in-flow anchors (DOCX) or page coordinates (PDF). Letting a
     * PDF become v4 of a Word template would leave every agreement drawn from it carrying field
     * placements that mean nothing against the new body.
     */
    if (template.kind !== parsed.kind) {
      return NextResponse.json(
        {
          ok: false,
          error: `“${template.name}” is a ${template.kind === "DOCX" ? "Word" : "PDF"} template. Upload a ${
            template.kind === "DOCX" ? ".docx" : ".pdf"
          } file, or create a new template for this one.`,
        },
        { status: 400 },
      );
    }

    for (let attempt = 0; attempt < 5; attempt++) {
      const last = await prisma.agreementTemplateVersion.findFirst({
        where: { templateId },
        orderBy: { version: "desc" },
        select: { version: true },
      });
      const version = (last?.version ?? 0) + 1;
      try {
        const created = await prisma.agreementTemplateVersion.create({
          data: { ...payload, templateId, version },
          select: { id: true, version: true },
        });
        // A new upload becomes the version new agreements are drawn from. The founder can point
        // it back at an older one from the template screen.
        await prisma.agreementTemplate.update({
          where: { id: templateId },
          data: { currentVersionId: created.id },
        });
        await logActivity(session, {
          action: "agreement.template.version.create",
          section: "agreements",
          entityType: "AgreementTemplate",
          entityId: templateId,
          summary: `Uploaded v${created.version} of the agreement template “${template.name}”`,
          meta: { file: parsed.sourceName, kind: parsed.kind, bytes: parsed.sourceSize },
        });
        return NextResponse.json({
          ok: true,
          templateId,
          versionId: created.id,
          version: created.version,
          kind: parsed.kind,
          warnings: parsed.warnings,
          fieldSummary: describeFields(parsed.fields),
        });
      } catch (e) {
        if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== "P2002") throw e;
      }
    }
    return NextResponse.json({ ok: false, error: "Could not allocate a version. Try again." }, { status: 409 });
  }

  // ── A brand new template ──
  if (name.length < 2) {
    return NextResponse.json({ ok: false, error: "Give the template a name." }, { status: 400 });
  }

  const template = await prisma.agreementTemplate.create({
    data: {
      name,
      description: description || null,
      kind: parsed.kind,
      createdById: session.user.id,
      versions: { create: { ...payload, version: 1 } },
    },
    select: { id: true, versions: { select: { id: true } } },
  });
  const versionId = template.versions[0]!.id;
  await prisma.agreementTemplate.update({
    where: { id: template.id },
    data: { currentVersionId: versionId },
  });

  await logActivity(session, {
    action: "agreement.template.create",
    section: "agreements",
    entityType: "AgreementTemplate",
    entityId: template.id,
    summary: `Created the agreement template “${name}” from ${parsed.sourceName}`,
    meta: { kind: parsed.kind, bytes: parsed.sourceSize },
  });

  return NextResponse.json({
    ok: true,
    templateId: template.id,
    versionId,
    version: 1,
    kind: parsed.kind,
    warnings: parsed.warnings,
    fieldSummary: describeFields(parsed.fields),
  });
}

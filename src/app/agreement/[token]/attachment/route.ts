import { NextResponse } from "next/server";
import { clientIpFrom, rateLimitOk } from "@/lib/rate-limit";
import { uploadedBodyFor } from "@/server/agreement-body";
import { loadAgreementByToken, recordAgreementEvent } from "@/server/agreement-core";
import { loadSignerByToken } from "@/server/agreement-signers";
import { storeAgreementAttachment } from "@/server/agreement-attachments";
import type { SignerRole } from "@/lib/agreement-doc";

/**
 * A signer uploading a file into an ATTACHMENT box, mid-ceremony.
 *
 * PUBLIC, because the person uploading their ID has no account - the token is the only credential.
 * A route handler rather than a server action for the same reason as the founder's uploads: a file
 * body cannot ride in an action argument.
 *
 * ── THE TOKEN DECIDES WHO THIS IS ───────────────────────────────────────────────────────────
 * The same URL serves the student and a co-signer, and which one the caller is comes from which
 * table the token resolves in - never from the request. That is what stops a guardian uploading
 * into the student's box, and it is the same dispatch the signing page itself uses.
 *
 * Everything else about what may be stored is in `agreement-attachments.ts`: bound to a field of
 * the right kind and owner, magic-byte sniffed, size capped, one file per box, and refused once
 * the agreement is sealed.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: { token: string } }) {
  const ip = clientIpFrom(new Headers(req.headers));
  // Public and it writes megabytes, so the bucket is tight. Generous enough for a signer who
  // photographs their passport three times before they are happy with it.
  if (!rateLimitOk(`agr:attach:ip:${ip}`, 20, 60 * 60_000)) {
    return NextResponse.json({ ok: false, error: "Too many uploads. Wait a few minutes." }, { status: 429 });
  }

  const who = await resolveSigner(params.token);
  if (!who) {
    return NextResponse.json({ ok: false, error: "This signing link is not valid." }, { status: 404 });
  }

  const body = await uploadedBodyFor(who.agreementId);
  if (!body) {
    return NextResponse.json(
      { ok: false, error: "This agreement has no document to attach anything to." },
      { status: 422 },
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ ok: false, error: "That upload could not be read." }, { status: 400 });
  }

  const fieldId = String(form.get("fieldId") ?? "");
  const file = form.get("file");
  if (!fieldId || !(file instanceof File)) {
    return NextResponse.json({ ok: false, error: "Choose a file to attach." }, { status: 400 });
  }

  const stored = await storeAgreementAttachment({
    agreementId: who.agreementId,
    fields: body.fields,
    fieldId,
    role: who.role,
    filename: file.name,
    bytes: Buffer.from(await file.arrayBuffer()),
  });
  if (!stored.ok) return NextResponse.json(stored, { status: 400 });

  await recordAgreementEvent(who.agreementId, "ATTACHMENT_UPLOADED", {
    ip,
    userAgent: req.headers.get("user-agent"),
    meta: {
      fieldId,
      role: who.role,
      filename: stored.filename,
      size: stored.size,
      sha256: stored.sha256,
    },
  });

  // The filename is what the document PRINTS, so the ceremony puts it in its field values.
  return NextResponse.json({ ok: true, filename: stored.filename, size: stored.size });
}

/**
 * Which counterparty is holding this token - the student, or a co-signer?
 *
 * Tried in that order because the student's is the common case. A token that resolves in neither
 * table, or whose ceremony is closed, is simply "not valid": an upload endpoint must not become an
 * oracle that distinguishes an expired link from a wrong one.
 */
async function resolveSigner(
  token: string,
): Promise<{ agreementId: string; role: SignerRole } | null> {
  const student = await loadAgreementByToken(token);
  if (student.ok) return { agreementId: student.row.id, role: "STUDENT" };

  const signer = await loadSignerByToken(token);
  if (signer.ok) return { agreementId: signer.row.agreementId, role: signer.row.role as SignerRole };

  return null;
}
